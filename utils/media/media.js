"use strict";

const fs         = require("fs");
const path       = require("path");
const axios      = require("axios");
const FormData   = require("form-data");
const { execSync } = require("child_process");
function githubApiHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// ── Đường dẫn ─────────────────────────────────────────────────────────────────

const ROOT         = process.cwd();
const LINKS_FILE   = path.join(ROOT, "includes", "data", "githubMediaLinks.json");
const INDEX_FILE   = path.join(ROOT, "includes", "data", "dataCache.json");
const VIDEO_DIR    = path.join(ROOT, "includes", "cache", "videos");
const THUMB_DIR    = path.join(ROOT, "includes", "cache", "thumbs");
const tempDir      = path.join(ROOT, "includes", "cache", "temp");

if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureDirs() {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  fs.mkdirSync(THUMB_DIR, { recursive: true });
}

function getConfig() {
  if (global.config) return global.config;
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
  } catch (e) {
    throw new Error(`[media] Không đọc được config.json: ${e.message}`);
  }
}

function readLinks() {
  try {
    if (fs.existsSync(LINKS_FILE)) return JSON.parse(fs.readFileSync(LINKS_FILE, "utf8"));
  } catch (_) {}
  return {};
}

function loadIndex() {
  try {
    if (fs.existsSync(INDEX_FILE)) return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  } catch (_) {}
  return [];
}

function saveIndex(arr) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(arr, null, 2), "utf8");
}

// ── Media Cache: decode từ GitHub ────────────────────────────────────────────

async function decodeFromApiUrl(apiUrl, outputPath, token) {
  const res = await axios.get(apiUrl, {
    headers: githubApiHeaders(token),
    timeout: 90000,
  });

  const b64         = res.data?.content;
  const downloadUrl = res.data?.download_url;

  // File nhỏ (<1MB): GitHub trả về base64 content
  if (b64 && b64.trim().length > 0) {
    const buffer = Buffer.from(b64.replace(/\n/g, ""), "base64");
    fs.writeFileSync(outputPath, buffer);
    return buffer.length;
  }

  // File lớn (>1MB): GitHub không trả content — tải thẳng từ download_url
  if (downloadUrl) {
    const dl = await axios.get(downloadUrl, {
      responseType: "arraybuffer",
      timeout: 120000,
      maxContentLength: 200 * 1024 * 1024,
    });
    const buffer = Buffer.from(dl.data);
    fs.writeFileSync(outputPath, buffer);
    return buffer.length;
  }

  throw new Error("GitHub không trả về content base64 và không có download_url");
}

function getVideoMeta(filePath) {
  try {
    const out  = execSync(
      `ffprobe -v error -show_format -show_streams -of json "${filePath}"`,
      { timeout: 15000, stdio: "pipe" }
    ).toString();
    const data = JSON.parse(out);
    const vs   = data.streams?.find(s => s.codec_type === "video");
    return {
      width:    vs?.width    || 0,
      height:   vs?.height   || 0,
      duration: Math.round(parseFloat(data.format?.duration || 0)),
    };
  } catch (_) {
    return { width: 0, height: 0, duration: 0 };
  }
}

function createThumb(videoPath, baseName) {
  const tmpJpg   = path.join(THUMB_DIR, `${baseName}.jpg`);
  const finalBin = path.join(THUMB_DIR, `${baseName}.bin`);
  try {
    execSync(
      `ffmpeg -y -i "${videoPath}" -ss 0 -vframes 1 -vf scale=320:-1 -q:v 5 "${tmpJpg}"`,
      { timeout: 15000, stdio: "pipe" }
    );
    if (fs.existsSync(tmpJpg)) {
      fs.renameSync(tmpJpg, finalBin);
      return `${baseName}.bin`;
    }
  } catch (_) {}
  return null;
}

async function decodeOne(key, opts = {}) {
  const { force = false, onLog = () => {} } = opts;

  const cfg   = getConfig();
  const token = cfg.githubToken;
  if (!token) throw new Error("[media] Thiếu config.githubToken");

  const links = readLinks();
  const entry = links[key];
  if (!entry) throw new Error(`[media] Không tìm thấy key "${key}" trong githubMediaLinks.json`);

  ensureDirs();

  const ext        = entry.ext || ".mp4";
  const fileName   = `${key}${ext}`;
  const cachedPath = path.join(VIDEO_DIR, fileName);

  if (!force && fs.existsSync(cachedPath) && fs.statSync(cachedPath).size > 0) {
    onLog(`[cache hit] ${key}`);
    return cachedPath;
  }

  onLog(`[decode] ${key} — đang giải mã từ GitHub...`);

  try {
    const bytes = await decodeFromApiUrl(entry.apiUrl, cachedPath, token);
    onLog(`[decode] ${key} — ${(bytes / 1024).toFixed(1)} KB`);
    return cachedPath;
  } catch (e) {
    onLog(`[decode] ${key} — ${e.message}`);
    try { fs.unlinkSync(cachedPath); } catch (_) {}
    return null;
  }
}

async function processAll(opts = {}) {
  const { onLog = console.log, onProgress, force = false } = opts;

  ensureDirs();

  const cfg   = getConfig();
  const token = cfg.githubToken;
  if (!token) throw new Error("[media] Thiếu config.githubToken trong config.json");

  const links = readLinks();
  const keys  = Object.keys(links);

  if (keys.length === 0) {
    onLog("githubMediaLinks.json trống. Chưa có file nào được upload.");
    return { success: 0, fail: 0, total: 0, saved: 0 };
  }

  const index      = loadIndex();
  const cachedKeys = new Set(index.map(e => e.key));
  const pending    = force ? keys : keys.filter(k => !cachedKeys.has(k));

  if (pending.length === 0) {
    onLog(`Không có entry mới. Tổng cache: ${index.length} file.`);
    return { success: 0, fail: 0, total: 0, saved: index.length };
  }

  onLog(`Cần giải mã: ${pending.length} entry mới (tổng: ${keys.length})`);

  let successCount = 0;
  let failCount    = 0;

  for (let i = 0; i < pending.length; i++) {
    const key    = pending[i];
    const entry  = links[key];
    const ext    = entry.ext || ".mp4";
    const isVideo = [".mp4", ".mkv", ".avi", ".mov", ".webm"].includes(ext);

    const label      = `[${i + 1}/${pending.length}]`;
    const fileName   = `${key}${ext}`;
    const cachedPath = path.join(VIDEO_DIR, fileName);

    onLog(`${label} Giải mã: ${key}${ext}`);

    try {
      const bytes = await decodeFromApiUrl(entry.apiUrl, cachedPath, token);
      onLog(`${label} Đã lưu — ${(bytes / 1024).toFixed(1)} KB`);

      let meta      = { width: 0, height: 0, duration: 0 };
      let thumbName = null;

      if (isVideo) {
        meta      = getVideoMeta(cachedPath);
        thumbName = createThumb(cachedPath, key);
        onLog(`${label} ${meta.width}x${meta.height} | ${meta.duration}s${thumbName ? " | thumb OK" : ""}`);
      }

      const existingIdx = index.findIndex(e => e.key === key);
      const record = {
        key,
        rawUrl:     entry.rawUrl,
        apiUrl:     entry.apiUrl,
        cachedPath: path.relative(ROOT, cachedPath),
        ext,
        isVideo,
        width:      meta.width,
        height:     meta.height,
        duration:   meta.duration,
        thumbnail:  thumbName,
        cachedAt:   new Date().toISOString(),
      };

      if (existingIdx >= 0) index[existingIdx] = record;
      else index.push(record);

      saveIndex(index);
      successCount++;
    } catch (e) {
      onLog(`${label} Lỗi: ${e.message}`);
      try { if (fs.existsSync(cachedPath)) fs.unlinkSync(cachedPath); } catch (_) {}
      failCount++;
    }

    onProgress?.({ done: i + 1, total: pending.length, success: successCount, fail: failCount });
  }

  onLog(`\nHoàn tất! Thành công: ${successCount} | Lỗi: ${failCount} | Tổng cache: ${index.length}`);
  return { success: successCount, fail: failCount, total: pending.length, saved: index.length };
}

function pickRandom(opts = {}) {
  const index = loadIndex();
  if (index.length === 0) return null;

  let pool = index.filter(e => {
    const full = path.join(ROOT, e.cachedPath);
    return fs.existsSync(full) && fs.statSync(full).size > 0;
  });

  if (opts.videoOnly) pool = pool.filter(e => e.isVideo);
  if (opts.ext)       pool = pool.filter(e => e.ext === opts.ext);

  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Upload: gửi video/voice/ảnh lên Zalo ─────────────────────────────────────

function logMessageToFile(message, type = "general") {
  try {
    const logDir = path.join(ROOT, "logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

    const fileName = `${type}_${new Date().toISOString().split("T")[0]}.log`;
    const filePath = path.join(logDir, fileName);

    const timestamp = new Date().toLocaleString();
    fs.appendFileSync(filePath, `[${timestamp}] ${message}\n`);
  } catch (e) {}
}

function cleanTempFiles() {
  try {
    if (!fs.existsSync(tempDir)) return;
    const files = fs.readdirSync(tempDir);
    const now = Date.now();
    files.forEach((file) => {
      const filePath = path.join(tempDir, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > 5 * 60 * 1000) fs.unlinkSync(filePath);
      } catch (e) {}
    });
  } catch (e) {}
}

function cleanupOldFiles() {
  const extensions = [".mp4", ".mp3", ".aac", ".jpg", ".jpeg", ".png", ".webp", ".tmp"];
  const now = Date.now();
  const maxAge = 5 * 60 * 1000;

  const targets = [
    ROOT,
    path.join(ROOT, "src", "modules", "cache"),
    tempDir,
  ];

  targets.forEach((dir) => {
    try {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir);
      files.forEach((file) => {
        const ext = path.extname(file).toLowerCase();
        if (extensions.includes(ext)) {
          const fullPath = path.join(dir, file);
          try {
            if (ext === ".ttf") return;
            const stats = fs.statSync(fullPath);
            if (now - stats.mtimeMs > maxAge) fs.unlinkSync(fullPath);
          } catch (e) {}
        }
      });
    } catch (e) {}
  });
}

async function extractAndUploadThumb(api, videoPath) {
  const thumbPath = path.join(tempDir, `thumb_${Date.now()}.jpg`);
  try {
    execSync(
      `ffmpeg -y -i "${videoPath}" -ss 0 -vframes 1 -q:v 5 "${thumbPath}"`,
      { stdio: "pipe", timeout: 15000 }
    );
    if (!fs.existsSync(thumbPath)) return null;

    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", fs.createReadStream(thumbPath), {
      filename: path.basename(thumbPath),
      contentType: "image/jpeg",
    });

    const res = await axios.post("https://catbox.moe/user/api.php", form, {
      headers: form.getHeaders(),
      timeout: 20000,
    });

    const url = typeof res.data === "string" ? res.data.trim() : null;
    return url && url.startsWith("https://") ? url : null;
  } catch (e) {
    return null;
  } finally {
    try { fs.unlinkSync(thumbPath); } catch (_) {}
  }
}

async function sendVideo(api, tmpPath, threadId, threadType, meta = {}) {
  if (!fs.existsSync(tmpPath)) throw new Error(`File không tồn tại: ${tmpPath}`);

  let uploads;
  try {
    uploads = await api.uploadAttachment([tmpPath], threadId, threadType);
  } catch (e) {
    throw new Error(`[uploadAttachment lỗi] ${e?.message || e}`);
  }

  if (!uploads || uploads.length === 0 || !uploads[0]?.fileUrl) {
    throw new Error(`uploadAttachment không trả về fileUrl (${path.basename(tmpPath)})`);
  }

  const { fileUrl, fileName, totalSize } = uploads[0];
  const videoUrl = fileName ? `${fileUrl}/${fileName}` : fileUrl;
  const width    = meta.width    || 1280;
  const height   = meta.height   || 720;
  const duration = meta.duration || 0;
  const msg      = meta.msg || "";
  const fileSize = totalSize || 0;

  let thumb = meta.thumbnailUrl || "";
  if (!thumb) {
    thumb = await extractAndUploadThumb(api, tmpPath) || "";
  }

  try {
    return await api.sendVideo(
      { videoUrl, thumbnailUrl: thumb, duration, width, height, msg, fileSize },
      threadId,
      threadType
    );
  } catch (e) {
    throw new Error(`[sendVideo lỗi] videoUrl=${videoUrl} | thumb=${thumb} | fileSize=${fileSize} | ${e?.message || e}`);
  }
}

async function sendVoice(api, tmpPath, threadId, threadType) {
  if (!fs.existsSync(tmpPath)) throw new Error(`File không tồn tại: ${tmpPath}`);

  let uploaded;
  try {
    uploaded = await api.uploadAttachment([tmpPath], threadId, threadType);
  } catch (e) {
    throw new Error(`[uploadAttachment lỗi] ${e?.message || e}`);
  }

  const voiceData = uploaded?.[0];

  if (!voiceData?.fileUrl) {
    throw new Error(`uploadAttachment không trả về fileUrl (${path.basename(tmpPath)})`);
  }

  const voiceUrl = (voiceData.fileUrl && voiceData.fileName)
    ? `${voiceData.fileUrl}/${voiceData.fileName}`
    : voiceData.fileUrl;

  try {
    return await api.sendVoice({ voiceUrl, ttl: 900_000 }, threadId, threadType);
  } catch (e) {
    throw new Error(`[sendVoice lỗi] voiceUrl=${voiceUrl} | ${e?.message || e}`);
  }
}

async function uploadImage(api, imagePath, threadId, threadType, caption = "") {
  if (!fs.existsSync(imagePath)) throw new Error(`Ảnh không tồn tại: ${imagePath}`);
  return api.sendMessage({ msg: caption, attachments: [imagePath] }, threadId, threadType);
}

module.exports = {
  processAll,
  decodeOne,
  loadIndex,
  saveIndex,
  pickRandom,
  readLinks,
  VIDEO_DIR,
  THUMB_DIR,
  INDEX_FILE,
  tempDir,
  logMessageToFile,
  cleanTempFiles,
  cleanupOldFiles,
  sendVideo,
  sendVoice,
  uploadImage,
};

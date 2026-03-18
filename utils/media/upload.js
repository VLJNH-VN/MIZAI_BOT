const fs       = require("fs");
const path     = require("path");
const FormData = require("form-data");
const axios    = require("axios");
const { execSync } = require("child_process");

const tempDir = path.join(process.cwd(), "includes", "cache", "temp");
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

function logMessageToFile(message, type = "general") {
  try {
    const logDir = path.join(process.cwd(), "logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

    const fileName = `${type}_${new Date().toISOString().split("T")[0]}.log`;
    const filePath = path.join(logDir, fileName);

    const timestamp = new Date().toLocaleString();
    fs.appendFileSync(filePath, `[${timestamp}] ${message}\n`);
  } catch (e) {}
}

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch (e) {}
  return null;
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (e) {}
  return false;
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
    process.cwd(),
    path.join(process.cwd(), "src", "modules", "cache"),
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

/**
 * Dùng ffmpeg extract frame đầu từ video → upload lên Catbox.moe (URL công khai).
 * Catbox không cần API key, trả về URL công khai để Zalo server tải thumbnail.
 * Trả về URL ảnh hoặc null nếu thất bại.
 */
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

/**
 * Upload file video (.mp4) lên Zalo rồi gửi bằng api.sendVideo.
 * Nếu không có thumbnailUrl, tự extract frame đầu từ video bằng ffmpeg.
 *
 * @param {object} api
 * @param {string} tmpPath    - Đường dẫn file mp4 local
 * @param {string} threadId
 * @param {string} threadType
 * @param {object} [meta]     - { msg, thumbnailUrl, duration, width, height }
 */
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

  // Lấy thumbnail: ưu tiên meta.thumbnailUrl, fallback extract frame → upload Catbox
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

/**
 * Upload file audio lên Zalo rồi gửi bằng api.sendVoice.
 * Pattern tham khảo từ GwenDev AutoDown.js:
 *   const uploaded = await api.uploadAttachment([aacPath], threadId, threadType);
 *   const voiceData = uploaded?.[0];
 *   if (voiceData?.fileUrl && voiceData?.fileName) {
 *       const voiceUrl = `${voiceData.fileUrl}/${voiceData.fileName}`;
 *       await api.sendVoice({ voiceUrl, ttl: 900_000 }, threadId, threadType);
 *   }
 *
 * @param {object} api
 * @param {string} tmpPath    - Đường dẫn file audio local (.aac/.m4a/.mp3)
 * @param {string} threadId
 * @param {string} threadType
 */
async function sendVoice(api, tmpPath, threadId, threadType) {
  if (!fs.existsSync(tmpPath)) throw new Error(`File không tồn tại: ${tmpPath}`);

  // ── Bước 1: Upload file lên Zalo CDN ──────────────────────────────────────
  let uploaded;
  try {
    uploaded = await api.uploadAttachment([tmpPath], threadId, threadType);
  } catch (e) {
    throw new Error(`[uploadAttachment lỗi] ${e?.message || e}`);
  }

  // ── Bước 2: Lấy voiceData — khớp chính xác pattern Gwen ─────────────────
  const voiceData = uploaded?.[0];

  if (!voiceData?.fileUrl) {
    throw new Error(`uploadAttachment không trả về fileUrl (${path.basename(tmpPath)})`);
  }

  // Gwen: dùng fileUrl/fileName; fallback về fileUrl nếu thiếu fileName
  const voiceUrl = (voiceData.fileUrl && voiceData.fileName)
    ? `${voiceData.fileUrl}/${voiceData.fileName}`
    : voiceData.fileUrl;

  // ── Bước 3: Gửi voice ─────────────────────────────────────────────────────
  try {
    return await api.sendVoice({ voiceUrl, ttl: 900_000 }, threadId, threadType);
  } catch (e) {
    throw new Error(`[sendVoice lỗi] voiceUrl=${voiceUrl} | ${e?.message || e}`);
  }
}

/**
 * Upload ảnh lên Zalo và gửi vào thread.
 *
 * @param {object} api
 * @param {string} imagePath
 * @param {string} threadId
 * @param {string} threadType
 * @param {string} [caption]
 */
async function uploadImage(api, imagePath, threadId, threadType, caption = "") {
  if (!fs.existsSync(imagePath)) throw new Error(`Ảnh không tồn tại: ${imagePath}`);
  return api.sendMessage({ msg: caption, attachments: [imagePath] }, threadId, threadType);
}

module.exports = {
  tempDir,
  logMessageToFile,
  readJSON,
  writeJSON,
  cleanTempFiles,
  cleanupOldFiles,
  sendVideo,
  sendVoice,
  uploadImage,
};

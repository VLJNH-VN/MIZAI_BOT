"use strict";

/**
 * utils/system/ljzi.js
 * Module Ljzi — Quản lý danh sách video gái/anime + gửi video chuẩn zca-js
 *
 * Đăng ký global:
 *   global.Ljzi.vdgai                    → string[]   danh sách URL video gái
 *   global.Ljzi.vdani                    → string[]   danh sách URL video anime
 *   global.Ljzi.pick(name)               → string|null  lấy random 1 URL
 *   global.Ljzi.send(api, event, name)   → Promise      gửi video (ưu tiên cache)
 *   global.Ljzi.cacheSize(name)          → number       số video đang có trong cache
 *
 * Cache:
 *   Khi khởi động, tự động tải sẵn CACHE_SIZE video về local (download + H264).
 *   Khi send() lấy 1 video từ cache, tự động bổ sung 1 video mới vào cache ngầm.
 *   Nếu cache trống (lần đầu hoặc chưa kịp tải), fallback download on-demand.
 */

const fs           = require("fs");
const path         = require("path");
const axios        = require("axios");
const { execSync } = require("child_process");

const LISTAPI_DIR = path.join(__dirname, "../../includes/listapi");
const TEMP_DIR    = path.join(__dirname, "../../includes/cache");
const CACHE_SIZE  = 5;

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function cleanup(...files) {
  setTimeout(() => {
    files.forEach(f => {
      try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    });
  }, 10000);
}

async function downloadFile(url, filePath) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  const res = await axios.get(url, {
    responseType:     "arraybuffer",
    timeout:          120000,
    maxContentLength: 200 * 1024 * 1024,
    headers: { "User-Agent": global.userAgent || "Mozilla/5.0" },
  });
  fs.writeFileSync(filePath, Buffer.from(res.data));
  if (fs.statSync(filePath).size === 0) throw new Error("File tải về rỗng");
}

function probeStreams(filePath) {
  try {
    const out  = execSync(
      `ffprobe -v error -show_format -show_streams -of json "${filePath}"`,
      { timeout: 30000, stdio: "pipe" }
    ).toString();
    const data = JSON.parse(out);
    const vs   = data.streams?.find(s => s.codec_type === "video");
    const dur  = parseFloat(data.format?.duration || 0);
    return {
      width:    vs?.width    || 576,
      height:   vs?.height   || 1024,
      duration: dur > 0 ? Math.max(1, Math.ceil(dur)) : 10,
    };
  } catch {
    return { width: 576, height: 1024, duration: 10 };
  }
}

function convertToH264(inputPath, outputPath) {
  execSync(
    `ffmpeg -y -i "${inputPath}" -map 0:v:0 -map 0:a:0? ` +
    `-c:v libx264 -preset fast -crf 23 -profile:v baseline -level 3.1 ` +
    `-pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" ` +
    `-c:a aac -b:a 128k -ar 44100 -movflags +faststart "${outputPath}"`,
    { timeout: 180000, stdio: "pipe" }
  );
}

// ── Load JSON list ─────────────────────────────────────────────────────────────

function loadList(filename) {
  const filePath = path.join(LISTAPI_DIR, filename);
  try {
    if (fs.existsSync(filePath))
      return JSON.parse(fs.readFileSync(filePath, "utf8")).slice();
  } catch (e) {
    global.logWarn?.(`[Ljzi] Không load được ${filename}: ${e.message}`);
  }
  return [];
}

// ── Video cache ────────────────────────────────────────────────────────────────
// Mỗi entry: { filePath: string, meta: { width, height, duration } }

const _cache   = { vdgai: [], vdani: [] };
const _filling = { vdgai: false, vdani: false };

/**
 * Tải + convert 1 video ngẫu nhiên từ list vào cache.
 * @returns {boolean} true nếu thành công
 */
async function _prepareOne(name) {
  const list = global.Ljzi?.[name];
  if (!list || !list.length) return false;

  const url      = list[Math.floor(Math.random() * list.length)];
  const id       = uid();
  const rawPath  = path.join(TEMP_DIR, `ljzi_raw_${id}.mp4`);
  const h264Path = path.join(TEMP_DIR, `ljzi_h264_${id}.mp4`);

  try {
    await downloadFile(url, rawPath);

    let finalPath = rawPath;
    try {
      convertToH264(rawPath, h264Path);
      if (fs.existsSync(h264Path) && fs.statSync(h264Path).size > 0) {
        finalPath = h264Path;
        cleanup(rawPath);
      }
    } catch (e) {
      global.logWarn?.(`[Ljzi] Convert H264 lỗi khi cache: ${e.message}`);
      try { if (fs.existsSync(h264Path)) fs.unlinkSync(h264Path); } catch (_) {}
    }

    const meta      = probeStreams(finalPath);
    const fileSize  = fs.statSync(finalPath).size;

    // releaseUrl sẽ được upload lúc gửi thật (trong _sendFromFile)
    _cache[name].push({ filePath: finalPath, meta, releaseUrl: null });
    return true;
  } catch (e) {
    global.logWarn?.(`[Ljzi] _prepareOne "${name}" lỗi: ${e.message}`);
    cleanup(rawPath, h264Path);
    return false;
  }
}

/**
 * Chạy ngầm để bổ sung cache đến CACHE_SIZE.
 */
async function _fillCache(name) {
  if (_filling[name]) return;
  if (!_cache[name]) return;
  if (_cache[name].length >= CACHE_SIZE) return;

  _filling[name] = true;

  while (_cache[name].length < CACHE_SIZE) {
    const ok = await _prepareOne(name);
    if (!ok) break;
  }

  global.logInfo?.(`[Ljzi] Cache "${name}" sẵn sàng: ${_cache[name].length}/${CACHE_SIZE}`);
  _filling[name] = false;
}

// ── Gửi video từ file đã chuẩn bị sẵn ────────────────────────────────────────

async function _sendFromFile(api, event, filePath, meta, caption, releaseUrl) {
  const fileSize = fs.statSync(filePath).size;

  // Upload thumbnail + chuẩn bị release URL song song
  let thumbnailUrl = "";
  let finalReleaseUrl = releaseUrl || null;

  const thumbPromise = global.zaloUploadThumbnail
    ? global.zaloUploadThumbnail(api, filePath, event.threadId, event.type).catch(() => "")
    : Promise.resolve("");

  // Nếu chưa có releaseUrl: thử GitHub → thử Zalo CDN (uploadAttachment mp4)
  const uploadPromise = (!finalReleaseUrl && fileSize < 50 * 1024 * 1024)
    ? (async () => {
        // 1. Thử GitHub
        if (typeof global.githubReleaseUpload === "function") {
          try { return await global.githubReleaseUpload(filePath, `ljzi_${uid()}.mp4`); }
          catch (e) { global.logWarn?.(`[Ljzi] GitHub thất bại: ${e.message}`); }
        }
        // 2. Fallback: upload lên Zalo CDN
        try {
          const url = await global.zaloUploadAttachment(api, filePath, event.threadId, event.type);
          if (url) { global.logInfo?.(`[Ljzi] Zalo CDN OK`); return url; }
        } catch (e) { global.logWarn?.(`[Ljzi] Zalo CDN thất bại: ${e.message}`); }
        return null;
      })()
    : Promise.resolve(finalReleaseUrl);

  [thumbnailUrl, finalReleaseUrl] = await Promise.all([thumbPromise, uploadPromise]);

  let sentAsVideo = false;

  if (finalReleaseUrl) {
    try {
      await api.sendVideo({
        videoUrl:     finalReleaseUrl,
        thumbnailUrl: thumbnailUrl || "",
        msg:          caption || "",
        width:        meta.width,
        height:       meta.height,
        duration:     meta.duration * 1000,
        ttl:          500_000,
      }, event.threadId, event.type);
      sentAsVideo = true;
    } catch (e) {
      global.logWarn?.(`[Ljzi] sendVideo thất bại: ${e.message}`);
    }
  }

  if (!sentAsVideo) {
    await api.sendMessage(
      { msg: caption || "", attachments: [filePath], ttl: 500_000 },
      event.threadId, event.type
    );
  }

  cleanup(filePath);
}

// ── On-demand: download → H264 → gửi (khi cache trống) ───────────────────────

async function _sendOnDemand(api, event, srcUrl, caption) {
  const id       = uid();
  const rawPath  = path.join(TEMP_DIR, `ljzi_raw_${id}.mp4`);
  const h264Path = path.join(TEMP_DIR, `ljzi_h264_${id}.mp4`);

  try {
    await downloadFile(srcUrl, rawPath);

    let uploadPath = rawPath;
    try {
      convertToH264(rawPath, h264Path);
      if (fs.existsSync(h264Path) && fs.statSync(h264Path).size > 0)
        uploadPath = h264Path;
    } catch (e) {
      global.logWarn?.(`[Ljzi] Convert H264 on-demand lỗi: ${e.message}`);
    }

    const meta = probeStreams(uploadPath);
    await _sendFromFile(api, event, uploadPath, meta, caption);

  } finally {
    cleanup(rawPath, h264Path);
  }
}

// ── Đăng ký global.Ljzi ───────────────────────────────────────────────────────

const vdgai = loadList("gai.json");
const vdani = loadList("ani.json");

global.Ljzi = {
  vdgai,
  vdani,

  pick(name) {
    const list = this[name];
    if (!list || !list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  },

  cacheSize(name) {
    return _cache[name]?.length ?? 0;
  },

  async send(api, event, name, caption) {
    const cap = caption ?? `🎬 ${name}`;

    if (_cache[name] && _cache[name].length > 0) {
      const item = _cache[name].shift();
      _fillCache(name).catch(() => {});
      await _sendFromFile(api, event, item.filePath, item.meta, cap, item.releaseUrl);
    } else {
      global.logWarn?.(`[Ljzi] Cache "${name}" trống, download on-demand...`);
      const url = this.pick(name);
      if (!url) throw new Error(`[Ljzi] Danh sách "${name}" trống hoặc chưa có.`);
      await _sendOnDemand(api, event, url, cap);
      _fillCache(name).catch(() => {});
    }
  },
};

global.logInfo?.(`[Ljzi] Đã load: vdgai=${vdgai.length} | vdani=${vdani.length}`);

// Bắt đầu fill cache ngầm ngay khi khởi động
if (vdgai.length) _fillCache("vdgai").catch(() => {});
if (vdani.length) _fillCache("vdani").catch(() => {});

/**
 * utils/media/mediaCache.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Giải mã video/ảnh/audio từ GitHub (base64) → lưu vào filecache local.
 * Dùng được cả trong CLI (getdata.js) lẫn lệnh bot (datat).
 *
 * Flow:
 *   1. Đọc githubMediaLinks.json (các entry đã upload bằng api add)
 *   2. Với mỗi entry chưa có trong cache index:
 *      - Gọi GitHub API → lấy base64 → decode → lưu file .mp4/.jpg/...
 *      - Dùng ffprobe lấy width/height/duration (nếu là video)
 *      - Tạo thumbnail .bin (nếu là video)
 *      - Lưu vào dataCache.json
 *
 * Config đọc từ global.config (nếu có) hoặc config.json trực tiếp.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  EXPORTS                                                                 │
 * ├──────────────────────────┬───────────────────────────────────────────────┤
 * │  processAll(opts)        │ Decode toàn bộ entry mới → cache + index      │
 * │  decodeOne(key, opts)    │ Decode 1 entry theo key → trả về cachedPath   │
 * │  loadIndex()             │ Đọc dataCache.json                            │
 * │  pickRandom(category?)   │ Chọn ngẫu nhiên 1 entry (có thể lọc category)│
 * └──────────────────────────┴───────────────────────────────────────────────┘
 */

"use strict";

const fs         = require("fs");
const path       = require("path");
const axios      = require("axios");
const { execSync } = require("child_process");
const { githubApiHeaders } = require("./githubConfig");

// ── Đường dẫn ──────────────────────────────────────────────────────────────────
const ROOT         = process.cwd();
const LINKS_FILE   = path.join(ROOT, "includes", "data", "githubMediaLinks.json");
const INDEX_FILE   = path.join(ROOT, "includes", "data", "dataCache.json");
const VIDEO_DIR    = path.join(ROOT, "includes", "cache", "videos");
const THUMB_DIR    = path.join(ROOT, "includes", "cache", "thumbs");

// ── Đảm bảo thư mục tồn tại ───────────────────────────────────────────────────
function ensureDirs() {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  fs.mkdirSync(THUMB_DIR, { recursive: true });
}

// ── Đọc config từ global.config hoặc trực tiếp config.json ───────────────────
function getConfig() {
  if (global.config) return global.config;
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
  } catch (e) {
    throw new Error(`[mediaCache] Không đọc được config.json: ${e.message}`);
  }
}


// ── Đọc/ghi danh sách link đã upload ─────────────────────────────────────────
function readLinks() {
  try {
    if (fs.existsSync(LINKS_FILE)) return JSON.parse(fs.readFileSync(LINKS_FILE, "utf8"));
  } catch (_) {}
  return {};
}

// ── Đọc/ghi cache index ───────────────────────────────────────────────────────
function loadIndex() {
  try {
    if (fs.existsSync(INDEX_FILE)) return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  } catch (_) {}
  return [];
}

function saveIndex(arr) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(arr, null, 2), "utf8");
}

// ── Giải mã base64 từ GitHub API URL → lưu file ──────────────────────────────
async function decodeFromApiUrl(apiUrl, outputPath, token) {
  const res = await axios.get(apiUrl, {
    headers: githubApiHeaders(token),
    timeout: 90000,
  });

  const b64 = res.data?.content;
  if (!b64) throw new Error("GitHub không trả về content base64");

  const buffer = Buffer.from(b64.replace(/\n/g, ""), "base64");
  fs.writeFileSync(outputPath, buffer);
  return buffer.length;
}

// ── Lấy metadata video bằng ffprobe ──────────────────────────────────────────
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

// ── Tạo thumbnail từ video (lưu dạng .bin) ───────────────────────────────────
function createThumb(videoPath, baseName) {
  const tmpJpg  = path.join(THUMB_DIR, `${baseName}.jpg`);
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

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: Giải mã 1 entry theo key
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decode 1 entry từ githubMediaLinks.json theo key.
 * Nếu file đã tồn tại trong cache, trả về ngay mà không download lại.
 *
 * @param {string} key               - Key trong githubMediaLinks.json
 * @param {object} [opts]
 * @param {boolean} [opts.force]     - Decode lại dù file đã cache
 * @param {function} [opts.onLog]    - Callback log
 * @returns {Promise<string|null>}   - Đường dẫn file đã cache, hoặc null nếu lỗi
 */
async function decodeOne(key, opts = {}) {
  const { force = false, onLog = () => {} } = opts;

  const cfg   = getConfig();
  const token = cfg.githubToken;
  if (!token) throw new Error("[mediaCache] Thiếu config.githubToken");

  const links = readLinks();
  const entry = links[key];
  if (!entry) throw new Error(`[mediaCache] Không tìm thấy key "${key}" trong githubMediaLinks.json`);

  ensureDirs();

  const ext        = entry.ext || ".mp4";
  const fileName   = `${key}${ext}`;
  const cachedPath = path.join(VIDEO_DIR, fileName);

  // Trả về ngay nếu đã có cache
  if (!force && fs.existsSync(cachedPath) && fs.statSync(cachedPath).size > 0) {
    onLog(`[cache hit] ${key}`);
    return cachedPath;
  }

  onLog(`[decode] ${key} — đang giải mã từ GitHub...`);

  try {
    const bytes = await decodeFromApiUrl(entry.apiUrl, cachedPath, token);
    onLog(`[decode] ✅ ${key} — ${(bytes / 1024).toFixed(1)} KB`);
    return cachedPath;
  } catch (e) {
    onLog(`[decode] ❌ ${key} — ${e.message}`);
    try { fs.unlinkSync(cachedPath); } catch (_) {}
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: Xử lý toàn bộ entry chưa có trong cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decode tất cả entry trong githubMediaLinks.json chưa có trong dataCache.json.
 *
 * @param {object} [opts]
 * @param {function} [opts.onLog]       - Callback log string
 * @param {function} [opts.onProgress]  - Callback({ done, total, success, fail })
 * @param {boolean}  [opts.force]       - Decode lại toàn bộ dù đã cache
 * @returns {Promise<{ success, fail, total, saved }>}
 */
async function processAll(opts = {}) {
  const { onLog = console.log, onProgress, force = false } = opts;

  ensureDirs();

  const cfg   = getConfig();
  const token = cfg.githubToken;
  if (!token) throw new Error("[mediaCache] Thiếu config.githubToken trong config.json");

  // Đọc danh sách tất cả entry đã upload
  const links = readLinks();
  const keys  = Object.keys(links);

  if (keys.length === 0) {
    onLog("📭 githubMediaLinks.json trống. Chưa có file nào được upload.");
    return { success: 0, fail: 0, total: 0, saved: 0 };
  }

  // Đọc cache index hiện tại
  const index      = loadIndex();
  const cachedKeys = new Set(index.map(e => e.key));
  const pending    = force ? keys : keys.filter(k => !cachedKeys.has(k));

  if (pending.length === 0) {
    onLog(`✅ Không có entry mới. Tổng cache: ${index.length} file.`);
    return { success: 0, fail: 0, total: 0, saved: index.length };
  }

  onLog(`🎬 Cần giải mã: ${pending.length} entry mới (tổng: ${keys.length})`);

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
      // ── Decode từ GitHub ────────────────────────────────────────────────
      const bytes = await decodeFromApiUrl(entry.apiUrl, cachedPath, token);
      onLog(`${label} ✅ Đã lưu — ${(bytes / 1024).toFixed(1)} KB`);

      // ── Metadata (chỉ video) ────────────────────────────────────────────
      let meta      = { width: 0, height: 0, duration: 0 };
      let thumbName = null;

      if (isVideo) {
        meta      = getVideoMeta(cachedPath);
        thumbName = createThumb(cachedPath, key);
        onLog(`${label} 📐 ${meta.width}x${meta.height} | ${meta.duration}s${thumbName ? " | thumb OK" : ""}`);
      }

      // ── Cập nhật index ──────────────────────────────────────────────────
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
      onLog(`${label} ❌ Lỗi: ${e.message}`);
      try { if (fs.existsSync(cachedPath)) fs.unlinkSync(cachedPath); } catch (_) {}
      failCount++;
    }

    onProgress?.({ done: i + 1, total: pending.length, success: successCount, fail: failCount });
  }

  onLog(`\n✅ Hoàn tất! Thành công: ${successCount} | Lỗi: ${failCount} | Tổng cache: ${index.length}`);
  return { success: successCount, fail: failCount, total: pending.length, saved: index.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: Lấy 1 entry ngẫu nhiên từ cache index
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chọn ngẫu nhiên 1 entry từ dataCache.json.
 * @param {object} [opts]
 * @param {boolean} [opts.videoOnly]   - Chỉ lấy file video
 * @param {string}  [opts.ext]         - Lọc theo extension (vd: ".mp4")
 * @returns {object|null}
 */
function pickRandom(opts = {}) {
  const index = loadIndex();
  if (index.length === 0) return null;

  let pool = index.filter(e => {
    // Chỉ lấy file đang có trên disk
    const full = path.join(ROOT, e.cachedPath);
    return fs.existsSync(full) && fs.statSync(full).size > 0;
  });

  if (opts.videoOnly) pool = pool.filter(e => e.isVideo);
  if (opts.ext)       pool = pool.filter(e => e.ext === opts.ext);

  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  processAll,
  decodeOne,
  loadIndex,
  pickRandom,
  VIDEO_DIR,
  THUMB_DIR,
  INDEX_FILE,
  readLinks,
  saveIndex,
};

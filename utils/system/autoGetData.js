/**
 * utils/system/autoGetData.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Auto giải mã GitHub media → filecache local (tối đa MAX_FILES file / chu kỳ).
 * Sau CYCLE_MS (1 phút) tự xóa các file đã decode rồi lặp lại.
 *
 *   global.startAutoGetData()   — Khởi động (gọi 1 lần trong index.js)
 *   global.stopAutoGetData()    — Dừng vòng lặp (nếu cần)
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const { decodeOne, loadIndex, VIDEO_DIR, THUMB_DIR, INDEX_FILE } =
  require("../media/mediaCache");

const MAX_FILES = 10;
const CYCLE_MS  = 60 * 1000;

const ROOT       = process.cwd();
const LINKS_FILE = path.join(ROOT, "includes", "data", "githubMediaLinks.json");

let _running = false;
let _stopRequested = false;

function _log(fn, msg) {
  const logger = global[fn] || (fn === "logError" ? console.error : console.log);
  logger(msg);
}

function _readLinks() {
  try {
    if (fs.existsSync(LINKS_FILE))
      return JSON.parse(fs.readFileSync(LINKS_FILE, "utf8"));
  } catch (_) {}
  return {};
}

function _saveIndex(arr) {
  try {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(arr, null, 2), "utf8");
  } catch (e) {
    _log("logError", `[autoGetData] Không ghi được dataCache.json: ${e.message}`);
  }
}

function _removeDecodedFiles(decoded) {
  for (const { key, cachedPath } of decoded) {
    try {
      if (fs.existsSync(cachedPath)) fs.unlinkSync(cachedPath);
    } catch (_) {}
    try {
      const thumbBin = path.join(THUMB_DIR, `${key}.bin`);
      if (fs.existsSync(thumbBin)) fs.unlinkSync(thumbBin);
    } catch (_) {}
    try {
      const thumbJpg = path.join(THUMB_DIR, `${key}.jpg`);
      if (fs.existsSync(thumbJpg)) fs.unlinkSync(thumbJpg);
    } catch (_) {}
  }

  const index = loadIndex();
  const kept  = index.filter(e => {
    const full = path.join(ROOT, e.cachedPath);
    return fs.existsSync(full) && fs.statSync(full).size > 0;
  });
  _saveIndex(kept);
}

async function _runCycle() {
  if (_stopRequested) {
    _running = false;
    _log("logInfo", "[autoGetData] ⏹️  Đã dừng vòng lặp.");
    return;
  }

  try {
    const links   = _readLinks();
    const allKeys = Object.keys(links);

    if (allKeys.length === 0) {
      _log("logWarn", "[autoGetData] ⚠️  githubMediaLinks.json trống — thử lại sau 1 phút.");
      setTimeout(_runCycle, CYCLE_MS);
      return;
    }

    const shuffled = allKeys.sort(() => Math.random() - 0.5).slice(0, MAX_FILES);
    _log("logInfo", `[autoGetData] 🎬 Bắt đầu giải mã ${shuffled.length} file...`);

    const decoded = [];

    for (const key of shuffled) {
      if (_stopRequested) break;
      try {
        const cachedPath = await decodeOne(key, { force: true, onLog: () => {} });
        if (cachedPath) decoded.push({ key, cachedPath });
      } catch (e) {
        _log("logWarn", `[autoGetData] ❌ ${key}: ${e.message}`);
      }
    }

    _log("logInfo", `[autoGetData] ✅ Đã giải mã ${decoded.length}/${shuffled.length} file — sẽ xóa sau 1 phút.`);

    setTimeout(() => {
      if (decoded.length > 0) {
        _removeDecodedFiles(decoded);
        _log("logInfo", `[autoGetData] 🗑️  Đã xóa ${decoded.length} file cache. Bắt đầu chu kỳ mới.`);
      }
      _runCycle();
    }, CYCLE_MS);

  } catch (e) {
    _log("logError", `[autoGetData] 💥 Lỗi chu kỳ: ${e.message}`);
    setTimeout(_runCycle, CYCLE_MS);
  }
}

function startAutoGetData() {
  if (_running) return;
  _running       = true;
  _stopRequested = false;
  _log("logInfo", `[autoGetData] 🚀 Khởi động — tối đa ${MAX_FILES} file/phút, tự xóa sau ${CYCLE_MS / 1000}s.`);
  _runCycle();
}

function stopAutoGetData() {
  _stopRequested = true;
}

module.exports = { startAutoGetData, stopAutoGetData };

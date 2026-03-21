"use strict";

/**
 * utils/bot/cawr.js
 * ─────────────────────────────────────────────────────────────────────────────
 * global.cawr — Thư viện tiện ích dùng chung toàn bot
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  global.cawr.tt — Bộ công cụ TikTok                                    │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  .search(q, limit)   │ Tìm kiếm video TikTok qua FOWN API              │
 * │  .getVideo(url)      │ Lấy link video thực + metadata qua tikwm        │
 * │  .uploadVideo(...)   │ Tải video về local → upload lên GitHub          │
 * │  .isDuplicate(l, u)  │ Kiểm tra URL đã có trong danh sách chưa        │
 * │  .pickRandom(name)   │ Lấy ngẫu nhiên 1 URL từ listapi/<name>.json    │
 * │  .loadList(name)     │ Đọc toàn bộ listapi/<name>.json                 │
 * │  .saveList(name, d)  │ Ghi lại listapi/<name>.json                     │
 * │  .bulkAdd(n,q,lim)   │ Pipeline đầy đủ: tìm→tải→upload→lưu            │
 * └──────────────────────┴──────────────────────────────────────────────────┘
 */

const fs   = require("fs");
const path = require("path");
const axios = require("axios");

const FOWN_API    = "https://fown.onrender.com";
const LISTAPI_DIR = path.join(process.cwd(), "includes", "listapi");
const TEMP_DIR    = path.join(process.cwd(), "includes", "cache");

// ─────────────────────────────────────────────────────────────────────────────
//  LISTAPI helpers
// ─────────────────────────────────────────────────────────────────────────────

function ensureListapiDir() {
  if (!fs.existsSync(LISTAPI_DIR)) fs.mkdirSync(LISTAPI_DIR, { recursive: true });
}

/**
 * Đọc mảng URL từ listapi/<name>.json. Trả về [] nếu chưa có.
 */
function loadList(name) {
  ensureListapiDir();
  const filePath = path.join(LISTAPI_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) return [];
  try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { return []; }
}

/**
 * Ghi mảng URL vào listapi/<name>.json.
 */
function saveList(name, data) {
  ensureListapiDir();
  const filePath = path.join(LISTAPI_DIR, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Lấy ngẫu nhiên 1 URL từ listapi/<name>.json. Trả về null nếu rỗng.
 */
function pickRandom(name) {
  const list = loadList(name);
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

// ─────────────────────────────────────────────────────────────────────────────
//  TikTok — Search
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tìm kiếm video TikTok qua FOWN API.
 * @param {string} query
 * @param {number} limit  1-20, mặc định 8
 * @returns {Promise<Array>}  mảng kết quả { url, title, uploader, view_count, duration, ... }
 */
async function search(query, limit = 8) {
  const res = await axios.get(
    `${FOWN_API}/api/search?ttsearch=${encodeURIComponent(query)}&svl=${limit}`,
    { timeout: 30000 }
  );
  return res.data?.results || [];
}

// ─────────────────────────────────────────────────────────────────────────────
//  TikTok — Lấy link video thực
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lấy link video không watermark + metadata qua tikwm.
 * @param {string} tiktokUrl
 * @returns {Promise<{ videoUrl, thumbnail, duration, width, height, title, author, images }>}
 */
async function getVideo(tiktokUrl) {
  const body = new URLSearchParams({ url: tiktokUrl }).toString();
  const res  = await axios.post("https://www.tikwm.com/api/", body, {
    timeout: 30000,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (res.data?.code !== 0) throw new Error(`tikwm lỗi code ${res.data?.code}`);
  const d = res.data.data;
  return {
    videoUrl:  d.play || d.wmplay || null,
    thumbnail: d.cover    || "",
    duration:  d.duration || 0,
    width:     d.width    || 576,
    height:    d.height   || 1024,
    title:     d.title    || "",
    author:    d.author?.nickname || "",
    images:    Array.isArray(d.images) ? d.images : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  TikTok — Tải video + upload GitHub
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tải video từ direct URL → upload lên GitHub → trả về download_url.
 * @param {string} videoUrl   Link video thực (không watermark)
 * @param {string} tipName    Tên thư mục trong repo (vd: "gaixinh")
 * @param {string} uid        ID duy nhất để đặt tên file
 * @returns {Promise<string|null>}  GitHub raw URL, null nếu thất bại
 */
async function uploadVideo(videoUrl, tipName, uid) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  const rawPath = path.join(TEMP_DIR, `cawr_tt_${uid}.mp4`);
  try {
    const res = await axios.get(videoUrl, {
      responseType:     "arraybuffer",
      timeout:          180000,
      maxContentLength: 500 * 1024 * 1024,
      headers: { "User-Agent": global.userAgent || "Mozilla/5.0" },
    });
    fs.writeFileSync(rawPath, Buffer.from(res.data));
    const fileSize = fs.statSync(rawPath).size;
    if (fileSize === 0) throw new Error("File tải về rỗng");
    const repoPath = `listapi/${tipName}/${uid}.mp4`;
    const ghUrl = await global.githubUpload(rawPath, repoPath);
    return ghUrl || null;
  } finally {
    try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch (_) {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  TikTok — Kiểm tra trùng
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kiểm tra ghUrl đã có trong existingList chưa (so sánh pathname).
 * @param {string[]} existingList
 * @param {string}   ghUrl
 * @returns {boolean}
 */
function isDuplicate(existingList, ghUrl) {
  if (!ghUrl) return false;
  const norm = u => {
    try { return new URL(u).pathname.toLowerCase(); } catch { return u.toLowerCase(); }
  };
  const target = norm(ghUrl);
  return existingList.some(u => norm(u) === target);
}

// ─────────────────────────────────────────────────────────────────────────────
//  TikTok — Pipeline đầy đủ: tìm → tải → upload → lưu
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tìm kiếm TikTok, tải video, upload GitHub, lưu vào listapi/<tipName>.json.
 * Bỏ qua trùng và slideshow ảnh tự động.
 *
 * @param {string}   tipName   Tên listapi (vd: "gaixinh")
 * @param {string}   query     Từ khóa tìm kiếm
 * @param {number}   limit     Số video tìm (1-20, mặc định 8)
 * @param {Function} [onProgress]  Callback tiến trình (i, total, status)
 * @returns {Promise<{ success, skipped, failed, total, failReasons }>}
 */
async function bulkAdd(tipName, query, limit = 8, onProgress = null) {
  const results = await search(query, limit);
  if (!results.length) return { success: 0, skipped: 0, failed: 0, total: 0, failReasons: [] };

  const data        = loadList(tipName);
  let success = 0, skipped = 0, failed = 0;
  const failReasons = [];

  for (let i = 0; i < results.length; i++) {
    const video = results[i];
    const uid   = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      const tikInfo = await getVideo(video.url);

      // Bỏ qua slideshow ảnh
      if (!tikInfo.videoUrl) {
        skipped++;
        onProgress?.(i + 1, results.length, "skip_image");
        continue;
      }

      const ghUrl = await uploadVideo(tikInfo.videoUrl, tipName, uid);
      if (!ghUrl) {
        failed++;
        failReasons.push("Không lấy được URL GitHub");
        onProgress?.(i + 1, results.length, "fail");
        continue;
      }

      // Kiểm tra trùng
      if (isDuplicate(data, ghUrl)) {
        skipped++;
        global.logInfo?.(`[cawr.tt] Bỏ qua trùng: ${ghUrl}`);
        onProgress?.(i + 1, results.length, "duplicate");
        continue;
      }

      data.push(ghUrl);
      success++;
      global.logInfo?.(`[cawr.tt] ✅ ${i + 1}/${results.length}: ${ghUrl}`);
      onProgress?.(i + 1, results.length, "ok");
    } catch (e) {
      failed++;
      failReasons.push(e.message?.slice(0, 60) || "unknown");
      global.logWarn?.(`[cawr.tt] Lỗi video ${i + 1}: ${e.message}`);
      onProgress?.(i + 1, results.length, "fail");
    }
  }

  saveList(tipName, data);
  return { success, skipped, failed, total: results.length, failReasons };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Export namespace cawr
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  tt: {
    search,
    getVideo,
    uploadVideo,
    isDuplicate,
    loadList,
    saveList,
    pickRandom,
    bulkAdd,
  },
};

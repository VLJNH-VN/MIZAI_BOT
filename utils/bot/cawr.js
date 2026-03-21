"use strict";

/**
 * utils/bot/cawr.js
 * ─────────────────────────────────────────────────────────────────────────────
 * global.cawr — Thư viện tiện ích dùng chung toàn bot
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  global.cawr.tt — Bộ công cụ TikTok                                    │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  .search(q, limit)   │ Tìm kiếm video TikTok qua FOWN API (max 50)     │
 * │  .getUserVideos(uid) │ Lấy toàn bộ video từ @username qua tikwm        │
 * │  .getVideo(url)      │ Lấy link video thực + metadata qua tikwm        │
 * │  .uploadVideo(...)   │ Tải video về local → upload lên GitHub          │
 * │  .isDuplicate(l, u)  │ Kiểm tra URL đã có trong danh sách chưa        │
 * │  .pickRandom(name)   │ Lấy ngẫu nhiên 1 URL từ listapi/<name>.json    │
 * │  .loadList(name)     │ Đọc toàn bộ listapi/<name>.json                 │
 * │  .saveList(name, d)  │ Ghi lại listapi/<name>.json                     │
 * │  .loadHistory()      │ Đọc lịch sử TikTok URL đã lấy                  │
 * │  .saveHistory(h)     │ Ghi lịch sử TikTok URL đã lấy                  │
 * │  .inHistory(url)     │ Kiểm tra URL đã trong lịch sử chưa             │
 * │  .addHistory(url)    │ Thêm URL vào lịch sử                            │
 * │  .bulkAdd(n,q,lim)   │ Pipeline đầy đủ: tìm→tải→upload→lưu            │
 * └──────────────────────┴──────────────────────────────────────────────────┘
 */

const fs   = require("fs");
const path = require("path");
const axios = require("axios");

const FOWN_API    = "https://fown.onrender.com";
const LISTAPI_DIR = path.join(process.cwd(), "includes", "listapi");
const TEMP_DIR    = path.join(process.cwd(), "includes", "cache");
const DATA_DIR    = path.join(process.cwd(), "includes", "data");
const HISTORY_FILE = path.join(DATA_DIR, "tt_history.json");

// ─────────────────────────────────────────────────────────────────────────────
//  LISTAPI helpers
// ─────────────────────────────────────────────────────────────────────────────

function ensureListapiDir() {
  if (!fs.existsSync(LISTAPI_DIR)) fs.mkdirSync(LISTAPI_DIR, { recursive: true });
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
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
//  HISTORY — Lịch sử TikTok URL đã xử lý (tránh trùng lặp giữa các lần chạy)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Đọc lịch sử từ file JSON. Trả về Set<string>.
 */
function loadHistory() {
  ensureDataDir();
  if (!fs.existsSync(HISTORY_FILE)) return new Set();
  try {
    const arr = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}

/**
 * Lưu Set lịch sử vào file JSON.
 */
function saveHistory(historySet) {
  ensureDataDir();
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([...historySet], null, 2), "utf-8");
}

/**
 * Kiểm tra TikTok URL đã được xử lý chưa.
 */
function inHistory(tiktokUrl) {
  const norm = u => {
    try {
      const parsed = new URL(u);
      return (parsed.hostname + parsed.pathname).replace(/\/$/, "").toLowerCase();
    } catch { return u.toLowerCase(); }
  };
  const history = loadHistory();
  const target  = norm(tiktokUrl);
  for (const h of history) {
    if (norm(h) === target) return true;
  }
  return false;
}

/**
 * Thêm TikTok URL vào lịch sử.
 */
function addHistory(tiktokUrl) {
  const history = loadHistory();
  history.add(tiktokUrl);
  saveHistory(history);
}

// ─────────────────────────────────────────────────────────────────────────────
//  TikTok — Search theo từ khoá (max 50)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tìm kiếm video TikTok qua FOWN API.
 * @param {string} query
 * @param {number} limit  1-50, mặc định 8
 * @returns {Promise<Array>}  mảng kết quả { url, title, uploader, ... }
 */
async function search(query, limit = 8) {
  const safeLimit = Math.min(Math.max(1, limit), 50);
  const res = await axios.get(
    `${FOWN_API}/api/search?ttsearch=${encodeURIComponent(query)}&svl=${safeLimit}`,
    { timeout: 30000 }
  );
  return res.data?.results || [];
}

// ─────────────────────────────────────────────────────────────────────────────
//  TikTok — Lấy toàn bộ video của @username (không giới hạn)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lấy toàn bộ video từ trang cá nhân @username qua tikwm (có phân trang).
 * @param {string} username  có thể có hoặc không có @ phía trước
 * @returns {Promise<Array<{ url, title, author }>>}
 */
async function getUserVideos(username) {
  const uid = username.startsWith("@") ? username.slice(1) : username;
  const videos = [];
  let cursor = 0;
  let hasMore = true;
  let page = 0;

  while (hasMore) {
    page++;
    let res;
    try {
      res = await axios.get("https://www.tikwm.com/api/user/posts", {
        params: { unique_id: uid, count: 35, cursor },
        timeout: 30000,
        headers: { "User-Agent": "Mozilla/5.0" },
      });
    } catch (e) {
      global.logWarn?.(`[cawr.tt] getUserVideos trang ${page} lỗi: ${e.message}`);
      break;
    }

    const d = res.data?.data;
    if (!d || res.data?.code !== 0) {
      global.logWarn?.(`[cawr.tt] getUserVideos code ${res.data?.code}`);
      break;
    }

    const list = Array.isArray(d.videos) ? d.videos : [];
    for (const v of list) {
      const tiktokUrl = `https://www.tiktok.com/@${uid}/video/${v.video_id || v.id || ""}`;
      videos.push({
        url:    tiktokUrl,
        title:  v.title || "",
        author: uid,
        videoUrl: v.play || v.wmplay || null,
      });
    }

    hasMore = !!d.hasMore;
    cursor  = d.cursor || 0;

    if (!hasMore || list.length === 0) break;
    await new Promise(r => setTimeout(r, 800));
  }

  return videos;
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
//  TikTok — Kiểm tra trùng trong danh sách listapi
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
 * Pipeline hoàn chỉnh:
 *   - Nếu query bắt đầu bằng "@" → lấy toàn bộ video từ user đó (full profile)
 *   - Ngược lại → tìm kiếm theo từ khóa (max 50)
 *
 * Sử dụng history file để tránh tải lại video đã xử lý trước đó.
 *
 * @param {string}   tipName      Tên listapi (vd: "gaixinh")
 * @param {string}   query        Từ khóa tìm kiếm hoặc @username
 * @param {number}   limit        Số video (chỉ dùng cho search text, max 50)
 * @param {Function} [onProgress] Callback tiến trình (i, total, status)
 * @returns {Promise<{ success, skipped, failed, total, failReasons }>}
 */
async function bulkAdd(tipName, query, limit = 8, onProgress = null) {
  const isUser = query.startsWith("@");

  let results;
  if (isUser) {
    global.logInfo?.(`[cawr.tt] Lấy video từ profile: ${query}`);
    results = await getUserVideos(query);
  } else {
    const safeLimit = Math.min(Math.max(1, limit), 50);
    global.logInfo?.(`[cawr.tt] Tìm kiếm: "${query}" (${safeLimit} video)`);
    results = await search(query, safeLimit);
  }

  if (!results.length) return { success: 0, skipped: 0, failed: 0, total: 0, failReasons: [] };

  const data        = loadList(tipName);
  let success = 0, skipped = 0, failed = 0;
  const failReasons = [];

  for (let i = 0; i < results.length; i++) {
    const video = results[i];
    const tiktokUrl = video.url || "";
    const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // Kiểm tra lịch sử (tránh tải lại video đã xử lý)
    if (tiktokUrl && inHistory(tiktokUrl)) {
      skipped++;
      global.logInfo?.(`[cawr.tt] Bỏ qua (đã trong lịch sử): ${tiktokUrl}`);
      onProgress?.(i + 1, results.length, "history");
      continue;
    }

    try {
      let tikInfo;
      // Với @user, tikwm đã trả sẵn videoUrl trong getUserVideos
      if (isUser && video.videoUrl) {
        tikInfo = { videoUrl: video.videoUrl, images: null };
      } else {
        tikInfo = await getVideo(tiktokUrl);
      }

      // Bỏ qua slideshow ảnh
      if (!tikInfo.videoUrl) {
        skipped++;
        if (tiktokUrl) addHistory(tiktokUrl);
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

      // Kiểm tra trùng trong listapi hiện tại
      if (isDuplicate(data, ghUrl)) {
        skipped++;
        if (tiktokUrl) addHistory(tiktokUrl);
        global.logInfo?.(`[cawr.tt] Bỏ qua trùng trong listapi: ${ghUrl}`);
        onProgress?.(i + 1, results.length, "duplicate");
        continue;
      }

      data.push(ghUrl);
      if (tiktokUrl) addHistory(tiktokUrl);
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
    getUserVideos,
    getVideo,
    uploadVideo,
    isDuplicate,
    loadList,
    saveList,
    pickRandom,
    loadHistory,
    saveHistory,
    inHistory,
    addHistory,
    bulkAdd,
  },
};

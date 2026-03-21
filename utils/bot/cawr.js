"use strict";

/**
 * utils/bot/cawr.js
 * ─────────────────────────────────────────────────────────────────────────────
 * global.cawr — Thư viện tiện ích dùng chung toàn bot
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  global.cawr.tt — Bộ công cụ TikTok (không dùng API bên ngoài)         │
 * ├────────────────────────┬────────────────────────────────────────────────┤
 * │  .search(q, limit)     │ Tìm video bằng từ khóa trực tiếp TikTok       │
 * │  .getUserVideos(uid)   │ Lấy toàn bộ video từ @username trực tiếp      │
 * │  .uploadVideo(...)     │ Tải video về local → upload lên GitHub         │
 * │  .isDuplicate(l, u)    │ Kiểm tra URL đã có trong danh sách chưa       │
 * │  .pickRandom(name)     │ Lấy ngẫu nhiên 1 URL từ listapi/<name>.json   │
 * │  .loadList(name)       │ Đọc toàn bộ listapi/<name>.json                │
 * │  .saveList(name, d)    │ Ghi lại listapi/<name>.json                    │
 * │  .loadHistory()        │ Đọc lịch sử TikTok video ID đã lấy            │
 * │  .inHistory(id)        │ Kiểm tra video ID đã trong lịch sử chưa       │
 * │  .addHistory(id)       │ Thêm video ID vào lịch sử                     │
 * │  .bulkAdd(n,q,lim)     │ Pipeline đầy đủ: tìm→tải→upload→lưu           │
 * └────────────────────────┴────────────────────────────────────────────────┘
 *
 * Cấu hình trong config.json:
 *   "tiktokCookie": "<cookie TikTok>"  — bắt buộc cho tìm theo từ khóa
 *   (lấy @username không cần cookie)
 */

const fs     = require("fs");
const path   = require("path");
const axios  = require("axios");
const crypto = require("crypto");

const TikTok = require("@tobyg74/tiktok-api-dl");

function generateMsToken(len = 148) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, b => chars[b % chars.length]).join("");
}

function buildFullCookie(baseCookie) {
  const hasMs      = /msToken=/.test(baseCookie);
  const hasChain   = /tt_chain_token=/.test(baseCookie);
  let cookie = baseCookie;
  if (!hasMs)    cookie += `; msToken=${generateMsToken()}`;
  if (!hasChain) cookie += `; tt_chain_token=${generateMsToken(24)}`;
  return cookie;
}

const LISTAPI_DIR  = path.join(process.cwd(), "includes", "listapi");
const TEMP_DIR     = path.join(process.cwd(), "includes", "cache");
const DATA_DIR     = path.join(process.cwd(), "includes", "data");
const HISTORY_FILE = path.join(DATA_DIR, "tt_history.json");
const FOWN_API     = "https://fown.onrender.com";

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers thư mục
// ─────────────────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
//  LISTAPI helpers
// ─────────────────────────────────────────────────────────────────────────────

function loadList(name) {
  ensureDir(LISTAPI_DIR);
  const filePath = path.join(LISTAPI_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) return [];
  try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { return []; }
}

function saveList(name, data) {
  ensureDir(LISTAPI_DIR);
  fs.writeFileSync(
    path.join(LISTAPI_DIR, `${name}.json`),
    JSON.stringify(data, null, 2),
    "utf-8"
  );
}

function pickRandom(name) {
  const list = loadList(name);
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

// ─────────────────────────────────────────────────────────────────────────────
//  HISTORY — Lưu video ID đã xử lý để tránh trùng lặp giữa các lần chạy
// ─────────────────────────────────────────────────────────────────────────────

function loadHistory() {
  ensureDir(DATA_DIR);
  if (!fs.existsSync(HISTORY_FILE)) return new Set();
  try {
    const arr = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}

function saveHistory(histSet) {
  ensureDir(DATA_DIR);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([...histSet], null, 2), "utf-8");
}

function inHistory(videoId) {
  if (!videoId) return false;
  return loadHistory().has(String(videoId));
}

function addHistory(videoId) {
  if (!videoId) return;
  const hist = loadHistory();
  hist.add(String(videoId));
  saveHistory(hist);
}

// ─────────────────────────────────────────────────────────────────────────────
//  TikTok — Search theo từ khoá (trực tiếp, không qua API ngoài)
//  Yêu cầu: global.config.tiktokCookie
//  Mỗi page ~10 kết quả, phân trang để đủ limit (max 50)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tìm video TikTok trực tiếp qua tiktok-api-dl, trả về mảng item chuẩn hoá.
 * @param {string} query
 * @param {number} limit  1-50
 * @returns {Promise<Array<{ id, videoUrl, tiktokUrl, title, author }>>}
 */
async function search(query, limit = 8) {
  const cookie = global.config?.tiktokCookie;
  if (!cookie) throw new Error("Chưa có tiktokCookie trong config.json");

  const safeLimit = Math.min(Math.max(1, limit), 50);
  const results   = [];
  let page = 1;

  while (results.length < safeLimit) {
    let res;
    try {
      res = await TikTok.Search(query, { type: "video", cookie, page });
    } catch (e) {
      global.logWarn?.(`[cawr.tt] search page ${page} lỗi: ${e.message}`);
      break;
    }

    if (res.status !== "success" || !Array.isArray(res.result) || res.result.length === 0) {
      global.logWarn?.(`[cawr.tt] search page ${page}: ${res.message || "không có kết quả"}`);
      break;
    }

    for (const v of res.result) {
      if (results.length >= safeLimit) break;
      const videoUrl = v.video?.downloadAddr || v.video?.playAddr || null;
      if (!videoUrl) continue;
      const uid = String(v.id || `${Date.now()}_${Math.random().toString(36).slice(2,6)}`);
      const tiktokUrl = `https://www.tiktok.com/@${v.author?.uniqueId || "unknown"}/video/${uid}`;
      results.push({
        id:        uid,
        videoUrl,
        tiktokUrl,
        title:     v.desc     || "",
        author:    v.author?.uniqueId || "",
      });
    }

    page++;
    if (results.length < safeLimit) {
      await new Promise(r => setTimeout(r, 600));
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
//  TikTok — Lấy toàn bộ video của @username (không cần cookie, không giới hạn)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lấy danh sách video từ @username qua fown.onrender.com (search API).
 * Không cần cookie, không cần secUid.
 * @param {string} username  có thể có hoặc không có @ phía trước
 * @param {number} limit     Số video tối đa (mặc định 50)
 * @returns {Promise<Array<{ id, videoUrl, tiktokUrl, title, author, _useFown }>>}
 */
async function getUserVideos(username, limit = 50) {
  const uid = username.replace(/^@/, "");
  const safeLimit = Math.max(1, Math.min(limit, 200));

  let res;
  try {
    res = await axios.get(`${FOWN_API}/api/search`, {
      params: { ttsearch: `@${uid}`, svl: safeLimit },
      timeout: 25000,
    });
  } catch (e) {
    throw new Error(`Fown search lỗi: ${e.message}`);
  }

  const videos = res.data?.results;
  if (!Array.isArray(videos) || videos.length === 0) {
    const msg = `Không tìm thấy video nào của @${uid} (fown trả về rỗng)`;
    global.logWarn?.(`[cawr.tt] getUserVideos: ${msg}`);
    throw new Error(msg);
  }

  return videos.map(v => ({
    id:        String(v.id || `${Date.now()}_${Math.random().toString(36).slice(2,6)}`),
    videoUrl:  null,                 // Không có direct URL; dùng fown download
    tiktokUrl: v.url || `https://www.tiktok.com/@${uid}/video/${v.id}`,
    title:     v.title || "",
    author:    uid,
    _useFown:  true,                 // Báo hiệu bulkAdd dùng fown để lấy raw_url
  }));
}

/**
 * Dùng fown.onrender.com để lấy raw_url (GitHub CDN) từ một TikTok video URL.
 * @param {string} tiktokUrl
 * @returns {Promise<string|null>}  raw_url hoặc null nếu thất bại
 */
async function fownGetRawUrl(tiktokUrl) {
  try {
    const res = await axios.get(`${FOWN_API}/api/download`, {
      params:  { url: tiktokUrl },
      timeout: 40000,
    });
    return res.data?.raw_url || null;
  } catch (e) {
    global.logWarn?.(`[cawr.tt] fownGetRawUrl lỗi (${tiktokUrl.slice(-30)}): ${e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  TikTok — Tải video + upload GitHub
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tải video từ direct URL → upload lên GitHub → trả về download_url.
 * @param {string} videoUrl   Link video thực (downloadAddr / playAddr)
 * @param {string} tipName    Tên thư mục trong repo (vd: "gaixinh")
 * @param {string} uid        ID duy nhất để đặt tên file
 * @returns {Promise<string|null>}  GitHub URL, null nếu thất bại
 */
async function uploadVideo(videoUrl, tipName, uid) {
  ensureDir(TEMP_DIR);
  const rawPath = path.join(TEMP_DIR, `cawr_tt_${uid}.mp4`);
  try {
    const res = await axios.get(videoUrl, {
      responseType:     "arraybuffer",
      timeout:          180000,
      maxContentLength: 500 * 1024 * 1024,
      headers: {
        "User-Agent":  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer":     "https://www.tiktok.com/",
      },
    });
    fs.writeFileSync(rawPath, Buffer.from(res.data));
    if (fs.statSync(rawPath).size === 0) throw new Error("File tải về rỗng");
    const repoPath = `listapi/${tipName}/${uid}.mp4`;
    const ghUrl = await global.githubUpload(rawPath, repoPath);
    return ghUrl || null;
  } finally {
    try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch (_) {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  TikTok — Kiểm tra trùng trong listapi (so sánh pathname)
// ─────────────────────────────────────────────────────────────────────────────

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
 *   - query bắt đầu "@" → GetUserPosts (lấy FULL, không cần cookie)
 *   - query bình thường  → Search (max 50, cần tiktokCookie trong config)
 *
 * History lưu theo video ID để tránh tải lại dù URL CDN thay đổi.
 *
 * @param {string}   tipName
 * @param {string}   query         Từ khóa hoặc @username
 * @param {number}   limit         Số video cho text search (max 50)
 * @param {Function} [onProgress]  Callback (i, total, status)
 * @returns {Promise<{ success, skipped, failed, total, failReasons }>}
 */
async function bulkAdd(tipName, query, limit = 8, onProgress = null) {
  const isUser = query.startsWith("@");

  let results;
  try {
    if (isUser) {
      global.logInfo?.(`[cawr.tt] GetUserPosts: ${query}`);
      results = await getUserVideos(query);
    } else {
      const safeLimit = Math.min(Math.max(1, limit), 50);
      global.logInfo?.(`[cawr.tt] Search: "${query}" (${safeLimit} video)`);
      results = await search(query, safeLimit);
    }
  } catch (e) {
    throw e;
  }

  if (!results.length) return { success: 0, skipped: 0, failed: 0, total: 0, failReasons: [] };

  const data        = loadList(tipName);
  let success = 0, skipped = 0, failed = 0;
  const failReasons = [];

  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    const uid  = `${item.id}_${Math.random().toString(36).slice(2, 6)}`;

    // Kiểm tra lịch sử theo video ID
    if (inHistory(item.id)) {
      skipped++;
      global.logInfo?.(`[cawr.tt] Bỏ qua (lịch sử): ${item.id}`);
      onProgress?.(i + 1, results.length, "history");
      continue;
    }

    try {
      let finalUrl = null;

      if (item._useFown) {
        // Lấy raw_url từ fown (GitHub CDN) — không cần tải về local
        global.logInfo?.(`[cawr.tt] Fown download ${i + 1}/${results.length}: ${item.id}`);
        finalUrl = await fownGetRawUrl(item.tiktokUrl);
        if (!finalUrl) {
          failed++;
          failReasons.push(`Fown không trả về URL: ${item.id}`);
          onProgress?.(i + 1, results.length, "fail");
          continue;
        }
      } else {
        // Tải về local rồi upload GitHub (flow cũ cho search keyword)
        if (!item.videoUrl) {
          skipped++;
          addHistory(item.id);
          onProgress?.(i + 1, results.length, "skip_image");
          continue;
        }
        finalUrl = await uploadVideo(item.videoUrl, tipName, uid);
        if (!finalUrl) {
          failed++;
          failReasons.push("Không lấy được URL GitHub");
          onProgress?.(i + 1, results.length, "fail");
          continue;
        }
      }

      if (isDuplicate(data, finalUrl)) {
        skipped++;
        addHistory(item.id);
        global.logInfo?.(`[cawr.tt] Bỏ qua trùng listapi: ${finalUrl}`);
        onProgress?.(i + 1, results.length, "duplicate");
        continue;
      }

      data.push(finalUrl);
      addHistory(item.id);
      success++;
      global.logInfo?.(`[cawr.tt] ✅ ${i + 1}/${results.length}: ${finalUrl}`);
      onProgress?.(i + 1, results.length, "ok");
    } catch (e) {
      failed++;
      failReasons.push(e.message?.slice(0, 80) || "unknown");
      global.logWarn?.(`[cawr.tt] Lỗi #${i + 1} (${item.id}): ${e.message}`);
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
    fownGetRawUrl,
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

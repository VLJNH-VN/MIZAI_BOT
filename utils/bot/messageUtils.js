"use strict";

const fs   = require("fs");
const path = require("path");
const axios = require("axios");
const { execSync } = require("child_process");
const { ThreadType } = require("zca-js");
const messageCache   = require("../../includes/database/messageCache");

// ── Extract Body ──────────────────────────────────────────────────────────────

function _extractFromObj(obj) {
  if (!obj || typeof obj !== "object") return "";
  if (typeof obj.text        === "string" && obj.text        !== "") return obj.text;
  if (typeof obj.msg         === "string" && obj.msg         !== "") return obj.msg;
  if (typeof obj.title       === "string" && obj.title       !== "") return obj.title;
  if (typeof obj.description === "string" && obj.description !== "") return obj.description;
  if (typeof obj.caption     === "string" && obj.caption     !== "") return obj.caption;
  if (typeof obj.body        === "string" && obj.body        !== "") return obj.body;
  return "";
}

function extractBody(raw) {
  if (!raw) return "";

  const c = raw.content;

  if (c && typeof c === "object") return _extractFromObj(c);

  if (typeof c === "string") {
    if (c.length > 0 && (c.charCodeAt(0) === 123 || c.charCodeAt(0) === 91)) {
      try {
        const parsed = JSON.parse(c);
        const extracted = _extractFromObj(parsed);
        if (extracted !== "") return extracted;
      } catch (_) {}
    }
    return c;
  }

  return "";
}

// ── Resolve Quote ─────────────────────────────────────────────────────────────

const MEDIA_EXTS = /\.(mp4|mkv|avi|mov|webm|jpg|jpeg|png|gif|webp|mp3|aac|m4a|ogg|wav|flac)$/i;

function _pickExt(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.split("?")[0].match(MEDIA_EXTS);
  return m ? m[0].toLowerCase() : null;
}

function _normalizeEntry(raw, source) {
  if (!raw) return null;

  const c      = raw.content;
  const attArr = Array.isArray(raw.attach) ? raw.attach : [];

  let mediaUrl = null;
  let ext      = null;
  let isMedia  = false;
  let isText   = false;

  if (typeof c === "string" && c.length > 0) {
    isText = true;
  } else if (c && typeof c === "object") {
    mediaUrl = c.url || c.normalUrl || c.hdUrl || c.href ||
               c.fileUrl || c.downloadUrl || c.src || null;
    ext      = c.ext ? (c.ext.startsWith(".") ? c.ext : "." + c.ext) : _pickExt(mediaUrl);
    isMedia  = !!mediaUrl;
  }

  if (!mediaUrl && attArr.length > 0) {
    const first = attArr[0];
    mediaUrl = first.url || first.normalUrl || first.hdUrl || first.href ||
               first.fileUrl || first.downloadUrl || first.src || null;
    ext      = first.ext ? (first.ext.startsWith(".") ? first.ext : "." + first.ext)
                          : _pickExt(mediaUrl);
    isMedia  = !!mediaUrl;
  }

  if (!isText && !isMedia) return null;

  return {
    msgId    : raw.msgId    ? String(raw.msgId)    : null,
    cliMsgId : raw.cliMsgId ? String(raw.cliMsgId) : null,
    uidFrom  : raw.uidFrom  ? String(raw.uidFrom)  : (raw.ownerId ? String(raw.ownerId) : null),
    ts       : raw.ts || raw.msgTs || null,
    content  : c,
    attach   : attArr,
    mediaUrl,
    ext,
    isMedia,
    isText,
    _source  : source,
  };
}

function _hasContent(raw) {
  if (!raw) return false;
  const c = raw.content;
  if (typeof c === "string" && c.trim().length > 0) return true;
  if (c && typeof c === "object") {
    const url = c.url || c.normalUrl || c.hdUrl || c.href ||
                c.fileUrl || c.downloadUrl || c.src;
    if (url) return true;
  }
  const attArr = Array.isArray(raw.attach) ? raw.attach : [];
  if (attArr.length > 0 && (attArr[0].url || attArr[0].href || attArr[0].fileUrl)) return true;
  return false;
}

async function resolveQuote({ raw, api, threadId, event }) {
  if (!raw) return null;

  const quoteRaw =
    raw.quote      ||
    raw.msgReply   ||
    raw.replyTo    ||
    raw.replyMessage ||
    null;

  if (!quoteRaw) return null;

  if (_hasContent(quoteRaw)) {
    return _normalizeEntry(quoteRaw, "quote");
  }

  const msgId    = quoteRaw.msgId    ? String(quoteRaw.msgId)    : null;
  const cliMsgId = quoteRaw.cliMsgId ? String(quoteRaw.cliMsgId) : null;

  if (!msgId && !cliMsgId) return null;

  const tid = threadId ? String(threadId) : null;

  const cached = msgId    ? messageCache.getById(msgId, tid)
               : cliMsgId ? messageCache.getByCliId(cliMsgId, tid)
               : null;

  if (cached && _hasContent(cached)) {
    return _normalizeEntry(cached, "cache");
  }

  if (!api || !tid) return _normalizeEntry(quoteRaw, "quote") || null;

  const isGroup =
    event?.type === ThreadType.Group ||
    (typeof event?.type === "number" && event.type === ThreadType.Group);

  if (!isGroup) return _normalizeEntry(quoteRaw, "quote") || null;

  try {
    const history = await api.getGroupChatHistory(tid, 50);
    const msgs    = history?.groupMsgs || [];

    for (const m of msgs) {
      const d = m?.data || m;
      const mid = d.msgId ? String(d.msgId) : null;
      const cid = d.cliMsgId ? String(d.cliMsgId) : null;

      const matched =
        (msgId    && (mid === msgId    || cid === msgId))    ||
        (cliMsgId && (cid === cliMsgId || mid === cliMsgId));

      if (matched && _hasContent(d)) {
        messageCache.store(m?.data ? m : { data: d, threadId: tid, type: event?.type });
        return _normalizeEntry(d, "history");
      }
    }
  } catch (e) {
    (global.logWarn || console.warn)(`[resolveQuote] getGroupChatHistory lỗi: ${e.message}`);
  }

  return _normalizeEntry(quoteRaw, "quote") || null;
}

// ── Process Gai Data ──────────────────────────────────────────────────────────

const ROOT_DIR       = path.join(__dirname, "../../");
const inputJsonPath  = path.join(ROOT_DIR, "includes", "data", "gai.json");
const cacheDir       = path.join(ROOT_DIR, "includes", "cache", "temp");
const thumbDir       = path.join(ROOT_DIR, "includes", "cache", "thumbs");
const outputJsonPath = path.join(ROOT_DIR, "includes", "data", "VideoCosplay.json");

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function downloadFile(url, filePath) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    maxContentLength: 200 * 1024 * 1024,
    headers: { "User-Agent": global.userAgent },
  });
  fs.writeFileSync(filePath, Buffer.from(response.data));
  return response.data;
}

function getVideoMetadata(filePath) {
  const out = execSync(
    `ffprobe -v error -show_format -show_streams -of json "${filePath}"`,
    { timeout: 15000, stdio: "pipe" }
  ).toString();
  const data        = JSON.parse(out);
  const videoStream = data.streams.find(s => s.codec_type === "video");
  if (!videoStream) throw new Error("Không tìm thấy video stream.");
  return {
    width:    videoStream.width  || 0,
    height:   videoStream.height || 0,
    duration: Math.round(parseFloat(data.format.duration || 0)),
  };
}

function createThumbnail(videoPath, thumbNameWithBinExt, outDir) {
  const baseName   = path.parse(thumbNameWithBinExt).name;
  const tempThumb  = path.join(outDir, `${baseName}.jpg`);
  const finalThumb = path.join(outDir, thumbNameWithBinExt);
  execSync(
    `ffmpeg -y -i "${videoPath}" -ss 00:00:01 -vframes 1 -vf scale=320:-1 -q:v 5 "${tempThumb}"`,
    { timeout: 15000, stdio: "pipe" }
  );
  fs.renameSync(tempThumb, finalThumb);
  return finalThumb;
}

async function processOneVideo(url, index, total, onLog) {
  const label        = `[${index + 1}/${total}]`;
  const videoFileName = `video_${index}_${Date.now()}.mp4`;
  const tmpPath      = path.join(cacheDir, videoFileName);

  try {
    onLog?.(`${label} Đang tải: ${url}`);
    const videoBuffer = await downloadFile(url, tmpPath);

    const sizeMB = (videoBuffer.length / 1024 / 1024).toFixed(2);
    onLog?.(`${label} Size: ${sizeMB} MB — đang lấy metadata...`);

    const start            = Date.now();
    const meta             = getVideoMetadata(tmpPath);
    const thumbBaseName    = path.parse(videoFileName).name;
    const thumbNameWithBin = `${thumbBaseName}.bin`;
    createThumbnail(tmpPath, thumbNameWithBin, thumbDir);

    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    onLog?.(`${label} ${meta.width}x${meta.height} | ${meta.duration}s | ${elapsed}s xử lý`);

    return { url, width: meta.width, height: meta.height, duration: meta.duration, thumbnail: thumbNameWithBin };
  } catch (err) {
    onLog?.(`${label} Lỗi: ${err.message}`);
    return null;
  } finally {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
  }
}

async function processGaiData({ sleepMs = 0, onLog, onProgress } = {}) {
  const log = onLog || ((msg) => console.log(msg));

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(thumbDir,  { recursive: true });

  if (!fs.existsSync(inputJsonPath)) {
    throw new Error(`Không tìm thấy file: ${inputJsonPath}`);
  }

  const rawList = JSON.parse(fs.readFileSync(inputJsonPath, "utf8"));
  const urlList = rawList.map(item => (typeof item === "string" ? item : item.url)).filter(Boolean);

  let existingData = [];
  try {
    existingData = JSON.parse(fs.readFileSync(outputJsonPath, "utf8"));
    log(`Đã có ${existingData.length} video đã xử lý trước đó.`);
  } catch {
    log("Chưa có file kết quả, sẽ tạo mới.");
  }

  const doneUrls    = new Set(existingData.map(v => v.url));
  const pendingUrls = urlList.filter(u => !doneUrls.has(u));

  if (pendingUrls.length === 0) {
    log("Không có link mới nào cần xử lý.");
    return { success: 0, fail: 0, total: 0, saved: existingData.length };
  }

  log(`Cần xử lý: ${pendingUrls.length} link mới`);

  let successCount = 0;
  let failCount    = 0;

  for (let i = 0; i < pendingUrls.length; i++) {
    const url       = pendingUrls[i];
    const videoData = await processOneVideo(url, i, pendingUrls.length, log);

    if (videoData) {
      existingData.push(videoData);
      fs.writeFileSync(outputJsonPath, JSON.stringify(existingData, null, 2));
      successCount++;
    } else {
      failCount++;
    }

    onProgress?.({ done: i + 1, total: pendingUrls.length, success: successCount, fail: failCount });

    if (sleepMs > 0 && i < pendingUrls.length - 1) {
      log(`Nghỉ ${sleepMs / 1000}s trước link tiếp theo...`);
      await sleep(sleepMs);
    }
  }

  log(`\nHoàn tất! Thành công: ${successCount} | Lỗi: ${failCount} | Tổng kho: ${existingData.length}`);
  return { success: successCount, fail: failCount, total: pendingUrls.length, saved: existingData.length };
}

// ── Parse mention UIDs từ event Zalo ──────────────────────────────────────────
function parseMentionIds(event) {
  const raw = event?.data;
  if (!raw) return [];

  // 1. raw.mentionInfo — JSON string: [{"uid":"123","length":8,"offset":0}]
  const mentionInfo = raw.mentionInfo;
  if (mentionInfo) {
    try {
      const arr = typeof mentionInfo === "string" ? JSON.parse(mentionInfo) : mentionInfo;
      if (Array.isArray(arr)) {
        const ids = arr.map(m => String(m.uid || m.id || "")).filter(uid => uid && uid !== "0");
        if (ids.length) return ids;
      }
    } catch {}
  }

  // 2. raw.mentions — array: [{"uid":"123","pos":0,"len":6,"type":0}]
  const mentions = raw.mentions;
  if (Array.isArray(mentions)) {
    const ids = mentions.map(m => String(m.uid || m.id || "")).filter(uid => uid && uid !== "0");
    if (ids.length) return ids;
  }
  // 2b. raw.mentions — object dạng { uid: name }
  if (mentions && typeof mentions === "object") {
    const ids = Object.keys(mentions).filter(k => k && k !== "0" && /^\d+$/.test(k));
    if (ids.length) return ids;
  }

  // 3. mentions nằm trong content JSON
  try {
    const c = raw.content;
    const parsed = typeof c === "string" ? JSON.parse(c) : c;
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.mentions)) {
        const ids = parsed.mentions.map(m => String(m.uid || m.id || "")).filter(uid => uid && uid !== "0");
        if (ids.length) return ids;
      }
      if (parsed.mentionInfo) {
        const arr = typeof parsed.mentionInfo === "string" ? JSON.parse(parsed.mentionInfo) : parsed.mentionInfo;
        if (Array.isArray(arr)) {
          const ids = arr.map(m => String(m.uid || "")).filter(uid => uid && uid !== "0");
          if (ids.length) return ids;
        }
      }
    }
  } catch {}

  return [];
}

module.exports = { extractBody, resolveQuote, processGaiData, parseMentionIds };

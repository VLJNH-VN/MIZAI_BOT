"use strict";

/**
 * utils/bot/resolveQuote.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Giải quyết "context reply" — lấy nội dung đầy đủ của tin nhắn được reply.
 *
 * Zalo đôi khi không gửi đủ content trong `event.data.quote` (đặc biệt với
 * video/media của người khác). Hàm này:
 *   1. Đọc raw.quote || raw.msgReply
 *   2. Kiểm tra xem đã có nội dung chưa (text / attach / url)
 *   3. Nếu thiếu → tra MessageCache (các tin đã nhận trước đó)
 *   4. Nếu vẫn không có → gọi api.getGroupChatHistory để tìm
 *   5. Trả về object đã chuẩn hóa hoặc null nếu không tìm được
 *
 * Kết quả trả về:
 * {
 *   msgId, cliMsgId, uidFrom, ts,
 *   content,          — chuỗi text hoặc object media
 *   attach,           — mảng attachment (thường có url)
 *   mediaUrl,         — URL media trực tiếp nếu có (tiện dùng)
 *   ext,              — đuôi file media nếu xác định được
 *   isMedia,          — true nếu là video/ảnh/audio
 *   isText,           — true nếu là text thuần
 *   _source,          — "quote"|"cache"|"history" — nguồn dữ liệu
 * }
 *
 * Dùng:
 *   const { resolveQuote } = require("../../utils/bot/resolveQuote");
 *   const ctx = await resolveQuote({ raw, api, threadId, event });
 *   if (!ctx) return send("Không tìm được tin bạn đang reply.");
 *
 * Hoặc qua global:
 *   global.resolveQuote({ raw, api, threadId, event })
 */

const { ThreadType } = require("zca-js");
const messageCache   = require("../../includes/database/messageCache");

const MEDIA_EXTS = /\.(mp4|mkv|avi|mov|webm|jpg|jpeg|png|gif|webp|mp3|aac|m4a|ogg|wav|flac)$/i;

function _pickExt(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.split("?")[0].match(MEDIA_EXTS);
  return m ? m[0].toLowerCase() : null;
}

function _normalizeEntry(raw, source) {
  if (!raw) return null;

  const c       = raw.content;
  const attArr  = Array.isArray(raw.attach) ? raw.attach : [];

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

module.exports = { resolveQuote };

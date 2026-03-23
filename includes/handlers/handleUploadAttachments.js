"use strict";

/**
 * handleUploadAttachments.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phát hiện và xử lý tin nhắn có đính kèm (ảnh, video, file, voice, gif,
 * sticker) từ sự kiện "message" của zca-js.
 *
 * Cách hoạt động:
 *  1. Phân tích `event.data` để xác định có đính kèm hay không — kiểm tra
 *     cả raw.content (object) lẫn raw.attach (string JSON / object / array).
 *  2. Chuẩn hoá metadata đính kèm → AttachmentInfo.
 *  3. Gọi `command.onAttachment(ctx)` cho mọi command đã đăng ký hook này.
 *
 * AttachmentInfo (object truyền vào `onAttachment`):
 *   {
 *     type:     "image" | "video" | "audio" | "file" | "gif" | "sticker",
 *     url:      string,          // URL tải về / xem (ưu tiên HD)
 *     thumb:    string | null,   // URL thumbnail (video/gif)
 *     name:     string | null,   // Tên file (nếu có)
 *     size:     number | null,   // Kích thước bytes (nếu có)
 *     mime:     string | null,   // MIME type (nếu có)
 *     duration: number | null,   // Thời lượng giây (audio/video)
 *     width:    number | null,   // Chiều rộng (ảnh/video)
 *     height:   number | null,   // Chiều cao (ảnh/video)
 *     raw:      object,          // Toàn bộ data gốc của attachment
 *   }
 *
 * Để command nhận được hook, khai báo trong command:
 *   module.exports = {
 *     config: { name: "...", ... },
 *     run: ...,
 *     onAttachment: async ({ api, event, attachment, send, senderId, threadID }) => { ... }
 *   };
 */

const { ThreadType } = require("zca-js");

// ── Bảng phân loại msgType (string) ──────────────────────────────────────────
const TYPE_MAP_STR = {
  photo:   "image",
  image:   "image",
  video:   "video",
  gif:     "gif",
  audio:   "audio",
  voice:   "audio",
  file:    "file",
  doc:     "file",
  sticker: "sticker",
};

// ── Bảng phân loại cliMsgType / msgType (số) — theo Zalo protocol ────────────
// 1=text, 3=sticker, 6=gif, 7=chat.photo (nhiều ảnh), 9=chat.file,
// 12=link, 32=photo, 304=video, 341=voice, 400=file v2
const TYPE_MAP_NUM = {
  3:   "sticker",
  6:   "gif",
  7:   "image",   // chat.photo (album)
  9:   "file",
  32:  "image",   // single photo
  304: "video",
  341: "audio",
  400: "file",
};

// ── Regex hỗ trợ ──────────────────────────────────────────────────────────────
const ZALO_CDN = /\b(zdn\.vn|dlfl\.vn|zmp3\.vn|zadn\.vn|zalo\.me|cover\.zdn|s\d+-ava)/i;
const IMG_EXT  = /\.(jpg|jpeg|png|gif|webp|jxl|bmp|heic|webp)(\?|$)/i;
const VID_EXT  = /\.(mp4|mkv|mov|avi|webm)(\?|$)/i;
const AUD_EXT  = /\.(mp3|m4a|ogg|aac|wav|flac|opus)(\?|$)/i;

/**
 * Lấy attachment type từ msgType string.
 * Ví dụ: "webchat.photo" → "image", "chat.video" → "video"
 */
function detectTypeFromMsgType(msgType) {
  if (!msgType) return null;
  if (typeof msgType === "number") return TYPE_MAP_NUM[msgType] || null;
  const lower = String(msgType).toLowerCase();
  for (const [keyword, type] of Object.entries(TYPE_MAP_STR)) {
    if (lower.includes(keyword)) return type;
  }
  return null;
}

/**
 * Suy đoán attachment type từ URL hoặc tên file.
 */
function detectTypeFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  const bare = url.split("?")[0].toLowerCase();
  if (IMG_EXT.test(bare) || ZALO_CDN.test(url)) return "image";
  if (VID_EXT.test(bare)) return "video";
  if (AUD_EXT.test(bare)) return "audio";
  return null;
}

/**
 * Trích URL tốt nhất từ một object attachment.
 * Ưu tiên: hdUrl > normalUrl > href > url > fileUrl > downloadUrl > src > thumb
 */
function urlFromObj(a) {
  if (!a || typeof a !== "object") return null;

  // Thử lấy HD URL từ params (chuỗi JSON)
  if (a.params && typeof a.params === "string") {
    try {
      const p = JSON.parse(a.params);
      if (p.hd && typeof p.hd === "string") return p.hd;
    } catch {}
  }

  const candidates = [
    a.hdUrl, a.normalUrl, a.href, a.url,
    a.fileUrl, a.videoUrl, a.downloadUrl, a.src,
    a.thumb, a.thumbUrl, a.preview,
  ];
  for (const u of candidates) {
    if (u && typeof u === "string" && u.startsWith("http")) return u;
  }
  return null;
}

/**
 * Parse một giá trị attach (string JSON / object / array) → mảng objects.
 */
function parseAttach(rawAttach) {
  if (!rawAttach) return [];

  // Chuỗi JSON
  if (typeof rawAttach === "string") {
    if (!rawAttach.trim()) return [];
    // Thử parse JSON
    try {
      const parsed = JSON.parse(rawAttach);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
      if (parsed && typeof parsed === "object") return [parsed];
    } catch {}
    // Không phải JSON — không xử lý thêm
    return [];
  }

  if (Array.isArray(rawAttach)) return rawAttach.filter(Boolean);
  if (typeof rawAttach === "object") return [rawAttach];
  return [];
}

/**
 * Chuẩn hoá AttachmentInfo từ một object attachment đơn.
 */
function buildAttachmentInfo(a, fallbackType) {
  const url = urlFromObj(a);
  if (!url) return null;

  const type =
    detectTypeFromMsgType(a.type || a.msgType || a.cliMsgType) ||
    detectTypeFromUrl(a.fname || a.fileName || url)             ||
    fallbackType ||
    "file";

  // Trích width/height từ params nếu có
  let width = a.width || null;
  let height = a.height || null;
  if ((!width || !height) && a.params && typeof a.params === "string") {
    try {
      const p = JSON.parse(a.params);
      width  = width  || p.width  || null;
      height = height || p.height || null;
    } catch {}
  }

  return {
    type,
    url,
    thumb:    a.thumb || a.thumbUrl || a.preview || null,
    name:     a.fname || a.fileName || a.name || null,
    size:     a.fsize || a.fileSize || a.size || null,
    mime:     a.ftype || a.mimeType || a.mime || a.contentType || null,
    duration: a.duration || null,
    width:    width ? Number(width) : null,
    height:   height ? Number(height) : null,
    raw:      a,
  };
}

/**
 * Chuẩn hoá AttachmentInfo từ event.data (raw).
 * Kiểm tra tuần tự:
 *   1. raw.attach  (string JSON / array / object)  ← ảnh thường, cliMsgType=32
 *   2. raw.content (object)                        ← video, file, link card
 *   3. raw.content (string URL đơn)               ← hiếm gặp
 *
 * @param {object} raw - event.data
 * @returns {AttachmentInfo|null}
 */
function normalizeAttachment(raw) {
  if (!raw) return null;

  const msgType     = raw.msgType     || null;
  const cliMsgType  = raw.cliMsgType  || null;
  const fallbackType = detectTypeFromMsgType(msgType) || detectTypeFromMsgType(cliMsgType);

  // ── 1. raw.attach (single photo, album, voice, v.v.) ─────────────────────
  const attachItems = parseAttach(raw.attach);
  if (attachItems.length > 0) {
    // Lấy item đầu tiên có URL hợp lệ
    for (const a of attachItems) {
      const info = buildAttachmentInfo(a, fallbackType || "image");
      if (info) return info;
    }
  }

  // ── 2. raw.content là object (video card, file card, link card với media) ─
  const content = raw.content;
  if (content && typeof content === "object") {
    const url = urlFromObj(content);
    if (url) {
      const type =
        detectTypeFromMsgType(msgType || cliMsgType) ||
        detectTypeFromMsgType(content.type)          ||
        detectTypeFromUrl(content.fname || url)      ||
        "file";

      let width  = content.width  || null;
      let height = content.height || null;
      if ((!width || !height) && content.params && typeof content.params === "string") {
        try {
          const p = JSON.parse(content.params);
          width  = width  || p.width  || null;
          height = height || p.height || null;
        } catch {}
      }

      return {
        type,
        url,
        thumb:    content.thumb || content.thumbUrl || content.preview || null,
        name:     content.fname || content.fileName || content.name    || null,
        size:     content.fsize || content.fileSize || content.size    || null,
        mime:     content.ftype || content.mimeType || content.mime    || null,
        duration: content.duration || null,
        width:    width  ? Number(width)  : null,
        height:   height ? Number(height) : null,
        raw:      content,
      };
    }
  }

  // ── 3. raw.content là string URL đơn ────────────────────────────────────────
  if (typeof content === "string" && /^https?:\/\//.test(content.trim())) {
    const url  = content.trim();
    const type = detectTypeFromMsgType(msgType || cliMsgType) || detectTypeFromUrl(url) || "file";
    return {
      type, url,
      thumb: null, name: null, size: null, mime: null,
      duration: null, width: null, height: null,
      raw: { url: content },
    };
  }

  return null;
}

/**
 * Kiểm tra xem event có chứa đính kèm không.
 * @param {object} raw - event.data
 * @returns {boolean}
 */
function hasAttachment(raw) {
  if (!raw) return false;

  const msgType    = raw.msgType    || "";
  const cliMsgType = raw.cliMsgType || 0;

  // Numeric cliMsgType khớp bảng
  if (TYPE_MAP_NUM[cliMsgType]) return true;

  // String msgType khớp bảng
  if (detectTypeFromMsgType(msgType)) return true;

  // raw.attach có dữ liệu
  if (raw.attach) {
    if (typeof raw.attach === "string" && raw.attach.trim()) return true;
    if (typeof raw.attach === "object") return true;
  }

  // content là object có URL media
  if (raw.content && typeof raw.content === "object") {
    const c = raw.content;
    const hasMedia = c.href || c.url || c.fileUrl || c.videoUrl ||
                     c.hdUrl || c.normalUrl || c.downloadUrl;
    if (hasMedia) return true;
  }

  return false;
}

// ── Main handler ───────────────────────────────────────────────────────────────

/**
 * Xử lý tin nhắn có đính kèm.
 * Gọi từ src/events/message.js sau handleCommand.
 *
 * @param {{ api, event, commands, prefix }} params
 */
async function handleUploadAttachments({ api, event, commands }) {
  try {
    const raw = event?.data ?? null;
    if (!raw) return;

    if (!hasAttachment(raw)) return;

    const attachment = normalizeAttachment(raw);
    if (!attachment) return;

    const threadID = event?.threadId ? String(event.threadId) : null;
    if (!threadID) return;

    const senderId = raw?.uidFrom ? String(raw.uidFrom) : null;

    // Bỏ qua tin nhắn của chính bot — dùng isSelf nếu zca-js cung cấp
    if (event.isSelf === true) return;
    const botId = global.botId ? String(global.botId) : null;
    if (botId && senderId && senderId === botId) return;

    const send = async (message) => {
      if (!threadID) return;
      const payload = typeof message === "string" ? { msg: message } : message;
      return api.sendMessage(payload, threadID, event.type ?? ThreadType.Group);
    };

    // ── Dispatch tới từng command có onAttachment ────────────────────────────
    if (!commands || typeof commands.forEach !== "function") return;

    for (const [commandName, command] of commands) {
      if (!command || typeof command.onAttachment !== "function") continue;

      try {
        await command.onAttachment({
          api,
          event,
          attachment,
          send,
          senderId,
          threadID,
          commandName,
          isBotAdmin: global.isBotAdmin,
        });
      } catch (err) {
        logError(`[handleUploadAttachments] Lỗi onAttachment command '${commandName}': ${err?.message || err}`);
      }
    }

    logDebug?.(`[upload] type=${attachment.type} | url=${attachment.url?.slice(0, 80)}`);
  } catch (err) {
    logError(`[handleUploadAttachments] Lỗi tổng: ${err?.message || err}`);
  }
}

module.exports = { handleUploadAttachments, normalizeAttachment, hasAttachment };

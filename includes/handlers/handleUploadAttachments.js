"use strict";

/**
 * handleUploadAttachments.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phát hiện và xử lý tin nhắn có đính kèm (ảnh, video, file, voice, gif,
 * sticker) từ sự kiện "message" của zca-js.
 *
 * Cách hoạt động:
 *  1. Phân tích `event.data` để xác định có đính kèm hay không (qua msgType
 *     hoặc nội dung content là object).
 *  2. Chuẩn hoá metadata đính kèm → AttachmentInfo.
 *  3. Gọi `command.onAttachment(ctx)` cho mọi command đã đăng ký hook này.
 *
 * AttachmentInfo (object truyền vào `onAttachment`):
 *   {
 *     type:     "image" | "video" | "audio" | "file" | "gif" | "sticker",
 *     url:      string,          // URL tải về / xem
 *     thumb:    string | null,   // URL thumbnail (video/gif)
 *     name:     string | null,   // Tên file (nếu có)
 *     size:     number | null,   // Kích thước bytes (nếu có)
 *     mime:     string | null,   // MIME type (nếu có)
 *     duration: number | null,   // Thời lượng giây (audio/video)
 *     raw:      object,          // Toàn bộ data.content gốc
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

// ── Bảng phân loại msgType ────────────────────────────────────────────────────
const TYPE_MAP = {
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

/**
 * Lấy attachment type từ msgType string.
 * Ví dụ: "webchat.photo" → "image", "chat.video" → "video"
 */
function detectTypeFromMsgType(msgType) {
  if (!msgType || typeof msgType !== "string") return null;
  const lower = msgType.toLowerCase();
  for (const [keyword, type] of Object.entries(TYPE_MAP)) {
    if (lower.includes(keyword)) return type;
  }
  return null;
}

/**
 * Suy đoán attachment type từ URL/tên file.
 */
function detectTypeFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  const ext = url.split("?")[0].split(".").pop().toLowerCase();
  if (["jpg", "jpeg", "png", "webp", "bmp", "heic"].includes(ext)) return "image";
  if (["mp4", "mkv", "mov", "avi", "webm"].includes(ext)) return "video";
  if (["mp3", "m4a", "ogg", "aac", "wav", "flac", "opus"].includes(ext)) return "audio";
  if (["gif"].includes(ext)) return "gif";
  return null;
}

/**
 * Chuẩn hoá content thành AttachmentInfo.
 * @param {string|object} content
 * @param {string|null}   msgType
 * @returns {AttachmentInfo|null}
 */
function normalizeAttachment(content, msgType) {
  if (!content) return null;

  // ── Trường hợp content là string (URL trực tiếp) ──────────────────────────
  if (typeof content === "string" && /^https?:\/\//.test(content.trim())) {
    const url  = content.trim();
    const type = detectTypeFromMsgType(msgType) || detectTypeFromUrl(url) || "file";
    return { type, url, thumb: null, name: null, size: null, mime: null, duration: null, raw: content };
  }

  // ── Trường hợp content là object ─────────────────────────────────────────
  if (typeof content === "object" && content !== null) {
    const url = content.href || content.url || content.fileUrl || content.videoUrl || content.thumb || null;
    if (!url) return null;

    const type =
      detectTypeFromMsgType(msgType)          ||
      detectTypeFromMsgType(content.type)     ||
      detectTypeFromUrl(content.fname || url) ||
      "file";

    return {
      type,
      url,
      thumb:    content.thumb || content.preview || null,
      name:     content.fname || content.fileName || content.name || null,
      size:     content.fsize || content.fileSize || content.size || null,
      mime:     content.ftype || content.mimeType || content.mime || null,
      duration: content.duration || null,
      raw:      content,
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

  const msgType = raw.msgType || "";

  // Có msgType khớp với bảng phân loại
  if (detectTypeFromMsgType(msgType)) return true;

  // content là object (có thể là link card hoặc file card)
  if (raw.content && typeof raw.content === "object") {
    // Loại bỏ link card thuần (chỉ có href là URL web thường)
    const c = raw.content;
    const hasMedia = c.href || c.url || c.fileUrl || c.videoUrl;
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

    const msgType  = raw.msgType || "";
    const content  = raw.content ?? null;
    const attachment = normalizeAttachment(content, msgType);

    if (!attachment) return;

    const threadID = event?.threadId ? String(event.threadId) : null;
    if (!threadID) return;

    const senderId = raw?.uidFrom ? String(raw.uidFrom) : null;
    const botId    = global.botId ? String(global.botId) : null;

    // Bỏ qua tin nhắn của chính bot
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

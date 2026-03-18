/**
 * extractBody – Trích nội dung text từ một raw message (event.data) của zca-js.
 *
 * Zalo gửi nhiều loại tin nhắn với cấu trúc `content` khác nhau:
 *  - Tin nhắn text thường   : content = "string"
 *  - Tin nhắn text kèm meta : content.text = "string"
 *  - Tin nhắn video/audio   : content.title | content.description | content.msg
 *  - Tin nhắn sticker/gif   : content.title | content.description
 *  - Tin nhắn quote người khác gửi video/audio: content = "string" (vẫn đúng)
 *    nhưng đôi khi Zalo bọc thêm một lớp object
 *
 * Hàm này thử tuần tự các field phổ biến và trả về chuỗi đầu tiên tìm được.
 */
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

  // 1. Content là object trực tiếp
  if (c && typeof c === "object") return _extractFromObj(c);

  // 2. Content là string
  if (typeof c === "string") {
    // Khi tin nhắn có nhiều mention, Zalo đôi khi gửi content là JSON string
    // dạng: '{"text":".lệnh ...","mentions":[...]}' — cần parse để lấy text thật
    if (c.length > 0 && (c.charCodeAt(0) === 123 /* { */ || c.charCodeAt(0) === 91 /* [ */)) {
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

module.exports = { extractBody };

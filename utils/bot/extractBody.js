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
function extractBody(raw) {
  if (!raw) return "";

  const c = raw.content;

  // 1. Content là string thuần (trường hợp phổ biến nhất)
  if (typeof c === "string") return c;

  // 2. Content là object
  if (c && typeof c === "object") {
    // Ưu tiên field "text" (zca-js thường dùng)
    if (typeof c.text === "string" && c.text !== "") return c.text;

    // Các field phụ thường thấy ở tin nhắn media/sticker/file
    if (typeof c.msg  === "string" && c.msg  !== "") return c.msg;
    if (typeof c.title === "string" && c.title !== "") return c.title;
    if (typeof c.description === "string" && c.description !== "") return c.description;
    if (typeof c.caption === "string" && c.caption !== "") return c.caption;
    if (typeof c.body === "string" && c.body !== "") return c.body;

    // Fallback: nếu "text" tồn tại nhưng rỗng, thử các field khác đã kiểm tra ở trên
    // (đã xử lý ở trên)
  }

  return "";
}

module.exports = { extractBody };

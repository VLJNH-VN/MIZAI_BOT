// ╔══════════════════════════════════════════════════════════════════════════╗
//  HƯỚNG DẪN TẠO LỆNH — MIZAI_BOT
//  File này giải thích toàn bộ cấu trúc một lệnh.
//  Sao chép file này, đổi tên file + config.name là xong.
// ╚══════════════════════════════════════════════════════════════════════════╝

module.exports = {

  // ══════════════════════════════════════════════════════════════════════════
  //  PHẦN 1 — CONFIG
  //  Khai báo thông tin lệnh. Bắt buộc phải có.
  // ══════════════════════════════════════════════════════════════════════════
  config: {
    name: "example",         // [BẮT BUỘC] Tên lệnh — người dùng gõ: .example
                             //   Đặt trùng tên file cho dễ quản lý.

    version: "1.0.0",        // Phiên bản lệnh (tự do đặt)

    hasPermssion: 0,         // Cấp quyền tối thiểu để dùng lệnh:
                             //   0 = Tất cả mọi người
                             //   1 = Quản trị viên nhóm trở lên
                             //   2 = Admin bot (ownerId / adminBotIds trong config.json)

    credits: "TênBạn",      // Tác giả lệnh

    description: "Mô tả ngắn về chức năng lệnh",

    commandCategory: "Tiện Ích", // Nhóm lệnh hiển thị trong .menu
                                 // Ví dụ: "Kinh Tế", "Giải Trí", "Admin", "System"

    usages: ".example <đối số>", // Cú pháp hướng dẫn người dùng

    cooldowns: 5             // Thời gian chờ giữa 2 lần dùng (giây)
                             //   0 = không giới hạn
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  PHẦN 2 — ON LOAD (tuỳ chọn)
  //  Chạy MỘT LẦN khi bot khởi động / reload lệnh.
  //  Dùng để: khởi tạo dữ liệu, đăng ký interval, kết nối DB riêng, v.v.
  // ══════════════════════════════════════════════════════════════════════════
  onLoad: async ({ api }) => {
    // api  — Zalo API client (gửi tin, lấy thông tin nhóm, ...)
    // Ví dụ:
    logInfo("[example] Lệnh đã được tải thành công.");
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  PHẦN 3 — RUN (bắt buộc)
  //  Hàm chính, chạy mỗi khi người dùng gọi lệnh.
  //
  //  DANH SÁCH THAM SỐ có thể dùng trong run():
  //  ┌─────────────────┬────────────────────────────────────────────────────┐
  //  │ Tham số         │ Mô tả                                              │
  //  ├─────────────────┼────────────────────────────────────────────────────┤
  //  │ api             │ Zalo API client                                    │
  //  │ event           │ Toàn bộ dữ liệu sự kiện gốc từ zca-js             │
  //  │ args            │ Mảng từ sau tên lệnh. VD: ".cmd a b" → ["a","b"]  │
  //  │ send(msg)       │ Hàm gửi tin nhắn về đúng thread hiện tại (quote)  │
  //  │ commands        │ Map toàn bộ lệnh đang chạy                        │
  //  │ prefix          │ Tiền tố lệnh (mặc định ".")                       │
  //  │ commandName     │ Tên lệnh đang chạy                                │
  //  │ senderId        │ ID người gửi (string)                             │
  //  │ threadID        │ ID cuộc trò chuyện / nhóm                        │
  //  │ isGroup         │ true nếu đang trong nhóm, false nếu nhắn riêng   │
  //  │ isBotAdmin(id)  │ Hàm kiểm tra id có phải admin bot không           │
  //  │ isGroupAdmin    │ Hàm async kiểm tra quyền quản trị nhóm           │
  //  │ registerReply   │ Đăng ký xử lý khi người dùng reply tin nhắn này  │
  //  │ registerReaction│ Đăng ký xử lý khi người dùng react tin nhắn này  │
  //  │ registerUndo    │ Đăng ký xử lý khi tin nhắn này bị thu hồi        │
  //  └─────────────────┴────────────────────────────────────────────────────┘
  // ══════════════════════════════════════════════════════════════════════════
  run: async ({
    api,
    event,
    args,
    send,
    senderId,
    threadID,
    isGroup,
    registerReply,
    registerReaction
  }) => {

    // ── Lấy thông tin cơ bản từ event ──────────────────────────────────────
    const raw = event?.data || {};
    const senderName = raw?.dName || senderId;

    // ── Ví dụ 1: Gửi tin nhắn đơn giản ────────────────────────────────────
    await send("Xin chào! Đây là lệnh mẫu.");

    // ── Ví dụ 2: Dùng args ─────────────────────────────────────────────────
    // Người dùng gõ: .example xin chào Mizai
    // args = ["xin", "chào", "Mizai"]
    if (args.length > 0) {
      const input = args.join(" ");
      await send(`Bạn nhập: ${input}`);
    }

    // ── Ví dụ 3: Kiểm tra nhóm / nhắn riêng ───────────────────────────────
    if (!isGroup) {
      return send("Lệnh này chỉ dùng được trong nhóm!");
    }

    // ── Ví dụ 4: Gửi có quote (mặc định send() đã tự quote) ───────────────
    // send() tự động quote tin nhắn của người dùng.
    // Nếu muốn gửi không quote, dùng api.sendMessage() trực tiếp:
    //   await api.sendMessage({ msg: "Không quote" }, threadID);

    // ── Ví dụ 5: Đăng ký chờ Reply ─────────────────────────────────────────
    // Bot gửi câu hỏi, rồi chờ người dùng reply để xử lý tiếp.
    const question = await send("Bạn muốn làm gì tiếp theo? Hãy reply tin nhắn này.");

    registerReply({
      messageID: question?.msgId,   // ID tin nhắn bot vừa gửi
      authorID:  senderId,          // Chỉ người này được reply
      callback: async ({ replyEvent, send: replySend }) => {
        const replyText = replyEvent?.data?.content || "";
        await replySend(`Bạn trả lời: ${replyText}`);
      }
    });

    // ── Ví dụ 6: Đăng ký chờ Reaction ──────────────────────────────────────
    // Người dùng react vào tin nhắn bot → kích hoạt callback.
    const reactMsg = await send("React ❤️ vào tin nhắn này để xác nhận.");

    registerReaction({
      messageID: reactMsg?.msgId,
      authorID:  senderId,
      callback: async ({ reactionEvent, send: reactSend }) => {
        await reactSend("Đã xác nhận!");
      }
    });

    // ── Ví dụ 7: Gọi API bên ngoài ─────────────────────────────────────────
    // const axios = require("axios"); // đã có global axios
    // const res = await axios.get("https://api.example.com/data");
    // await send(res.data.result);

    // ── Ví dụ 8: Dùng database kinh tế ─────────────────────────────────────
    // const { getUserData, formatMoney } = require('../../includes/database/economy');
    // const userData = await getUserData(senderId);
    // await send(`Số dư: ${formatMoney(userData.money)}`);
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  GHI NHỚ KHI TẠO LỆNH MỚI
//  1. Sao chép file này → đặt tên file = tên lệnh (vd: chaoban.js)
//  2. Đổi config.name = "chaoban"
//  3. Viết logic trong run()
//  4. Lưu file → bot tự load (hoặc dùng .load để reload không cần restart)
// ══════════════════════════════════════════════════════════════════════════════

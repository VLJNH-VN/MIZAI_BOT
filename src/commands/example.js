// ════════════════════════════════════════════════════════
//  EXAMPLE COMMAND — Lệnh mẫu cho MIZAI_BOT
//  Dùng file này làm template khi tạo lệnh mới.
// ════════════════════════════════════════════════════════

module.exports = {
  // ── Cấu hình lệnh ────────────────────────────────────
  config: {
    name: "example",           // Tên lệnh (người dùng gõ: .example)
    version: "1.0.0",
    hasPermssion: 0,           // 0 = user | 1 = quản trị viên nhóm | 2 = admin bot
    credits: "MiZai",
    description: "Lệnh mẫu minh họa cách tạo command cho MIZAI_BOT",
    commandCategory: "Example",
    usages: ".example [tuỳ chọn]",
    cooldowns: 3               // giây chờ giữa 2 lần dùng
  },

  // ── Chạy khi bot khởi động (tuỳ chọn) ───────────────
  onLoad: async ({ api }) => {
    logInfo("[example] Lệnh example đã được tải.");
  },

  // ── Xử lý chính khi người dùng gọi lệnh ─────────────
  run: async ({ api, event, args, send }) => {
    // args: mảng các từ người dùng nhập sau tên lệnh
    // Ví dụ: ".example xin chào" => args = ["xin", "chào"]

    // ── 1. Không có đối số → gửi hướng dẫn ──────────
    if (!args || args.length === 0) {
      return send(
        "📖 *Lệnh mẫu — MIZAI_BOT*\n\n" +
        "Cú pháp:\n" +
        "  .example hello      — Bot chào lại\n" +
        "  .example echo <...> — Bot lặp lại văn bản\n" +
        "  .example info       — Xem thông tin tin nhắn\n\n" +
        "Đây là lệnh demo, bạn có thể chỉnh sửa tuỳ ý!"
      );
    }

    const subCmd = args[0].toLowerCase();

    // ── 2. Lệnh con: hello ────────────────────────────
    if (subCmd === "hello") {
      const senderName = event?.data?.dName || "bạn";
      return send(`👋 Xin chào, ${senderName}! Mình là Mizai ~ ♡`);
    }

    // ── 3. Lệnh con: echo ─────────────────────────────
    if (subCmd === "echo") {
      const text = args.slice(1).join(" ");
      if (!text) return send("⚠️ Vui lòng nhập nội dung cần lặp lại.\nVí dụ: .example echo xin chào");
      return send(`🔁 ${text}`);
    }

    // ── 4. Lệnh con: info ─────────────────────────────
    if (subCmd === "info") {
      const msgId    = event?.msgId    || "Không rõ";
      const threadId = event?.threadId || "Không rõ";
      const senderId = event?.data?.uidFrom || "Không rõ";
      const isGroup  = event?.isGroup ? "Nhóm" : "Cá nhân";

      return send(
        "ℹ️ *Thông tin tin nhắn*\n\n" +
        `📨 Loại chat : ${isGroup}\n` +
        `👤 Sender ID : ${senderId}\n` +
        `💬 Thread ID : ${threadId}\n` +
        `🆔 Msg ID    : ${msgId}`
      );
    }

    // ── 5. Không khớp lệnh con nào ────────────────────
    return send(`❓ Lệnh con "${args[0]}" không hợp lệ.\nGõ .example để xem hướng dẫn.`);
  }
};

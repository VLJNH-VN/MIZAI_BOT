const { isBotAdmin } = require("../../utils/bot/botManager");

module.exports = {
  config: {
    name: "autoreply",
    aliases: ["ar", "tudongtl"],
    version: "1.0.0",
    hasPermssion: 2,
    credits: "MIZAI",
    description: "Quản lý tin nhắn tự động trả lời (vắng mặt)",
    commandCategory: "Admin",
    usages: [
      "autoreply list                     — Xem danh sách auto reply",
      "autoreply add <từ_khóa> | <trả lời> — Thêm auto reply",
      "autoreply delete <id>              — Xóa auto reply",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ api, event, args, send, senderId, prefix }) => {
    if (!isBotAdmin(senderId)) return send("⛔ Chỉ Admin bot mới dùng được lệnh này.");

    const sub = (args[0] || "").toLowerCase();

    if (!sub) {
      return send(
        `🔁 AUTOREPLY — TỰ ĐỘNG TRẢ LỜI\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${prefix}autoreply list              Xem danh sách\n` +
        `${prefix}autoreply add <kw> | <reply> Thêm mới\n` +
        `${prefix}autoreply delete <id>        Xóa\n\n` +
        `💡 Ví dụ:\n${prefix}autoreply add xin chào | Chào bạn! Mizai đang bận.`
      );
    }

    try {
      switch (sub) {

        case "list": {
          const list = await api.getAutoReplyList();
          const items = list?.autoReplies || list?.data || list || [];
          if (!items.length) return send("📭 Chưa có auto reply nào.");
          const lines = items.map((item, i) => {
            const trigger = item.trigger || item.keyword || item.content || "?";
            const reply = item.reply || item.message || item.response || "?";
            return `${i + 1}. [${item.id || i}] 🎯 "${trigger}" → "${reply.slice(0, 40)}..."`;
          });
          return send(`🔁 DANH SÁCH AUTO REPLY (${items.length}):\n${lines.join("\n")}`);
        }

        case "add": {
          const fullText = args.slice(1).join(" ");
          const parts = fullText.split("|");
          if (parts.length < 2) {
            return send(`⚠️ Ví dụ: ${prefix}autoreply add xin chào | Chào bạn! Đang bận.`);
          }
          const trigger = parts[0].trim();
          const reply = parts.slice(1).join("|").trim();
          if (!trigger || !reply) return send("⚠️ Từ khóa và nội dung trả lời không được để trống.");

          await api.createAutoReply({
            trigger,
            message: reply,
            enabled: true,
          });
          return send(`✅ Đã thêm auto reply:\n🎯 Từ khóa: "${trigger}"\n💬 Trả lời: "${reply}"`);
        }

        case "delete":
        case "del":
        case "rm": {
          const id = args[1];
          if (!id) return send(`⚠️ Ví dụ: ${prefix}autoreply delete 123`);
          await api.deleteAutoReply(id);
          return send(`✅ Đã xóa auto reply ID: ${id}`);
        }

        default:
          return send(`❌ Lệnh không hợp lệ. Dùng: ${prefix}autoreply để xem hướng dẫn.`);
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Lỗi không xác định";
      return send(`❌ Lỗi: ${msg}`);
    }
  },
};

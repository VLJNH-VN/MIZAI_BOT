const { ThreadType } = require("zca-js");

function parseDurationToSeconds(str) {
  const match = str?.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const n = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const map = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * (map[unit] || 0);
}

module.exports = {
  config: {
    name: "chatset",
    aliases: ["cs", "chatmanage"],
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MIZAI",
    description: "Quản lý cài đặt cuộc trò chuyện",
    commandCategory: "Tiện Ích",
    usages: [
      "chatset pin            — Ghim cuộc trò chuyện hiện tại",
      "chatset unpin          — Bỏ ghim cuộc trò chuyện",
      "chatset hide           — Ẩn cuộc trò chuyện",
      "chatset unhide         — Bỏ ẩn cuộc trò chuyện",
      "chatset unread         — Đánh dấu chưa đọc",
      "chatset read           — Bỏ đánh dấu chưa đọc",
      "chatset autodelete <10m|1h|1d|off> — Tự xóa tin nhắn sau thời gian",
      "chatset delete         — Xóa cuộc trò chuyện hiện tại (cẩn thận!)",
    ].join("\n"),
    cooldowns: 3,
  },

  run: async ({ api, event, args, send, threadID, prefix }) => {
    const sub = (args[0] || "").toLowerCase();

    if (!sub) {
      return send(
        `⚙️ CHATSET — CÀI ĐẶT CHAT\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${prefix}chatset pin           Ghim chat\n` +
        `${prefix}chatset unpin         Bỏ ghim\n` +
        `${prefix}chatset hide          Ẩn chat\n` +
        `${prefix}chatset unhide        Bỏ ẩn\n` +
        `${prefix}chatset unread        Đánh dấu chưa đọc\n` +
        `${prefix}chatset read          Bỏ đánh dấu\n` +
        `${prefix}chatset autodelete <thời gian|off>  Tự xóa\n` +
        `${prefix}chatset delete        Xóa hội thoại ⚠️`
      );
    }

    const isGroup = event.type === ThreadType.Group;
    const type = event.type;

    try {
      switch (sub) {

        case "pin": {
          await api.setPinnedConversations([{ threadId: threadID, type }], true);
          return send("📌 Đã ghim cuộc trò chuyện này.");
        }

        case "unpin": {
          await api.setPinnedConversations([{ threadId: threadID, type }], false);
          return send("📌 Đã bỏ ghim cuộc trò chuyện này.");
        }

        case "hide": {
          await api.setHiddenConversations([{ threadId: threadID, type }], true);
          return send("👁️ Đã ẩn cuộc trò chuyện này.");
        }

        case "unhide": {
          await api.setHiddenConversations([{ threadId: threadID, type }], false);
          return send("👁️ Đã bỏ ẩn cuộc trò chuyện này.");
        }

        case "unread": {
          await api.addUnreadMark(threadID, type);
          return send("🔵 Đã đánh dấu hội thoại là chưa đọc.");
        }

        case "read": {
          await api.removeUnreadMark(threadID, type);
          return send("✅ Đã bỏ đánh dấu chưa đọc.");
        }

        case "autodelete": {
          const param = (args[1] || "").toLowerCase();
          if (!param) {
            return send(
              `⚠️ Chọn thời gian hoặc off:\n` +
              `${prefix}chatset autodelete 10m\n` +
              `${prefix}chatset autodelete 1h\n` +
              `${prefix}chatset autodelete 1d\n` +
              `${prefix}chatset autodelete off`
            );
          }

          if (param === "off") {
            await api.updateAutoDeleteChat({ threadId: threadID, type, duration: 0 });
            return send("✅ Đã tắt tự động xóa tin nhắn.");
          }

          const secs = parseDurationToSeconds(param);
          if (!secs) {
            return send("❌ Định dạng không hợp lệ. Dùng: 10m, 1h, 1d, hoặc off");
          }

          await api.updateAutoDeleteChat({ threadId: threadID, type, duration: secs });
          return send(`✅ Đã bật tự động xóa tin nhắn sau ${param}.`);
        }

        case "delete": {
          const confirm = args[1];
          if (confirm !== "xacnhan") {
            return send(
              `⚠️ Lệnh này sẽ XÓA toàn bộ hội thoại hiện tại!\n` +
              `Nếu chắc chắn, gõ: ${prefix}chatset delete xacnhan`
            );
          }
          await api.deleteChat(
            { msgId: "0", cliMsgId: "0" },
            threadID,
            type
          );
          return send("🗑️ Đã xóa cuộc trò chuyện này.");
        }

        default:
          return send(`❌ Lệnh không hợp lệ. Dùng: ${prefix}chatset để xem hướng dẫn.`);
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Lỗi không xác định";
      return send(`❌ Lỗi: ${msg}`);
    }
  },
};

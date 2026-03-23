const { ThreadType } = require("zca-js");

function parseDurationToMs(str) {
  const match = str?.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const n = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const map = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * (map[unit] || 0);
}

module.exports = {
  config: {
    name: "chat",
    aliases: ["chatset", "cs", "undo"],
    version: "1.2.0",
    hasPermssion: 0,
    credits: "MIZAI",
    description: "Quản lý cài đặt cuộc trò chuyện và thu hồi tin nhắn bot",
    commandCategory: "Tiện Ích",
    usages: [
      "chat pin|unpin | hide|unhide | read|unread   — Ghim/ẩn/đánh dấu cuộc trò chuyện",
      "chat autodelete <10m|1h|1d|off>               — Tự xóa tin nhắn sau thời gian",
      "chat delete | undo (reply)                     — Xóa hội thoại / thu hồi tin nhắn bot",
    ].join("\n"),
    cooldowns: 3,
  },

  run: async ({ api, event, args, send, threadID, prefix, commandName }) => {
    let sub = (args[0] || "").toLowerCase();
    if (commandName === "undo" && !sub) sub = "undo";

    if (!sub) {
      return send(
        `⚙️ CHATSET — CÀI ĐẶT CHAT\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${prefix}chat pin           Ghim chat\n` +
        `${prefix}chat unpin         Bỏ ghim\n` +
        `${prefix}chat hide          Ẩn chat\n` +
        `${prefix}chat unhide        Bỏ ẩn\n` +
        `${prefix}chat unread        Đánh dấu chưa đọc\n` +
        `${prefix}chat read          Bỏ đánh dấu\n` +
        `${prefix}chat autodelete <thời gian|off>  Tự xóa\n` +
        `${prefix}chat delete        Xóa hội thoại ⚠️\n` +
        `${prefix}chat undo          Thu hồi tin nhắn bot (reply)`
      );
    }

    const type = event.type;

    try {
      switch (sub) {

        case "pin": {
          await api.setPinnedConversations(true, threadID, type);
          return send("📌 Đã ghim cuộc trò chuyện này.");
        }

        case "unpin": {
          await api.setPinnedConversations(false, threadID, type);
          return send("📌 Đã bỏ ghim cuộc trò chuyện này.");
        }

        case "hide": {
          await api.setHiddenConversations(true, threadID, type);
          return send("👁️ Đã ẩn cuộc trò chuyện này.");
        }

        case "unhide": {
          await api.setHiddenConversations(false, threadID, type);
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
              `${prefix}chat autodelete 10m\n` +
              `${prefix}chat autodelete 1h\n` +
              `${prefix}chat autodelete 1d\n` +
              `${prefix}chat autodelete off`
            );
          }
          if (param === "off") {
            await api.updateAutoDeleteChat(0, threadID, type);
            return send("✅ Đã tắt tự động xóa tin nhắn.");
          }
          const ms = parseDurationToMs(param);
          if (!ms) return send("❌ Định dạng không hợp lệ. Dùng: 10m, 1h, 1d, hoặc off");
          await api.updateAutoDeleteChat(ms, threadID, type);
          return send(`✅ Đã bật tự động xóa tin nhắn sau ${param}.`);
        }

        case "delete": {
          if (args[1] !== "xacnhan") {
            return send(
              `⚠️ Lệnh này sẽ XÓA toàn bộ hội thoại hiện tại!\n` +
              `Nếu chắc chắn, gõ: ${prefix}chat delete xacnhan`
            );
          }
          await api.deleteChat({ msgId: "0", cliMsgId: "0" }, threadID, type);
          return send("🗑️ Đã xóa cuộc trò chuyện này.");
        }

        case "undo": {
          if (global.config?.["🔄 undoEnabled"] === false) {
            return send("⛔ Tính năng thu hồi tin nhắn hiện đang bị tắt.");
          }

          const raw   = event?.data || {};
          const quote = raw?.quote || raw?.replyMsg || null;

          if (!quote || (!quote.globalMsgId && !quote.cliMsgId)) {
            return send("⚠️ Vui lòng reply vào tin nhắn của bot cần gỡ, sau đó gõ .undo");
          }

          const msgId   = quote.globalMsgId || quote.msgId;
          const cliId   = quote.cliMsgId || msgId;
          const uidFrom = global.botId ? String(global.botId) : "";

          try {
            await api.undo({ msgId, cliMsgId: cliId }, threadID, type);
            return send("✅ Đã gỡ tin nhắn thành công!");
          } catch {
            try {
              await api.deleteMessage(
                { data: { cliMsgId: cliId, msgId, uidFrom }, threadId: threadID, type },
                true
              );
              return send("✅ Đã xóa tin nhắn thành công!");
            } catch {
              return send("❌ Không thể gỡ tin nhắn này. Bot chỉ có thể gỡ tin nhắn do chính bot gửi.");
            }
          }
        }

        default:
          return send(`❌ Lệnh không hợp lệ. Dùng: ${prefix}chat để xem hướng dẫn.`);
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Lỗi không xác định";
      return send(`❌ Lỗi: ${msg}`);
    }
  },
};

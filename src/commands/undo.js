const { ThreadType } = require("zca-js");

module.exports = {
  config: {
    name: "undo",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "GwenDev / MiZai",
    description: "Gỡ tin nhắn của bot bằng cách reply vào tin nhắn cần gỡ",
    commandCategory: "Quản Trị",
    usages: "Reply vào tin nhắn của bot → .undo",
    cooldowns: 5,
  },

  run: async ({ api, event, send }) => {
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
    const threadID = event.threadId;
    const type     = event.type;

    try {
      await api.undo({ msgId, cliMsgId: cliId }, threadID, type);
      return send("✅ Đã gỡ tin nhắn thành công!");
    } catch (err) {
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
  },
};

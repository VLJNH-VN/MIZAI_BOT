const { ThreadType } = require("zca-js");
const { parseMentionIds } = require("../../utils/bot/messageUtils");

module.exports = {
  config: {
    name: "zcard",
    aliases: ["card", "danh thiep"],
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MIZAI",
    description: "Gửi danh thiếp người dùng Zalo",
    commandCategory: "Tiện Ích",
    usages: [
      "zcard @tag          — Gửi danh thiếp người được tag",
      "zcard <uid>         — Gửi danh thiếp theo UID",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ api, event, args, send, senderId, threadID, prefix }) => {
    const mentions = parseMentionIds(event);
    const targetId = mentions[0] || args[0] || senderId;

    if (!targetId) {
      return send(`⚠️ Ví dụ:\n${prefix}zcard @tên\n${prefix}zcard 123456789`);
    }

    try {
      await api.sendCard({ userId: targetId }, threadID, event.type);
      return;
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Lỗi không xác định";
      return send(`❌ Không thể gửi danh thiếp: ${msg}`);
    }
  },
};

const { isBotAdmin } = require("../../utils/bot/admin");

module.exports = {
  config: {
    name: "id",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Xem Zalo ID của bạn (dùng để cấu hình admin trong config.json)",
    commandCategory: "System",
    usages: ".id",
    cooldowns: 3
  },

  run: async ({ send, senderId }) => {
    const isAdmin = isBotAdmin(senderId);
    await send(
      `${senderId}\n` 
    );
  }
};

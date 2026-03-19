const { isBotAdmin } = require("../../utils/bot/botManager");

module.exports = {
  config: {
    name: "id",
    version: "1.1.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Xem Zalo ID của bạn hoặc của người được tag",
    commandCategory: "System",
    usages: ".id | .id @mention",
    cooldowns: 3
  },

  run: async ({ event, send, senderId }) => {
    const mentions = event?.data?.mentions;
    if (mentions && Object.keys(mentions).length > 0) {
      const lines = Object.entries(mentions)
        .map(([uid, name]) => `👤 ${name || uid}: ${uid}`)
        .join("\n");
      return send(`🆔 ID của người được tag:\n${lines}`);
    }

    const isAdmin = isBotAdmin(senderId);
    await send(
      `🆔 ID của bạn: ${senderId}` +
      (isAdmin ? `\n⭐ Bạn là Admin Bot` : "")
    );
  }
};

const { isBotAdmin } = require('../../utils/bot/botManager');
const { parseMentionIds } = require('../../utils/bot/messageUtils');

module.exports = {
  config: {
    name: "id",
    version: "1.2.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Xem Zalo ID của bạn hoặc của người được tag",
    commandCategory: "System",
    usages: ".id | .id @mention",
    cooldowns: 3
  },

  run: async ({ event, send, senderId }) => {
    const ids = parseMentionIds(event);
    if (ids.length > 0) {
      const lines = ids.map(uid => `👤 UID: ${uid}`).join("\n");
      return send(`🆔 ID của người được tag:\n${lines}`);
    }

    const isAdmin = isBotAdmin(senderId);
    await send(
      `🆔 ID của bạn: ${senderId}` +
      (isAdmin ? `\n⭐ Bạn là Admin Bot` : "")
    );
  }
};

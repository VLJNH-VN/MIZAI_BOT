module.exports = {
  config: {
    name: "rs",
    version: "1.1.0",
    hasPermssion: 2,
    credits: "Lizi",
    description: "Khởi động lại bot an toàn",
    commandCategory: "Admin",
    usages: ".restart",
    cooldowns: 5
  },

  run: async ({ api, event, send, senderId, threadID, isBotAdmin }) => {
    if (!isBotAdmin(senderId)) return send("❌ Chỉ admin bot mới dùng được lệnh này.");

    await send("🔄 Bot đang khởi động lại sau 3 giây...");

    setTimeout(() => {
      if (typeof global.restartBot === "function") {
        global.restartBot("Admin manual restart", 3000);
      } else {
        process.exit(0);
      }
    }, 500);
  }
};

module.exports = {
  config: {
    name: "ping", // Tên lệnh
    version: "1.0.0", // Phiên bản
    hasPermssion: 0, // 0=user | 1=quản trị viên nhóm | 2=admin bot
    credits: "MiZai", // Chủ lệnh
    description: "Test bot, đo độ trễ phản hồi", // Mô tả của lệnh
    commandCategory: "Hệ Thống", // Danh mục lệnh
    usages: "!ping", // Cách dùng
    cooldowns: 2 // thời gian chờ (giây)
  },

  run: async ({ send }) => {
    const start = Date.now();
    await send("🏓 Pong!");

    const latency = Date.now() - start;
    await send(`⏱ Độ trễ: ${latency}ms`);
  }
};


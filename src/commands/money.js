const { getUserData, formatMoney, getLevel } = require("../../includes/database/economy");
const { resolveSenderName } = require("../../includes/database/infoCache");

module.exports = {
  config: {
    name: "money",
    version: "2.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Kiểm tra số tiền và thông tin tài khoản của bạn",
    commandCategory: "Kinh Tế",
    usages: "money",
    cooldowns: 2
  },

  run: async ({ api, event, send }) => {
    const raw = event?.data || {};
    const userId = raw?.uidFrom ? String(raw.uidFrom) : (raw?.sender?.id ? String(raw.sender.id) : null);

    if (!userId) return send("❌ Không thể xác định người dùng!");

    let userName = userId;
    try { userName = await resolveSenderName({ api, userId }); } catch {}

    const data = await getUserData(userId);
    const money = data?.money ?? 100000;
    const exp = data?.exp ?? 0;
    const dailyLast = data?.daily_last ?? 0;
    const level = getLevel(exp);

    const now = Date.now();
    const dailyReady = (now - dailyLast) >= 24 * 60 * 60 * 1000;
    const dailyStatus = dailyReady ? "✅ Sẵn sàng" : "⏳ Chưa tới giờ";

    return send(
      `💼 Tài Khoản — ${userName}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `💰 Số dư: ${formatMoney(money)}\n` +
      `🏅 Cấp độ: Lv.${level} (${exp} EXP)\n` +
      `🎁 Điểm danh: ${dailyStatus}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `💡 .daily | .transfer | .dice | .rank`
    );
  }
};

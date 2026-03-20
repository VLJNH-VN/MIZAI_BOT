const { claimDaily, formatMoney, formatTime, getLevel } = require('../../../includes/database/economy');
const { resolveSenderName } = require('../../../includes/database/infoCache');

module.exports = {
  config: {
    name: "daily",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Nhận tiền điểm danh hàng ngày (reset sau 24 giờ)",
    commandCategory: "Kinh Tế",
    usages: "daily",
    cooldowns: 5
  },

  run: async ({ api, event, send }) => {
    const raw = event?.data || {};
    const userId = raw?.uidFrom ? String(raw.uidFrom) : (raw?.sender?.id ? String(raw.sender.id) : null);

    if (!userId) return send("❌ Không thể xác định người dùng!");

    let userName = userId;
    try { userName = await resolveSenderName({ api, userId }); } catch {}

    const result = await claimDaily(userId, userName);

    if (!result.success) {
      const remaining = formatTime(result.remaining);
      return send(
        `⏳ Bạn đã điểm danh rồi!\n\n` +
        `👤 ${userName}\n` +
        `🕐 Thời gian chờ: ${remaining}\n\n` +
        `💡 Hãy quay lại sau nhé!`
      );
    }

    const level = getLevel(result.newExp);
    return send(
      `🎁 Điểm Danh Thành Công!\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `👤 ${userName}\n` +
      `💰 Nhận được: +${formatMoney(result.reward)}\n` +
      `💵 Số dư hiện tại: ${formatMoney(result.newMoney)}\n` +
      `⭐ EXP: ${result.newExp} (Lv.${level})\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `📅 Điểm danh lại sau 24 giờ nhé!`
    );
  }
};

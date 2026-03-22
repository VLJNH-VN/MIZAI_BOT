const { getUserData, formatMoney, getLevel } = require('../../includes/database/user/economy');
const { resolveSenderName } = require('../../includes/database/message/infoCache');
const { parseMentionIds } = require('../../utils/bot/messageUtils');

module.exports = {
  config: {
    name: "profile",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Xem thông tin cá nhân hoặc của người được tag",
    commandCategory: "Tra Cứu",
    usages: "profile [@người dùng]",
    cooldowns: 5
  },

  run: async ({ api, event, send }) => {
    const raw = event?.data || {};
    const fromId = raw?.uidFrom ? String(raw.uidFrom) : null;

    const mentionIds = parseMentionIds(event);
    const targetId = mentionIds.length > 0 ? mentionIds[0] : fromId;

    if (!targetId) return send("❌ Không thể xác định người dùng!");

    let name = targetId;
    try { name = await resolveSenderName({ api, userId: targetId }); } catch {}

    const data = await getUserData(targetId);
    const money = data?.money ?? 100000;
    const exp = data?.exp ?? 0;
    const dailyLast = data?.daily_last ?? 0;
    const level = getLevel(exp);

    const lastDailyStr = dailyLast > 0
      ? new Date(dailyLast).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
      : "Chưa điểm danh";

    const nextLevel = level * level * 10;
    const progressBar = (() => {
      const filled = Math.min(10, Math.floor((exp % (level * level * 10)) / (level * level * 10) * 10));
      return "▓".repeat(filled) + "░".repeat(10 - filled);
    })();

    return send(
      `👤 Thông Tin — ${name}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `🏅 Cấp độ: Lv.${level}\n` +
      `⭐ EXP: ${exp} / ${nextLevel}\n` +
      `📊 [${progressBar}]\n` +
      `💰 Số dư: ${formatMoney(money)}\n` +
      `📅 Điểm danh: ${lastDailyStr}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `💡 .daily để nhận tiền | .rank me để xem xếp hạng`
    );
  }
};

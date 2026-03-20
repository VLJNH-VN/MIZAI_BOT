const { getTopUsers, getUserData, formatMoney, getLevel } = require('../../includes/database/economy');
const { resolveSenderName } = require('../../includes/database/infoCache');
const { getGroupSetting } = require('../../utils/bot/botManager');
const { ThreadType } = require("zca-js");

module.exports = {
  config: {
    name: "rank",
    version: "1.1.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Xem bảng xếp hạng giàu nhất và thống kê cá nhân",
    commandCategory: "Kinh Tế",
    usages: "rank [me]",
    cooldowns: 5
  },

  run: async ({ api, event, args, send, threadID }) => {
    if (event.type === ThreadType.Group) {
      const rankOn = getGroupSetting(threadID, "rankEnabled", true);
      if (!rankOn) {
        return send("❌ Lệnh rank đã bị tắt trong nhóm này.\n💡 Admin nhóm dùng: .set rank on để bật lại.");
      }
    }

    const raw = event?.data || {};
    const userId = raw?.uidFrom ? String(raw.uidFrom) : null;
    const sub = args[0] ? args[0].toLowerCase() : "";

    if (sub === "me" || sub === "toi") {
      if (!userId) return send("❌ Không thể xác định người dùng!");

      const data = await getUserData(userId);
      let name = userId;
      try { name = await resolveSenderName({ api, userId }); } catch {}

      const level = getLevel(data?.exp || 0);
      const money = data?.money || 100000;
      const exp = data?.exp || 0;

      return send(
        `📊 Thống Kê Cá Nhân\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `👤 ${name}\n` +
        `💰 Số dư: ${formatMoney(money)}\n` +
        `⭐ EXP: ${exp}\n` +
        `🏅 Cấp độ: Lv.${level}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `💡 Dùng .daily để nhận tiền hàng ngày!`
      );
    }

    const topUsers = await getTopUsers(10);
    if (!topUsers || topUsers.length === 0) {
      return send("📊 Chưa có dữ liệu bảng xếp hạng!");
    }

    const medals = ["🥇", "🥈", "🥉"];
    let msg = `🏆 Bảng Xếp Hạng Giàu Nhất\n━━━━━━━━━━━━━━━━\n`;

    for (let i = 0; i < topUsers.length; i++) {
      const u = topUsers[i];
      const medal = medals[i] || `${i + 1}.`;
      const name = u.name || u.user_id;
      const level = getLevel(u.exp || 0);
      msg += `${medal} ${name}\n    💰 ${formatMoney(u.money)} | Lv.${level}\n`;
    }

    msg += `━━━━━━━━━━━━━━━━\n💡 .rank me để xem thống kê của bạn`;

    return send(msg);
  }
};

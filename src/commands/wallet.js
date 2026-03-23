/**
 * src/commands/wallet.js
 * Gộp: money + daily + rank
 */

const { getUserData, getUserMoney, getTopUsers, formatMoney, formatTime, getLevel, claimDaily } = require("../../includes/database/user/economy");
const { resolveSenderName } = require("../../includes/database/message/infoCache");
const { getGroupSetting } = require("../../utils/bot/botManager");
const { ThreadType } = require("zca-js");

module.exports = {
  config: {
    name:            "wallet",
    aliases:         ["money", "daily", "rank", "w"],
    version:         "1.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Xem tài khoản, nhận điểm danh và bảng xếp hạng kinh tế",
    commandCategory: "Kinh Tế",
    usages: [
      "wallet [daily]     — Xem số dư / nhận điểm danh hàng ngày",
      "wallet rank [me]   — Bảng xếp hạng / thống kê cá nhân",
    ].join("\n"),
    cooldowns: 3,
  },

  run: async ({ api, event, args, send, threadID, commandName }) => {
    const raw    = event?.data || {};
    const userId = raw?.uidFrom ? String(raw.uidFrom) : (raw?.sender?.id ? String(raw.sender.id) : null);
    if (!userId) return send("❌ Không thể xác định người dùng!");

    const FLAG_MAP = { "-d": "daily", "-r": "rank", "-m": "me" };
    const sub = FLAG_MAP[args[0]] || (args[0] || "").toLowerCase();

    // Alias shortcut: khi gọi bằng tên alias cũ
    const effectiveSub = (commandName === "daily") ? "daily"
                       : (commandName === "rank")  ? "rank"
                       : sub || "info";

    // ── Xem số dư ─────────────────────────────────────────────────────────────
    if (effectiveSub === "info" || effectiveSub === "money" || effectiveSub === "w" || effectiveSub === "wallet" || !effectiveSub || effectiveSub === "xemso") {
      let userName = userId;
      try { userName = await resolveSenderName({ api, userId }); } catch {}

      const data = await getUserData(userId);
      const money   = data?.money ?? 100000;
      const exp     = data?.exp ?? 0;
      const dailyLast = data?.daily_last ?? 0;
      const level   = getLevel(exp);
      const dailyReady = (Date.now() - dailyLast) >= 24 * 60 * 60 * 1000;

      return send(
        `💼 Tài Khoản — ${userName}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `💰 Số dư: ${formatMoney(money)}\n` +
        `🏅 Cấp độ: Lv.${level} (${exp} EXP)\n` +
        `🎁 Điểm danh: ${dailyReady ? "✅ Sẵn sàng" : "⏳ Chưa tới giờ"}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `💡 .wallet daily | .wallet rank | .transfer | .dice`
      );
    }

    // ── Điểm danh ─────────────────────────────────────────────────────────────
    if (effectiveSub === "daily" || effectiveSub === "diemdanh" || effectiveSub === "dd") {
      let userName = userId;
      try { userName = await resolveSenderName({ api, userId }); } catch {}

      const result = await claimDaily(userId, userName);
      if (!result.success) {
        return send(
          `⏳ Bạn đã điểm danh rồi!\n\n` +
          `👤 ${userName}\n` +
          `🕐 Thời gian chờ: ${formatTime(result.remaining)}\n\n` +
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

    // ── Rank ──────────────────────────────────────────────────────────────────
    if (effectiveSub === "rank" || effectiveSub === "xephang") {
      if (event.type === ThreadType.Group) {
        const rankOn = getGroupSetting(threadID, "rankEnabled", true);
        if (!rankOn) return send("❌ Lệnh rank đã bị tắt trong nhóm này.\n💡 Admin dùng: .set rank on để bật lại.");
      }

      const sub2 = (args[1] || "").toLowerCase();
      if (sub2 === "me" || sub2 === "toi") {
        const data = await getUserData(userId);
        let name = userId;
        try { name = await resolveSenderName({ api, userId }); } catch {}

        return send(
          `📊 Thống Kê Cá Nhân\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `👤 ${name}\n` +
          `💰 Số dư: ${formatMoney(data?.money || 100000)}\n` +
          `⭐ EXP: ${data?.exp || 0}\n` +
          `🏅 Cấp độ: Lv.${getLevel(data?.exp || 0)}\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `💡 Dùng .wallet daily để nhận tiền hàng ngày!`
        );
      }

      const topUsers = await getTopUsers(10);
      if (!topUsers || topUsers.length === 0) return send("📊 Chưa có dữ liệu bảng xếp hạng!");

      const medals = ["🥇", "🥈", "🥉"];
      let msg = `🏆 Bảng Xếp Hạng Giàu Nhất\n━━━━━━━━━━━━━━━━\n`;
      for (let i = 0; i < topUsers.length; i++) {
        const u = topUsers[i];
        msg += `${medals[i] || `${i + 1}.`} ${u.name || u.user_id}\n    💰 ${formatMoney(u.money)} | Lv.${getLevel(u.exp || 0)}\n`;
      }
      msg += `━━━━━━━━━━━━━━━━\n💡 .wallet rank me để xem thống kê của bạn`;
      return send(msg);
    }

    return send(`❓ Lệnh không hợp lệ. Dùng: .wallet để xem hướng dẫn.`);
  },
};

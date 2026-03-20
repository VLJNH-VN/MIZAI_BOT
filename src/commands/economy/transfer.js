const { transferMoney, getUserMoney, formatMoney } = require("../../includes/database/economy");
const { resolveSenderName } = require("../../includes/database/infoCache");
const { parseMentionIds } = require("../../utils/bot/messageUtils");

module.exports = {
  config: {
    name: "transfer",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Chuyển tiền cho người khác trong nhóm",
    commandCategory: "Kinh Tế",
    usages: "transfer @người_nhận <số_tiền>",
    cooldowns: 10
  },

  run: async ({ api, event, args, send }) => {
    const raw = event?.data || {};
    const userId = raw?.uidFrom ? String(raw.uidFrom) : null;
    if (!userId) return send("❌ Không thể xác định người dùng!");

    const mentionIds = parseMentionIds(event);
    if (mentionIds.length === 0) {
      return send(
        `💸 Hướng Dẫn Chuyển Tiền\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Cách dùng: .transfer @người_nhận <số_tiền>\n\n` +
        `📌 Ví dụ: .transfer @Bạn 50000\n` +
        `💰 Số dư của bạn: ${formatMoney(await getUserMoney(userId))}`
      );
    }

    const targetId = mentionIds[0];
    if (targetId === userId) return send("❌ Không thể tự chuyển tiền cho chính mình!");

    const amountStr = args.find((a) => /^\d+$/.test(a));
    const amount = amountStr ? parseInt(amountStr) : 0;

    if (!amount || amount < 1000) {
      return send("❌ Số tiền tối thiểu để chuyển là 1,000 VNĐ!");
    }

    if (amount > 10000000) {
      return send("❌ Không thể chuyển quá 10,000,000 VNĐ một lần!");
    }

    let senderName = userId;
    let targetName = targetId;
    try { senderName = await resolveSenderName({ api, userId }); } catch {}
    try { targetName = await resolveSenderName({ api, userId: targetId }); } catch {}

    const result = await transferMoney(userId, targetId, amount, senderName, targetName);

    if (!result.success) {
      const myMoney = await getUserMoney(userId);
      return send(
        `❌ Chuyển tiền thất bại!\n` +
        `📌 Lý do: ${result.reason}\n` +
        `💰 Số dư của bạn: ${formatMoney(myMoney)}`
      );
    }

    return send(
      `💸 Chuyển Tiền Thành Công!\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `👤 Người gửi: ${senderName}\n` +
      `🎯 Người nhận: ${targetName}\n` +
      `💵 Số tiền: ${formatMoney(amount)}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `💰 Số dư còn lại: ${formatMoney(result.fromNew)}`
    );
  }
};

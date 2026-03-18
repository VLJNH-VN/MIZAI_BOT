const { getUserMoney, updateUserMoney, formatMoney, addExp } = require("../../includes/database/economy");
const { resolveSenderName } = require("../../includes/database/infoCache");

module.exports = {
  config: {
    name: "dice",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Chơi xúc xắc — đặt cược và thử vận may! (win x2, lose -bet)",
    commandCategory: "Kinh Tế",
    usages: "dice <số_tiền>",
    cooldowns: 5
  },

  run: async ({ api, event, args, send }) => {
    const raw = event?.data || {};
    const userId = raw?.uidFrom ? String(raw.uidFrom) : null;
    if (!userId) return send("❌ Không thể xác định người dùng!");

    const myMoney = await getUserMoney(userId);

    if (!args[0]) {
      return send(
        `🎲 Hướng Dẫn Chơi Xúc Xắc\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Cách dùng: .dice <số_tiền>\n\n` +
        `📌 Luật chơi:\n` +
        `• Xúc xắc bot: 1–6\n` +
        `• Xúc xắc bạn: 1–6\n` +
        `• Thắng (bạn > bot): nhận x2 cược\n` +
        `• Hòa: hoàn lại tiền\n` +
        `• Thua: mất tiền cược\n\n` +
        `💰 Số dư: ${formatMoney(myMoney)}`
      );
    }

    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount < 1000) {
      return send("❌ Số tiền cược tối thiểu là 1,000 VNĐ!");
    }
    if (amount > myMoney) {
      return send(`❌ Không đủ tiền! Số dư của bạn: ${formatMoney(myMoney)}`);
    }
    if (amount > 5000000) {
      return send("❌ Cược tối đa 5,000,000 VNĐ mỗi lần!");
    }

    let userName = userId;
    try { userName = await resolveSenderName({ api, userId }); } catch {}

    const playerRoll = Math.floor(Math.random() * 6) + 1;
    const botRoll = Math.floor(Math.random() * 6) + 1;

    const diceEmoji = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

    let resultLine, newMoney;
    if (playerRoll > botRoll) {
      await updateUserMoney(userId, amount, "add");
      newMoney = myMoney + amount;
      resultLine = `🎉 Bạn thắng! +${formatMoney(amount)}`;
      await addExp(userId, 5);
    } else if (playerRoll === botRoll) {
      newMoney = myMoney;
      resultLine = `🤝 Hòa! Không mất không được`;
    } else {
      await updateUserMoney(userId, amount, "sub");
      newMoney = myMoney - amount;
      resultLine = `😢 Bạn thua! -${formatMoney(amount)}`;
    }

    return send(
      `🎲 Kết Quả Xúc Xắc\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `👤 ${userName}: ${diceEmoji[playerRoll]} (${playerRoll})\n` +
      `🤖 Bot:      ${diceEmoji[botRoll]} (${botRoll})\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `${resultLine}\n` +
      `💰 Số dư: ${formatMoney(newMoney)}`
    );
  }
};

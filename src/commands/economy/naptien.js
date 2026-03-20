/**
 * src/commands/naptien.js
 * Người dùng gửi yêu cầu nạp tiền → admin duyệt/hủy qua .duyet / .huy
 */

const { getUserMoney, formatMoney } = require('../../../includes/database/economy');
const { addRequest, setNotifyMsgId } = require('../../../includes/database/requestQueue');
const { resolveSenderName } = require('../../../includes/database/infoCache');

module.exports = {
  config: {
    name: "naptien",
    version: "2.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Gửi yêu cầu nạp tiền (chờ Admin duyệt)",
    commandCategory: "Kinh Tế",
    usages: ".naptien <số tiền>",
    cooldowns: 30,
    extra: {
      minAmount: 10000,
      maxAmount: 1000000
    }
  },

  run: async ({ api, event, args, send, senderId, threadID, registerReply }) => {
    const raw = event?.data || {};
    const userId = raw?.uidFrom ? String(raw.uidFrom) : senderId;

    if (!userId) return send("❌ Không thể xác định người dùng!");

    const currentMoney = await getUserMoney(userId);

    if (!args[0]) {
      return send(
        `💳 Hướng dẫn Nạp Tiền:\n\n` +
        `Cách dùng: .naptien <số tiền>\n\n` +
        `📌 Lưu ý:\n` +
        `• Nạp tối thiểu: 10,000 VNĐ\n` +
        `• Nạp tối đa: 1,000,000 VNĐ/lần\n` +
        `• Yêu cầu sẽ chờ Admin duyệt\n\n` +
        `💰 Số dư hiện tại: ${formatMoney(currentMoney)}`
      );
    }

    const amount = parseInt(String(args[0]).replace(/[.,]/g, ""));

    if (isNaN(amount) || amount <= 0) return send("❌ Số tiền không hợp lệ!");
    if (amount < 10000) return send("❌ Số tiền tối thiểu là 10,000 VNĐ!");
    if (amount > 1000000) return send("❌ Số tiền tối đa là 1,000,000 VNĐ/lần!");

    let userName = userId;
    try { userName = await resolveSenderName({ api, userId }); } catch {}

    // Thêm vào hàng đợi chờ duyệt
    const item = addRequest({
      type: "naptien",
      userId,
      userName,
      threadId: threadID,
      content: `Nạp ${formatMoney(amount)}`,
      extra: { amount }
    });

    // Gửi thông báo, lưu msgId để admin có thể reply vào để duyệt/hủy
    const sent = await send(
      `📨 Yêu cầu nạp tiền đã gửi!\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `🔢 Số thứ tự: #${item.stt}\n` +
      `👤 Người dùng: ${userName}\n` +
      `💵 Số tiền: ${formatMoney(amount)}\n` +
      `⏳ Trạng thái: Chờ Admin duyệt\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `Admin dùng .duyet ${item.stt} hoặc reply .duyet\n` +
      `để duyệt | .huy ${item.stt} để hủy`
    );

    // Đăng ký reply: admin reply vào tin này → kích hoạt onReply của lệnh duyet
    const msgId = sent?.message?.msgId || sent?.msgId || sent?.data?.msgId || null;
    if (msgId) {
      setNotifyMsgId(item.stt, msgId);
      registerReply({
        messageId: String(msgId),
        commandName: "duyet",
        payload: { stt: item.stt },
        ttl: 24 * 60 * 60 * 1000 // 24 giờ
      });
    }
  }
};

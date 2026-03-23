/**
 * src/commands/pay.js
 * Gộp: naptien + transfer
 */

const { transferMoney, getUserMoney, formatMoney } = require("../../includes/database/user/economy");
const { addRequest, setNotifyMsgId } = require("../../includes/database/core/requestQueue");
const { resolveSenderName } = require("../../includes/database/message/infoCache");
const { parseMentionIds } = require("../../utils/bot/messageUtils");

module.exports = {
  config: {
    name:            "pay",
    aliases:         ["naptien", "transfer", "chuyentien"],
    version:         "1.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Nạp tiền (chờ Admin duyệt) hoặc chuyển tiền cho người khác",
    commandCategory: "Kinh Tế",
    usages: [
      "pay nap <số tiền>         — Gửi yêu cầu nạp tiền",
      "pay chuyen @người <tiền>  — Chuyển tiền cho người khác",
    ].join("\n"),
    cooldowns: 10,
  },

  run: async ({ api, event, args, send, senderId, threadID, registerReply, commandName, prefix }) => {
    const raw    = event?.data || {};
    const userId = raw?.uidFrom ? String(raw.uidFrom) : senderId;
    if (!userId) return send("❌ Không thể xác định người dùng!");

    const FLAG_MAP = { "-n": "nap", "-c": "chuyen" };
    let sub = FLAG_MAP[args[0]] || (args[0] || "").toLowerCase();
    let subArgs = args.slice(1);

    // Alias shortcut
    if (commandName === "naptien")   { sub = "nap";    subArgs = args; }
    if (commandName === "transfer")  { sub = "chuyen"; subArgs = args; }
    if (commandName === "chuyentien"){ sub = "chuyen"; subArgs = args; }

    if (!sub) {
      const currentMoney = await getUserMoney(userId);
      return send(
        `💳 PAY — THANH TOÁN\n━━━━━━━━━━━━━━━━\n` +
        `${prefix}pay nap <số tiền>         Nạp tiền (Admin duyệt)\n` +
        `${prefix}pay chuyen @người <tiền>  Chuyển tiền\n\n` +
        `💰 Số dư hiện tại: ${formatMoney(currentMoney)}`
      );
    }

    // ── Nạp tiền ──────────────────────────────────────────────────────────────
    if (sub === "nap" || sub === "naptien") {
      const currentMoney = await getUserMoney(userId);
      const rawAmount = subArgs[0];

      if (!rawAmount) {
        return send(
          `💳 Hướng dẫn Nạp Tiền:\n\n` +
          `Cách dùng: ${prefix}pay nap <số tiền>\n\n` +
          `📌 Lưu ý:\n` +
          `• Nạp tối thiểu: 10,000 VNĐ\n` +
          `• Nạp tối đa: 1,000,000 VNĐ/lần\n` +
          `• Yêu cầu sẽ chờ Admin duyệt\n\n` +
          `💰 Số dư hiện tại: ${formatMoney(currentMoney)}`
        );
      }

      const amount = parseInt(String(rawAmount).replace(/[.,]/g, ""));
      if (isNaN(amount) || amount <= 0) return send("❌ Số tiền không hợp lệ!");
      if (amount < 10000)    return send("❌ Số tiền tối thiểu là 10,000 VNĐ!");
      if (amount > 1000000) return send("❌ Số tiền tối đa là 1,000,000 VNĐ/lần!");

      let userName = userId;
      try { userName = await resolveSenderName({ api, userId }); } catch {}

      const item = addRequest({
        type: "naptien", userId, userName, threadId: threadID,
        content: `Nạp ${formatMoney(amount)}`,
        extra: { amount }
      });

      const sent = await send(
        `📨 Yêu cầu nạp tiền đã gửi!\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `🔢 Số thứ tự: #${item.stt}\n` +
        `👤 Người dùng: ${userName}\n` +
        `💵 Số tiền: ${formatMoney(amount)}\n` +
        `⏳ Trạng thái: Chờ Admin duyệt\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Admin dùng .duyet ${item.stt} để duyệt | .huy ${item.stt} để hủy`
      );

      const msgId = sent?.message?.msgId || sent?.msgId || sent?.data?.msgId || null;
      if (msgId) {
        setNotifyMsgId(item.stt, msgId);
        registerReply({
          messageId: String(msgId),
          commandName: "duyet",
          payload: { stt: item.stt },
          ttl: 24 * 60 * 60 * 1000
        });
      }
      return;
    }

    // ── Chuyển tiền ───────────────────────────────────────────────────────────
    if (sub === "chuyen" || sub === "transfer" || sub === "chuyentien") {
      const mentionIds = parseMentionIds(event);
      if (mentionIds.length === 0) {
        return send(
          `💸 Hướng Dẫn Chuyển Tiền\n━━━━━━━━━━━━━━━━\n` +
          `Cách dùng: ${prefix}pay chuyen @người_nhận <số_tiền>\n\n` +
          `📌 Ví dụ: ${prefix}pay chuyen @Bạn 50000\n` +
          `💰 Số dư của bạn: ${formatMoney(await getUserMoney(userId))}`
        );
      }

      const targetId = mentionIds[0];
      if (targetId === userId) return send("❌ Không thể tự chuyển tiền cho chính mình!");

      const amountStr = subArgs.find((a) => /^\d+$/.test(a));
      const amount = amountStr ? parseInt(amountStr) : 0;
      if (!amount || amount < 1000)       return send("❌ Số tiền tối thiểu để chuyển là 1,000 VNĐ!");
      if (amount > 10000000) return send("❌ Không thể chuyển quá 10,000,000 VNĐ một lần!");

      let senderName = userId, targetName = targetId;
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

    return send(`❓ Lệnh không hợp lệ. Dùng: ${prefix}pay để xem hướng dẫn.`);
  },
};

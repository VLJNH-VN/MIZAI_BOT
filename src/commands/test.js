"use strict";

/**
 * src/commands/test.js
 * Test bot ping + test toàn bộ flow handleReaction (sendReaction / REACT / onReaction)
 */

module.exports = {
  config: {
    name:            "test",
    aliases:         ["ping", "check"],
    version:         "1.1.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Kiểm tra bot + test handleReaction (sendReaction, REACT, onReaction)",
    commandCategory: "Tiện Ích",
    usages:          "test",
    cooldowns:       3,
  },

  // ── run: gửi card thông tin + đăng ký chờ reaction ─────────────────────────
  run: async ({
    api, event, send,
    senderId, threadID, isGroup,
    registerReaction,
    reactLoading, reactSuccess,
    sendReaction, REACT,
  }) => {
    const t0 = Date.now();
    await reactLoading();

    const ping       = Date.now() - t0;
    const senderName = event?.data?.dName || senderId;
    const where      = isGroup ? `nhóm` : `nhắn riêng`;

    // Gửi card kết quả + hướng dẫn thả reaction
    const sent = await send(
      `✅ Bot đang hoạt động!\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 ${senderName} | 📍 ${where}\n` +
      `⚡ Ping: ${ping}ms  |  🕒 ${fmtUptime(process.uptime())}\n` +
      `📦 Node ${process.version}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 Thả bất kỳ reaction vào tin này để test handleReaction`
    );

    // Lấy msgId của tin vừa gửi
    const messageId =
      sent?.message?.msgId ??
      sent?.msgId ??
      sent?.data?.msgId ??
      null;

    if (messageId) {
      registerReaction({
        messageId,
        commandName: "test",
        ttl:         5 * 60 * 1000,       // 5 phút
        payload:     { senderName, senderId },
      });
    }

    // React vào tin của người dùng bằng sendReaction
    await reactSuccess();
    await sendReaction(api, event, REACT.AKOI);
  },

  // ── onReaction: xử lý khi ai đó thả cảm xúc vào tin bot vừa gửi ───────────
  onReaction: async ({
    api, reaction, data, send,
    uid, icon, threadID, type,
    sendReaction, REACT,
  }) => {
    const { senderName, senderId } = data || {};

    // Lấy raw event để react ngược lại
    const raw      = reaction?.data ?? {};
    const msgId    = raw?.msgId    ?? raw?.cliMsgId    ?? null;
    const cliMsgId = raw?.cliMsgId ?? raw?.clientMsgId ?? null;

    // Ghép event-like object để sendReaction hoạt động
    const fakeEvent = {
      type    : type,
      threadId: threadID,
      data    : { msgId, cliMsgId },
    };

    // Chọn reaction text trả lời tuỳ icon nhận được
    const replyText = pickReplyText(icon);

    // React ngược lại tin của người dùng
    await sendReaction(api, fakeEvent, replyText);

    // Gửi kết quả test vào thread
    await send(
      `🧪 handleReaction OK!\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 UID react : ${uid}\n` +
      `🎭 Icon nhận : ${icon || "(trống)"}\n` +
      `💬 React trả : ${replyText}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ sendReaction (rType 75) hoạt động bình thường`
    );
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUptime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}h ${m}m ${s}s`;
}

function pickReplyText(icon) {
  if (!icon) return "ok";
  // Map một số icon Zalo phổ biến → text reaction phù hợp
  const map = {
    ":-*":  "❤️",
    ":-h":  "😡",
    "/-strong": "👍",
    "/-weak":   "👎",
    ":-)":  "hihi",
    ":-D":  "hihi",
    ":-o":  "wow",
    ":-(":  "😢",
    ":-|":  "🤔",
  };
  return map[icon] ?? "akoi";
}

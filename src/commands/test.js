"use strict";

module.exports = {
  config: {
    name:            "test",
    aliases:         ["ping", "check"],
    version:         "1.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Kiểm tra bot còn sống không + test reaction",
    commandCategory: "Tiện Ích",
    usages:          "test",
    cooldowns:       3,
  },

  run: async ({
    api, event, send,
    senderId, threadID, isGroup,
    reactLoading, reactSuccess,
    sendReaction, REACT,
  }) => {
    const start = Date.now();

    await reactLoading();

    const ping   = Date.now() - start;
    const senderName = event?.data?.dName || senderId;
    const where  = isGroup ? `nhóm ${threadID}` : "nhắn riêng";

    const msg =
      `✅ Bot đang hoạt động!\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `👤 Người gọi : ${senderName}\n` +
      `📍 Nơi       : ${where}\n` +
      `⚡ Ping      : ${ping}ms\n` +
      `🕒 Uptime    : ${fmtUptime(process.uptime())}\n` +
      `📦 Node      : ${process.version}`;

    await send(msg);
    await reactSuccess();
    await sendReaction(api, event, REACT.AKOI);
  },
};

function fmtUptime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}h ${m}m ${s}s`;
}

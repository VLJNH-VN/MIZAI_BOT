const { ThreadType } = require("zca-js");
const { parseMentionIds } = require('../../utils/bot/messageUtils');
const { isMuted, muteUser, unmuteUser, getMutedList } = require('../../includes/database/moderation/muteManager');

function parseDuration(str) {
  const match = str.match(/^(\d+)(s|m|h|d|giây|phút|giờ|ngày)$/i);
  if (!match) return null;
  const n    = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const map  = { s: 1000, giây: 1000, m: 60000, phút: 60000, h: 3600000, giờ: 3600000, d: 86400000, ngày: 86400000 };
  return n * (map[unit] || 0);
}

module.exports = {
  config: {
    name: "mute",
    version: "2.0.0",
    hasPermssion: 1,
    credits: "GwenDev / MiZai",
    description: "Cấm hoặc gỡ cấm người dùng nhắn tin trong nhóm",
    commandCategory: "Quản Trị",
    usages: [
      "mute @mention [10m|2h|1d]   — Mute thành viên (có/không thời hạn)",
      "mute off @mention | list     — Gỡ mute / danh sách đang mute",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ event, args, send, threadID, prefix }) => {
    if (event.type !== ThreadType.Group) {
      return send("⛔ Lệnh này chỉ dùng được trong nhóm.");
    }

    const mentionIds = parseMentionIds(event);
    const FLAG_MAP   = { "-l": "list", "-f": "off" };
    const sub        = FLAG_MAP[args[0]] || (args[0] || "").toLowerCase();

    if (sub === "list") {
      const now  = Date.now();
      const list = getMutedList(threadID);

      if (!list.length) return send("✅ Không có ai đang bị mute trong nhóm này.");

      const lines = list.map(({ userId, name, expireAt }) => {
        const left = expireAt
          ? `còn ${Math.ceil((expireAt - now) / 60000)} phút`
          : "vĩnh viễn";
        return `• ${name} (${userId}) — ${left}`;
      });

      return send(`🔇 DANH SÁCH MUTE\n━━━━━━━━━━━━━━━━\n${lines.join("\n")}`);
    }

    if (sub === "off") {
      if (!mentionIds.length) return send(`⚠️ Tag người cần gỡ mute. Ví dụ: ${prefix}mute off @tên`);
      let count = 0;
      for (const uid of mentionIds) {
        if (isMuted(threadID, uid)) {
          unmuteUser(threadID, uid);
          count++;
        }
      }
      return send(`✅ Đã gỡ mute ${count} người.`);
    }

    if (!mentionIds.length) {
      return send(
        `⚠️ Cú pháp: ${prefix}mute @tên [thời hạn]\n` +
        "Ví dụ: .mute @user 10m | .mute @user 2h | .mute @user (vĩnh viễn)"
      );
    }

    const durationArg = args.find(a => /^\d+(s|m|h|d|giây|phút|giờ|ngày)$/i.test(a));
    const duration    = durationArg ? parseDuration(durationArg) : null;
    const expireAt    = duration ? Date.now() + duration : null;

    for (const uid of mentionIds) {
      muteUser(threadID, uid, uid, expireAt);
    }

    const timeMsg = durationArg ? `(trong ${durationArg})` : "(vĩnh viễn)";
    return send(`🔇 Đã mute ${mentionIds.length} người ${timeMsg}.\n💡 Gỡ: ${prefix}mute off @tên`);
  },

  onMessage: async ({ event, send }) => {
    if (event.type !== ThreadType.Group) return;
    const raw      = event?.data || {};
    const senderId = raw?.uidFrom ? String(raw.uidFrom) : null;
    const botId    = global.botId ? String(global.botId) : null;
    if (!senderId || senderId === botId) return;

    if (isMuted(event.threadId, senderId)) {
      const name = raw?.senderName || "Bạn";
      try {
        const msgId = raw?.msgId;
        const cliId = raw?.cliMsgId || msgId;
        if (msgId && cliId) {
          await global.api?.deleteMessage(
            { data: { cliMsgId: cliId, msgId, uidFrom: senderId }, threadId: event.threadId, type: event.type },
            false
          );
        }
      } catch {}
      try {
        await send(`🔇 @${name} đang bị mute và không thể nhắn tin.`);
      } catch {}
    }
  },

  isMuted,
};

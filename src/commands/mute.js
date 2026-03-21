const fs   = require("fs");
const path = require("path");
const { ThreadType } = require("zca-js");
const { parseMentionIds } = require('../../utils/bot/messageUtils');

const MUTE_FILE = path.join(__dirname, "../../includes/data/muted.json");

function readMuted() {
  try {
    if (!fs.existsSync(MUTE_FILE)) { fs.writeFileSync(MUTE_FILE, "{}"); return {}; }
    return JSON.parse(fs.readFileSync(MUTE_FILE, "utf-8"));
  } catch { return {}; }
}

function saveMuted(data) {
  fs.writeFileSync(MUTE_FILE, JSON.stringify(data, null, 2));
}

function parseDuration(str) {
  const match = str.match(/^(\d+)(s|m|h|d|giây|phút|giờ|ngày)$/i);
  if (!match) return null;
  const n = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const map = { s: 1000, giây: 1000, m: 60000, phút: 60000, h: 3600000, giờ: 3600000, d: 86400000, ngày: 86400000 };
  return n * (map[unit] || 0);
}

function isMuted(groupId, userId) {
  const data = readMuted();
  const key  = `${groupId}:${userId}`;
  if (!data[key]) return false;
  if (data[key].expireAt && Date.now() > data[key].expireAt) {
    delete data[key];
    saveMuted(data);
    return false;
  }
  return true;
}

module.exports = {
  config: {
    name: "mute",
    version: "1.1.0",
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
    const FLAG_MAP = { "-l": "list", "-f": "off" };
    const sub        = FLAG_MAP[args[0]] || (args[0] || "").toLowerCase();

    if (sub === "list") {
      const data = readMuted();
      const now  = Date.now();
      const list = Object.entries(data)
        .filter(([k]) => k.startsWith(`${threadID}:`))
        .filter(([, v]) => !v.expireAt || v.expireAt > now)
        .map(([k, v]) => {
          const uid  = k.split(":")[1];
          const name = v.name || uid;
          const left = v.expireAt
            ? `còn ${Math.ceil((v.expireAt - now) / 60000)} phút`
            : "vĩnh viễn";
          return `• ${name} (${uid}) — ${left}`;
        });

      if (!list.length) return send("✅ Không có ai đang bị mute trong nhóm này.");
      return send(`🔇 DANH SÁCH MUTE\n━━━━━━━━━━━━━━━━\n${list.join("\n")}`);
    }

    if (sub === "off") {
      if (!mentionIds.length) return send(`⚠️ Tag người cần gỡ mute. Ví dụ: ${prefix}mute off @tên`);
      const data = readMuted();
      let count  = 0;
      for (const uid of mentionIds) {
        const key = `${threadID}:${uid}`;
        if (data[key]) { delete data[key]; count++; }
      }
      saveMuted(data);
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

    const data = readMuted();
    for (const uid of mentionIds) {
      const key  = `${threadID}:${uid}`;
      data[key]  = { name: uid, mutedAt: Date.now(), expireAt };
    }
    saveMuted(data);

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
        const msgId  = raw?.msgId;
        const cliId  = raw?.cliMsgId || msgId;
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

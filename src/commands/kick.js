const { ThreadType } = require("zca-js");

module.exports = {
  config: {
    name: "kick",
    version: "1.0.0",
    hasPermssion: 1,
    credits: "GwenDev / MiZai",
    description: "Kick thành viên ra khỏi nhóm",
    commandCategory: "Quản Trị",
    usages: "kick @mention [lý do]",
    cooldowns: 5,
  },

  run: async ({ api, event, args, send, threadID, senderId, prefix }) => {
    if (event.type !== ThreadType.Group) {
      return send("⛔ Lệnh này chỉ dùng được trong nhóm.");
    }

    const mentions  = event?.data?.mentions || {};
    const mentionIds = Object.keys(mentions);

    if (mentionIds.length === 0) {
      return send(`⚠️ Vui lòng tag người cần kick.\nVí dụ: ${prefix}kick @tên_người`);
    }

    const botId = global.botId ? String(global.botId) : null;
    const reason = args.filter(a => !a.startsWith("@")).slice(1).join(" ") || "Không có lý do";

    let kicked = 0;
    const failed = [];

    for (const uid of mentionIds) {
      if (uid === botId) {
        failed.push("Bot (không thể tự kick)");
        continue;
      }
      if (uid === String(senderId)) {
        failed.push("Chính bạn (không thể tự kick)");
        continue;
      }
      try {
        await api.removeGroupMember(threadID, uid);
        kicked++;
      } catch (err) {
        const name = mentions[uid]?.dName || uid;
        failed.push(name);
      }
    }

    let msg = "";
    if (kicked > 0) msg += `✅ Đã kick ${kicked} thành viên.\n📋 Lý do: ${reason}`;
    if (failed.length > 0) msg += `\n❌ Không thể kick: ${failed.join(", ")}`;
    return send(msg.trim());
  },
};

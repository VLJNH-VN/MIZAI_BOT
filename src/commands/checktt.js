const { ThreadType } = require("zca-js");
const { getTopForGroup, recordMessage } = require("../events/tuongTac");

module.exports = {
  config: {
    name: "checktt",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "GwenDev / MiZai",
    description: "Xem bảng tương tác nhóm theo ngày/tuần/tháng hoặc cá nhân",
    commandCategory: "Nhóm",
    usages: [
      "checktt          — Xem top tương tác ngày",
      "checktt week     — Xem top tương tác tuần",
      "checktt month    — Xem top tương tác tháng",
      "checktt @mention — Xem tương tác của người đó",
    ].join("\n"),
    cooldowns: 10,
  },

  run: async ({ event, args, send, threadID }) => {
    if (event.type !== ThreadType.Group) {
      return send("⛔ Lệnh này chỉ dùng được trong nhóm.");
    }

    const sub      = (args[0] || "").toLowerCase();
    const mentions = event?.data?.mentions || {};
    const mentionIds = Object.keys(mentions);

    let period = "day";
    let title  = "NGÀY";
    if (sub === "week" || sub === "tuần") { period = "week"; title = "TUẦN"; }
    if (sub === "month"|| sub === "tháng"){ period = "month"; title = "THÁNG"; }

    if (mentionIds.length > 0) {
      const uid = mentionIds[0];
      const top = getTopForGroup(threadID, "day").find(u => u.uid === uid);
      const topW = getTopForGroup(threadID, "week").find(u => u.uid === uid);
      const topM = getTopForGroup(threadID, "month").find(u => u.uid === uid);
      const name = mentions[uid]?.dName || uid;
      return send(
        `╭─────「 TƯƠNG TÁC – ${name} 」─────⭓\n` +
        `│ 📅 Hôm nay  : ${top?.count   || 0} tin nhắn\n` +
        `│ 📆 Tuần này : ${topW?.count  || 0} tin nhắn\n` +
        `│ 🗓️ Tháng này: ${topM?.count  || 0} tin nhắn\n` +
        "╰────────────────────────────────⭓"
      );
    }

    const top = getTopForGroup(threadID, period);
    if (!top.length) return send(`📭 Chưa có dữ liệu tương tác cho ${title} này.`);

    const lines = [`╭─────「 TOP TƯƠNG TÁC ${title} 」─────⭓`];
    top.forEach((u, i) => lines.push(`│ ${i + 1}. ${u.name} – ${u.count} tin nhắn`));
    lines.push("╰────────────────────────────────────⭓");
    return send(lines.join("\n"));
  },
};

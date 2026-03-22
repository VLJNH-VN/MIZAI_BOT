const { ThreadType } = require("zca-js");
const { isBotAdmin, isGroupAdmin, setGroupSetting, getGroupSetting } = require('../../utils/bot/botManager');
const { readConfig, writeConfig } = require('../../utils/media/helpers');

module.exports = {
  config: {
    name: "set",
    version: "1.0.0",
    hasPermssion: 1,
    credits: "MiZai",
    description: "Cài đặt prefix bot và các tính năng nhóm",
    commandCategory: "Quản Trị",
    usages: [
      "set prefix <ký tự>   — Đổi prefix bot (chỉ admin bot)",
      "set rank on|off       — Bật/tắt lệnh rank trong nhóm",
    ].join("\n"),
    cooldowns: 3,
  },

  run: async ({ api, event, args, send, prefix, threadID, senderId }) => {
    const FLAG_MAP = { "-p": "prefix", "-r": "rank" };
    const sub    = FLAG_MAP[args[0]] || (args[0] || "").toLowerCase().trim();
    const value  = (args[1] || "").toLowerCase().trim();

    if (!sub) {
      return send(
        `⚙️ LỆNH SET\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `${prefix}set prefix <ký tự>  — Đổi prefix (admin bot)\n` +
        `${prefix}set rank on|off      — Bật/tắt rank trong nhóm\n` +
        `━━━━━━━━━━━━━━━━`
      );
    }

    // ── set prefix ────────────────────────────────────────────────────────────
    if (sub === "prefix") {
      if (!isBotAdmin(senderId)) {
        return send("⛔ Chỉ admin bot mới có thể đổi prefix.");
      }

      const newPrefix = args[1] ? String(args[1]).trim() : "";
      if (!newPrefix) {
        return send(
          `❌ Thiếu ký tự prefix.\n` +
          `Dùng: ${prefix}set prefix <ký tự>\n` +
          `Ví dụ: ${prefix}set prefix !`
        );
      }
      if (newPrefix.length > 3) {
        return send("⛔ Prefix không được dài quá 3 ký tự.");
      }

      const cfg = readConfig();
      const old = cfg.prefix || ".";
      cfg.prefix = newPrefix;
      writeConfig(cfg);

      global.prefix = newPrefix;
      global.config.prefix = newPrefix;

      return send(
        `✅ Đã đổi prefix thành công!\n` +
        `  Cũ: ${old}\n` +
        `  Mới: ${newPrefix}\n` +
        `✔️ Đã áp dụng ngay, không cần restart.`
      );
    }

    // ── set rank ──────────────────────────────────────────────────────────────
    if (sub === "rank") {
      if (event.type !== ThreadType.Group) {
        return send("⛔ Lệnh này chỉ dùng được trong nhóm.");
      }

      if (!["on", "off"].includes(value)) {
        const current = getGroupSetting(threadID, "rankEnabled", true);
        return send(
          `🏆 Rank — Nhóm này\n` +
          `Trạng thái: ${current ? "✅ ON" : "❌ OFF"}\n` +
          `Dùng: ${prefix}set rank on | ${prefix}set rank off`
        );
      }

      const isGAdmin = await isGroupAdmin({ api, groupId: threadID, userId: senderId }).catch(() => false);
      const isAdmin  = isBotAdmin(senderId);
      if (!isGAdmin && !isAdmin) {
        return send("⛔ Chỉ admin nhóm hoặc admin bot mới có thể thay đổi cài đặt này.");
      }

      const enable = value === "on";
      setGroupSetting(threadID, "rankEnabled", enable);

      return send(
        `${enable ? "✅" : "❌"} Lệnh rank đã được ${enable ? "BẬT" : "TẮT"} cho nhóm này.`
      );
    }

    return send(
      `❌ Lệnh con không hợp lệ: "${args[0]}"\n` +
      `💡 Dùng ${prefix}set để xem danh sách lệnh.`
    );
  },
};

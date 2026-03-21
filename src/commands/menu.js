"use strict";

/**
 * src/commands/menu.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Xem danh sách nhóm lệnh, thông tin lệnh.
 * Reply số để xem lệnh trong nhóm → reply tiếp để xem chi tiết lệnh.
 */

// ─────────────────────────────────────────────────────────────────────────────

function commandsGroup(cmds) {
  const array = [];
  for (const cmd of cmds.values()) {
    const { name, commandCategory } = cmd.config || {};
    if (!name) continue;
    const cat   = commandCategory || "Khác";
    const found = array.find(i => i.commandCategory === cat);
    if (!found) array.push({ commandCategory: cat, commandsName: [name] });
    else found.commandsName.push(name);
  }
  array.sort((a, b) => b.commandsName.length - a.commandsName.length);
  return array;
}

function infoCmds(cfg, p = ".") {
  const permText = (n) =>
    n == 0 ? "Thành Viên" : n == 1 ? "Quản Trị Viên Nhóm" : n == 2 ? "Admin Bot" : "Điều Hành";
  return (
    `╭── INFO ────⭓\n` +
    `│ 📔 Tên lệnh: ${cfg.name}\n` +
    `│ 🌴 Phiên bản: ${cfg.version || "1.0.0"}\n` +
    `│ 🔐 Quyền hạn: ${permText(cfg.hasPermssion)}\n` +
    `│ 👤 Tác giả: ${cfg.credits || "Không rõ"}\n` +
    `│ 🌾 Mô tả: ${cfg.description || "Không có"}\n` +
    `│ 📎 Thuộc nhóm: ${cfg.commandCategory || "Khác"}\n` +
    `│ 📝 Cách dùng: ${p}${cfg.name} ${cfg.usages || ""}\n` +
    `│ ⏳ Cooldown: ${cfg.cooldowns || 0}s\n` +
    `╰─────────────⭓`
  );
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name:            "menu",
    version:         "1.1.1",
    hasPermssion:    0,
    credits:         "DC-Nam mod by Vtuan & DongDev (converted MiZai)",
    description:     "Xem danh sách nhóm lệnh, thông tin lệnh",
    commandCategory: "Hệ Thống",
    usages:          "[tên lệnh | all]",
    cooldowns:       5,
  },

  run: async ({ args, send, commands, prefix, registerReply }) => {
    const p    = prefix || ".";
    const cmds = commands && typeof commands.values === "function" ? commands : new Map();
    const sub  = (args[0] || "").toLowerCase().trim();

    // ── menu <tên lệnh> ───────────────────────────────────────────────────────
    if (args.length >= 1 && sub !== "all") {
      const key = args.join(" ").toLowerCase();
      const cmd = cmds.get(key);
      if (cmd) return send(infoCmds(cmd.config, p));

      // Gợi ý gần nhất (Levenshtein)
      const allNames = Array.from(cmds.keys());
      let best = null, bestScore = Infinity;
      for (const name of allNames) {
        const a = key, b = name;
        const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
        for (let i = 0; i <= a.length; i++) dp[i][0] = i;
        for (let j = 0; j <= b.length; j++) dp[0][j] = j;
        for (let i = 1; i <= a.length; i++)
          for (let j = 1; j <= b.length; j++)
            dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
        const d = dp[a.length][b.length];
        if (d < bestScore) { bestScore = d; best = name; }
      }
      const maxDist = Math.max(1, Math.floor(Math.max(key.length, best?.length || 0) / 2));
      const hint = best && bestScore <= maxDist ? `\n💡 Ý bạn là: ${p}${best}?` : "";
      return send(`❌ Không tìm thấy lệnh "${key}".${hint}`);
    }

    // ── menu all ──────────────────────────────────────────────────────────────
    if (sub === "all") {
      const seen = new Set();
      let txt = `╭─────────────⭓\n`, count = 0;
      for (const cmd of cmds.values()) {
        const name = cmd?.config?.name;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        txt += `│ ${++count}. ${name} | ${cmd.config.description || ""}\n`;
      }
      txt += `╰─────────────⭓`;
      return send(txt);
    }

    // ── menu (nhóm lệnh → reply để xem chi tiết) ─────────────────────────────
    const data = commandsGroup(cmds);
    let txt = `╭─────────────⭓\n`, count = 0;
    for (const { commandCategory, commandsName } of data) {
      txt += `│ ${++count}. ${commandCategory} || có ${commandsName.length} lệnh\n`;
    }
    txt += (
      `├────────⭔\n` +
      `│ 📝 Tổng có: ${cmds.size} lệnh\n` +
      `│ ⏰ Reply từ 1 đến ${data.length} để chọn\n` +
      `╰─────────────⭓`
    );

    const sent = await send(txt);
    const msgId =
      sent?.msgId ??
      sent?.message?.msgId ??
      (Array.isArray(sent?.attachment) ? sent.attachment[0]?.msgId : null);

    if (msgId) {
      registerReply({
        messageId:   String(msgId),
        commandName: "menu",
        payload:     { case: "infoGr", data, prefix: p },
      });
    }

  },

  onReply: async ({ api, event, data: replyData, send, registerReply: reg }) => {
    const raw  = event?.data ?? {};
    const body = typeof raw.content === "string"
      ? raw.content
      : (raw.content?.text || raw.content?.msg || "");
    const num  = parseInt(body.trim(), 10);

    const { case: $case, data = [], prefix: p = "." } = replyData || {};

    // ── Chọn nhóm → xem danh sách lệnh trong nhóm ────────────────────────────
    if ($case === "infoGr") {
      const item = data[num - 1];
      if (!item) return send(`❎ "${body.trim()}" không nằm trong số thứ tự menu`);

      let txt = `╭─────────────⭓\n│ ${item.commandCategory}\n├─────⭔\n`, count = 0;
      for (const name of item.commandsName) txt += `│ ${++count}. ${name}\n`;
      txt += (
        `├────────⭔\n` +
        `│ 🔎 Reply từ 1 đến ${item.commandsName.length} để xem chi tiết\n` +
        `│ 📝 Dùng ${p}help <tên lệnh> để xem cách dùng\n` +
        `╰─────────────⭓`
      );

      const sent = await send(txt);
      const msgId =
        sent?.msgId ??
        sent?.message?.msgId ??
        (Array.isArray(sent?.attachment) ? sent.attachment[0]?.msgId : null);

      if (msgId && reg) {
        reg({
          messageId:   String(msgId),
          commandName: "menu",
          payload:     { case: "infoCmds", data: item.commandsName, prefix: p },
        });
      }
      return;
    }

    // ── Chọn lệnh → xem chi tiết ─────────────────────────────────────────────
    if ($case === "infoCmds") {
      const name = data[num - 1];
      if (!name) return send(`⚠️ "${body.trim()}" không nằm trong số thứ tự`);

      const cmds = global.commands;
      const cmd  = cmds?.get?.(name);
      if (!cmd) return send(`❌ Không tìm thấy lệnh "${name}"`);

      return send(infoCmds(cmd.config, p));
    }
  },
};

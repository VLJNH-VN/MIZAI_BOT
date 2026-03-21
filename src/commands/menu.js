"use strict";

/**
 * src/commands/menu.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Xem danh sách nhóm lệnh, thông tin lệnh.
 * Reply số để xem lệnh trong nhóm → reply tiếp để xem chi tiết lệnh.
 */

const fs = require("fs");
const { drawMenuCard, drawCategoryCard, drawCommandInfoCard, drawAllCommandsCard } = require("../../utils/canvas");

// ─────────────────────────────────────────────────────────────────────────────

function commandsGroup(cmds) {
  const array = [];
  const seen  = new Set();
  for (const cmd of cmds.values()) {
    const { name, commandCategory } = cmd.config || {};
    if (!name || seen.has(name)) continue;
    seen.add(name);
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

  run: async ({ api, event, args, send, commands, prefix, registerReply, threadID }) => {
    const p    = prefix || ".";
    const cmds = commands && typeof commands.values === "function" ? commands : new Map();
    const sub  = (args[0] || "").toLowerCase().trim();

    // ── menu <tên lệnh> ───────────────────────────────────────────────────────
    if (args.length >= 1 && sub !== "all") {
      const key = args.join(" ").toLowerCase();
      const cmd = cmds.get(key);
      if (cmd) {
        let cardPath;
        try { cardPath = await drawCommandInfoCard({ config: cmd.config, prefix: p }); } catch (_) {}
        if (cardPath) {
          await api.sendMessage({ msg: "", attachments: [cardPath] }, threadID, event.type);
          try { fs.unlinkSync(cardPath); } catch (_) {}
        } else {
          await send(infoCmds(cmd.config, p));
        }
        return;
      }

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

    // ── menu all (phân trang 20 lệnh/trang) ──────────────────────────────────
    if (sub === "all") {
      const seen = new Set();
      const allCmds = [];
      for (const cmd of cmds.values()) {
        const name = cmd?.config?.name;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        allCmds.push({ name, desc: cmd.config.description || "" });
      }

      const PAGE_SIZE = 20;
      const totalPages = Math.ceil(allCmds.length / PAGE_SIZE);
      const page = 1;
      const slice = allCmds.slice(0, PAGE_SIZE);

      let cardPath;
      try {
        cardPath = await drawAllCommandsCard({ commands: slice, page, totalPages, total: allCmds.length, prefix: p });
      } catch (_) {}

      let sent;
      if (cardPath) {
        sent = await api.sendMessage({ msg: "", attachments: [cardPath] }, threadID, event.type);
        try { fs.unlinkSync(cardPath); } catch (_) {}
      } else {
        let txt = `╭─────────────⭓\n│ 📋 Tất cả lệnh — Trang ${page}/${totalPages}\n├─────⭔\n`;
        slice.forEach((c, i) => { txt += `│ ${i + 1}. ${c.name} | ${c.desc}\n`; });
        txt += `├────────⭔\n│ 📝 Tổng: ${allCmds.length} lệnh\n`;
        if (totalPages > 1) txt += `│ ⏰ Reply số trang (2–${totalPages}) để xem tiếp\n`;
        txt += `╰─────────────⭓`;
        sent = await send(txt);
      }

      const msgId =
        sent?.message?.msgId ??
        sent?.msgId ??
        (Array.isArray(sent?.attachment) ? sent.attachment[0]?.msgId : null);

      if (msgId && totalPages > 1) {
        registerReply({
          messageId:   String(msgId),
          commandName: "menu",
          payload:     { case: "allPage", allCmds, totalPages, prefix: p },
        });
      }
      return;
    }

    // ── menu (nhóm lệnh → reply để xem chi tiết) ─────────────────────────────
    const data = commandsGroup(cmds);
    const uniqueCount = data.reduce((s, g) => s + g.commandsName.length, 0);

    let cardPath;
    try { cardPath = await drawMenuCard({ groups: data, uniqueCount, prefix: p }); } catch (_) {}

    let sent;
    if (cardPath) {
      sent = await api.sendMessage({ msg: "", attachments: [cardPath] }, threadID, event.type);
      try { fs.unlinkSync(cardPath); } catch (_) {}
    } else {
      let txt = `╭─────────────⭓\n`;
      let count = 0;
      for (const { commandCategory, commandsName } of data) {
        txt += `│ ${++count}. ${commandCategory} || có ${commandsName.length} lệnh\n`;
      }
      txt += `├────────⭔\n│ 📝 Tổng có: ${uniqueCount} lệnh\n│ ⏰ Reply từ 1 đến ${data.length} để chọn\n╰─────────────⭓`;
      sent = await send(txt);
    }

    const msgId =
      sent?.message?.msgId ??
      sent?.msgId ??
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
    const threadID = event.threadId;

    const { case: $case, data = [], prefix: p = "." } = replyData || {};

    // ── Chọn nhóm → xem danh sách lệnh trong nhóm ────────────────────────────
    if ($case === "infoGr") {
      const item = data[num - 1];
      if (!item) return send(`❎ "${body.trim()}" không nằm trong số thứ tự menu`);

      let cardPath;
      try {
        cardPath = await drawCategoryCard({
          category: item.commandCategory,
          commands: item.commandsName,
          prefix:   p,
        });
      } catch (_) {}

      let sent;
      if (cardPath) {
        sent = await api.sendMessage({ msg: "", attachments: [cardPath] }, threadID, event.type);
        try { fs.unlinkSync(cardPath); } catch (_) {}
      } else {
        let txt = `╭─────────────⭓\n│ ${item.commandCategory}\n├─────⭔\n`;
        let count = 0;
        for (const name of item.commandsName) txt += `│ ${++count}. ${name}\n`;
        txt += `├────────⭔\n│ 🔎 Reply từ 1 đến ${item.commandsName.length} để xem chi tiết\n╰─────────────⭓`;
        sent = await send(txt);
      }

      const msgId =
        sent?.message?.msgId ??
        sent?.msgId ??
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

    // ── menu all → chuyển trang ───────────────────────────────────────────────
    if ($case === "allPage") {
      const { allCmds = [], totalPages = 1 } = replyData;
      const page = num;
      if (!page || page < 1 || page > totalPages) {
        return send(`⚠️ Trang không hợp lệ. Nhập số từ 1 đến ${totalPages}.`);
      }
      const PAGE_SIZE = 20;
      const slice = allCmds.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

      let cardPath;
      try {
        cardPath = await drawAllCommandsCard({ commands: slice, page, totalPages, total: allCmds.length, prefix: p });
      } catch (_) {}

      let sent;
      if (cardPath) {
        sent = await api.sendMessage({ msg: "", attachments: [cardPath] }, threadID, event.type);
        try { fs.unlinkSync(cardPath); } catch (_) {}
      } else {
        let txt = `╭─────────────⭓\n│ 📋 Tất cả lệnh — Trang ${page}/${totalPages}\n├─────⭔\n`;
        slice.forEach((c, i) => { txt += `│ ${(page - 1) * PAGE_SIZE + i + 1}. ${c.name} | ${c.desc}\n`; });
        txt += `├────────⭔\n│ 📝 Tổng: ${allCmds.length} lệnh\n`;
        if (page < totalPages) txt += `│ ⏰ Reply số trang (${page + 1}–${totalPages}) để xem tiếp\n`;
        txt += `╰─────────────⭓`;
        sent = await send(txt);
      }

      const msgId =
        sent?.message?.msgId ??
        sent?.msgId ??
        (Array.isArray(sent?.attachment) ? sent.attachment[0]?.msgId : null);

      if (msgId && page < totalPages && reg) {
        reg({
          messageId:   String(msgId),
          commandName: "menu",
          payload:     { case: "allPage", allCmds, totalPages, prefix: p },
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

      let cardPath;
      try { cardPath = await drawCommandInfoCard({ config: cmd.config, prefix: p }); } catch (_) {}
      if (cardPath) {
        await api.sendMessage({ msg: "", attachments: [cardPath] }, threadID, event.type);
        try { fs.unlinkSync(cardPath); } catch (_) {}
      } else {
        await send(infoCmds(cmd.config, p));
      }
      return;
    }
  },
};

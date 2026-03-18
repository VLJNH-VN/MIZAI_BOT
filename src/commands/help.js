module.exports = {
  config: {
    name: "help",
    version: "2.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Xem danh sách lệnh và thông tin chi tiết",
    commandCategory: "Hệ Thống",
    usages: "[tên lệnh / all]",
    cooldowns: 0
  },

  run: async ({ event, args, send, commands, prefix }) => {
    const type = (args?.[0] ? String(args[0]).toLowerCase() : "").trim();
    const cmds = commands && typeof commands.values === "function" ? commands : new Map();
    const p = prefix || ".";

    const permissionText = (perm) => {
      const n = Number(perm);
      if (n === 0) return "Thành Viên";
      if (n === 1) return "Quản Trị Viên";
      if (n === 2) return "Admin Bot";
      return "Không rõ";
    };

    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = Math.floor(uptime % 60);
    const uptimeStr = `${h}h ${m}m ${s}s`;

    // ── help all ──────────────────────────────────────────────────────────────
    if (type === "all") {
      const seen = new Set();
      const unique = [];
      for (const cmd of cmds.values()) {
        const name = cmd?.config?.name;
        if (name && !seen.has(name)) {
          seen.add(name);
          unique.push(cmd);
        }
      }
      let i = 0;
      let msg = `📋 TẤT CẢ LỆNH (${unique.length})\n━━━━━━━━━━━━━━━━\n`;
      for (const cmd of unique) {
        const cfg = cmd?.config || {};
        msg += `${++i}. ${p}${cfg.name} — ${cfg.description || "Không có mô tả"}\n`;
      }
      if (unique.length === 0) msg += "Chưa có lệnh nào được load.";
      msg += `━━━━━━━━━━━━━━━━\n⏰ Bot online: ${uptimeStr}`;
      return send(msg);
    }

    // ── help <command> ────────────────────────────────────────────────────────
    if (type) {
      const found = cmds.get(type);
      if (!found) {
        const allNames = Array.from(cmds.keys());
        // Tìm gợi ý gần nhất
        let best = null, bestScore = Infinity;
        for (const name of allNames) {
          let a = type, b = name;
          const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
          for (let i = 0; i <= a.length; i++) dp[i][0] = i;
          for (let j = 0; j <= b.length; j++) dp[0][j] = j;
          for (let i = 1; i <= a.length; i++)
            for (let j = 1; j <= b.length; j++)
              dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
          const d = dp[a.length][b.length];
          if (d < bestScore) { bestScore = d; best = name; }
        }
        const maxAllowed = Math.max(1, Math.floor(Math.max(type.length, best?.length || 0) / 2));
        const hint = bestScore <= maxAllowed ? `\n💡 Ý bạn là: ${p}${best}?` : "";
        return send(`❌ Không tìm thấy lệnh "${type}".${hint}`);
      }

      const cfg = found.config || {};
      return send(
        `╔══ HƯỚNG DẪN LỆNH ══╗\n` +
        `  ${p}${cfg.name}\n` +
        `╚════════════════════╝\n` +
        `📌 Mô tả: ${cfg.description || "Không có"}\n` +
        `🗂️  Nhóm: ${cfg.commandCategory || "Khác"}\n` +
        `🔑 Quyền: ${permissionText(cfg.hasPermssion)}\n` +
        `⏳ Cooldown: ${Number(cfg.cooldowns ?? 0)}s\n` +
        `📖 Cách dùng: ${p}${cfg.name} ${cfg.usages || ""}\n` +
        `👨‍💻 Credits: ${cfg.credits || "Không rõ"}\n` +
        `🔖 Phiên bản: v${cfg.version || "1.0.0"}`
      );
    }

    // ── help (danh sách theo nhóm) ────────────────────────────────────────────
    const categories = new Map();
    const seenCat = new Set();
    for (const cmd of cmds.values()) {
      const cfg = cmd?.config || {};
      const name = String(cfg.name || "").trim();
      if (!name || seenCat.has(name)) continue;
      seenCat.add(name);
      const cat = String(cfg.commandCategory || "Khác");
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat).push(name);
    }

    const catIcons = {
      "Hệ Thống": "⚙️",
      "Kinh Tế": "💰",
      "Tra Cứu": "🔍",
      "Game": "🎮",
      "Tiện ích": "🛠️",
      "Giải Trí": "🎭"
    };

    const catEntries = Array.from(categories.entries()).sort((a, b) => a[0].localeCompare(b[0], "vi"));

    let msg = `╔══════════════════════╗\n`;
    msg += `  🤖 MENU LỆNH BOT\n`;
    msg += `╚══════════════════════╝\n\n`;

    for (const [cat, names] of catEntries) {
      names.sort((a, b) => a.localeCompare(b, "vi"));
      const icon = catIcons[cat] || "📁";
      msg += `${icon} ${cat.toUpperCase()} (${names.length})\n`;
      msg += `  ${names.map(n => `${p}${n}`).join("  |  ")}\n\n`;
    }

    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📊 Tổng: ${seenCat.size} lệnh\n`;
    msg += `⏰ Online: ${uptimeStr}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💡 ${p}help <tên lệnh> — xem chi tiết\n`;
    msg += `💡 ${p}help all — xem tất cả`;

    return send(msg);
  }
};

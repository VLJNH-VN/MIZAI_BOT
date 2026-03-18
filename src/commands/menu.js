module.exports = {
  config: {
    name: "menu",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Xem menu lệnh theo giao diện công nghệ",
    commandCategory: "Hệ Thống",
    usages: "menu [tên lệnh]",
    cooldowns: 3,
  },

  run: async ({ event, args, send, commands, prefix }) => {
    const p    = prefix || ".";
    const cmds = commands && typeof commands.values === "function" ? commands : new Map();
    const type = args[0] ? String(args[0]).toLowerCase().trim() : "";

    // ── Helpers ──────────────────────────────────────────────────────────────
    const pad2  = (n) => String(n).padStart(2, "0");
    const uptime = process.uptime();
    const h = Math.floor((uptime % 86400) / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = Math.floor(uptime % 60);
    const uptimeStr = `${pad2(h)}h ${pad2(m)}m ${pad2(s)}s`;
    const memMb = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

    const W = 34;
    const line   = "═".repeat(W);
    const thinL  = "─".repeat(W);
    const blank  = "║" + " ".repeat(W) + "║";

    const centerRow = (text, ch = "║") => {
      const len    = [...text].length;
      const spaces = Math.max(0, W - len);
      const left   = Math.floor(spaces / 2);
      const right  = spaces - left;
      return `${ch}${" ".repeat(left)}${text}${" ".repeat(right)}${ch}`;
    };

    const col = (icon, label, val) => {
      const content = `${icon} ${label}: ${val}`;
      const spaces  = Math.max(0, W - [...content].length - 1);
      return `║ ${content}${" ".repeat(spaces)}║`;
    };

    const divider = (lc = "╠", rc = "╣", fc = "═") =>
      `${lc}${"═".repeat(W)}${rc}`;

    const thinDiv = () => `╟${"─".repeat(W)}╢`;

    // ── Xem chi tiết một lệnh ─────────────────────────────────────────────
    if (type) {
      const found = cmds.get(type);
      if (!found) {
        return send(`❌ Không tìm thấy lệnh "${type}".\n💡 Dùng ${p}menu để xem danh sách.`);
      }
      const cfg  = found.config || {};
      const perm = ["Thành Viên", "Admin Nhóm", "Admin Bot"][Number(cfg.hasPermssion ?? 0)] || "Không rõ";

      return send(
        `╔${line}╗\n` +
        `${centerRow("◈  CHI TIẾT LỆNH  ◈")}\n` +
        `${centerRow(`[ ${p}${cfg.name} ]`)}\n` +
        `${divider()}\n` +
        `${blank}\n` +
        `${col("📌", "Mô tả   ", cfg.description || "Không có")}\n` +
        `${col("🗂️ ", "Nhóm   ", cfg.commandCategory || "Khác")}\n` +
        `${col("🔑", "Quyền   ", perm)}\n` +
        `${col("⏳", "Cooldown", `${Number(cfg.cooldowns ?? 0)}s`)}\n` +
        `${col("📖", "Dùng    ", `${p}${cfg.name} ${cfg.usages || ""}`)}\n` +
        `${col("👤", "Credits ", cfg.credits || "Không rõ")}\n` +
        `${col("🔖", "Phiên bản", `v${cfg.version || "1.0.0"}`)}\n` +
        `${blank}\n` +
        `╚${line}╝`
      );
    }

    // ── Gom nhóm lệnh ────────────────────────────────────────────────────
    const catIcons = {
      "Hệ Thống":  "⚙️ ",
      "Kinh Tế":   "💰",
      "Quản Trị":  "🛡️ ",
      "Tra Cứu":   "🔍",
      "Game":      "🎮",
      "Tiện ích":  "🛠️ ",
      "Giải Trí":  "🎭",
      "System":    "⚙️ ",
    };

    const categories = new Map();
    const seen = new Set();
    for (const cmd of cmds.values()) {
      const cfg  = cmd?.config || {};
      const name = String(cfg.name || "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const cat = String(cfg.commandCategory || "Khác");
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat).push(name);
    }

    const catEntries = Array.from(categories.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], "vi")
    );

    // ── Header ────────────────────────────────────────────────────────────
    let msg = "";
    msg += `╔${line}╗\n`;
    msg += `${centerRow("◈◈◈  MIZAI BOT SYSTEM  ◈◈◈")}\n`;
    msg += `${centerRow("[ COMMAND MENU v1.5.0 ]")}\n`;
    msg += `${divider()}\n`;
    msg += `${col("📡", "Trạng thái", "● ONLINE")}\n`;
    msg += `${col("⏱️ ", "Uptime    ", uptimeStr)}\n`;
    msg += `${col("💾", "RAM       ", `${memMb} MB`)}\n`;
    msg += `${col("🔧", "Node.js   ", process.version)}\n`;
    msg += `${divider()}\n`;

    // ── Danh sách nhóm lệnh ───────────────────────────────────────────────
    for (const [cat, names] of catEntries) {
      names.sort((a, b) => a.localeCompare(b, "vi"));
      const icon = catIcons[cat] || "📁";

      msg += `${centerRow(`${icon}  ${cat.toUpperCase()}  (${names.length})`)}\n`;
      msg += `${thinDiv()}\n`;

      const chunkSize = 3;
      for (let i = 0; i < names.length; i += chunkSize) {
        const chunk = names.slice(i, i + chunkSize);
        const line2 = chunk.map(n => `▶ ${p}${n}`).join("   ");
        const spaces = Math.max(0, W - [...line2].length - 1);
        msg += `║ ${line2}${" ".repeat(spaces)}║\n`;
      }

      msg += `${blank}\n`;
    }

    // ── Footer ─────────────────────────────────────────────────────────────
    msg += `${divider()}\n`;
    msg += `${col("📊", "Tổng cộng", `${seen.size} lệnh`)}\n`;
    msg += `${blank}\n`;
    msg += `${centerRow(`💡 ${p}menu <tên lệnh>  —  xem chi tiết`)}\n`;
    msg += `${centerRow(`💡 ${p}help all  —  xem toàn bộ`)}\n`;
    msg += `${blank}\n`;
    msg += `╚${line}╝`;

    return send(msg);
  },
};

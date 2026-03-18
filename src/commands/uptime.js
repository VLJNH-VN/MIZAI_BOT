module.exports = {
  config: {
    name: "uptime",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Xem thời gian bot hoạt động và thông số hệ thống",
    commandCategory: "Hệ Thống",
    usages: "uptime",
    cooldowns: 3,
  },

  run: async ({ send }) => {
    const uptime = process.uptime();
    const d  = Math.floor(uptime / 86400);
    const h  = Math.floor((uptime % 86400) / 3600);
    const m  = Math.floor((uptime % 3600) / 60);
    const s  = Math.floor(uptime % 60);

    const pad   = (n) => String(n).padStart(2, "0");
    const timer = d > 0
      ? `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`
      : `${pad(h)}h ${pad(m)}m ${pad(s)}s`;

    const mem     = process.memoryUsage();
    const heapMb  = (mem.heapUsed  / 1024 / 1024).toFixed(1);
    const totalMb = (mem.heapTotal / 1024 / 1024).toFixed(1);
    const rssMb   = (mem.rss       / 1024 / 1024).toFixed(1);

    const node    = process.version;
    const now     = new Date();
    const bootTime = new Date(now - uptime * 1000);
    const fmt = (dt) =>
      `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()} ` +
      `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;

    const bar = (used, total, len = 12) => {
      const pct   = Math.min(1, used / total);
      const fill  = Math.round(pct * len);
      const empty = len - fill;
      return `[${"█".repeat(fill)}${"░".repeat(empty)}] ${(pct * 100).toFixed(0)}%`;
    };

    const ramBar = bar(parseFloat(heapMb), parseFloat(totalMb));

    const W = 32;
    const line  = "═".repeat(W);
    const blank = "║" + " ".repeat(W) + "║";

    const row = (icon, label, value) => {
      const content = `${icon} ${label}: ${value}`;
      const pad2 = W - content.length - 1;
      return `║ ${content}${" ".repeat(Math.max(0, pad2))}║`;
    };

    const title = "⚡  SYSTEM UPTIME  ⚡";
    const titlePad = Math.floor((W - title.length) / 2);
    const titleRow = `║${" ".repeat(titlePad)}${title}${" ".repeat(W - titlePad - title.length)}║`;

    const sub = "[ MiZai Bot v2.0.0 ]";
    const subPad = Math.floor((W - sub.length) / 2);
    const subRow = `║${" ".repeat(subPad)}${sub}${" ".repeat(W - subPad - sub.length)}║`;

    const ramRow = (() => {
      const content = `💾 RAM  ${ramBar}`;
      const pad2 = W - content.length - 1;
      return `║ ${content}${" ".repeat(Math.max(0, pad2))}║`;
    })();

    const msg =
      `╔${line}╗\n` +
      `${titleRow}\n` +
      `${subRow}\n` +
      `╠${line}╣\n` +
      `${blank}\n` +
      `${row("⏱️ ", "Uptime ", timer)}\n` +
      `${row("📅", "Khởi động", fmt(bootTime))}\n` +
      `${blank}\n` +
      `╠${line}╣\n` +
      `${ramRow}\n` +
      `${row("📊", "Heap    ", `${heapMb} / ${totalMb} MB`)}\n` +
      `${row("🖥️ ", "RSS     ", `${rssMb} MB`)}\n` +
      `${blank}\n` +
      `╠${line}╣\n` +
      `${row("🔧", "Node.js ", node)}\n` +
      `${row("🖱️ ", "PID     ", String(process.pid))}\n` +
      `${blank}\n` +
      `╚${line}╝`;

    return send(msg);
  },
};

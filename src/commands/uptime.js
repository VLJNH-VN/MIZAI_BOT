"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

let _canvas;
function getCanvas() {
  if (!_canvas) _canvas = require("../../utils/media/canvas");
  return _canvas;
}

const ROOT       = process.cwd();
const BG_IMAGE   = path.join(ROOT, "attached_assets", "generated_images", "uptime_tech.png");
const STATS_FILE = path.join(ROOT, "includes", "cache", "bot_stats.json");

// ── Restart counter ───────────────────────────────────────────────────────────
function loadStats() {
  try {
    if (fs.existsSync(STATS_FILE)) return JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
  } catch (_) {}
  return { restartCount: 0, firstStart: Date.now() };
}

function saveStats(stats) {
  try {
    const dir = path.dirname(STATS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (_) {}
}

// Tăng restart count khi module được load lần đầu
const _botStats = loadStats();
_botStats.restartCount = (_botStats.restartCount || 0) + 1;
if (!_botStats.firstStart) _botStats.firstStart = Date.now();
saveStats(_botStats);

// ── Network info ──────────────────────────────────────────────────────────────
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}

// ── System data ───────────────────────────────────────────────────────────────
function getSystemData(pingMs) {
  const uptime = process.uptime();
  const d  = Math.floor(uptime / 86400);
  const h  = Math.floor((uptime % 86400) / 3600);
  const m  = Math.floor((uptime % 3600) / 60);
  const s  = Math.floor(uptime % 60);
  const pad = n => String(n).padStart(2, "0");

  const uptimeStr = d > 0
    ? `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`
    : `${pad(h)}h ${pad(m)}m ${pad(s)}s`;

  const totalMem   = os.totalmem() / (1024 * 1024);
  const freeMem    = os.freemem()  / (1024 * 1024);
  const usedMem    = totalMem - freeMem;
  const ramPct     = Math.round((usedMem / totalMem) * 100);
  const cpuLoad    = os.loadavg()[0];
  const cpuCount   = os.cpus().length;
  const cpuPct     = Math.min(100, Math.round((cpuLoad / cpuCount) * 100));
  const cpuModel   = os.cpus()[0]?.model?.split(" ").slice(0, 4).join(" ") || "Unknown";

  const vnTime    = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
  const startTime = new Date(Date.now() - uptime * 1000)
    .toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });

  // Số nhóm/thread đang hoạt động
  let threadCount = 0;
  try {
    const ids = global.groupLoader?.getGroupIds?.();
    if (Array.isArray(ids)) threadCount = ids.length;
  } catch (_) {}

  // RAM cảnh báo
  const ramWarning = ramPct >= 85;

  const stats = loadStats();

  return {
    uptimeStr,
    startTime,
    vnTime,
    ramPct,
    cpuPct,
    cpuModel,
    usedMem:      usedMem.toFixed(0),
    totalMem:     totalMem.toFixed(0),
    freeMem:      freeMem,
    nodeVer:      process.version,
    cmdCount:     global.commands?.size || 0,
    prefix:       global.prefix || global.config?.PREFIX || ".",
    pingMs:       pingMs ?? 0,
    threadCount,
    ramWarning,
    hostname:     os.hostname(),
    localIP:      getLocalIP(),
    platform:     `${os.type()} ${os.arch()}`,
    restartCount: stats.restartCount || 1,
    firstStart:   stats.firstStart
      ? new Date(stats.firstStart).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })
      : vnTime,
  };
}

// ── Fallback text ─────────────────────────────────────────────────────────────
function buildText(d) {
  const ramWarn = d.ramWarning ? "  ⚠️ RAM CAO!" : "";
  return (
    `⚡ SYSTEM UPTIME — MiZai v2.0.0\n` +
    `${"─".repeat(36)}\n` +
    `⏰ Thời gian  : ${d.vnTime}\n` +
    `🚀 Khởi động  : ${d.startTime}\n` +
    `⏳ Hoạt động  : ${d.uptimeStr}\n` +
    `🔁 Restarts   : ${d.restartCount} lần\n` +
    `${"─".repeat(36)}\n` +
    `🏓 Ping API   : ${d.pingMs}ms\n` +
    `💬 Threads    : ${d.threadCount} nhóm\n` +
    `📦 Lệnh       : ${d.cmdCount}\n` +
    `⚙️  Prefix     : ${d.prefix}\n` +
    `${"─".repeat(36)}\n` +
    `🔩 CPU         : ${d.cpuPct}% | ${d.cpuModel}\n` +
    `💾 RAM         : ${d.usedMem}MB/${d.totalMem}MB (${d.ramPct}%)${ramWarn}\n` +
    `🔋 RAM trống   : ${(d.freeMem / 1024).toFixed(2)} GB\n` +
    `🔧 Node.js     : ${d.nodeVer}\n` +
    `🖥️  OS          : ${d.platform}\n` +
    `${"─".repeat(36)}\n` +
    `🌐 Hostname    : ${d.hostname}\n` +
    `📡 IP nội bộ   : ${d.localIP}`
  );
}

module.exports = {
  config: {
    name:            "uptime",
    aliases:         ["ping"],
    version:         "3.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Xem thời gian hoạt động, ping, tài nguyên và thông tin hệ thống",
    commandCategory: "Hệ Thống",
    usages:          "uptime | ping",
    cooldowns:       5,
  },

  run: async ({ api, event, send, threadID, commandName }) => {
    // ── Ping mode ─────────────────────────────────────────────────────────────
    if (commandName === "ping") {
      const t0      = Date.now();
      await send("🏓 Đang đo...");
      const latency = Date.now() - t0;
      const bar     = latency < 200 ? "🟢 Tốt" : latency < 500 ? "🟡 Trung bình" : "🔴 Cao";
      return send(`⚡ Ping API: ${latency}ms  ${bar}`);
    }

    // ── Đo ping trước ────────────────────────────────────────────────────────
    const t0 = Date.now();
    try { await api.sendMessage({ msg: "" }, threadID, event.type); } catch (_) {}
    const pingMs = Date.now() - t0;

    const data = getSystemData(pingMs);

    // ── Cảnh báo RAM ─────────────────────────────────────────────────────────
    if (data.ramWarning) {
      await send(`⚠️ CẢNH BÁO: RAM đang ở mức cao (${data.ramPct}%)! Cân nhắc restart bot.`);
    }

    // ── Vẽ card ───────────────────────────────────────────────────────────────
    let cardPath;
    try {
      cardPath = await getCanvas().drawUptimeCard({ ...data, bgImagePath: BG_IMAGE });
    } catch (err) {
      logError?.(`[uptime] drawUptimeCard lỗi: ${err?.message || err}`);
    }

    if (cardPath && fs.existsSync(cardPath)) {
      try {
        await api.sendMessage({ msg: "", attachments: [cardPath] }, threadID, event.type);
      } catch (err) {
        logError?.(`[uptime] gửi ảnh lỗi: ${err?.message || err}`);
        await send(buildText(data));
      } finally {
        try { fs.unlinkSync(cardPath); } catch (_) {}
      }
    } else {
      await send(buildText(data));
    }
  },
};

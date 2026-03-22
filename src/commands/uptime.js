"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

const { drawUptimeCard } = require("../../utils/canvas");

const ROOT     = process.cwd();
const BG_IMAGE = path.join(ROOT, "attached_assets", "generated_images", "uptime_tech.png");

function getSystemData() {
  const uptime = process.uptime();
  const d  = Math.floor(uptime / 86400);
  const h  = Math.floor((uptime % 86400) / 3600);
  const m  = Math.floor((uptime % 3600) / 60);
  const s  = Math.floor(uptime % 60);
  const pad = n => String(n).padStart(2, "0");

  const uptimeStr = d > 0
    ? `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`
    : `${pad(h)}h ${pad(m)}m ${pad(s)}s`;

  const totalMem = os.totalmem() / (1024 * 1024);
  const freeMem  = os.freemem()  / (1024 * 1024);
  const usedMem  = totalMem - freeMem;
  const ramPct   = Math.round((usedMem / totalMem) * 100);
  const cpuLoad  = os.loadavg()[0];
  const cpuCount = os.cpus().length;
  const cpuPct   = Math.min(100, Math.round((cpuLoad / cpuCount) * 100));

  const vnTime   = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
  const startTime = new Date(Date.now() - uptime * 1000)
    .toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });

  return {
    uptimeStr,
    startTime,
    vnTime,
    ramPct,
    cpuPct,
    usedMem:  usedMem.toFixed(0),
    totalMem: totalMem.toFixed(0),
    freeMem:  freeMem,
    nodeVer:  process.version,
    cmdCount: global.commands?.size || 0,
    prefix:   global.prefix || global.config?.PREFIX || ".",
  };
}

module.exports = {
  config: {
    name:            "uptime",
    aliases:         ["ping"],
    version:         "2.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Xem thời gian hoạt động, thông tin hệ thống và đo độ trễ",
    commandCategory: "Hệ Thống",
    usages:          "uptime | ping",
    cooldowns:       5,
  },

  run: async ({ api, event, send, threadID, commandName }) => {
    if (commandName === "ping") {
      const start   = Date.now();
      await send("🏓 Pong!");
      const latency = Date.now() - start;
      return send(`⚡ Độ trễ: ${latency}ms`);
    }

    const data = getSystemData();

    let cardPath;
    try {
      cardPath = await drawUptimeCard({
        ...data,
        bgImagePath: BG_IMAGE,
      });
    } catch (err) {
      logError?.(`[uptime] drawUptimeCard lỗi: ${err?.message || err}`);
    }

    if (cardPath && fs.existsSync(cardPath)) {
      try {
        await api.sendMessage(
          { msg: "", attachments: [cardPath] },
          threadID,
          event.type
        );
      } catch (err) {
        logError?.(`[uptime] gửi ảnh lỗi: ${err?.message || err}`);
        await send(`⚡ Uptime: ${data.uptimeStr} | RAM: ${data.usedMem}MB/${data.totalMem}MB`);
      } finally {
        try { fs.unlinkSync(cardPath); } catch (_) {}
      }
    } else {
      await send(
        `⚡ SYSTEM UPTIME\n` +
        `⏳ Hoạt động: ${data.uptimeStr}\n` +
        `💾 RAM: ${data.usedMem}MB / ${data.totalMem}MB (${data.ramPct}%)\n` +
        `🔩 CPU: ${data.cpuPct}%\n` +
        `🔧 Node.js: ${data.nodeVer}\n` +
        `📦 Lệnh: ${data.cmdCount}`
      );
    }
  },
};

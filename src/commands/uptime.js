"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

const ROOT      = process.cwd();
const IMG_PATH  = path.join(ROOT, "includes", "cache", "uptime_tech.png");
const SRC_IMG   = path.join(ROOT, "attached_assets", "generated_images", "uptime_tech.png");

function buildBar(percent, len = 12) {
  const filled = Math.round((percent / 100) * len);
  return "█".repeat(filled) + "░".repeat(len - filled);
}

function getSystemInfo() {
  const uptime  = process.uptime();
  const d  = Math.floor(uptime / 86400);
  const h  = Math.floor((uptime % 86400) / 3600);
  const m  = Math.floor((uptime % 3600) / 60);
  const s  = Math.floor(uptime % 60);
  const pad = n => String(n).padStart(2, "0");
  const uptimeStr = d > 0
    ? `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`
    : `${pad(h)}h ${pad(m)}m ${pad(s)}s`;

  const totalMem  = os.totalmem() / (1024 * 1024);
  const freeMem   = os.freemem()  / (1024 * 1024);
  const usedMem   = totalMem - freeMem;
  const ramPct    = Math.round((usedMem / totalMem) * 100);
  const cpuLoad   = os.loadavg()[0];
  const cpuCount  = os.cpus().length;
  const cpuPct    = Math.min(100, Math.round((cpuLoad / cpuCount) * 100));
  const vnTime    = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
  const startTime = new Date(Date.now() - uptime * 1000)
    .toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });

  const prefix   = global.prefix || global.config?.PREFIX || ".";
  const cmdCount = global.commands?.size || 0;
  const nodeVer  = process.version;
  const platform = `${os.type()} (${os.arch()})`;

  const W = 38;
  const line = "═".repeat(W);
  const div  = "─".repeat(W);

  const row = (label, value) => {
    const content = `${label} ${value}`;
    const pad2 = W - content.length - 2;
    return `║ ${content}${" ".repeat(Math.max(0, pad2))} ║`;
  };

  return [
    `╔${line}╗`,
    `║${"  ⚡  SYSTEM UPTIME  ⚡  MiZai v2.0.0".padEnd(W)}║`,
    `╠${line}╣`,
    row("⏰ Thời gian :", vnTime),
    row("🚀 Khởi động :", startTime),
    row("⏳ Hoạt động :", uptimeStr),
    `╠${line}╣`,
    row("🔩 CPU       :", `${cpuCount} nhân | Load ${cpuLoad.toFixed(2)}`),
    row("   [CPU]     :", `[${buildBar(cpuPct)}] ${cpuPct}%`),
    row("💾 RAM       :", `${usedMem.toFixed(0)}MB / ${totalMem.toFixed(0)}MB`),
    row("   [RAM]     :", `[${buildBar(ramPct)}] ${ramPct}%`),
    row("🔋 RAM trống :", `${(freeMem / 1024).toFixed(2)} GB`),
    `╠${line}╣`,
    row("🔧 Node.js   :", nodeVer),
    row("⚙️  Prefix    :", prefix),
    row("📦 Lệnh      :", `${cmdCount} lệnh`),
    row("🛠️  Trạng thái:", "Đang chạy ổn định ✅"),
    row("🖥️  Hệ điều hành:", platform),
    `╚${line}╝`,
  ].join("\n");
}

function ensureImage() {
  try {
    if (!fs.existsSync(IMG_PATH) && fs.existsSync(SRC_IMG)) {
      const dir = path.dirname(IMG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(SRC_IMG, IMG_PATH);
    }
    return fs.existsSync(IMG_PATH) ? IMG_PATH : (fs.existsSync(SRC_IMG) ? SRC_IMG : null);
  } catch {
    return fs.existsSync(SRC_IMG) ? SRC_IMG : null;
  }
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

    const info    = getSystemInfo();
    const imgFile = ensureImage();

    if (!imgFile) {
      return send(info);
    }

    try {
      const uploaded = await api.uploadAttachment([imgFile], threadID, event.type);
      const fileUrl  = uploaded?.[0]?.fileUrl;

      if (fileUrl) {
        await api.sendImage({
          imageUrl: fileUrl,
          msg:      info,
          ttl:      500_000,
        }, threadID, event.type);
      } else {
        await send(info);
      }
    } catch {
      try {
        await send({ body: info, attachment: fs.createReadStream(imgFile) });
      } catch {
        await send(info);
      }
    }
  },
};

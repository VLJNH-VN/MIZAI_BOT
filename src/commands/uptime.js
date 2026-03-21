"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { execSync } = require("child_process");

const ROOT      = process.cwd();
const VIDEO_DIR = path.join(ROOT, "includes", "cache", "videos");

function getVideoMeta(filePath) {
  try {
    const out  = execSync(`ffprobe -v error -show_format -show_streams -of json "${filePath}"`, { timeout: 15000 }).toString();
    const data = JSON.parse(out);
    const vs   = data.streams?.find(s => s.codec_type === "video");
    const dur  = parseFloat(data.format?.duration || 0);
    return { width: vs?.width || 720, height: vs?.height || 1280, duration: dur > 0 ? Math.max(1, Math.ceil(dur)) : 1 };
  } catch { return { width: 720, height: 1280, duration: 1 }; }
}

const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm"]);

function getRandomVideo() {
  if (!fs.existsSync(VIDEO_DIR)) return null;
  const files = fs.readdirSync(VIDEO_DIR)
    .filter(f => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
    .map(f => path.join(VIDEO_DIR, f))
    .filter(f => { try { return fs.statSync(f).size > 0; } catch { return false; } });
  return files.length ? files[Math.floor(Math.random() * files.length)] : null;
}

function getSystemInfo() {
  const uptime = process.uptime();
  const d  = Math.floor(uptime / 86400);
  const h  = Math.floor((uptime % 86400) / 3600);
  const m  = Math.floor((uptime % 3600) / 60);
  const s  = Math.floor(uptime % 60);
  const pad = n => String(n).padStart(2, "0");
  const uptimeStr = d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s` : `${pad(h)}h ${pad(m)}m ${pad(s)}s`;

  const totalMem = os.totalmem() / (1024 * 1024);
  const freeMem  = os.freemem()  / (1024 * 1024);
  const usedMem  = totalMem - freeMem;
  const cpuLoad  = os.loadavg()[0];
  const vnTime   = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });

  return (
    `🚀 Hệ thống bot:\n` +
    `⏰ Hiện tại: ${vnTime}\n` +
    `⏳ Hoạt động: ${uptimeStr}\n` +
    `⚙️ Prefix: ${global.prefix || global.config?.PREFIX || "."}\n` +
    `📦 Số lệnh: ${global.commands?.size || 0}\n` +
    `🛠️ Trạng thái: Đang chạy ổn định\n` +
    `🖥️ Hệ điều hành: ${os.type()} ${os.release()} (${os.arch()})\n` +
    `🔩 CPU: ${os.cpus().length} nhân | Load: ${cpuLoad.toFixed(2)}%\n` +
    `💾 RAM: ${usedMem.toFixed(0)}MB / ${totalMem.toFixed(0)}MB\n` +
    `🔋 RAM trống: ${(freeMem / 1024).toFixed(2)}GB\n` +
    `🔧 Node.js: ${process.version}`
  );
}

module.exports = {
  config: {
    name:            "uptime",
    aliases:         ["ping"],
    version:         "1.2.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Xem thời gian hoạt động, thông tin hệ thống và đo độ trễ",
    commandCategory: "Hệ Thống",
    usages:          "uptime | ping",
    cooldowns:       5,
  },

  run: async ({ api, event, send, threadID, commandName }) => {
    // ── Ping mode ────────────────────────────────────────────────────────────
    if (commandName === "ping") {
      const start = Date.now();
      await send("🏓 Pong!");
      const latency = Date.now() - start;
      return send(`⏱ Độ trễ: ${latency}ms`);
    }

    // ── Uptime / system info ─────────────────────────────────────────────────
    const info      = getSystemInfo();
    const videoPath = getRandomVideo();

    if (!videoPath) {
      return send(info);
    }

    try {
      await send(info);
      const meta     = getVideoMeta(videoPath);
      const uploaded = await api.uploadAttachment([videoPath], threadID, event.type);
      const fileUrl  = uploaded?.[0]?.fileUrl;
      if (fileUrl) {
        await api.sendVideo({
          videoUrl:     fileUrl,
          thumbnailUrl: "",
          msg:          "",
          width:        meta.width    || 1280,
          height:       meta.height   || 720,
          duration:     Math.max(1000, (meta.duration || 1) * 1000),
          ttl:          500_000,
        }, threadID, event.type);
      }
    } catch (err) {
      logError?.(`[uptime] video lỗi: ${err?.message || err}`);
    }
  },
};

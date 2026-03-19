"use strict";

/**
 * src/commands/uptime.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Xem thời gian hoạt động + thông số hệ thống.
 * Nếu có video trong includes/cache/videos/ sẽ gửi kèm video ngẫu nhiên.
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");

const { sendVideo, getVideoMeta } = require("../../utils/media/media");

const ROOT      = process.cwd();
const VIDEO_DIR = path.join(ROOT, "includes", "cache", "videos");
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
  const uptime  = process.uptime();
  const d  = Math.floor(uptime / 86400);
  const h  = Math.floor((uptime % 86400) / 3600);
  const m  = Math.floor((uptime % 3600) / 60);
  const s  = Math.floor(uptime % 60);
  const pad = (n) => String(n).padStart(2, "0");
  const uptimeStr = d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s` : `${pad(h)}h ${pad(m)}m ${pad(s)}s`;

  const totalMem = os.totalmem() / (1024 * 1024);
  const freeMem  = os.freemem()  / (1024 * 1024);
  const usedMem  = totalMem - freeMem;
  const cpuLoad  = os.loadavg()[0];

  const now = new Date();
  const vnTime = now.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });

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

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name:            "uptime",
    version:         "1.1.0",
    hasPermssion:    0,
    credits:         "Nguyễn Trương Thiện Phát (converted MiZai)",
    description:     "Xem thời gian hoạt động và thông tin hệ thống",
    commandCategory: "Hệ Thống",
    usages:          "uptime",
    cooldowns:       5,
  },

  run: async ({ api, event, send, threadID }) => {
    const info      = getSystemInfo();
    const videoPath = getRandomVideo();

    if (!videoPath) {
      return send(info);
    }

    try {
      await send(info);
      const meta = getVideoMeta(videoPath);
      await sendVideo(api, videoPath, threadID, event.type, {
        width:    meta.width    || 1280,
        height:   meta.height   || 720,
        duration: meta.duration || 0,
        msg:      "",
      });
    } catch (err) {
      global.logError?.(`[uptime] video lỗi: ${err?.message || err}`);
    }
  },
};

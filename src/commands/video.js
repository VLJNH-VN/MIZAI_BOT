"use strict";

/**
 * src/commands/video.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Gửi video ngẫu nhiên từ thư mục includes/cache/videos/ (đã tải về local).
 *
 * Lệnh:
 *   video          — Gửi video ngẫu nhiên
 *   video <số>     — Gửi video theo số thứ tự
 */

const fs   = require("fs");
const path = require("path");

const { sendVideo, getVideoMeta } = require("../../utils/media/media");

const ROOT      = process.cwd();
const VIDEO_DIR = path.join(ROOT, "includes", "cache", "videos");

const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".flv"]);

// ─────────────────────────────────────────────────────────────────────────────
// Lấy danh sách video có sẵn trong thư mục
// ─────────────────────────────────────────────────────────────────────────────
function getAvailableVideos() {
  if (!fs.existsSync(VIDEO_DIR)) return [];

  return fs.readdirSync(VIDEO_DIR)
    .filter(f => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
    .map(f => path.join(VIDEO_DIR, f))
    .filter(f => {
      try { return fs.statSync(f).size > 0; } catch { return false; }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Export lệnh
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  config: {
    name:            "video",
    aliases:         ["vid"],
    version:         "1.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Gửi video ngẫu nhiên từ kho video đã tải về",
    commandCategory: "Giải Trí",
    usages: [
      "video          — Gửi video ngẫu nhiên",
      "video <số>     — Gửi video theo STT",
    ].join("\n"),
    cooldowns: 10,
  },

  run: async ({ api, event, args, send, threadID }) => {
    const videos = getAvailableVideos();

    if (videos.length === 0) {
      return send(
        "📭 Chưa có video nào trong kho.\n" +
        "Hãy tải video về trước vào thư mục includes/cache/videos/"
      );
    }

    // Chọn theo số thứ tự hoặc ngẫu nhiên
    let filePath;
    const num = parseInt(args[0]);
    if (!isNaN(num) && num >= 1 && num <= videos.length) {
      filePath = videos[num - 1];
    } else {
      filePath = videos[Math.floor(Math.random() * videos.length)];
    }

    await send(`⏳ Đang gửi video... (${path.basename(filePath)})`);

    try {
      const meta = getVideoMeta(filePath);
      await sendVideo(api, filePath, threadID, event.type, {
        width:    meta.width    || 1280,
        height:   meta.height   || 720,
        duration: meta.duration || 0,
        msg:      "",
      });
    } catch (err) {
      global.logError?.(`[video] ${err?.message || err}`);
      return send("❌ Lỗi khi gửi video:\n" + (err?.message || "Lỗi không xác định"));
    }
  },
};

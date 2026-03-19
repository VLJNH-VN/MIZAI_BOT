"use strict";

/**
 * src/commands/video.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Gửi video ngẫu nhiên từ global.mediaCache (filecache local đã giải mã).
 *
 * Lệnh:
 *   video          — Gửi video ngẫu nhiên từ cache
 *   video <số>     — Gửi video theo số thứ tự trong cache
 */

const fs   = require("fs");
const path = require("path");

const { sendVideo } = require("../../utils/media/media");

const ROOT = process.cwd();

// ─────────────────────────────────────────────────────────────────────────────
// Gửi video từ cached file lên Zalo
// ─────────────────────────────────────────────────────────────────────────────
async function sendCachedVideo(api, entry, threadID, type) {
  const fullPath = path.join(ROOT, entry.cachedPath);

  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).size === 0) {
    throw new Error(`File cache không tồn tại hoặc rỗng: ${entry.cachedPath}`);
  }

  await sendVideo(api, fullPath, threadID, type, {
    width:    entry.width    || 1280,
    height:   entry.height   || 720,
    duration: entry.duration || 0,
    msg:      "",
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
    description:     "Gửi video ngẫu nhiên từ filecache (global.mediaCache)",
    commandCategory: "Giải Trí",
    usages: [
      "video          — Gửi video ngẫu nhiên",
      "video <số>     — Gửi video theo STT",
    ].join("\n"),
    cooldowns: 10,
  },

  run: async ({ api, event, args, send, threadID }) => {
    const index = global.mediaCache.loadIndex();

    if (!index || index.length === 0) {
      return send(
        "📭 Cache trống.\n" +
        "Dùng \"datat decode\" để giải mã video từ GitHub."
      );
    }

    // Lọc chỉ video có file sẵn trên disk
    const available = index.filter(e => {
      if (!e.isVideo) return false;
      const full = path.join(ROOT, e.cachedPath);
      return fs.existsSync(full) && fs.statSync(full).size > 0;
    });

    if (available.length === 0) {
      return send(
        `⚠️ Cache có ${index.length} entry nhưng không có video nào sẵn sàng.\n` +
        `Dùng "datat decode" để giải mã.`
      );
    }

    // Chọn theo số thứ tự hoặc ngẫu nhiên
    let item;
    const num = parseInt(args[0]);
    if (!isNaN(num) && num >= 1 && num <= available.length) {
      item = available[num - 1];
    } else {
      item = available[Math.floor(Math.random() * available.length)];
    }

    await send("⏳ Đang chuẩn bị video...");

    try {
      await sendCachedVideo(api, item, threadID, event.type);
    } catch (err) {
      global.logError?.(`[video] ${err?.message || err}`);
      return send("❌ Lỗi khi gửi video:\n" + (err?.message || "Lỗi không xác định"));
    }
  },
};

"use strict";

/**
 * src/commands/datat.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Gửi video ngẫu nhiên từ kho đã giải mã (filecache local).
 * Video được lấy từ includes/data/dataCache.json (đã decode từ GitHub base64).
 *
 * Lệnh:
 *   datat           — Gửi video ngẫu nhiên từ cache
 *   datat status    — Xem trạng thái cache
 *   datat decode    — Giải mã các entry mới từ GitHub vào cache (chạy nền)
 *   datat <số>      — Gửi video theo số thứ tự trong cache
 */

const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const FormData = require("form-data");

const { loadIndex, pickRandom, processAll, VIDEO_DIR } = require("../../utils/media/mediaCache");

const ROOT      = process.cwd();
const TEMP_DIR  = path.join(ROOT, "includes", "cache", "temp");
const THUMB_DIR = path.join(ROOT, "includes", "cache", "thumbs");

// Theo dõi tiến trình decode đang chạy
let _decoding = false;

// ─────────────────────────────────────────────────────────────────────────────
// Upload thumbnail lên Catbox → URL công khai (cho Zalo sendVideo)
// ─────────────────────────────────────────────────────────────────────────────
async function uploadThumb(thumbName) {
  if (!thumbName) return "";
  const thumbPath = path.join(THUMB_DIR, thumbName);
  if (!fs.existsSync(thumbPath)) return "";

  try {
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", fs.createReadStream(thumbPath), {
      filename: "thumb.jpg",
      contentType: "image/jpeg",
    });
    const res = await global.axios.post("https://catbox.moe/user/api.php", form, {
      headers: form.getHeaders(),
      timeout: 20000,
    });
    const url = typeof res.data === "string" ? res.data.trim() : "";
    return url.startsWith("https://") ? url : "";
  } catch (_) {
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extract thumbnail trực tiếp từ video (fallback khi không có .bin)
// ─────────────────────────────────────────────────────────────────────────────
async function extractThumbFromVideo(videoPath) {
  const tmpPath = path.join(TEMP_DIR, `thumb_datat_${Date.now()}.jpg`);
  try {
    execSync(
      `ffmpeg -y -i "${videoPath}" -ss 0 -vframes 1 -q:v 5 "${tmpPath}"`,
      { stdio: "pipe", timeout: 15000 }
    );
    if (!fs.existsSync(tmpPath)) return "";

    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", fs.createReadStream(tmpPath), {
      filename: "thumb.jpg",
      contentType: "image/jpeg",
    });
    const res = await global.axios.post("https://catbox.moe/user/api.php", form, {
      headers: form.getHeaders(),
      timeout: 20000,
    });
    const url = typeof res.data === "string" ? res.data.trim() : "";
    return url.startsWith("https://") ? url : "";
  } catch (_) {
    return "";
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gửi video từ cached file lên Zalo
// ─────────────────────────────────────────────────────────────────────────────
async function sendCachedVideo(api, entry, threadID, type) {
  const fullPath = path.join(ROOT, entry.cachedPath);

  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).size === 0) {
    throw new Error(`File cache không tồn tại hoặc rỗng: ${entry.cachedPath}`);
  }

  // Upload lên Zalo CDN
  const uploads = await global.upload(fullPath, threadID, type);
  if (!uploads || !uploads[0]?.fileUrl) {
    throw new Error("Upload không trả về fileUrl");
  }

  const { fileUrl, fileName, totalSize } = uploads[0];
  const videoUrl = fileName ? `${fileUrl}/${fileName}` : fileUrl;

  // Lấy thumbnail
  let thumbUrl = "";
  if (entry.thumbnail) {
    thumbUrl = await uploadThumb(entry.thumbnail);
  }
  if (!thumbUrl) {
    thumbUrl = await extractThumbFromVideo(fullPath);
  }

  await api.sendVideo(
    {
      videoUrl,
      thumbnailUrl: thumbUrl,
      duration:     (entry.duration || 0) * 1000,
      width:        entry.width    || 1280,
      height:       entry.height   || 720,
      msg:          "",
      fileSize:     totalSize || 0,
    },
    threadID,
    type
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Export lệnh
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  config: {
    name:            "datat",
    aliases:         ["dt"],
    version:         "1.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Gửi video ngẫu nhiên từ kho GitHub đã giải mã về filecache",
    commandCategory: "Giải Trí",
    usages: [
      "datat          — Gửi video ngẫu nhiên",
      "datat <số>     — Gửi video theo STT",
      "datat status   — Xem trạng thái cache",
      "datat decode   — Giải mã entry mới từ GitHub (nền)",
    ].join("\n"),
    cooldowns: 10,
  },

  run: async ({ api, event, args, send, threadID }) => {
    const sub = (args[0] || "").toLowerCase().trim();

    // ── datat status ─────────────────────────────────────────────────────────
    if (sub === "status") {
      const index = loadIndex();

      let onDisk   = 0;
      let missDisk = 0;
      let videos   = 0;

      for (const e of index) {
        const full = path.join(ROOT, e.cachedPath);
        if (fs.existsSync(full) && fs.statSync(full).size > 0) {
          onDisk++;
          if (e.isVideo) videos++;
        } else {
          missDisk++;
        }
      }

      return send(
        `📦 TRẠNG THÁI FILECACHE\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `📝 Tổng index      : ${index.length} entry\n` +
        `✅ Có file trên disk: ${onDisk}\n` +
        `🎬 Trong đó video  : ${videos}\n` +
        `⚠️ Thiếu file      : ${missDisk}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `💡 Dùng "datat decode" để giải mã entry mới`
      );
    }

    // ── datat decode ─────────────────────────────────────────────────────────
    if (sub === "decode") {
      if (_decoding) {
        return send("⚠️ Đang decode rồi! Dùng \"datat status\" để theo dõi.");
      }

      const index  = loadIndex();
      const links  = (() => {
        try {
          const p = path.join(ROOT, "includes", "data", "githubMediaLinks.json");
          return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
        } catch (_) { return {}; }
      })();
      const cached = new Set(index.map(e => e.key));
      const pending = Object.keys(links).filter(k => !cached.has(k));

      if (pending.length === 0) {
        return send(`✅ Không có entry mới cần giải mã. Cache: ${index.length} file.`);
      }

      await send(
        `🚀 Bắt đầu giải mã ${pending.length} entry mới từ GitHub...\n` +
        `💬 Dùng "datat status" để theo dõi tiến độ.`
      );

      _decoding = true;

      processAll({
        onLog: (msg) => global.logInfo?.(`[datat decode] ${msg}`),
        onProgress: ({ done, total }) => {
          global.logInfo?.(`[datat decode] ${done}/${total}`);
        },
      })
        .then(({ success, fail, saved }) => {
          _decoding = false;
          global.logInfo?.(`[datat decode] ✅ Xong: ${success} ok | ${fail} lỗi | ${saved} file cache`);
        })
        .catch(err => {
          _decoding = false;
          global.logError?.(`[datat decode] Lỗi: ${err?.message || err}`);
        });

      return;
    }

    // ── datat <số> hoặc datat (ngẫu nhiên) ───────────────────────────────────
    const index = loadIndex();

    if (index.length === 0) {
      return send(
        "📭 Cache trống.\n" +
        "Chạy \"datat decode\" để giải mã từ GitHub, hoặc \"node getdata.js\" trên CLI."
      );
    }

    // Lọc chỉ video có file trên disk
    const available = index.filter(e => {
      if (!e.isVideo) return false;
      const full = path.join(ROOT, e.cachedPath);
      return fs.existsSync(full) && fs.statSync(full).size > 0;
    });

    if (available.length === 0) {
      return send(
        `⚠️ Cache có ${index.length} entry nhưng không có video nào sẵn sàng.\n` +
        `Chạy "datat decode" để giải mã.`
      );
    }

    // Chọn theo số hoặc ngẫu nhiên
    let item;
    const num = parseInt(args[0]);
    if (!isNaN(num) && num >= 1 && num <= available.length) {
      item = available[num - 1];
    } else {
      item = available[Math.floor(Math.random() * available.length)];
    }

    await send("⏳ Đang chuẩn bị video...");

    fs.mkdirSync(TEMP_DIR, { recursive: true });

    try {
      await sendCachedVideo(api, item, threadID, event.type);
    } catch (err) {
      global.logError?.(`[datat] ${err?.message || err}`);
      return send("❌ Lỗi khi gửi video:\n" + (err?.message || "Lỗi không xác định"));
    }
  },
};

/**
 * src/commands/media.js
 * Gộp: getlink + sendmedia
 */

const path          = require("path");
const os            = require("os");
const fs            = require("fs");
const axios         = require("axios");
const { Transform } = require("stream");

// Giới hạn tốc độ tải video: 1MB/s (phù hợp hosting Node 24 RAM thấp)
const DOWNLOAD_SPEED_LIMIT = 1 * 1024 * 1024;

function createThrottle(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return null;
  let lastTime = Date.now();
  let accumulated = 0;
  return new Transform({
    transform(chunk, _enc, callback) {
      accumulated += chunk.length;
      const elapsed  = (Date.now() - lastTime) / 1000;
      const expected = accumulated / bytesPerSec;
      const delay    = Math.max(0, (expected - elapsed) * 1000);
      if (delay > 0) setTimeout(() => { this.push(chunk); callback(); }, delay);
      else           { this.push(chunk); callback(); }
    },
  });
}

module.exports = {
  config: {
    name:            "media",
    aliases:         ["getlink", "sm", "sendlink", "sendvideo", "sendmedia"],
    version:         "1.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Lấy link download media hoặc gửi link/video",
    commandCategory: "Tiện Ích",
    usages: [
      "media getlink | parse <url>   — Lấy URL download / phân tích link",
      "media link|video <url>         — Gửi link preview / video từ URL",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ api, event, args, send, threadID, prefix, commandName }) => {
    const FLAG_MAP = { getlink: "getlink", sm: "link", sendlink: "link", sendvideo: "video", sendmedia: null };
    let sub = FLAG_MAP[commandName] !== undefined ? FLAG_MAP[commandName] : (args[0] || "").toLowerCase();
    let subArgs = (FLAG_MAP[commandName] !== undefined && commandName !== "sendmedia") ? args : args.slice(1);

    // sendmedia alias → use first arg as sub
    if (commandName === "sendmedia") {
      sub = (args[0] || "").toLowerCase();
      subArgs = args.slice(1);
    }

    if (!sub) {
      return send(
        `📨 MEDIA — XỬ LÝ NỘI DUNG\n━━━━━━━━━━━━━━━━\n` +
        `${prefix}media getlink         Lấy link download (reply vào media)\n` +
        `${prefix}media link <url>      Gửi link preview\n` +
        `${prefix}media video <url>     Gửi video\n` +
        `${prefix}media parse <url>     Phân tích link`
      );
    }

    // ── Lấy link download ─────────────────────────────────────────────────────
    if (sub === "getlink" || sub === "gl") {
      const raw = event?.data || {};
      const ctx = await global.resolveQuote({ raw, api, threadId: threadID, event });

      if (!ctx || !ctx.isMedia) {
        return send(
          "❎ Hãy reply vào một tin nhắn có ảnh, video hoặc audio!" +
          (ctx?.isText ? "\n💬 Tin nhắn được reply là text, không phải media." : "")
        );
      }

      const attachments = ctx.attach?.length > 0 ? ctx.attach : [{ url: ctx.mediaUrl }];
      const urls = attachments
        .map((a, i) => {
          const url = a.url || a.normalUrl || a.hdUrl || a.href || a.fileUrl || a.downloadUrl;
          return url ? `${i + 1}. ${url}` : null;
        })
        .filter(Boolean);

      if (!urls.length) return send("❎ Không tìm thấy URL nào trong media được reply.");
      return send(`🔗 Có ${urls.length} tệp đính kèm:\n` + urls.join("\n"));
    }

    // ── Các sub cần URL ───────────────────────────────────────────────────────
    const url = subArgs[0];
    if (!url) return send(`❌ Thiếu URL. Ví dụ: ${prefix}media ${sub} https://example.com`);
    if (!url.startsWith("http")) return send("❌ URL phải bắt đầu bằng http:// hoặc https://");

    try {
      switch (sub) {
        case "link": {
          await api.sendLink({ url, ttl: 0 }, threadID, event.type);
          return send(`✅ Đã gửi link: ${url}`);
        }

        case "video": {
          try { await api.addReaction("⏳", { type: event.type, threadId: event.threadId, data: event.data }); } catch (_r) {}
          const tmpPath = path.join(os.tmpdir(), `video_${Date.now()}.mp4`);
          const res = await axios.get(url, { responseType: "stream", timeout: 180000, headers: { "User-Agent": "Mozilla/5.0" } });
          await new Promise((resolve, reject) => {
            const writer   = fs.createWriteStream(tmpPath);
            const throttle = createThrottle(DOWNLOAD_SPEED_LIMIT);
            if (throttle) res.data.pipe(throttle).pipe(writer);
            else          res.data.pipe(writer);
            writer.on("finish", resolve);
            writer.on("error", reject);
            res.data.on("error", reject);
            if (throttle) throttle.on("error", reject);
          });
          await api.sendVideo({ videoPath: tmpPath }, threadID, event.type);
          try { fs.unlinkSync(tmpPath); } catch {}
          return;
        }

        case "parse": {
          const info = await api.parseLink(url);
          if (!info) return send("❌ Không phân tích được link này.");
          const title  = info.title || info.name || "Không có tiêu đề";
          const desc   = info.description || info.desc || "Không có mô tả";
          const domain = info.domain || new URL(url).hostname;
          return send(
            `🔗 PHÂN TÍCH LINK\n━━━━━━━━━━━━━━━━\n` +
            `📌 Tiêu đề: ${title}\n` +
            `📝 Mô tả: ${desc.slice(0, 150)}\n` +
            `🌐 Domain: ${domain}\n` +
            `🔗 URL: ${url}`
          );
        }

        default:
          return send(`❌ Lệnh không hợp lệ. Dùng: ${prefix}media để xem hướng dẫn.`);
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Lỗi không xác định";
      return send(`❌ Lỗi: ${msg}`);
    }
  },
};

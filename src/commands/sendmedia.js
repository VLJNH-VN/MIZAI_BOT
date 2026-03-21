const { ThreadType } = require("zca-js");
const path = require("path");
const os = require("os");
const fs = require("fs");
const axios = require("axios");

module.exports = {
  config: {
    name: "sendmedia",
    aliases: ["sm", "sendlink", "sendvideo"],
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MIZAI",
    description: "Gửi link preview, video, hoặc phân tích link",
    commandCategory: "Tiện Ích",
    usages: [
      "sendmedia link <url>     — Gửi link với preview đẹp",
      "sendmedia video <url>    — Gửi video từ URL",
      "sendmedia parse <url>    — Phân tích thông tin link",
    ].join("\n"),
    cooldowns: 10,
  },

  run: async ({ api, event, args, send, threadID, prefix }) => {
    const sub = (args[0] || "").toLowerCase();
    const url = args[1];

    if (!sub || !url) {
      return send(
        `📨 SENDMEDIA — GỬI NỘI DUNG\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${prefix}sendmedia link <url>   Gửi link preview\n` +
        `${prefix}sendmedia video <url>  Gửi video\n` +
        `${prefix}sendmedia parse <url>  Phân tích link`
      );
    }

    if (!url.startsWith("http")) {
      return send("❌ URL phải bắt đầu bằng http:// hoặc https://");
    }

    try {
      switch (sub) {

        case "link": {
          await api.sendLink({ url, ttl: 0 }, threadID, event.type);
          return send(`✅ Đã gửi link: ${url}`);
        }
        case "video": {
          await send(`⏳ Đang tải video từ:\n${url}`);
          const tmpPath = path.join(os.tmpdir(), `video_${Date.now()}.mp4`);
          const res = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 120000,
            headers: { "User-Agent": "Mozilla/5.0" },
          });
          fs.writeFileSync(tmpPath, Buffer.from(res.data));
          await api.sendVideo({ videoPath: tmpPath }, threadID, event.type);
          try { fs.unlinkSync(tmpPath); } catch {}
          break;
        }

        case "parse": {
          const info = await api.parseLink(url);
          if (!info) return send("❌ Không phân tích được link này.");
          const title = info.title || info.name || "Không có tiêu đề";
          const desc = info.description || info.desc || "Không có mô tả";
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
          return send(`❌ Lệnh không hợp lệ. Dùng: ${prefix}sendmedia để xem hướng dẫn.`);
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Lỗi không xác định";
      return send(`❌ Lỗi: ${msg}`);
    }
  },
};

const { execSync } = require("child_process");
const { sendVideo, tempDir } = require("../../utils/media/upload");
const axios = require("axios");
const fs    = require("fs");
const path  = require("path");

// ── Trích URL từ quote/replyMsg (ZCA-JS) ─────────────────────────────────────
const VIDEO_URL_REGEX = /https?:\/\/[^\s"']+\.(?:mp4|mov|mkv|webm|flv)[^\s"']*/gi;
const ANY_URL_REGEX   = /https?:\/\/[^\s"']+/g;

function extractUrlFromQuote(raw) {
  const quote = raw?.quote || raw?.replyMsg || null;
  if (!quote) return null;

  const candidates = [
    quote.href, quote.url, quote.urlVid, quote.urlFile,
    quote.normalUrl, quote.hdUrl, quote.videoUrl, quote.urlOrigin,
    quote.content?.href, quote.content?.url, quote.content?.urlVid,
    quote.content?.normalUrl, quote.content?.hdUrl, quote.content?.videoUrl,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.startsWith("http")) return c;
  }

  const text = typeof quote.content === "string"
    ? quote.content
    : (quote.content?.text || quote.content?.msg || "");

  if (text) {
    const vidMatch = text.match(VIDEO_URL_REGEX);
    if (vidMatch?.length) return vidMatch[0];
    const anyMatch = text.match(ANY_URL_REGEX);
    if (anyMatch?.length) return anyMatch[0];
  }

  for (const val of Object.values(quote)) {
    if (typeof val === "string" && val.startsWith("http")) return val;
    if (val && typeof val === "object") {
      for (const nested of Object.values(val)) {
        if (typeof nested === "string" && nested.startsWith("http")) return nested;
      }
    }
  }

  return null;
}

// ── Lấy metadata video (width, height, duration) ─────────────────────────────
function getVideoMeta(filePath) {
  try {
    const out = execSync(
      `ffprobe -v error -show_streams -show_format -of json "${filePath}"`,
      { timeout: 15000, stdio: "pipe" }
    ).toString();
    const data = JSON.parse(out);
    const vs = data.streams?.find(s => s.codec_type === "video");
    return {
      width:    vs?.width    || 1280,
      height:   vs?.height   || 720,
      duration: Math.round(parseFloat(data.format?.duration || 0)) * 1000,
    };
  } catch {
    return { width: 1280, height: 720, duration: 0 };
  }
}

// ── Tải video trực tiếp (mp4 raw link) ───────────────────────────────────────
async function downloadDirect(url, outPath) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 60000,
    maxContentLength: 500 * 1024 * 1024,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  fs.writeFileSync(outPath, Buffer.from(res.data));
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name: "vd",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Tải & gửi video từ link mp4 trực tiếp",
    commandCategory: "Utility",
    usages: ".vd <url mp4>  hoặc  Reply vào tin nhắn có link → .vd",
    cooldowns: 20,
  },

  run: async ({ api, event, args, send, threadID }) => {
    const raw = event?.data || {};

    // ── Bước 1: Xác định URL ──────────────────────────────────────────────────
    let url = null;
    if (args[0] && args[0].startsWith("http")) {
      url = args[0];
    } else {
      url = extractUrlFromQuote(raw);
    }

    if (!url) {
      return send(
        "📹 Cách dùng:\n" +
        "1. .vd <link mp4 trực tiếp>\n" +
        "2. Reply vào tin nhắn chứa link → .vd\n\n" +
        "Hỗ trợ: link .mp4 trực tiếp, Zalo CDN, v.v."
      );
    }

    await send("⏳ Đang tải video...");

    fs.mkdirSync(tempDir, { recursive: true });
    const tmpPath = path.join(tempDir, `vd_${Date.now()}.mp4`);

    try {
      logInfo?.(`[vd] direct download: ${url}`);
      try {
        await downloadDirect(url, tmpPath);
      } catch (err) {
        return send(
          "❌ Không tải được link này:\n" + (err?.message || err) +
          "\n\n💡 Thử cung cấp link download trực tiếp (.mp4)"
        );
      }

      if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) {
        return send("❌ Tải xong nhưng file rỗng. Link có thể không hợp lệ.");
      }

      const meta = getVideoMeta(tmpPath);
      logInfo?.(`[vd] Gửi video: ${path.basename(tmpPath)} | ${meta.width}x${meta.height} | ${meta.duration}ms`);

      await sendVideo(api, tmpPath, threadID, event.type, { ...meta, msg: "" });

    } catch (err) {
      logError?.(`[vd] ${err?.message || err}`);
      return send("❌ Lỗi khi gửi video:\n" + (err?.message || "Lỗi không xác định"));
    } finally {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    }
  },
};

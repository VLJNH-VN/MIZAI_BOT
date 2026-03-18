const axios    = require("axios");
const FormData = require("form-data");
const NodeCache = require("node-cache");
const fs   = require("fs");
const path = require("path");

const AUDD_API_KEY = "7e60513b4c9734b5f48b33d4e5d76c67";
const cache = new NodeCache({ stdTTL: 3600 });

// ── Trích URL media từ quote (hỗ trợ quote & replyMsg của ZCA-JS) ─────────────
const MEDIA_URL_REGEX = /https?:\/\/[^\s"']+\.(?:mp4|mp3|m4a|ogg|webm|wav|aac|flv|mkv|mov|ts)(?:[?#][^\s"']*)?/gi;
const ZALO_CDN_REGEX  = /https?:\/\/[^\s"']*(?:zdn\.vn|zadn\.vn|zaloapp\.com|zalopay\.vn)[^\s"']*/g;
const ANY_URL_REGEX   = /https?:\/\/[^\s"']+/g;

function extractMediaUrl(quote) {
  if (!quote) return null;

  const fieldCandidates = [
    quote.href,
    quote.url,
    quote.urlFile,
    quote.urlVid,
    quote.normalUrl,
    quote.hdUrl,
    quote.videoUrl,
    quote.urlOrigin,
    quote.content?.href,
    quote.content?.url,
    quote.content?.link,
    quote.content?.urlFile,
    quote.content?.urlVid,
    quote.content?.src,
    quote.content?.normalUrl,
    quote.content?.hdUrl,
    quote.content?.videoUrl,
    quote.content?.urlOrigin,
  ];
  for (const c of fieldCandidates) {
    if (typeof c === "string" && c.startsWith("http")) return c;
  }

  const text = typeof quote.content === "string"
    ? quote.content
    : (typeof quote.content?.text === "string" ? quote.content.text
      : typeof quote.content?.msg === "string" ? quote.content.msg : "");

  if (text) {
    const mediaMatches = text.match(MEDIA_URL_REGEX);
    if (mediaMatches?.length) return mediaMatches[0];

    const zaloMatches = text.match(ZALO_CDN_REGEX);
    if (zaloMatches?.length) return zaloMatches[0];

    const anyMatches = text.match(ANY_URL_REGEX);
    if (anyMatches?.length) return anyMatches[0];
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

// ── Tải file trực tiếp → Buffer ──────────────────────────────────────────────
async function downloadBuffer(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    maxContentLength: 100 * 1024 * 1024,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  return Buffer.from(res.data);
}

// ── Upload buffer lên Catbox.moe ─────────────────────────────────────────────
async function uploadToCatbox(buffer, filename = "audio.mp3") {
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("fileToUpload", buffer, { filename });

  const res = await axios.post("https://catbox.moe/user/api.php", form, {
    headers: form.getHeaders(),
    timeout: 60000,
    responseType: "text",
  });

  const link = (res.data || "").trim();
  if (!link.startsWith("http")) throw new Error("Catbox trả về không hợp lệ: " + link);
  return link;
}

// ── Nhận diện qua audd.io ────────────────────────────────────────────────────
async function recognizeFromUrl(publicUrl) {
  const form = new FormData();
  form.append("api_token", AUDD_API_KEY);
  form.append("url", publicUrl);
  form.append("return", "spotify,apple_music");

  const res = await axios.post("https://api.audd.io/", form, {
    headers: form.getHeaders(),
    timeout: 25000,
  });
  return res.data;
}

// ── Trích URL ảnh bìa ────────────────────────────────────────────────────────
function extractCoverUrl(result) {
  try {
    const appleArtwork = result?.apple_music?.artwork?.url;
    if (typeof appleArtwork === "string")
      return appleArtwork.replace("{w}", "500").replace("{h}", "500");
  } catch {}
  try {
    const imgs = result?.spotify?.album?.images;
    if (Array.isArray(imgs) && imgs.length) return imgs[0].url;
  } catch {}
  return null;
}

// ── Phát hiện extension từ URL ───────────────────────────────────────────────
function guessExt(url) {
  const clean = url.split("?")[0].split("#")[0];
  const m = clean.match(/\.(mp4|mp3|m4a|ogg|webm|wav|aac|flv|mkv|mov|ts)$/i);
  return m ? m[1] : null;
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name: "timnhac",
    aliases: ["findsong", "identify"],
    version: "4.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Nhận diện bài hát từ tin nhắn audio/video hoặc link trực tiếp",
    commandCategory: "Utility",
    usages: ".timnhac <link>  hoặc  Reply vào tin nhắn audio/video → .timnhac",
    cooldowns: 15,
  },

  run: async ({ event, args, send }) => {
    const raw = event?.data || {};

    // ── Bước 1: Xác định URL media ────────────────────────────────────────────
    let mediaUrl = null;

    if (args[0] && args[0].startsWith("http")) {
      mediaUrl = args[0];
    } else {
      const quote = raw?.quote || raw?.replyMsg || null;
      mediaUrl = extractMediaUrl(quote);
    }

    if (!mediaUrl) {
      return send(
        "🎵 Cách dùng:\n" +
        "1. Reply vào tin nhắn audio/video → gõ .timnhac\n" +
        "2. Hoặc: .timnhac <link trực tiếp>\n\n" +
        "Hỗ trợ: Zalo voice, video, link audio/video trực tiếp."
      );
    }

    const cached = cache.get(mediaUrl);
    if (cached) return send("🎵 Kết quả (cache)\n━━━━━━━━━━━━━━━━\n" + cached);

    await send("⏳ Đang tải và nhận diện bài hát...");

    try {
      // ── Bước 2: Tải file về ─────────────────────────────────────────────────
      let buffer, ext;
      try {
        buffer = await downloadBuffer(mediaUrl);
        ext    = guessExt(mediaUrl) || "mp3";
        logInfo?.(`[timnhac] direct download OK, ext=${ext}, size=${buffer.length}`);
      } catch (err) {
        return send("❌ Không tải được media:\n" + (err?.message || err) + "\n\n" +
          "💡 Thử cung cấp link trực tiếp: .timnhac <url>");
      }

      // ── Bước 3: Upload lên Catbox.moe ───────────────────────────────────────
      let publicUrl;
      try {
        publicUrl = await uploadToCatbox(buffer, `audio.${ext}`);
        logInfo?.(`[timnhac] Catbox OK: ${publicUrl}`);
      } catch (err) {
        return send("❌ Upload lên server thất bại:\n" + (err?.message || err));
      }

      // ── Bước 4: Nhận diện qua audd.io ──────────────────────────────────────
      const recognition = await recognizeFromUrl(publicUrl);

      if (!recognition?.result) {
        return send(
          "❌ Không nhận diện được bài hát.\n" +
          `🔗 Media đã upload: ${publicUrl}`
        );
      }

      const r = recognition.result;
      const title    = r.title        || "Unknown";
      const artist   = r.artist       || "Unknown";
      const album    = r.album        || "Unknown";
      const year     = r.release_date || "?";
      const songLink = r.song_link    || null;
      const coverUrl = extractCoverUrl(r);

      let coverLink = null;
      if (coverUrl) {
        try { coverLink = await global.uploadImage(coverUrl); } catch {}
      }

      const lines = [
        `🎵 Kết quả nhận diện`,
        `━━━━━━━━━━━━━━━━`,
        `• Bài hát : ${title}`,
        `• Nghệ sĩ : ${artist}`,
        `• Album   : ${album}`,
        `• Năm     : ${year}`,
      ];
      if (songLink)  lines.push(`• Link    : ${songLink}`);
      if (coverLink) lines.push(`• Ảnh bìa : ${coverLink}`);
      lines.push(`━━━━━━━━━━━━━━━━`);
      lines.push(`📁 Media: ${publicUrl}`);

      const resultText = lines.join("\n");
      cache.set(mediaUrl, resultText);
      return send(resultText);

    } catch (err) {
      global.logError?.(`[timnhac] ${err?.message || err}`);
      return send("❌ Lỗi nhận diện bài hát: " + (err?.message || "Lỗi không xác định"));
    }
  },
};

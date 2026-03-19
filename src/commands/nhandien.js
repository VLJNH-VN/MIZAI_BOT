"use strict";

/**
 * src/commands/nhandien.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Nhận diện bài hát từ audio/voice message qua AudD API (https://api.audd.io)
 *
 * Cách dùng:
 *   .nhandien           — Reply vào tin nhắn audio/voice để nhận diện
 *   .nhandien <url>     — Nhận diện từ URL audio công khai
 */

const FormData = require("form-data");

const AUDD_TOKEN   = "7e60513b4c9734b5f48b33d4e5d76c67";
const AUDD_API     = "https://api.audd.io/";
const AUDD_RETURN  = "apple_music,spotify,deezer";

// ─────────────────────────────────────────────────────────────────────────────
// Tải audio từ URL → Buffer
// ─────────────────────────────────────────────────────────────────────────────
async function fetchAudioBuffer(url) {
  const res = await global.axios.get(url, {
    responseType:     "arraybuffer",
    timeout:          60_000,
    maxContentLength: 50 * 1024 * 1024,
    headers: {
      "User-Agent": global.userAgent,
    },
  });
  return Buffer.from(res.data);
}

// ─────────────────────────────────────────────────────────────────────────────
// Gọi AudD API — truyền file binary (chính xác hơn URL do Zalo có auth)
// ─────────────────────────────────────────────────────────────────────────────
async function recognizeAudio(audioBuffer, filename = "audio.mp3") {
  const form = new FormData();
  form.append("api_token", AUDD_TOKEN);
  form.append("return",    AUDD_RETURN);
  form.append("file",      audioBuffer, {
    filename,
    contentType: "audio/mpeg",
  });

  const res = await global.axios.post(AUDD_API, form, {
    headers: {
      ...form.getHeaders(),
    },
    timeout: 30_000,
  });

  return res.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Thời gian phát hành đẹp
// ─────────────────────────────────────────────────────────────────────────────
function fmtDate(str) {
  if (!str) return "Không rõ";
  try {
    const d = new Date(str);
    if (isNaN(d)) return str;
    return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch (_) {
    return str;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ghép kết quả thành chuỗi hiển thị
// ─────────────────────────────────────────────────────────────────────────────
function buildResultMsg(result) {
  let msg = `🎵 NHẬN DIỆN BÀI HÁT\n`;
  msg += `━━━━━━━━━━━━━━━━\n`;
  msg += `🎶 Tên: ${result.title || "Không rõ"}\n`;
  msg += `👤 Nghệ sĩ: ${result.artist || "Không rõ"}\n`;
  if (result.album) msg += `💿 Album: ${result.album}\n`;
  if (result.release_date) msg += `📅 Phát hành: ${fmtDate(result.release_date)}\n`;
  if (result.label) msg += `🏷️  Nhãn: ${result.label}\n`;
  if (result.timecode) msg += `⏱️  Vị trí nhận ra: ${result.timecode}\n`;
  msg += `━━━━━━━━━━━━━━━━\n`;

  // Apple Music
  const am = result.apple_music;
  if (am) {
    if (am.previews?.[0]?.url) msg += `🍎 Preview: ${am.previews[0].url}\n`;
    if (am.url) msg += `🎧 Apple Music: ${am.url}\n`;
  }

  // Spotify
  const sp = result.spotify;
  if (sp?.external_urls?.spotify) {
    msg += `💚 Spotify: ${sp.external_urls.spotify}\n`;
  }

  // Deezer
  const dz = result.deezer;
  if (dz?.link) msg += `🎵 Deezer: ${dz.link}\n`;

  // Song.link fallback
  if (result.song_link) msg += `🔗 Song.link: ${result.song_link}\n`;

  return msg.trimEnd();
}

// ─────────────────────────────────────────────────────────────────────────────
// Command
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  config: {
    name:            "nhandien",
    aliases:         ["songid", "audd", "nhandiennhac"],
    version:         "1.0.0",
    hasPermssion:    0,
    credits:         "MiZai · AudD",
    description:     "Nhận diện bài hát từ audio/voice message",
    commandCategory: "Giải Trí",
    usages:          "[reply vào audio] | <url audio>",
    cooldowns:       10,
  },

  run: async ({ api, event, args, send }) => {
    const raw      = event?.data || {};
    const threadId = event.threadId;

    let audioUrl  = null;
    let filename  = "audio.mp3";

    // ── 1. Thử lấy từ URL args ─────────────────────────────────────────────
    const argUrl = args.join(" ").trim();
    if (/^https?:\/\//i.test(argUrl)) {
      audioUrl = argUrl;
      const ext = argUrl.split("?")[0].split(".").pop().toLowerCase();
      if (["mp3","aac","m4a","ogg","wav","flac","webm","mp4"].includes(ext)) {
        filename = `audio.${ext}`;
      }
    }

    // ── 2. Thử lấy từ tin nhắn reply ──────────────────────────────────────
    if (!audioUrl) {
      const ctx = await global.resolveQuote({ raw, api, threadId, event });

      if (!ctx || !ctx.isMedia) {
        return send(
          "🎵 NHẬN DIỆN BÀI HÁT\n" +
          "━━━━━━━━━━━━━━━━\n" +
          "Cách dùng:\n" +
          "  • Reply vào tin nhắn audio/voice rồi gõ .nhandien\n" +
          "  • Hoặc: .nhandien <url audio công khai>\n" +
          "━━━━━━━━━━━━━━━━\n" +
          "Hỗ trợ: mp3, aac, m4a, ogg, wav, flac" +
          (ctx?.isText ? "\n⚠️ Tin được reply là text, không phải audio." : "")
        );
      }

      audioUrl = ctx.mediaUrl;
      if (ctx.ext) filename = `audio${ctx.ext}`;
    }

    if (!audioUrl) {
      return send("❌ Không tìm thấy URL audio. Vui lòng reply vào tin nhắn voice/audio.");
    }

    await send("🔍 Đang nhận diện bài hát...");

    // ── 3. Tải audio ───────────────────────────────────────────────────────
    let audioBuf;
    try {
      audioBuf = await fetchAudioBuffer(audioUrl);
    } catch (err) {
      global.logError?.(`[nhandien] fetch audio: ${err?.message || err}`);
      return send("❌ Không tải được audio: " + (err?.message || "Lỗi không xác định"));
    }

    global.logInfo?.(`[nhandien] audio tải được: ${(audioBuf.length / 1024).toFixed(0)} KB`);

    // ── 4. Gọi AudD API ────────────────────────────────────────────────────
    let data;
    try {
      data = await recognizeAudio(audioBuf, filename);
    } catch (err) {
      global.logError?.(`[nhandien] audd api: ${err?.message || err}`);
      return send("❌ Lỗi gọi API nhận diện: " + (err?.message || "Lỗi không xác định"));
    }

    global.logInfo?.(`[nhandien] AudD status=${data?.status} | result=${JSON.stringify(data?.result).slice(0, 80)}`);

    // ── 5. Xử lý kết quả ──────────────────────────────────────────────────
    if (data?.status !== "success") {
      const errMsg = data?.error?.error_message || data?.status || "Không xác định";
      return send(`❌ AudD trả lỗi: ${errMsg}`);
    }

    if (!data.result) {
      return send(
        "😔 Không nhận diện được bài hát.\n" +
        "Thử lại với đoạn audio rõ hơn hoặc phần có nhạc."
      );
    }

    return send(buildResultMsg(data.result));
  },
};

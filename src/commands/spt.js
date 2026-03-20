"use strict";

/**
 * src/commands/spt.js
 * Tìm kiếm và tải nhạc Spotify
 * Credits: Dev — converted MiZai
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { registerReply } = require("../../includes/handlers/handleReply");

const SPT_ID     = "b9d2557a2dd64105a37f413fa5ffcda4";
const SPT_SECRET = "41bdf804974e4e70bfa0515bb3097fbb";

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2,"0")}:${String(s % 60).padStart(2,"0")}`;
  return `${m}:${String(s % 60).padStart(2,"0")}`;
}

function fmtSize(bytes) {
  const units = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Math.round(bytes / Math.pow(1024, i))} ${units[i]}`;
}

async function getToken() {
  const res = await global.axios.post(
    "https://accounts.spotify.com/api/token",
    null,
    {
      headers: {
        Authorization: "Basic " + Buffer.from(`${SPT_ID}:${SPT_SECRET}`).toString("base64"),
      },
      params:  { grant_type: "client_credentials" },
      timeout: 15000,
    }
  );
  return res.data.access_token;
}

async function search(keyword) {
  const token = await getToken();
  const res   = await global.axios.get(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(keyword)}&type=track&limit=6`,
    { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
  );
  return res.data.tracks.items.map(item => ({
    id:          item.id,
    title:       item.name,
    author:      item.album.artists[0].name,
    duration:    item.duration_ms,
    thumb:       item.album.images[0]?.url || "",
    link:        item.external_urls.spotify,
    preview_url: item.preview_url,
  }));
}

module.exports = {
  config: {
    name:            "spt",
    version:         "1.1.0",
    hasPermssion:    0,
    credits:         "Dev — converted MiZai",
    description:     "Tìm kiếm và tải nhạc Spotify",
    commandCategory: "Giải Trí",
    usages:          "spt <từ khóa>",
    cooldowns:       5,
  },

  run: async ({ api, event, args, send, threadID }) => {
    const keyword = args.join(" ").trim();
    if (!keyword) return send("⚠️ Nhập từ khóa tìm nhạc.\nVí dụ: spt shape of you");

    await send(`🔍 Đang tìm: "${keyword}"...`);

    let tracks;
    try {
      tracks = await search(keyword);
    } catch (err) {
      return send(`❌ Lỗi tìm kiếm: ${err.message}`);
    }

    if (!tracks.length) return send(`❎ Không tìm thấy kết quả cho: "${keyword}"`);

    const list = tracks.map((t, i) =>
      `\n${i + 1}. 👤 ${t.author}\n` +
      `   📜 ${t.title}\n` +
      `   ⏳ ${fmtDuration(t.duration)}`
    ).join("");

    const msgBody =
      `[ SPOTIFY — KẾT QUẢ TÌM KIẾM ]\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `📝 Từ khóa: ${keyword}${list}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `📌 Reply STT (1–${tracks.length}) để tải nhạc`;

    const sent = await send(msgBody);
    const msgId = sent?.message?.msgId ?? sent?.attachment?.[0]?.msgId ?? sent?.msgId;
    if (msgId) {
      registerReply({
        messageId:   String(msgId),
        commandName: "spt",
        payload:     { tracks },
        ttl:         10 * 60 * 1000,
      });
    }
  },

  // ── onReply: tải bài được chọn qua fown API (YouTube Music) ──────────────
  onReply: async ({ api, event, data, send }) => {
    const { tracks = [] } = data || {};
    if (!tracks.length) return send("❌ Hết dữ liệu. Vui lòng tìm lại.");

    const raw    = event?.data || {};
    const body   = typeof raw.content === "string" ? raw.content : (raw.content?.text || "");
    const numMatch = body.trim().replace(/@\S*/g, "").trim().match(/\d+/);
    const choice = numMatch ? parseInt(numMatch[0], 10) : NaN;

    if (isNaN(choice) || choice < 1 || choice > tracks.length) {
      return send(`⚠️ Nhập số từ 1 đến ${tracks.length}.`);
    }

    const track = tracks[choice - 1];
    await send(`⏳ Đang tải: ${track.title} — ${track.author}`);

    const FOWN_API = "https://fown.onrender.com";

    try {
      // Tìm bài trên YouTube Music bằng title + author
      const keyword   = `${track.title} ${track.author}`;
      const searchRes = await global.axios.get(
        `${FOWN_API}/api/search?ytmsearch=${encodeURIComponent(keyword)}&svl=1`,
        { timeout: 30000 }
      );
      const ytmUrl = searchRes.data?.results?.[0]?.url;
      if (!ytmUrl) return send("❌ Không tìm thấy nhạc trên YouTube Music. Thử bài khác.");

      // Lấy download_audio_url (GitHub Releases — URL vĩnh cửu)
      const mediaRes = await global.axios.get(
        `${FOWN_API}/api/media?url=${encodeURIComponent(ytmUrl)}`,
        { timeout: 120000 }
      );
      const audioUrl = mediaRes.data?.download_audio_url || mediaRes.data?.download_url;
      if (!audioUrl) return send("❌ Không lấy được link tải nhạc. Thử lại sau.");

      await send(`🎵 ${track.title}\n👤 ${track.author}\n⏳ ${fmtDuration(track.duration)}`);
      await api.sendVoice({ voiceUrl: audioUrl }, event.threadId, event.type);
    } catch (err) {
      return send(`❌ Lỗi tải nhạc: ${err.message}`);
    }
  },
};

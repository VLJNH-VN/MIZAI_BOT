"use strict";

/**
 * src/commands/scl.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tìm kiếm nhạc trên SoundCloud.
 *
 * Lệnh:
 *   scl <từ khóa>   — Tìm kiếm và hiển thị 5 kết quả
 *   (reply số)      — Xem chi tiết + link stream bài đã chọn
 */

const { registerReply } = require("../../includes/handlers/handleReply");

const SC_API      = "https://api-v2.soundcloud.com";
const SC_HOME     = "https://soundcloud.com";
const LIMIT       = 5;

const HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":          "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8",
  "Referer":         "https://soundcloud.com/",
  "Origin":          "https://soundcloud.com",
};

// ─────────────────────────────────────────────────────────────────────────────
// Lấy client_id động từ SoundCloud
// ─────────────────────────────────────────────────────────────────────────────
let _cachedClientId = null;
let _cachedAt       = 0;
const CLIENT_ID_TTL = 60 * 60 * 1000; // 1 giờ

async function getClientId() {
  if (_cachedClientId && Date.now() - _cachedAt < CLIENT_ID_TTL) {
    return _cachedClientId;
  }

  const axios = global.axios;
  const home  = await axios.get(SC_HOME, { headers: HEADERS, timeout: 15000 });
  const html  = home.data;

  // Tìm các script bundle của SoundCloud
  const scriptUrls = [];
  const re = /src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g;
  let m;
  while ((m = re.exec(html)) !== null) scriptUrls.push(m[1]);

  // Thử từng script để tìm client_id
  for (const url of scriptUrls.slice(-8)) {
    try {
      const res = await axios.get(url, { headers: HEADERS, timeout: 10000 });
      const match = res.data.match(/client_id\s*:\s*"([a-zA-Z0-9]{32})"/);
      if (match) {
        _cachedClientId = match[1];
        _cachedAt       = Date.now();
        return _cachedClientId;
      }
    } catch (_) {}
  }

  throw new Error("Không lấy được client_id từ SoundCloud");
}

// ─────────────────────────────────────────────────────────────────────────────
// Tìm kiếm track
// ─────────────────────────────────────────────────────────────────────────────
async function searchTracks(query) {
  const clientId = await getClientId();
  const axios    = global.axios;

  const url    = `${SC_API}/search/tracks`;
  const params = {
    q:         query,
    client_id: clientId,
    limit:     LIMIT,
    offset:    0,
    linked_partitioning: 1,
  };

  const res = await axios.get(url, {
    params,
    headers: HEADERS,
    timeout: 15000,
  });

  const collection = res.data?.collection;
  if (!Array.isArray(collection) || collection.length === 0) {
    return [];
  }

  return collection.map(t => ({
    id:        t.id,
    title:     t.title,
    username:  t.user?.username || "Không rõ",
    fullName:  t.user?.full_name || t.user?.username || "Không rõ",
    permalink: t.permalink_url,
    duration:  t.duration,
    plays:     t.playback_count,
    likes:     t.likes_count,
    streamUrl: t.stream_url || null,
    artworkUrl: t.artwork_url || null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function formatDuration(ms) {
  const s   = Math.floor(ms / 1000);
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function formatNumber(n) {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

// ─────────────────────────────────────────────────────────────────────────────
// Command
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  config: {
    name:            "scl",
    aliases:         ["soundcloud", "sc"],
    version:         "1.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Tìm kiếm nhạc trên SoundCloud",
    commandCategory: "Giải Trí",
    usages:          "<từ khóa>",
    cooldowns:       5,
  },

  run: async ({ args, send }) => {
    const query = args.join(" ").trim();
    if (!query) {
      return send(
        "🎵 Cách dùng: scl <từ khóa>\n" +
        "Ví dụ: scl alan walker faded"
      );
    }

    await send(`🔍 Đang tìm "${query}" trên SoundCloud...`);

    let tracks;
    try {
      tracks = await searchTracks(query);
    } catch (err) {
      global.logError?.(`[scl] ${err?.message || err}`);
      return send("❌ Lỗi tìm kiếm: " + (err?.message || "Không xác định"));
    }

    if (!tracks.length) {
      return send(`😔 Không tìm thấy kết quả nào cho "${query}"`);
    }

    let msg = `🎵 KẾT QUẢ SOUNDCLOUD\n`;
    msg += `🔎 Từ khóa: "${query}"\n`;
    msg += `━━━━━━━━━━━━━━━━\n`;
    tracks.forEach((t, i) => {
      msg += `${i + 1}. 🎶 ${t.title}\n`;
      msg += `   👤 ${t.fullName}  ⏱ ${formatDuration(t.duration)}  ▶️ ${formatNumber(t.plays)}\n`;
    });
    msg += `━━━━━━━━━━━━━━━━\n`;
    msg += `💬 Reply số từ 1-${tracks.length} để xem chi tiết`;

    const sent = await send(msg);
    const msgId =
      sent?.message?.msgId ??
      (Array.isArray(sent?.attachment) ? sent.attachment[0]?.msgId : null);

    if (msgId) {
      registerReply({
        messageId:   msgId,
        commandName: "scl",
        payload:     { tracks, query },
      });
    }
  },

  onReply: async ({ event, data, send }) => {
    const { tracks = [] } = data || {};
    if (!tracks.length) return send("❌ Không còn dữ liệu. Vui lòng tìm lại.");

    const raw  = event?.data ?? {};
    const body = typeof raw.content === "string"
      ? raw.content
      : (raw.content?.text || raw.content?.msg || "");
    const choice = parseInt(body.trim(), 10);

    if (isNaN(choice) || choice < 1 || choice > tracks.length) {
      return send(`⚠️ Vui lòng reply số từ 1 đến ${tracks.length}`);
    }

    const t = tracks[choice - 1];

    let msg = `🎵 CHI TIẾT BÀI HÁT\n`;
    msg += `━━━━━━━━━━━━━━━━\n`;
    msg += `🎶 Tên: ${t.title}\n`;
    msg += `👤 Nghệ sĩ: ${t.fullName} (@${t.username})\n`;
    msg += `⏱️ Thời lượng: ${formatDuration(t.duration)}\n`;
    msg += `▶️ Lượt nghe: ${formatNumber(t.plays)}\n`;
    msg += `❤️ Lượt thích: ${formatNumber(t.likes)}\n`;
    msg += `━━━━━━━━━━━━━━━━\n`;
    msg += `🔗 Link: ${t.permalink}`;

    return send(msg);
  },
};

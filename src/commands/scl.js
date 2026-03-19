"use strict";

/**
 * src/commands/scl.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tìm kiếm nhạc SoundCloud → reply số → tải & gửi sendVoice.
 */

const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const { registerReply }       = require("../../includes/handlers/handleReply");
const { sendVoice, tempDir }  = require("../../utils/media/media");

const SC_API  = "https://api-v2.soundcloud.com";
const SC_HOME = "https://soundcloud.com";
const LIMIT   = 5;

const HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":          "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8",
  "Referer":         "https://soundcloud.com/",
  "Origin":          "https://soundcloud.com",
};

// ─────────────────────────────────────────────────────────────────────────────
// Client ID (cache 1 giờ)
// ─────────────────────────────────────────────────────────────────────────────
let _clientId = null;
let _clientAt = 0;

async function getClientId() {
  if (_clientId && Date.now() - _clientAt < 3_600_000) return _clientId;

  const axios = global.axios;
  const home  = await axios.get(SC_HOME, { headers: HEADERS, timeout: 15000 });
  const html  = home.data;

  const urls = [];
  const re   = /src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g;
  let m;
  while ((m = re.exec(html)) !== null) urls.push(m[1]);

  for (const url of urls.slice(-8)) {
    try {
      const r     = await axios.get(url, { headers: HEADERS, timeout: 10000 });
      const match = r.data.match(/client_id\s*:\s*"([a-zA-Z0-9]{32})"/);
      if (match) { _clientId = match[1]; _clientAt = Date.now(); return _clientId; }
    } catch (_) {}
  }
  throw new Error("Không lấy được client_id từ SoundCloud");
}

// ─────────────────────────────────────────────────────────────────────────────
// Tìm kiếm track
// ─────────────────────────────────────────────────────────────────────────────
async function searchTracks(query) {
  const clientId = await getClientId();
  const res = await global.axios.get(`${SC_API}/search/tracks`, {
    params: { q: query, client_id: clientId, limit: LIMIT, offset: 0 },
    headers: HEADERS,
    timeout: 15000,
  });

  return (res.data?.collection || []).map(t => ({
    id:       t.id,
    title:    t.title,
    username: t.user?.username  || "Không rõ",
    fullName: t.user?.full_name || t.user?.username || "Không rõ",
    permalink: t.permalink_url,
    duration:  t.duration,
    plays:     t.playback_count,
    likes:     t.likes_count,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Lấy URL stream (mp3 128k) từ track ID
// ─────────────────────────────────────────────────────────────────────────────
async function getStreamUrl(trackId) {
  const clientId = await getClientId();
  const res = await global.axios.get(`${SC_API}/tracks/${trackId}/streams`, {
    params:  { client_id: clientId },
    headers: HEADERS,
    timeout: 15000,
  });
  return res.data?.http_mp3_128_url || res.data?.preview_mp3_128_url || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tải mp3 về rồi convert sang AAC
// ─────────────────────────────────────────────────────────────────────────────
async function downloadAsAac(mp3Url) {
  const ts    = Date.now();
  const mp3   = path.join(tempDir, `scl_${ts}.mp3`);
  const aac   = path.join(tempDir, `scl_${ts}.aac`);

  // Tải mp3
  const res = await global.axios.get(mp3Url, {
    responseType: "arraybuffer",
    timeout:      120_000,
    maxContentLength: 50 * 1024 * 1024,
    headers: { "User-Agent": HEADERS["User-Agent"] },
  });
  fs.writeFileSync(mp3, Buffer.from(res.data));

  // Convert → AAC
  execSync(`ffmpeg -y -i "${mp3}" -c:a aac -b:a 128k "${aac}"`, {
    stdio: "pipe", timeout: 60_000,
  });

  try { fs.unlinkSync(mp3); } catch (_) {}
  return aac;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function fmtDuration(ms) {
  const s   = Math.floor(ms / 1000);
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}
function fmtNum(n) {
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
    version:         "2.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Tìm & tải nhạc SoundCloud (sendVoice)",
    commandCategory: "Giải Trí",
    usages:          "<từ khóa>",
    cooldowns:       5,
  },

  run: async ({ args, send }) => {
    const query = args.join(" ").trim();
    if (!query) return send("🎵 Dùng: scl <từ khóa>\nVí dụ: scl bóng phù hoa TVS");

    await send(`🔍 Đang tìm "${query}" trên SoundCloud...`);

    let tracks;
    try {
      tracks = await searchTracks(query);
    } catch (err) {
      global.logError?.(`[scl] ${err?.message || err}`);
      return send("❌ Lỗi tìm kiếm: " + (err?.message || "Không xác định"));
    }

    if (!tracks.length) return send(`😔 Không tìm thấy kết quả cho "${query}"`);

    let msg = `🎵 KẾT QUẢ SOUNDCLOUD\n🔎 "${query}"\n━━━━━━━━━━━━━━━━\n`;
    tracks.forEach((t, i) => {
      msg += `${i + 1}. 🎶 ${t.title}\n`;
      msg += `   👤 ${t.fullName}  ⏱ ${fmtDuration(t.duration)}  ▶️ ${fmtNum(t.plays)}\n`;
    });
    msg += `━━━━━━━━━━━━━━━━\n💬 Reply số từ 1-${tracks.length} để tải nhạc`;

    const sent  = await send(msg);
    const msgId = sent?.message?.msgId ?? sent?.attachment?.[0]?.msgId;
    if (msgId) {
      registerReply({ messageId: msgId, commandName: "scl", payload: { tracks } });
    }
  },

  onReply: async ({ api, event, data, send }) => {
    const { tracks = [] } = data || {};
    if (!tracks.length) return send("❌ Hết dữ liệu. Vui lòng tìm lại.");

    const raw    = event?.data ?? {};
    const body   = typeof raw.content === "string" ? raw.content : (raw.content?.text || raw.content?.msg || "");
    const choice = parseInt(body.trim(), 10);

    if (isNaN(choice) || choice < 1 || choice > tracks.length) {
      return send(`⚠️ Reply số từ 1 đến ${tracks.length}`);
    }

    const t = tracks[choice - 1];

    await send(
      `⏳ Đang tải: ${t.title}\n` +
      `👤 ${t.fullName}  ⏱ ${fmtDuration(t.duration)}`
    );

    // Lấy stream URL
    let mp3Url;
    try {
      mp3Url = await getStreamUrl(t.id);
    } catch (err) {
      global.logError?.(`[scl] getStream: ${err?.message || err}`);
      return send("❌ Không lấy được link stream: " + (err?.message || err));
    }

    if (!mp3Url) return send("❌ SoundCloud không cung cấp link tải cho bài này.");

    // Tải & convert sang AAC
    let aacPath;
    try {
      fs.mkdirSync(tempDir, { recursive: true });
      aacPath = await downloadAsAac(mp3Url);
    } catch (err) {
      global.logError?.(`[scl] download: ${err?.message || err}`);
      return send("❌ Lỗi tải nhạc: " + (err?.message || err));
    }

    // Gửi sendVoice
    try {
      await sendVoice(api, aacPath, event.threadId, event.type);
      await send(
        `✅ Download SoundCloud\n` +
        `📝 ${t.title}\n` +
        `👤 ${t.fullName}\n` +
        `⏳ ${fmtDuration(t.duration)} · ▶️ ${fmtNum(t.plays)} · ❤️ ${fmtNum(t.likes)}`
      );
    } catch (err) {
      global.logError?.(`[scl] sendVoice: ${err?.message || err}`);
      return send("❌ Lỗi gửi audio: " + (err?.message || err));
    } finally {
      try { if (aacPath && fs.existsSync(aacPath)) fs.unlinkSync(aacPath); } catch (_) {}
    }
  },
};

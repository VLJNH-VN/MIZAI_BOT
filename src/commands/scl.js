"use strict";

/**
 * src/commands/scl.js — SoundCloud search + download + GitHub upload → sendVoice
 *
 * Flow khi reply số:
 *   1. Lấy progressive transcoding URL từ data track (đã lưu lúc search)
 *   2. Gọi URL đó + client_id → nhận direct mp3 link
 *   3. Tải mp3 → buffer
 *   4. Upload buffer lên GitHub → rawUrl công khai
 *   5. api.sendVoice({ voiceUrl: rawUrl }) — không cần uploadAttachment
 */

const fs   = require("fs");
const path = require("path");

const { registerReply } = require("../../includes/handlers/handleReply");

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

// ─── Client ID cache ──────────────────────────────────────────────────────────
let _clientId = null;
let _clientAt = 0;

async function getClientId() {
  if (_clientId && Date.now() - _clientAt < 3_600_000) return _clientId;

  const axios = global.axios;
  const html  = (await axios.get(SC_HOME, { headers: HEADERS, timeout: 15000 })).data;

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

// ─── Search tracks (lưu transcodings để dùng khi download) ───────────────────
async function searchTracks(query) {
  const clientId = await getClientId();
  const res = await global.axios.get(`${SC_API}/search/tracks`, {
    params: { q: query, client_id: clientId, limit: LIMIT, offset: 0 },
    headers: HEADERS,
    timeout: 15000,
  });

  return (res.data?.collection || []).map(t => ({
    id:           t.id,
    title:        t.title,
    username:     t.user?.username  || "Không rõ",
    fullName:     t.user?.full_name || t.user?.username || "Không rõ",
    permalink:    t.permalink_url,
    duration:     t.duration,
    plays:        t.playback_count,
    likes:        t.likes_count,
    transcodings: t.media?.transcodings || [],   // <-- lưu để download sau
  }));
}

// ─── Lấy direct mp3 URL từ transcoding ───────────────────────────────────────
async function resolveStreamUrl(transcodings) {
  const clientId = await getClientId();
  const axios    = global.axios;

  // Ưu tiên progressive (direct mp3) trước HLS
  const sorted = [...transcodings].sort((a, b) => {
    const score = t => (t.format?.protocol === "progressive" ? 0 : 1);
    return score(a) - score(b);
  });

  for (const tc of sorted) {
    if (!tc.url) continue;
    try {
      const res = await axios.get(tc.url, {
        params:  { client_id: clientId },
        headers: HEADERS,
        timeout: 15000,
      });
      const url = res.data?.url;
      if (url) return { url, isHls: tc.format?.protocol === "hls" };
    } catch (_) {}
  }
  throw new Error("Không lấy được stream URL từ transcodings");
}

// ─── Tải mp3 từ direct URL → Buffer ──────────────────────────────────────────
async function downloadMp3Buffer(mp3Url) {
  const res = await global.axios.get(mp3Url, {
    responseType: "arraybuffer",
    timeout:      120_000,
    maxContentLength: 50 * 1024 * 1024,
    headers: { "User-Agent": HEADERS["User-Agent"] },
  });
  return Buffer.from(res.data);
}

// ─── Tải HLS → mp3 qua ffmpeg (khi progressive không có) ────────────────────
function downloadHlsToBuffer(m3u8Url) {
  const { execSync } = require("child_process");
  const tmpOut = path.join(
    require("../../utils/media/media").tempDir,
    `scl_hls_${Date.now()}.mp3`
  );
  execSync(
    `ffmpeg -y -i "${m3u8Url}" -c:a libmp3lame -q:a 4 "${tmpOut}"`,
    { stdio: "pipe", timeout: 90_000 }
  );
  const buf = fs.readFileSync(tmpOut);
  try { fs.unlinkSync(tmpOut); } catch (_) {}
  return buf;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function fmtNum(n) {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  config: {
    name:            "scl",
    aliases:         ["soundcloud", "sc"],
    version:         "3.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Tìm & tải nhạc SoundCloud → GitHub → sendVoice",
    commandCategory: "Giải Trí",
    usages:          "<từ khóa>",
    cooldowns:       5,
  },

  // ── Tìm kiếm ────────────────────────────────────────────────────────────────
  run: async ({ args, send }) => {
    const query = args.join(" ").trim();
    if (!query) return send("🎵 Dùng: scl <từ khóa>\nVí dụ: scl bóng phù hoa TVS");

    await send(`🔍 Đang tìm "${query}" trên SoundCloud...`);

    let tracks;
    try {
      tracks = await searchTracks(query);
    } catch (err) {
      global.logError?.(`[scl] search: ${err?.message || err}`);
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

  // ── Xử lý reply ─────────────────────────────────────────────────────────────
  onReply: async ({ api, event, data, send }) => {
    const { tracks = [] } = data || {};
    if (!tracks.length) return send("❌ Hết dữ liệu. Vui lòng tìm lại.");

    const raw    = event?.data ?? {};
    const body   = typeof raw.content === "string"
      ? raw.content
      : (raw.content?.text || raw.content?.msg || "");
    const choice = parseInt(body.trim(), 10);

    if (isNaN(choice) || choice < 1 || choice > tracks.length) {
      return send(`⚠️ Reply số từ 1 đến ${tracks.length}`);
    }

    const t = tracks[choice - 1];

    if (!t.transcodings?.length) {
      return send("❌ Bài này không có dữ liệu stream. Vui lòng thử bài khác.");
    }

    await send(`⏳ Đang tải: ${t.title}\n👤 ${t.fullName}  ⏱ ${fmtDuration(t.duration)}`);

    // 1. Lấy direct URL từ transcodings
    let streamInfo;
    try {
      streamInfo = await resolveStreamUrl(t.transcodings);
    } catch (err) {
      global.logError?.(`[scl] resolveStream: ${err?.message || err}`);
      return send("❌ Không lấy được stream: " + err.message);
    }

    global.logInfo?.(`[scl] stream url (isHls=${streamInfo.isHls}): ${streamInfo.url.slice(0, 80)}...`);

    // 2. Tải audio → buffer
    let audioBuf;
    try {
      if (streamInfo.isHls) {
        audioBuf = downloadHlsToBuffer(streamInfo.url);
      } else {
        audioBuf = await downloadMp3Buffer(streamInfo.url);
      }
    } catch (err) {
      global.logError?.(`[scl] download: ${err?.message || err}`);
      return send("❌ Lỗi tải nhạc: " + err.message);
    }

    global.logInfo?.(`[scl] downloaded ${(audioBuf.length / 1024).toFixed(0)} KB`);

    // 3. Upload lên GitHub → rawUrl công khai
    let rawUrl;
    try {
      const fileName = `scl_${t.id}_${Date.now()}.mp3`;
      rawUrl = await global.uploadImage(audioBuf, fileName);
    } catch (err) {
      global.logError?.(`[scl] github upload: ${err?.message || err}`);
      return send("❌ Lỗi upload GitHub: " + err.message);
    }

    global.logInfo?.(`[scl] github rawUrl: ${rawUrl}`);

    // 4. Gửi voice bằng rawUrl GitHub
    try {
      await api.sendVoice(
        { voiceUrl: rawUrl, ttl: 0 },
        event.threadId,
        event.type
      );
      await send(
        `✅ Download SoundCloud\n` +
        `📝 ${t.title}\n` +
        `👤 ${t.fullName}\n` +
        `⏳ ${fmtDuration(t.duration)} · ▶️ ${fmtNum(t.plays)} · ❤️ ${fmtNum(t.likes)}`
      );
    } catch (err) {
      global.logError?.(`[scl] sendVoice: ${err?.message || err}`);
      return send("❌ Lỗi gửi audio: " + err.message);
    }
  },
};

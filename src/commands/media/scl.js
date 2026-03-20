"use strict";

/**
 * src/commands/scl.js — SoundCloud search + tải nhạc qua fown API
 *
 * Flow:
 *   Search: GET /api/search?scsearch=<q>&svl=5  → danh sách track
 *   Download: GET /api/media?url=<sc_url>        → download_audio_url (GitHub Releases)
 *   Gửi: api.sendVoice({ voiceUrl: download_audio_url }) → phát inline
 */

const { registerReply } = require("../../includes/handlers/handleReply");

const FOWN_API = "https://fown.onrender.com";
const LIMIT    = 5;

function fmtDuration(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function fmtNum(n) {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

module.exports = {
  config: {
    name:            "scl",
    aliases:         ["soundcloud", "sc"],
    version:         "4.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Tìm & tải nhạc SoundCloud",
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
      const res = await global.axios.get(
        `${FOWN_API}/api/search?scsearch=${encodeURIComponent(query)}&svl=${LIMIT}`,
        { timeout: 30000 }
      );
      tracks = res.data?.results || [];
    } catch (err) {
      return send("❌ Lỗi tìm kiếm: " + (err?.message || "Không xác định"));
    }

    if (!tracks.length) return send(`😔 Không tìm thấy kết quả cho "${query}"`);

    let msg = `🎵 KẾT QUẢ SOUNDCLOUD\n🔎 "${query}"\n━━━━━━━━━━━━━━━━\n`;
    tracks.forEach((t, i) => {
      msg += `${i + 1}. 🎶 ${t.title}\n`;
      msg += `   👤 ${t.uploader}  ⏱ ${fmtDuration(t.duration)}  ▶️ ${fmtNum(t.view_count)}\n`;
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
    const body   = typeof raw.content === "string"
      ? raw.content
      : (raw.content?.text || raw.content?.msg || "");
    const numMatch = body.trim().replace(/@\S*/g, "").trim().match(/\d+/);
    const choice = numMatch ? parseInt(numMatch[0], 10) : NaN;

    if (isNaN(choice) || choice < 1 || choice > tracks.length) {
      return send(`⚠️ Reply số từ 1 đến ${tracks.length}`);
    }

    const t = tracks[choice - 1];
    await send(`⏳ Đang tải: ${t.title}\n👤 ${t.uploader}  ⏱ ${fmtDuration(t.duration)}`);

    let audioUrl;
    try {
      const res = await global.axios.get(
        `${FOWN_API}/api/media?url=${encodeURIComponent(t.url)}`,
        { timeout: 120000 }
      );
      audioUrl = res.data?.download_audio_url || res.data?.download_url;
    } catch (err) {
      return send("❌ Lỗi tải nhạc: " + err.message);
    }

    if (!audioUrl) return send("❌ Không lấy được link tải nhạc. Thử bài khác.");

    const caption =
      `✅ SoundCloud\n📝 ${t.title}\n👤 ${t.uploader}\n` +
      `⏳ ${fmtDuration(t.duration)} · ▶️ ${fmtNum(t.view_count)}`;

    try {
      await api.sendMessage({ msg: caption }, event.threadId, event.type);
      await api.sendVoice({ voiceUrl: audioUrl }, event.threadId, event.type);
    } catch (err) {
      return send("❌ Lỗi gửi audio: " + err.message);
    }
  },
};

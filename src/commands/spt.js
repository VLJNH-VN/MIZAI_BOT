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
  const s  = Math.floor(ms / 1000);
  const m  = Math.floor(s / 60);
  const h  = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2,"0")}:${String(s % 60).padStart(2,"0")}`;
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

    // Tải thumbnail → lưu temp file → gửi kèm ảnh
    const tmpFiles = [];
    for (const t of tracks) {
      if (!t.thumb) { tmpFiles.push(null); continue; }
      try {
        const buf     = (await global.axios.get(t.thumb, { responseType: "arraybuffer", timeout: 10000 })).data;
        const tmpPath = path.join(os.tmpdir(), `spt_thumb_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
        fs.writeFileSync(tmpPath, Buffer.from(buf));
        tmpFiles.push(tmpPath);
      } catch { tmpFiles.push(null); }
    }

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

    const validTmp = tmpFiles.filter(Boolean);
    let sent;
    try {
      sent = await api.sendMessage(
        validTmp.length ? { msg: msgBody, attachments: validTmp } : { msg: msgBody },
        threadID,
        event.type
      );
    } finally {
      for (const f of validTmp) try { fs.unlinkSync(f); } catch {}
    }
    const msgId = sent?.message?.msgId ?? sent?.msgId ?? sent?.data?.msgId;
    if (msgId) {
      registerReply({
        messageId:   String(msgId),
        commandName: "spt",
        payload:     { tracks },
        ttl:         10 * 60 * 1000,
      });
    }
  },

  // ── onReply: tải bài được chọn ────────────────────────────────────────────
  onReply: async ({ event, data, send }) => {
    const { tracks = [] } = data || {};
    if (!tracks.length) return send("❌ Hết dữ liệu. Vui lòng tìm lại.");

    const raw    = event?.data || {};
    const body   = typeof raw.content === "string" ? raw.content : (raw.content?.text || "");
    const choice = parseInt(body.trim());

    if (isNaN(choice) || choice < 1 || choice > tracks.length) {
      return send(`⚠️ Nhập số từ 1 đến ${tracks.length}.`);
    }

    const track = tracks[choice - 1];
    await send(`⏳ Đang tải: ${track.title} — ${track.author}`);

    try {
      const trackUrl   = encodeURIComponent(track.link);
      const apiRes     = await global.axios.get(
        `https://www.bhandarimilan.info.np/spotify?url=${trackUrl}`,
        { timeout: 30000 }
      );

      if (!apiRes.data?.success || !apiRes.data?.link) {
        return send("❌ Không lấy được link tải nhạc. Thử lại sau.");
      }

      const audioLink = apiRes.data.link;
      const tmpFile   = path.join(os.tmpdir(), `spt_${Date.now()}.mp3`);

      const audioRes = await global.axios.get(audioLink, {
        responseType: "arraybuffer",
        timeout:      60000,
      });
      fs.writeFileSync(tmpFile, Buffer.from(audioRes.data));

      const size = fmtSize(fs.statSync(tmpFile).size);
      const meta = apiRes.data.metadata || {};

      try {
        await send({
          msg: `🎵 ${meta.title || track.title}\n👤 ${meta.artists || track.author}\n📅 ${meta.releaseDate || ""}\n💽 ${size}`,
          attachments: [tmpFile],
        });
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
    } catch (err) {
      return send(`❌ Lỗi tải nhạc: ${err.message}`);
    }
  },
};

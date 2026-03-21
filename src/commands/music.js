"use strict";

/**
 * src/commands/music.js
 * Gộp: scl (SoundCloud) + spt (Spotify) + mixcloud (Mixcloud)
 */

const https = require("https");
const fs    = require("fs");
const path  = require("path");
const os    = require("os");
const { fmtDurationSec, fmtDurationMs } = require("../../utils/helpers");
const { drawSearchCard, drawNowPlayingCard } = require("../../utils/musicCard");

const FOWN_API = "https://fown.onrender.com";
const SPT_ID     = "1530d567ec6542669896bc96efd370f3";
const SPT_SECRET = "6e0241b124da40dfb98728b7f29cedfd";
const MIXCLOUD_GRAPHQL_URL = "https://app.mixcloud.com/graphql";

function fmtNum(n) {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

function formatDuration(seconds) {
  const s = Number(seconds) || 0;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// ── Spotify ───────────────────────────────────────────────────────────────────
async function sptGetToken() {
  const res = await global.axios.post(
    "https://accounts.spotify.com/api/token",
    "grant_type=client_credentials",
    {
      headers: {
        Authorization: "Basic " + Buffer.from(`${SPT_ID}:${SPT_SECRET}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 15000,
    }
  );
  return res.data.access_token;
}

async function sptSearch(keyword) {
  const token = await sptGetToken();
  const res   = await global.axios.get(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(keyword)}&type=track&limit=6`,
    { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
  );
  return res.data.tracks.items.map(item => ({
    id:       item.id,
    title:    item.name,
    author:   item.album.artists[0].name,
    duration: item.duration_ms,
    link:     item.external_urls.spotify,
  }));
}

// ── Mixcloud ──────────────────────────────────────────────────────────────────
const MIXCLOUD_HEADERS = {
  "user-agent": global.userAgent,
  "accept": "*/*",
  "content-type": "application/json",
  "origin": "https://www.mixcloud.com",
  "referer": "https://www.mixcloud.com/",
  "x-mixcloud-client-version": "2d2abe714aa39c05e74111c1de52b08328a5fadb",
  "x-mixcloud-platform": "www",
};

const SEARCH_QUERY = `query SearchResultsCloudcastsQuery($count: Int! $term: String! $cursor: String) {
  viewer { search { searchQuery(term: $term) { cloudcasts(first: $count, after: $cursor) {
    edges { node { id name slug owner { displayName username } audioLength plays } cursor }
  } } } }
}`;

function mixPost(postData, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const u = new URL(MIXCLOUD_GRAPHQL_URL);
    const dataStr = JSON.stringify(postData);
    const req = https.request(
      { method: "POST", protocol: u.protocol, hostname: u.hostname, path: u.pathname + u.search, headers: MIXCLOUD_HEADERS },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode || 0, json: JSON.parse(data) }); }
          catch (e) { reject(new Error(`Invalid JSON: ${e.message}`)); }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("Timeout")));
    req.write(dataStr);
    req.end();
  });
}

async function mixSearch(term) {
  const { status, json } = await mixPost({ query: SEARCH_QUERY, variables: { count: 10, term: term.trim() } });
  if (status !== 200) throw new Error(`HTTP ${status}`);
  if (json?.errors) throw new Error(json.errors[0]?.message);
  const edges = json?.data?.viewer?.search?.searchQuery?.cloudcasts?.edges;
  if (!edges?.length) throw new Error("Không có kết quả từ Mixcloud");
  return edges.map(({ node }) => ({
    id: node.id, name: node.name || "Unknown", slug: node.slug || "",
    owner: { displayName: node.owner?.displayName || node.owner?.username || "Unknown", username: node.owner?.username || "" },
    audioLength: node.audioLength || 0, plays: node.plays || 0,
  }));
}

// ── SoundCloud ────────────────────────────────────────────────────────────────
async function sclSearch(query) {
  const res = await global.axios.get(
    `${FOWN_API}/api/search?scsearch=${encodeURIComponent(query)}&svl=5`,
    { timeout: 30000 }
  );
  return res.data?.results || [];
}

module.exports = {
  config: {
    name:            "music",
    aliases:         ["nhac", "scl", "soundcloud", "sc", "spt", "spotify", "mixcloud", "mix"],
    version:         "2.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Tìm & tải nhạc từ SoundCloud, Spotify hoặc Mixcloud",
    commandCategory: "Giải Trí",
    usages: [
      "music sc <từ khóa>    — Tìm trên SoundCloud",
      "music spt <từ khóa>   — Tìm trên Spotify",
      "music mix <từ khóa>   — Tìm trên Mixcloud",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ api, event, args, send, registerReply, commandName, threadID }) => {
    const FLAG_MAP = { sc: "sc", soundcloud: "sc", scl: "sc", spt: "spt", spotify: "spt", mix: "mix", mixcloud: "mix", nhac: "sc", music: "sc" };

    let platform = FLAG_MAP[commandName] || null;
    let queryArgs = args;

    if (!platform) {
      const sub = (args[0] || "").toLowerCase();
      if (FLAG_MAP[sub]) { platform = FLAG_MAP[sub]; queryArgs = args.slice(1); }
      else {
        return send(
          `🎵 MUSIC — TÌM & TẢI NHẠC\n━━━━━━━━━━━━━━━━\n` +
          `• .music sc <từ khóa>   → SoundCloud\n` +
          `• .music spt <từ khóa>  → Spotify\n` +
          `• .music mix <từ khóa>  → Mixcloud\n\n` +
          `Ví dụ: .music sc bóng phù hoa`
        );
      }
    }

    const query = queryArgs.join(" ").trim();
    if (!query) return send(`⚠️ Nhập từ khóa tìm nhạc. Ví dụ: .music ${platform} tên bài hát`);

    await send(`🔍 Đang tìm "${query}"...`);

    try {
      if (platform === "sc") {
        const tracks = await sclSearch(query);
        if (!tracks.length) return send(`😔 Không tìm thấy kết quả cho "${query}"`);
        tracks.forEach(t => { t._durStr = fmtDurationSec(t.duration); });
        let cardPath;
        try { cardPath = await drawSearchCard({ platform: "sc", query, tracks: tracks.slice(0, 6) }); } catch (_) {}
        const msg = `💬 Reply số từ 1-${tracks.length} để tải nhạc`;
        const sent = cardPath
          ? await api.sendMessage({ msg, attachments: [cardPath] }, threadID, event.type)
          : await send(msg);
        if (cardPath) try { fs.unlinkSync(cardPath); } catch (_) {}
        const msgId = sent?.message?.msgId ?? sent?.attachment?.[0]?.msgId;
        if (msgId) registerReply({ messageId: String(msgId), commandName: "music", payload: { platform: "sc", tracks } });

      } else if (platform === "spt") {
        const tracks = await sptSearch(query);
        if (!tracks.length) return send(`😔 Không tìm thấy kết quả cho "${query}"`);
        tracks.forEach(t => { t._durStr = fmtDurationMs(t.duration); });
        let cardPath;
        try { cardPath = await drawSearchCard({ platform: "spt", query, tracks: tracks.slice(0, 6) }); } catch (_) {}
        const msg = `📌 Reply STT (1–${tracks.length}) để tải nhạc`;
        const sent = cardPath
          ? await api.sendMessage({ msg, attachments: [cardPath] }, threadID, event.type)
          : await send(msg);
        if (cardPath) try { fs.unlinkSync(cardPath); } catch (_) {}
        const msgId = sent?.message?.msgId ?? sent?.attachment?.[0]?.msgId ?? sent?.msgId;
        if (msgId) registerReply({ messageId: String(msgId), commandName: "music", payload: { platform: "spt", tracks }, ttl: 10 * 60 * 1000 });

      } else if (platform === "mix") {
        const results = await mixSearch(query);
        const top5 = results.slice(0, 5);
        const cardTracks = top5.map(r => ({
          title:  r.name,
          owner:  r.owner,
          _durStr: formatDuration(r.audioLength),
        }));
        let cardPath;
        try { cardPath = await drawSearchCard({ platform: "mix", query, tracks: cardTracks }); } catch (_) {}
        const msg = `💬 Reply số từ 1-5 để xem link Mixcloud`;
        const sent = cardPath
          ? await api.sendMessage({ msg, attachments: [cardPath] }, threadID, event.type)
          : await send(msg);
        if (cardPath) try { fs.unlinkSync(cardPath); } catch (_) {}
        const sentId = sent?.message?.msgId ?? (Array.isArray(sent?.attachment) && sent.attachment[0]?.msgId);
        if (sentId) registerReply({ messageId: String(sentId), commandName: "music", payload: { platform: "mix", results } });
      }
    } catch (err) {
      return send(`❌ Lỗi tìm kiếm: ${err?.message || "Không xác định"}`);
    }
  },

  onReply: async ({ api, event, data, send }) => {
    const { platform, tracks = [], results = [] } = data || {};
    const raw    = event?.data ?? {};
    const body   = typeof raw.content === "string" ? raw.content : (raw.content?.text || raw.content?.msg || "");
    const numMatch = body.trim().replace(/@\S*/g, "").trim().match(/\d+/);
    const choice = numMatch ? parseInt(numMatch[0], 10) : NaN;

    if (platform === "sc") {
      if (!tracks.length) return send("❌ Hết dữ liệu. Vui lòng tìm lại.");
      if (isNaN(choice) || choice < 1 || choice > tracks.length) return send(`⚠️ Reply số từ 1 đến ${tracks.length}`);
      const t = tracks[choice - 1];
      await send(`⏳ Đang tải: ${t.title}\n👤 ${t.uploader}  ⏱ ${fmtDurationSec(t.duration)}`);
      try {
        const res = await global.axios.get(`${FOWN_API}/api/media?url=${encodeURIComponent(t.url)}`, { timeout: 120000 });
        const audioUrl = res.data?.download_audio_url || res.data?.download_url;
        if (!audioUrl) return send("❌ Không lấy được link tải. Thử bài khác.");
        let cardPath;
        try {
          cardPath = await drawNowPlayingCard({
            platform: "sc",
            title:    t.title,
            artist:   t.uploader,
            duration: fmtDurationSec(t.duration),
            thumb:    t.thumbnail || t.artwork_url,
          });
        } catch (_) {}
        const infoMsg = `✅ SoundCloud\n📝 ${t.title}\n👤 ${t.uploader}\n⏳ ${fmtDurationSec(t.duration)} · ▶️ ${fmtNum(t.view_count)}`;
        if (cardPath) {
          await api.sendMessage({ msg: infoMsg, attachments: [cardPath] }, event.threadId, event.type);
          try { fs.unlinkSync(cardPath); } catch (_) {}
        } else {
          await api.sendMessage({ msg: infoMsg }, event.threadId, event.type);
        }
        await api.sendVoice({ voiceUrl: audioUrl }, event.threadId, event.type);
      } catch (err) { return send("❌ Lỗi tải nhạc: " + err.message); }

    } else if (platform === "spt") {
      if (!tracks.length) return send("❌ Hết dữ liệu. Vui lòng tìm lại.");
      if (isNaN(choice) || choice < 1 || choice > tracks.length) return send(`⚠️ Nhập số từ 1 đến ${tracks.length}.`);
      const track = tracks[choice - 1];
      await send(`⏳ Đang tải: ${track.title} — ${track.author}`);
      try {
        const keyword   = `${track.title} ${track.author}`;
        const searchRes = await global.axios.get(`${FOWN_API}/api/search?ytmsearch=${encodeURIComponent(keyword)}&svl=1`, { timeout: 30000 });
        const ytmUrl = searchRes.data?.results?.[0]?.url;
        if (!ytmUrl) return send("❌ Không tìm thấy nhạc trên YouTube Music. Thử bài khác.");
        const mediaRes = await global.axios.get(`${FOWN_API}/api/media?url=${encodeURIComponent(ytmUrl)}`, { timeout: 120000 });
        const audioUrl = mediaRes.data?.download_audio_url || mediaRes.data?.download_url;
        if (!audioUrl) return send("❌ Không lấy được link tải. Thử lại sau.");
        let cardPath;
        try {
          cardPath = await drawNowPlayingCard({
            platform: "spt",
            title:    track.title,
            artist:   track.author,
            duration: fmtDurationMs(track.duration),
          });
        } catch (_) {}
        const infoMsg = `🎵 ${track.title}\n👤 ${track.author}\n⏳ ${fmtDurationMs(track.duration)}`;
        if (cardPath) {
          await api.sendMessage({ msg: infoMsg, attachments: [cardPath] }, event.threadId, event.type);
          try { fs.unlinkSync(cardPath); } catch (_) {}
        } else {
          await send(infoMsg);
        }
        await api.sendVoice({ voiceUrl: audioUrl }, event.threadId, event.type);
      } catch (err) { return send(`❌ Lỗi tải nhạc: ${err.message}`); }

    } else if (platform === "mix") {
      if (!results.length) return send("❌ Hết dữ liệu. Vui lòng tìm lại.");
      if (isNaN(choice) || choice < 1 || choice > 5 || !results[choice - 1]) return send("⚠️ Chọn số từ 1-5.");
      const r = results[choice - 1];
      await send(`✅ Bạn đã chọn:\n🎵 ${r.name}\n👤 ${r.owner.displayName}\n🔗 https://www.mixcloud.com/${r.owner.username}/${r.slug}`);
    }
  },
};

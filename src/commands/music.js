"use strict";

/**
 * src/commands/music.js
 * Gộp: scl (SoundCloud) + spt (Spotify) + mixcloud (Mixcloud) + yt (YouTube)
 */

const https  = require("https");
const fs     = require("fs");
const SpotifyWebApi = require("spotify-web-api-node");
const { Reactions } = require("zca-js");
const { fmtDurationSec, fmtDurationMs } = require("../../utils/media/helpers");
let _canvas;
function getCanvas() {
  if (!_canvas) _canvas = require("../../utils/media/canvas");
  return _canvas;
}

const FOWN_API = "https://fown.onrender.com";
const MIXCLOUD_GRAPHQL_URL = "https://app.mixcloud.com/graphql";

// ── Spotify client (Client Credentials) ───────────────────────────────────────
const _cfg = (() => { try { return require("../../config.json"); } catch { return {}; } })();
const spotifyApi = new SpotifyWebApi({
  clientId:     _cfg.spotifyClientId     || "1530d567ec6542669896bc96efd370f3",
  clientSecret: _cfg.spotifyClientSecret || "a42a5f176e6146219163543787b40494",
});
let _spotifyTokenExpiry = 0;

async function ensureSpotifyToken() {
  if (Date.now() < _spotifyTokenExpiry - 30000) return;
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    if (!data?.body?.access_token) throw new Error("Không nhận được access_token từ Spotify");
    spotifyApi.setAccessToken(data.body.access_token);
    _spotifyTokenExpiry = Date.now() + data.body.expires_in * 1000;
  } catch (err) {
    _spotifyTokenExpiry = 0;
    const sc  = err?.statusCode || err?.status || "";
    const msg = stringifyWebapiError(err);
    throw Object.assign(
      new Error(`Spotify auth thất bại${sc ? ` (${sc})` : ""}: ${msg}`),
      { spotifyBlocked: true }
    );
  }
}

function stringifyWebapiError(err) {
  if (!err) return "Không xác định";
  if (typeof err.message === "string" && err.message && err.message !== "[object Object]") return err.message;
  if (typeof err.message === "object" && err.message !== null) {
    return err.message.error_description
      || err.message.error?.message
      || err.message.error
      || JSON.stringify(err.message);
  }
  const sc = err?.statusCode || err?.status;
  if (sc) return `HTTP ${sc}`;
  return err.toString?.() || JSON.stringify(err);
}

function stringifyError(err) {
  if (!err) return "Không xác định";
  // AxiosError: đọc message từ response body nếu có
  if (err.isAxiosError || err.response) {
    const data = err.response?.data;
    if (data) {
      const detail = data.message || data.error || data.details || null;
      if (detail && typeof detail === "string") {
        const sc = err.response?.status || err.status || "";
        // Phát hiện YouTube bot-check
        if (detail.includes("Sign in to confirm") || detail.includes("bot") || detail.includes("cookies")) {
          return "YouTube yêu cầu xác thực bot — API tải nhạc đang bị chặn. Thử lại sau hoặc dùng platform khác (scl, mix).";
        }
        return sc ? `HTTP ${sc} — ${detail}` : detail;
      }
    }
    const sc = err.response?.status || err.status || "";
    return sc ? `HTTP ${sc} — ${err.message}` : err.message;
  }
  const sc = err?.statusCode || err?.status;
  const msg = stringifyWebapiError(err);
  return sc ? `HTTP ${sc} — ${msg}` : msg;
}

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

function resolveUrl(url) {
  if (!url) return url;
  if (url.startsWith("/")) return FOWN_API + url;
  return url;
}

function extractMsgId(sent) {
  if (!sent) return null;
  return sent?.message?.msgId
    ?? sent?.msgId
    ?? sent?.attachment?.[0]?.msgId
    ?? (Array.isArray(sent?.attachment) ? sent.attachment[0]?.msgId : null)
    ?? (Array.isArray(sent) ? sent[0]?.msgId : null)
    ?? null;
}

// ── YouTube ────────────────────────────────────────────────────────────────────
async function ytSearch(keyword) {
  const res = await global.axios.get(
    `${FOWN_API}/api/search?ytsearch=${encodeURIComponent(keyword)}&svl=6`,
    { timeout: 30000 }
  );
  return (res.data?.results || []).map(item => ({
    id:        item.id || "",
    title:     item.title || "Unknown",
    author:    item.uploader || "Unknown",
    duration:  (item.duration || 0) * 1000,
    link:      item.url || item.webpage_url || "",
    _durSec:   item.duration || 0,
    thumbnail: resolveUrl(item.thumbnail || "") || "",
  }));
}

// ── Spotify (Spotify Web API — Client Credentials) ────────────────────────────
async function sptSearch(keyword) {
  // Thử Spotify trước
  try {
    await ensureSpotifyToken();
    let res;
    try {
      res = await spotifyApi.searchTracks(keyword, { limit: 6 });
    } catch (err) {
      const sc = err?.statusCode || err?.status;
      if (sc === 401 || sc === 403) {
        _spotifyTokenExpiry = 0;
        throw Object.assign(new Error("SPOTIFY_BLOCKED"), { spotifyBlocked: true });
      }
      throw err;
    }
    const items = res.body?.tracks?.items || [];
    if (!items.length) throw Object.assign(new Error("SPOTIFY_EMPTY"), { spotifyBlocked: true });
    return items.map(track => ({
      id:        track.id || "",
      title:     track.name || "Unknown",
      author:    (track.artists || []).map(a => a.name).join(", ") || "Unknown",
      duration:  track.duration_ms || 0,
      _durSec:   Math.floor((track.duration_ms || 0) / 1000),
      link:      track.external_urls?.spotify || "",
      thumbnail: track.album?.images?.[0]?.url || "",
      spotifyId: track.id || "",
    }));
  } catch (err) {
    if (err.spotifyBlocked) {
      // Fallback: tìm trên YouTube thay thế
      global.logWarn?.("[MUSIC:spt] Spotify bị chặn, fallback sang YouTube search...");
      const ytTracks = await ytSearch(keyword);
      return ytTracks.map(t => ({
        id:        t.id || "",
        title:     t.title || "Unknown",
        author:    t.author || "Unknown",
        duration:  t.duration || 0,
        _durSec:   t._durSec || 0,
        link:      t.link || "",
        thumbnail: t.thumbnail || "",
        spotifyId: "",
        _ytFallback: true,
      }));
    }
    throw err;
  }
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
    edges { node { id name slug owner { displayName username } audioLength plays picture { urlRoot } } cursor }
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
  return edges.map(({ node }) => {
    const urlRoot = node.picture?.urlRoot || "";
    const thumbnail = urlRoot
      ? `https://thumbnailer.mixcloud.com/unsafe/600x600/${urlRoot}`
      : "";
    return {
      id: node.id, name: node.name || "Unknown", slug: node.slug || "",
      owner: { displayName: node.owner?.displayName || node.owner?.username || "Unknown", username: node.owner?.username || "" },
      audioLength: node.audioLength || 0, plays: node.plays || 0,
      thumbnail,
    };
  });
}

// ── SoundCloud ────────────────────────────────────────────────────────────────
async function sclSearch(query) {
  const res = await global.axios.get(
    `${FOWN_API}/api/search?scsearch=${encodeURIComponent(query)}&svl=6`,
    { timeout: 30000 }
  );
  return res.data?.results || [];
}

module.exports = {
  config: {
    name:            "music",
    aliases:         ["nhac", "scl", "soundcloud", "sc", "spt", "spotify", "mixcloud", "mix", "mx", "yt", "youtube", "ytm", "ytmusic"],
    version:         "3.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Tìm & tải nhạc từ SoundCloud, Spotify, Mixcloud hoặc YouTube",
    commandCategory: "Giải Trí",
    usages: "music sc|spt|mix|yt <từ khóa>   — Tìm nhạc (SoundCloud / Spotify / Mixcloud / YouTube)",
    cooldowns: 5,
  },

  run: async ({ api, event, args, send, registerReply, commandName, threadID }) => {
    const FLAG_MAP = {
      sc: "sc", soundcloud: "sc", scl: "sc", nhac: "sc",
      spt: "spt", spotify: "spt",
      mix: "mix", mixcloud: "mix", mx: "mix",
      yt: "yt", youtube: "yt", ytm: "yt", ytmusic: "yt",
    };

    let platform = FLAG_MAP[commandName] || null;
    let queryArgs = args;

    if (platform) {
      // commandName là alias platform trực tiếp → args là query
    } else {
      // commandName là "music" → đọc arg đầu làm platform
      const sub = (args[0] || "").toLowerCase();
      if (FLAG_MAP[sub]) { platform = FLAG_MAP[sub]; queryArgs = args.slice(1); }
      else {
        return send(
          `🎵 MUSIC — TÌM & TẢI NHẠC\n━━━━━━━━━━━━━━━━\n` +
          `• .music sc <từ khóa>   → SoundCloud\n` +
          `• .music spt <từ khóa>  → Spotify\n` +
          `• .music mix <từ khóa>  → Mixcloud\n` +
          `• .music yt <từ khóa>   → YouTube\n\n` +
          `Ví dụ: .music yt bóng phù hoa`
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
        try { cardPath = await getCanvas().drawSearchCard({ platform: "sc", query, tracks: tracks.slice(0, 6) }); } catch (_) {}
        const sent = cardPath
          ? await api.sendMessage({ msg: "", attachments: [cardPath] }, threadID, event.type)
          : await send(`💬 Reply số từ 1-${Math.min(tracks.length, 6)} để tải nhạc`);
        if (cardPath) try { fs.unlinkSync(cardPath); } catch (_) {}
        const msgId = extractMsgId(sent);
        if (msgId) registerReply({ messageId: String(msgId), commandName: "music", payload: { platform: "sc", tracks } });

      } else if (platform === "spt") {
        const tracks = await sptSearch(query);
        if (!tracks.length) return send(`😔 Không tìm thấy kết quả cho "${query}"`);
        tracks.forEach(t => { t._durStr = t._durSec ? fmtDurationSec(t._durSec) : fmtDurationMs(t.duration); });
        let cardPath;
        try { cardPath = await getCanvas().drawSearchCard({ platform: "spt", query, tracks: tracks.slice(0, 6) }); } catch (_) {}
        const sent = cardPath
          ? await api.sendMessage({ msg: "", attachments: [cardPath] }, threadID, event.type)
          : await send(`📌 Reply STT (1–${Math.min(tracks.length, 6)}) để tải nhạc`);
        if (cardPath) try { fs.unlinkSync(cardPath); } catch (_) {}
        const msgId = extractMsgId(sent);
        if (msgId) registerReply({ messageId: String(msgId), commandName: "music", payload: { platform: "spt", tracks }, ttl: 10 * 60 * 1000 });

      } else if (platform === "yt") {
        const tracks = await ytSearch(query);
        if (!tracks.length) return send(`😔 Không tìm thấy kết quả cho "${query}"`);
        tracks.forEach(t => { t._durStr = t._durSec ? fmtDurationSec(t._durSec) : fmtDurationMs(t.duration); });
        let cardPath;
        try { cardPath = await getCanvas().drawSearchCard({ platform: "yt", query, tracks: tracks.slice(0, 6) }); } catch (_) {}
        const sent = cardPath
          ? await api.sendMessage({ msg: "", attachments: [cardPath] }, threadID, event.type)
          : await send(`🎬 Reply số từ 1-${Math.min(tracks.length, 6)} để tải nhạc`);
        if (cardPath) try { fs.unlinkSync(cardPath); } catch (_) {}
        const msgId = extractMsgId(sent);
        if (msgId) registerReply({ messageId: String(msgId), commandName: "music", payload: { platform: "yt", tracks }, ttl: 10 * 60 * 1000 });

      } else if (platform === "mix") {
        const results = await mixSearch(query);
        const top5 = results.slice(0, 5);
        const cardTracks = top5.map(r => ({
          title:     r.name,
          owner:     r.owner,
          _durStr:   formatDuration(r.audioLength),
          thumbnail: r.thumbnail || "",
        }));
        let cardPath;
        try { cardPath = await getCanvas().drawSearchCard({ platform: "mix", query, tracks: cardTracks }); } catch (_) {}
        const sent = cardPath
          ? await api.sendMessage({ msg: "", attachments: [cardPath] }, threadID, event.type)
          : await send(`💬 Reply số từ 1-5 để xem link Mixcloud`);
        if (cardPath) try { fs.unlinkSync(cardPath); } catch (_) {}
        const sentId = extractMsgId(sent);
        if (sentId) registerReply({ messageId: String(sentId), commandName: "music", payload: { platform: "mix", results } });
      }
    } catch (err) {
      console.error(`[MUSIC:${platform}] Lỗi tìm kiếm:`, err);
      return send(`❌ Lỗi tìm kiếm: ${stringifyError(err)}`);
    }
  },

  onReply: async ({ api, event, data, send }) => {
    const { platform, tracks = [], results = [] } = data || {};
    const raw    = event?.data ?? {};
    const body   = typeof raw.content === "string" ? raw.content : (raw.content?.text || raw.content?.msg || "");
    const numMatch = body.trim().replace(/@\S*/g, "").trim().match(/\d+/);
    const choice = numMatch ? parseInt(numMatch[0], 10) : NaN;

    async function addReactionWow() {
      try {
        const _raw = event?.data ?? {};
        const _mid = _raw?.msgId ?? _raw?.cliMsgId ?? _raw?.clientMsgId ?? null;
        const _cid = _raw?.cliMsgId ?? _raw?.clientMsgId ?? _mid ?? null;
        if (_mid || _cid) await api.addReaction(Reactions.WOW, { type: event.type, threadId: event.threadId, data: { msgId: _mid, cliMsgId: _cid } });
      } catch (_) {}
    }

    if (platform === "sc") {
      if (!tracks.length) return send("❌ Hết dữ liệu. Vui lòng tìm lại.");
      if (isNaN(choice) || choice < 1 || choice > tracks.length) return send(`⚠️ Reply số từ 1 đến ${tracks.length}`);
      const t = tracks[choice - 1];
      await addReactionWow();
      try {
        const res = await global.axios.get(
          `${FOWN_API}/api/media?url=${encodeURIComponent(t.url)}`,
          { timeout: 120000 }
        );
        const audioUrl = resolveUrl(res.data?.download_audio_url || res.data?.download_url);
        if (!audioUrl) return send("❌ Không lấy được link tải. Thử bài khác.");
        let cardPath;
        try {
          cardPath = await getCanvas().drawNowPlayingCard({
            platform: "sc",
            title:    t.title,
            artist:   t.uploader,
            duration: fmtDurationSec(t.duration),
            thumb:    t.thumbnail || t.artwork_url,
          });
        } catch (_) {}
        if (cardPath) {
          await api.sendMessage({ msg: "", attachments: [cardPath] }, event.threadId, event.type);
          try { fs.unlinkSync(cardPath); } catch (_) {}
        } else {
          const infoMsg = `✅ SoundCloud\n📝 ${t.title}\n👤 ${t.uploader}\n⏳ ${fmtDurationSec(t.duration)} · ▶️ ${fmtNum(t.view_count)}`;
          await api.sendMessage({ msg: infoMsg }, event.threadId, event.type);
        }
        await global.zaloSendVoice(api, audioUrl, event.threadId, event.type);
      } catch (err) { console.error("[MUSIC:scl] Lỗi tải nhạc:", err?.message || err); return send("❌ Lỗi tải nhạc: " + stringifyError(err)); }

    } else if (platform === "spt") {
      if (!tracks.length) return send("❌ Hết dữ liệu. Vui lòng tìm lại.");
      if (isNaN(choice) || choice < 1 || choice > tracks.length) return send(`⚠️ Nhập số từ 1 đến ${tracks.length}.`);
      const track = tracks[choice - 1];
      await addReactionWow();
      try {
        const durStr = track._durSec ? fmtDurationSec(track._durSec) : fmtDurationMs(track.duration);
        let audioUrl = null;

        // Nếu đã có YouTube link (fallback), dùng luôn — ngược lại tìm trên YouTube
        let ytUrl = track._ytFallback && track.link ? track.link : null;
        if (!ytUrl) {
          const keyword   = `${track.title} ${track.author}`;
          const searchRes = await global.axios.get(
            `${FOWN_API}/api/search?ytsearch=${encodeURIComponent(keyword)}&svl=1`,
            { timeout: 30000 }
          );
          ytUrl = searchRes.data?.results?.[0]?.url || searchRes.data?.results?.[0]?.webpage_url;
        }
        if (!ytUrl) return send("❌ Không tìm thấy nhạc trên YouTube. Thử bài khác.");

        const mediaRes = await global.axios.get(
          `${FOWN_API}/api/media?url=${encodeURIComponent(ytUrl)}`,
          { timeout: 120000 }
        );
        audioUrl = resolveUrl(mediaRes.data?.download_audio_url || mediaRes.data?.download_url || null);

        if (!audioUrl) return send("❌ Không lấy được link tải. Thử lại sau.");
        let cardPath;
        try {
          cardPath = await getCanvas().drawNowPlayingCard({
            platform: "spt",
            title:    track.title,
            artist:   track.author,
            duration: durStr,
            thumb:    track.thumbnail || "",
          });
        } catch (_) {}
        if (cardPath) {
          await api.sendMessage({ msg: "", attachments: [cardPath] }, event.threadId, event.type);
          try { fs.unlinkSync(cardPath); } catch (_) {}
        } else {
          await send(`🎵 ${track.title}\n👤 ${track.author}\n⏳ ${durStr}`);
        }
        await global.zaloSendVoice(api, audioUrl, event.threadId, event.type);
      } catch (err) { console.error("[MUSIC:spt] Lỗi tải nhạc:", err); return send(`❌ Lỗi tải nhạc: ${stringifyError(err)}`); }

    } else if (platform === "yt") {
      if (!tracks.length) return send("❌ Hết dữ liệu. Vui lòng tìm lại.");
      if (isNaN(choice) || choice < 1 || choice > tracks.length) return send(`⚠️ Nhập số từ 1 đến ${tracks.length}.`);
      const track = tracks[choice - 1];
      await addReactionWow();
      try {
        const durStr = track._durSec ? fmtDurationSec(track._durSec) : fmtDurationMs(track.duration);
        const ytUrl  = track.link || track.url || "";
        if (!ytUrl) return send("❌ Không có link. Thử lại sau.");
        const mediaRes = await global.axios.get(
          `${FOWN_API}/api/media?url=${encodeURIComponent(ytUrl)}`,
          { timeout: 120000 }
        );
        const audioUrl = resolveUrl(mediaRes.data?.download_audio_url || mediaRes.data?.download_url || null);
        if (!audioUrl) return send("❌ Không lấy được link tải. Thử bài khác.");
        let cardPath;
        try {
          cardPath = await getCanvas().drawNowPlayingCard({
            platform: "yt",
            title:    track.title,
            artist:   track.author,
            duration: durStr,
            thumb:    track.thumbnail || "",
          });
        } catch (_) {}
        if (cardPath) {
          await api.sendMessage({ msg: "", attachments: [cardPath] }, event.threadId, event.type);
          try { fs.unlinkSync(cardPath); } catch (_) {}
        } else {
          await send(`🎬 ${track.title}\n👤 ${track.author}\n⏳ ${durStr}`);
        }
        await global.zaloSendVoice(api, audioUrl, event.threadId, event.type);
      } catch (err) { console.error("[MUSIC:yt] Lỗi tải nhạc:", err); return send(`❌ Lỗi tải nhạc: ${stringifyError(err)}`); }

    } else if (platform === "mix") {
      if (!results.length) return send("❌ Hết dữ liệu. Vui lòng tìm lại.");
      if (isNaN(choice) || choice < 1 || choice > 5 || !results[choice - 1]) return send("⚠️ Chọn số từ 1-5.");
      const r = results[choice - 1];
      const mixUrl = `https://www.mixcloud.com/${r.owner.username}/${r.slug}`;
      await addReactionWow();
      let cardPath;
      try {
        cardPath = await getCanvas().drawNowPlayingCard({
          platform: "mix",
          title:    r.name,
          artist:   r.owner.displayName,
          duration: formatDuration(r.audioLength),
          thumb:    r.thumbnail || "",
        });
      } catch (_) {}
      let audioUrl = null;
      try {
        const mediaRes = await global.axios.get(
          `${FOWN_API}/api/media?url=${encodeURIComponent(mixUrl)}`,
          { timeout: 20000 }
        );
        audioUrl = resolveUrl(mediaRes.data?.download_audio_url || mediaRes.data?.download_url || null);
      } catch (_) {}
      const fallbackText = `🎵 ${r.name}\n👤 ${r.owner.displayName}\n⏳ ${formatDuration(r.audioLength)}\n🔗 ${mixUrl}`;
      if (cardPath) {
        await api.sendMessage({ msg: audioUrl ? "" : `🔗 ${mixUrl}`, attachments: [cardPath] }, event.threadId, event.type);
        try { fs.unlinkSync(cardPath); } catch (_) {}
      } else {
        await send(fallbackText);
      }
      if (audioUrl) {
        await global.zaloSendVoice(api, audioUrl, event.threadId, event.type);
      }
    }
  },
};

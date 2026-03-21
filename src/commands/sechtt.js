"use strict";

/**
 * src/commands/sechtt.js
 * Tìm kiếm video TikTok qua fown API (tikwm backend)
 * Gửi video đúng format — dùng githubUpload → raw.githubusercontent.com URL
 */

const fs   = require("fs");
const path = require("path");
const { Reactions } = require("zca-js");
const axios = require("axios");

const FOWN_API = "https://fown.onrender.com";
const TEMP_DIR = path.join(process.cwd(), "includes", "cache");

function fmtNum(n) {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

function fmtDuration(sec) {
  const s = Math.round(Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function uniqueId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function cleanup(...files) {
  setTimeout(() => {
    files.forEach(f => {
      try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    });
  }, 10000);
}

async function downloadFile(url, filePath) {
  const res = await axios.get(url, {
    responseType:      "arraybuffer",
    timeout:           180000,
    maxContentLength:  500 * 1024 * 1024,
    headers: { "User-Agent": global.userAgent || "Mozilla/5.0" },
  });
  fs.writeFileSync(filePath, Buffer.from(res.data));
  return res.headers["content-type"] || "";
}

async function searchTikTok(query, limit = 8) {
  const res = await global.axios.get(
    `${FOWN_API}/api/search?ttsearch=${encodeURIComponent(query)}&svl=${limit}`,
    { timeout: 30000 }
  );
  return res.data?.results || [];
}

function buildResultList(results) {
  const lines = [
    `🎵 KẾT QUẢ TIKTOK`,
    `━━━━━━━━━━━━━━━━`,
  ];
  results.forEach((r, i) => {
    const dur   = r.duration ? ` · ⏱ ${fmtDuration(r.duration)}` : "";
    const views = r.view_count ? ` · 👁 ${fmtNum(r.view_count)}` : "";
    const title = (r.title || "Không có tiêu đề").slice(0, 60);
    lines.push(`${i + 1}. ${title}${dur}${views}`);
    lines.push(`   👤 ${r.uploader || "Ẩn danh"}`);
  });
  lines.push(`━━━━━━━━━━━━━━━━`);
  lines.push(`💬 Reply số từ 1-${results.length} để tải video`);
  return lines.join("\n");
}

// ── Lấy video URL không watermark từ tikwm ──────────────────────────────────
async function getTikwmVideoUrl(tiktokUrl) {
  const body = new URLSearchParams({ url: tiktokUrl }).toString();
  const res  = await axios.post("https://www.tikwm.com/api/", body, {
    timeout: 30000,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (res.data?.code !== 0) throw new Error(`tikwm lỗi code ${res.data?.code}`);
  const d = res.data.data;
  return {
    videoUrl:  d.play || d.wmplay || null,
    thumbnail: d.cover   || "",
    duration:  d.duration || 0,
    width:     d.width   || 576,
    height:    d.height  || 1024,
    images:    Array.isArray(d.images) ? d.images : null,
  };
}

module.exports = {
  config: {
    name:            "sechtt",
    aliases:         ["searchtiktok", "timtt", "tiktoksearch", "ttfind"],
    version:         "2.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Tìm kiếm video TikTok và tải về",
    commandCategory: "Giải Trí",
    usages: [
      "sechtt <từ khóa>         — Tìm 8 video TikTok",
      "sechtt <từ khóa> <số>    — Tìm n video (vd: sechtt gái mup 15)",
      "sechtt <từ khóa> -n <số> — Tương tự, cả 2 format đều dùng được",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ api, event, args, send, registerReply, threadID }) => {
    if (!args.length) {
      return send(
        `🎵 SECHTT — TÌM KIẾM TIKTOK\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Cách dùng:\n` +
        `  • .sechtt <từ khóa>\n` +
        `  • .sechtt <từ khóa> -n 15\n\n` +
        `Ví dụ: .sechtt mèo hài hước`
      );
    }

    let limit = 8;
    let queryArgs = [...args];

    // Dạng -n <số>
    const nIdx = queryArgs.findIndex(a => a === "-n");
    if (nIdx !== -1 && queryArgs[nIdx + 1]) {
      const parsed = parseInt(queryArgs[nIdx + 1], 10);
      if (!isNaN(parsed) && parsed >= 1) limit = Math.min(parsed, 50);
      queryArgs.splice(nIdx, 2);
    } else {
      // Dạng số cuối không có -n: .sechtt gái mup 15
      const last = queryArgs[queryArgs.length - 1];
      const parsed = parseInt(last, 10);
      if (!isNaN(parsed) && parsed >= 1 && String(parsed) === last) {
        limit = Math.min(parsed, 50);
        queryArgs = queryArgs.slice(0, -1);
      }
    }

    const query = queryArgs.join(" ").trim();
    if (!query) return send("⚠️ Nhập từ khóa tìm kiếm. Ví dụ: .sechtt mèo hài hước");

    await send(`🔍 Đang tìm TikTok: "${query}"...`);

    let results;
    try {
      results = await searchTikTok(query, limit);
    } catch (err) {
      return send(`❌ Lỗi tìm kiếm: ${err?.message || "Không xác định"}`);
    }

    if (!results.length) return send(`😔 Không tìm thấy video TikTok cho "${query}"`);

    const listMsg = buildResultList(results);
    const sent = await send(listMsg);
    const msgId = sent?.message?.msgId ?? sent?.attachment?.[0]?.msgId ?? sent?.msgId;
    if (msgId) {
      registerReply({
        messageId:   String(msgId),
        commandName: "sechtt",
        payload:     { results, query },
      });
    }
  },

  onReply: async ({ api, event, data, send }) => {
    const { results = [] } = data || {};
    const raw      = event?.data ?? {};
    const body     = typeof raw.content === "string" ? raw.content : (raw.content?.text || raw.content?.msg || "");
    const numMatch = body.trim().replace(/@\S*/g, "").trim().match(/\d+/);
    const choice   = numMatch ? parseInt(numMatch[0], 10) : NaN;

    if (!results.length) return send("❌ Hết dữ liệu. Vui lòng tìm lại.");
    if (isNaN(choice) || choice < 1 || choice > results.length) {
      return send(`⚠️ Reply số từ 1 đến ${results.length}`);
    }

    const video = results[choice - 1];

    try {
      const _mid = raw?.msgId ?? raw?.cliMsgId ?? raw?.clientMsgId ?? null;
      const _cid = raw?.cliMsgId ?? raw?.clientMsgId ?? _mid ?? null;
      if (_mid || _cid) await api.addReaction(Reactions.WOW, { type: event.type, threadId: event.threadId, data: { msgId: _mid, cliMsgId: _cid } });
    } catch (_) {}

    const title    = (video.title || "TikTok video").slice(0, 80);
    const uploader = video.uploader || "Ẩn danh";
    const dur      = video.duration ? fmtDuration(video.duration) : "?:??";
    const views    = video.view_count ? fmtNum(video.view_count) : "0";
    const caption  = `📄 ${title}\n👤 ${uploader} · ⏱ ${dur} · 👁 ${views}`;

    await send(`⏳ Đang xử lý...\n🎬 ${title}\n👤 ${uploader}`);

    const uid     = uniqueId();
    const rawPath = path.join(TEMP_DIR, `tt_raw_${uid}.mp4`);

    try {
      if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

      // ── Bước 1: Lấy direct URL từ tikwm ──────────────────────────────────
      let tikInfo;
      try {
        tikInfo = await getTikwmVideoUrl(video.url);
      } catch (e) {
        return send(`❌ Không lấy được video: ${e.message}`);
      }

      // Slideshow ảnh
      if (tikInfo.images?.length) {
        const imgPaths = [];
        try {
          for (const imgUrl of tikInfo.images.slice(0, 6)) {
            const p = path.join(TEMP_DIR, `tt_img_${uniqueId()}.jpg`);
            try { await downloadFile(imgUrl, p); imgPaths.push(p); } catch (_) {}
          }
          if (imgPaths.length) {
            await api.sendMessage({ msg: caption, attachments: imgPaths }, event.threadId, event.type);
          }
        } finally {
          cleanup(...imgPaths);
        }
        return;
      }

      if (!tikInfo.videoUrl) return send("❌ Không tìm được link video. Thử bài khác.");

      // ── Bước 2: Tải video về local ────────────────────────────────────────
      await downloadFile(tikInfo.videoUrl, rawPath);
      const fileSize = fs.statSync(rawPath).size;

      // ── Bước 3: Upload GitHub → sendVideo với raw URL ─────────────────────
      if (typeof global.githubUpload === "function" && fileSize < 50 * 1024 * 1024) {
        try {
          const ghUrl = await global.githubUpload(rawPath, `sechtt/vid_${uid}.mp4`);
          if (ghUrl) {
            await api.sendVideo({
              videoUrl:     ghUrl,
              thumbnailUrl: tikInfo.thumbnail || "",
              msg:          caption,
              width:        tikInfo.width  || 576,
              height:       tikInfo.height || 1024,
              duration:     (tikInfo.duration || 0) * 1000,
              fileSize:     fileSize,
              ttl:          500_000,
            }, event.threadId, event.type);
            logInfo?.("[sechtt] sendVideo (GitHub) thành công.");
            return;
          }
        } catch (ghErr) {
          logWarn?.(`[sechtt] githubUpload/sendVideo thất bại: ${ghErr.message}`);
        }
      }

      // ── Bước 4: Fallback — gửi file MP4 ──────────────────────────────────
      await api.sendMessage(
        { msg: caption, attachments: [rawPath], ttl: 500_000 },
        event.threadId, event.type
      );

    } catch (err) {
      return send(`❌ Lỗi tải video: ${err?.message || "Không xác định"}`);
    } finally {
      cleanup(rawPath);
    }
  },
};

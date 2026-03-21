"use strict";

/**
 * src/commands/sechtt.js
 * Tìm kiếm video TikTok qua fown API (tikwm backend)
 * Hỗ trợ: xem kết quả + tải video theo số thứ tự
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { Reactions } = require("zca-js");

const FOWN_API = "https://fown.onrender.com";

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

module.exports = {
  config: {
    name:            "sechtt",
    aliases:         ["searchtiktok", "timtt", "tiktoksearch", "ttfind"],
    version:         "1.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Tìm kiếm video TikTok và tải về",
    commandCategory: "Giải Trí",
    usages: [
      "sechtt <từ khóa>         — Tìm 8 video TikTok",
      "sechtt <từ khóa> -n <số> — Tìm n video (tối đa 20)",
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
    const nIdx = queryArgs.findIndex(a => a === "-n");
    if (nIdx !== -1 && queryArgs[nIdx + 1]) {
      const parsed = parseInt(queryArgs[nIdx + 1], 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 20) limit = parsed;
      queryArgs.splice(nIdx, 2);
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
    const { results = [], query = "" } = data || {};
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
      const _raw = event?.data ?? {};
      const _mid = _raw?.msgId ?? _raw?.cliMsgId ?? _raw?.clientMsgId ?? null;
      const _cid = _raw?.cliMsgId ?? _raw?.clientMsgId ?? _mid ?? null;
      if (_mid || _cid) await api.addReaction(Reactions.WOW, { type: event.type, threadId: event.threadId, data: { msgId: _mid, cliMsgId: _cid } });
    } catch (_) {}

    const title    = (video.title || "TikTok video").slice(0, 80);
    const uploader = video.uploader || "Ẩn danh";
    const dur      = video.duration ? fmtDuration(video.duration) : "?:??";
    const views    = video.view_count ? fmtNum(video.view_count) : "0";

    await send(`⏳ Đang tải video...\n🎬 ${title}\n👤 ${uploader} · ⏱ ${dur} · 👁 ${views}`);

    try {
      const downloadRes = await global.axios.get(
        `${FOWN_API}/api/download?url=${encodeURIComponent(video.url)}&format=best`,
        { timeout: 120000 }
      );

      let videoUrl = downloadRes.data?.raw_url || downloadRes.data?.url || null;

      if (!videoUrl) {
        const mediaRes = await global.axios.get(
          `${FOWN_API}/api/media?url=${encodeURIComponent(video.url)}`,
          { timeout: 60000 }
        );
        videoUrl = mediaRes.data?.download_url || mediaRes.data?.download_audio_url || null;
      }

      if (!videoUrl) return send("❌ Không lấy được link tải. Thử video khác.");

      try {
        await api.sendVideo({ videoUrl }, event.threadId, event.type);
      } catch {
        let tmpPath;
        try {
          await send("⏳ File lớn, đang tải về để gửi...").catch(() => {});
          const ext = "mp4";
          tmpPath = path.join(os.tmpdir(), `mizai_tt_${Date.now()}.${ext}`);
          const writer = fs.createWriteStream(tmpPath);
          const fileRes = await global.axios.get(videoUrl, { responseType: "stream", timeout: 0 });
          await new Promise((resolve, reject) => {
            fileRes.data.pipe(writer);
            writer.on("finish", resolve);
            writer.on("error", reject);
          });
          await api.sendMessage({ attachments: [tmpPath] }, event.threadId, event.type);
        } catch (dlErr) {
          return send(`❌ Không gửi được video: ${dlErr?.message || "Lỗi không xác định"}\n🔗 ${videoUrl}`);
        } finally {
          if (tmpPath) try { fs.unlinkSync(tmpPath); } catch (_) {}
        }
      }
    } catch (err) {
      return send(`❌ Lỗi tải video: ${err?.message || "Không xác định"}`);
    }
  },
};

"use strict";

/**
 * Module: Sticker
 *
 * Cách dùng:
 *   !stk                — Reply vào ảnh/video → chuyển thành ảnh WebP 512×512
 *   !stk <từ khóa>      — Tìm sticker Zalo theo từ khóa, gửi tối đa 3 sticker
 *   !stk spin <từ khóa> — Tìm ngẫu nhiên 1 sticker Zalo
 *   !stk ai <mô tả>     — AI vẽ ảnh (Pollinations) → gửi dưới dạng ảnh
 */

const fs            = require("node:fs");
const path          = require("node:path");
const { exec }      = require("node:child_process");
const { promisify } = require("node:util");
const axios         = require("axios");
const ffmpegPath    = require("ffmpeg-static");
const { log }       = require("../../utils/system/logger");
const { resolveQuote } = require("../../utils/bot/messageUtils");

const execPromise = promisify(exec);

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpPath(prefix) {
  return path.join("/tmp", `${prefix}_${Date.now()}`);
}

function cleanup(...files) {
  for (const f of files) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

async function downloadToFile(url, destPath) {
  const resp = await axios.get(url, {
    responseType: "stream",
    timeout: 30_000,
    headers: { "User-Agent": global.userAgent || "Mozilla/5.0" },
  });
  const writer = fs.createWriteStream(destPath);
  resp.data.pipe(writer);
  await new Promise((res, rej) => {
    writer.on("finish", res);
    writer.on("error", rej);
  });
}

async function convertToWebp(inputPath, outputPath, isAnimated = false) {
  const scale = `scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000`;
  let cmd;
  if (isAnimated) {
    cmd = `"${ffmpegPath}" -y -i "${inputPath}" -vcodec libwebp -vf "${scale}" -loop 0 -preset default -an -vsync 0 -q:v 60 "${outputPath}"`;
  } else {
    cmd = `"${ffmpegPath}" -y -i "${inputPath}" -vcodec libwebp -vf "${scale}" -q:v 80 "${outputPath}"`;
  }
  await execPromise(cmd);
}

// ── Sticker Zalo API: search + send ──────────────────────────────────────────

async function searchAndSendStickers(api, keyword, threadID, threadType, count = 3) {
  const ids = await api.getStickers(keyword);
  if (!ids || ids.length === 0) return 0;

  const pick = ids.slice(0, count);
  const stickers = await api.getStickersDetail(pick);
  if (!stickers || stickers.length === 0) return 0;

  let sent = 0;
  for (const sticker of stickers) {
    if (!sticker?.id) continue;
    try {
      await api.sendSticker(sticker, threadID, threadType);
      sent++;
    } catch (e) {
      log.warn(`[STK] Gửi sticker ${sticker.id} lỗi: ${e.message}`);
    }
  }
  return sent;
}

// ── Sub-command: reply → WebP ─────────────────────────────────────────────────

async function handleFromReply({ api, event, send, threadID, threadType, reactLoading, reactSuccess, reactError }) {
  const raw    = event?.data || {};
  const quoted = await resolveQuote({ raw, api, threadId: threadID, event });

  if (!quoted?.isMedia || !quoted?.mediaUrl) {
    return send(
      `[ 🖼️ STK — CÁCH DÙNG ]\n` +
      `─────────────────────\n` +
      ` Reply ảnh/video → !stk\n` +
      ` Tìm sticker Zalo → !stk <từ khóa>\n` +
      ` Ngẫu nhiên       → !stk spin <từ khóa>\n` +
      ` AI vẽ            → !stk ai <mô tả>\n` +
      `─────────────────────`
    );
  }

  await reactLoading();

  const isAnimated = quoted.type === "video" || /\.gif($|\?)/i.test(quoted.mediaUrl);
  const inFile  = tmpPath("stk_in") + (isAnimated ? ".tmp" : ".tmp");
  const outFile = tmpPath("stk_out") + ".webp";

  try {
    await downloadToFile(quoted.mediaUrl, inFile);
    await convertToWebp(inFile, outFile, isAnimated);

    await send({ msg: "", attachments: [outFile] });
    await reactSuccess();
  } catch (e) {
    log.error("[STK] Lỗi xử lý:", e.message);
    await reactError();
    await send(`⚠️ Lỗi tạo sticker: ${e.message}`);
  } finally {
    cleanup(inFile, outFile);
  }
}

// ── Sub-command: search sticker Zalo ─────────────────────────────────────────

async function handleSearch({ api, send, threadID, threadType, keyword, count, reactLoading, reactSuccess, reactError }) {
  await reactLoading();
  try {
    const sent = await searchAndSendStickers(api, keyword, threadID, threadType, count);
    if (sent === 0) {
      await reactError();
      return send(`⚠️ Không tìm thấy sticker nào cho từ khóa "${keyword}".`);
    }
    await reactSuccess();
  } catch (e) {
    log.error("[STK-SEARCH] Lỗi:", e.message);
    await reactError();
    await send(`⚠️ Lỗi tìm sticker: ${e.message}`);
  }
}

// ── Sub-command: spin (1 sticker ngẫu nhiên) ─────────────────────────────────

async function handleSpin({ api, send, threadID, threadType, keyword, reactLoading, reactSuccess, reactError }) {
  await reactLoading();
  try {
    const ids = await api.getStickers(keyword);
    if (!ids || ids.length === 0) throw new Error("Không tìm thấy sticker nào.");

    const randomId = ids[Math.floor(Math.random() * ids.length)];
    const stickers = await api.getStickersDetail([randomId]);
    if (!stickers?.[0]?.id) throw new Error("Không lấy được thông tin sticker.");

    await api.sendSticker(stickers[0], threadID, threadType);
    await reactSuccess();
  } catch (e) {
    log.error("[STK-SPIN] Lỗi:", e.message);
    await reactError();
    await send(`⚠️ Lỗi: ${e.message}`);
  }
}

// ── Sub-command: AI vẽ ảnh ───────────────────────────────────────────────────

async function handleAi({ api, send, threadID, threadType, prompt, reactLoading, reactSuccess, reactError }) {
  await reactLoading();
  await send(`🎨 AI đang vẽ: "${prompt}"... (Đợi xíu nha)`);

  const aiUrl  = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true&seed=${Date.now()}`;
  const inFile  = tmpPath("ai_in")  + ".tmp";
  const outFile = tmpPath("ai_out") + ".webp";

  try {
    await downloadToFile(aiUrl, inFile);
    await convertToWebp(inFile, outFile, false);

    await send({ msg: `🖼️ "${prompt}"`, attachments: [outFile] });
    await reactSuccess();
  } catch (e) {
    log.error("[STK-AI] Lỗi:", e.message);
    await reactError();
    await send(`⚠️ AI vẽ lỗi: ${e.message}`);
  } finally {
    cleanup(inFile, outFile);
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name           : "stk",
    aliases        : ["sticker"],
    version        : "2.0.0",
    hasPermssion   : 0,
    credits        : "MiZai",
    description    : "Tạo/tìm sticker từ ảnh, video, Zalo library hoặc AI",
    commandCategory: "Tiện Ích",
    usages         : [
      "stk               — Reply ảnh/video → ảnh WebP 512×512",
      "stk <từ khóa>     — Tìm sticker Zalo (tối đa 3)",
      "stk spin <từ khóa>— Lấy ngẫu nhiên 1 sticker Zalo",
      "stk ai <mô tả>    — AI vẽ ảnh theo mô tả",
    ].join("\n"),
    cooldowns      : 5,
  },

  run: async ({
    api, event, args, send, threadID,
    reactLoading, reactSuccess, reactError,
  }) => {
    const threadType = event.type;
    const sub        = (args[0] || "").toLowerCase().trim();
    const restText   = args.slice(1).join(" ").trim();
    const ctx        = { api, event, send, threadID, threadType, reactLoading, reactSuccess, reactError };

    // Không có args → reply ảnh/video → WebP
    if (!sub) {
      return handleFromReply(ctx);
    }

    // !stk ai <prompt>
    if (sub === "ai") {
      if (!restText) return send("⚠️ Nhập mô tả.\nVí dụ: !stk ai mèo phi hành gia");
      return handleAi({ ...ctx, prompt: restText });
    }

    // !stk spin <keyword>
    if (sub === "spin") {
      if (!restText) return send("⚠️ Nhập từ khóa.\nVí dụ: !stk spin mèo");
      return handleSpin({ ...ctx, keyword: restText });
    }

    // !stk <keyword> → tìm sticker Zalo
    const keyword = args.join(" ").trim();
    return handleSearch({ ...ctx, keyword, count: 3 });
  },
};

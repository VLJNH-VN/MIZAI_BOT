"use strict";

/**
 * Module: Sticker
 *
 * Cách dùng:
 *   !stk                — Reply vào ảnh/video → chuyển thành WebP 512×512 và gửi
 *   !stk <từ khóa>      — Tìm sticker Zalo theo từ khóa, gửi tối đa 3 sticker
 *   !stk spin <từ khóa> — Tìm ngẫu nhiên 1 sticker Zalo
 *   !stk ai <mô tả>     — AI vẽ ảnh (Pollinations) → gửi dưới dạng ảnh
 */

const fs            = require("node:fs");
const path          = require("node:path");
const { exec, execSync } = require("node:child_process");
const { promisify } = require("node:util");
const FormData      = require("form-data");
const axios         = require("axios");
const { logError, logWarn, logInfo } = require("../../utils/system/logger");
const { resolveQuote } = require("../../utils/bot/messageUtils");

const execPromise = promisify(exec);

// ── ffmpeg path (ưu tiên ffmpeg-static, fallback system ffmpeg) ───────────────
const ffmpegPath = (() => {
  try {
    const p = require("ffmpeg-static");
    if (p && fs.existsSync(p)) return p;
  } catch {}
  try { return execSync("which ffmpeg", { encoding: "utf8" }).trim(); } catch {}
  return "ffmpeg";
})();

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

async function getContentType(url) {
  try {
    const resp = await axios.head(url, {
      timeout: 8_000,
      headers: { "User-Agent": global.userAgent || "Mozilla/5.0" },
    });
    return (resp.headers["content-type"] || "").toLowerCase();
  } catch {
    return "";
  }
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

// ── GitHub upload ─────────────────────────────────────────────────────────────

async function uploadToGithub(filePath, fileName) {
  const { githubToken, repo, branch } = global.config || {};
  if (!githubToken || !repo || !branch) {
    throw new Error("Chưa cấu hình githubToken/repo/branch trong config.json");
  }

  const remotePath = `stickers/${fileName}`;
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${remotePath}`;
  const headers = {
    Authorization: `token ${githubToken}`,
    "Content-Type": "application/json",
  };

  let sha;
  try {
    const res = await axios.get(apiUrl, { headers, timeout: 15_000 });
    sha = res.data.sha;
  } catch (err) {
    if (err.response?.status !== 404) throw err;
  }

  const content = fs.readFileSync(filePath).toString("base64");
  await axios.put(apiUrl, {
    message: `[sticker] Upload ${fileName}`,
    content,
    branch,
    ...(sha ? { sha } : {}),
  }, { headers, timeout: 30_000 });

  const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${remotePath}`;
  logInfo(`[STK] Upload GitHub thành công: ${rawUrl}`);
  return rawUrl;
}

// ── Gửi WebP dưới dạng ảnh đính kèm ─────────────────────────────────────────

async function sendWebpFile(api, filePath, threadID, threadType) {
  await api.sendMessage({ msg: "", attachments: [filePath] }, threadID, threadType);
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
      logWarn(`[STK] Gửi sticker ${sticker.id} lỗi: ${e.message}`);
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

  let isAnimated = /\.gif($|\?)/i.test(quoted.mediaUrl);
  if (!isAnimated) {
    const ct = await getContentType(quoted.mediaUrl);
    isAnimated = ct.includes("video") || ct.includes("gif");
  }

  const inFile  = tmpPath("stk_in")  + ".tmp";
  const outFile = tmpPath("stk_out") + ".webp";

  try {
    await downloadToFile(quoted.mediaUrl, inFile);
    await convertToWebp(inFile, outFile, isAnimated);
    await sendWebpFile(api, outFile, threadID, threadType);
    await reactSuccess();
  } catch (e) {
    logError("[STK] Lỗi xử lý:", e.message);
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
    logError("[STK-SEARCH] Lỗi:", e.message);
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
    logError("[STK-SPIN] Lỗi:", e.message);
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
    await sendWebpFile(api, outFile, threadID, threadType);
    await reactSuccess();
  } catch (e) {
    logError("[STK-AI] Lỗi:", e.message);
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
    version        : "2.2.0",
    hasPermssion   : 0,
    credits        : "MiZai",
    description    : "Tạo/tìm sticker từ ảnh, video, Zalo library hoặc AI",
    commandCategory: "Tiện Ích",
    usages         : [
      "stk               — Reply ảnh/video → WebP 512×512",
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

    if (!sub) return handleFromReply(ctx);

    if (sub === "ai") {
      if (!restText) return send("⚠️ Nhập mô tả.\nVí dụ: !stk ai mèo phi hành gia");
      return handleAi({ ...ctx, prompt: restText });
    }

    if (sub === "spin") {
      if (!restText) return send("⚠️ Nhập từ khóa.\nVí dụ: !stk spin mèo");
      return handleSpin({ ...ctx, keyword: restText });
    }

    const keyword = args.join(" ").trim();
    return handleSearch({ ...ctx, keyword, count: 3 });
  },
};

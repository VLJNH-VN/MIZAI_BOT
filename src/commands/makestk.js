"use strict";

/**
 * src/commands/makestk.js
 * Tạo sticker-like PNG/WebP cho Zalo
 *
 * Cách dùng:
 *   .makestk <text hoặc emoji>          → Tạo text sticker PNG
 *   .makestk webp <text hoặc emoji>     → Tạo text sticker WebP
 *   .makestk (reply ảnh)                → Chuyển ảnh thành sticker PNG bo góc
 *   .makestk webp (reply ảnh)           → Chuyển ảnh thành sticker WebP bo góc
 *   .makestk (reply video)              → Lấy frame từ video → sticker PNG
 *   .makestk webp (reply video)         → Lấy frame từ video → sticker WebP
 *   .makestk t=5 (reply video)          → Lấy frame tại giây thứ 5
 */

const { createCanvas, loadImage } = require("canvas");
const fs      = require("fs");
const path    = require("path");
const os      = require("os");
const axios   = require("axios");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

let _sharp;
function getSharp() {
  if (!_sharp) _sharp = require("sharp");
  return _sharp;
}

const STICKER_SIZE = 512;
const FFMPEG_BIN   = "ffmpeg";
const FFPROBE_BIN  = "ffprobe";

// ── Màu chủ đề ngẫu nhiên ─────────────────────────────────────────────────────
const THEMES = [
  { fill: "#ffffff", stroke: "#111111", shadow: "#00000088", glow: null },
  { fill: "#FFD700", stroke: "#8B4500", shadow: "#00000088", glow: "#FFD70066" },
  { fill: "#ff4b6e", stroke: "#ffffff", shadow: "#00000088", glow: "#ff4b6e55" },
  { fill: "#00e5ff", stroke: "#003c4a", shadow: "#00000088", glow: "#00e5ff55" },
  { fill: "#7fff00", stroke: "#1a4000", shadow: "#00000088", glow: "#7fff0055" },
  { fill: "#ff9a00", stroke: "#4a2700", shadow: "#00000088", glow: "#ff9a0055" },
  { fill: "#e040fb", stroke: "#1a0033", shadow: "#00000088", glow: "#e040fb55" },
];

function pickTheme(seed) {
  const idx = Math.abs(seed || 0) % THEMES.length;
  return THEMES[idx];
}

// ── Tính font size tự động theo độ dài text ───────────────────────────────────
function autoFontSize(text) {
  const len = [...text].length;
  if (len <= 2)  return 220;
  if (len <= 4)  return 160;
  if (len <= 8)  return 110;
  if (len <= 16) return 80;
  return 58;
}

// ── Vẽ text wrap ──────────────────────────────────────────────────────────────
function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? cur + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ── Tải file từ URL về buffer ─────────────────────────────────────────────────
async function fetchBuffer(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer":    "https://www.google.com/",
    },
  });
  return Buffer.from(res.data);
}

// ── Tải file từ URL xuống đường dẫn local ────────────────────────────────────
async function downloadFile(url, dest) {
  const res = await axios.get(url, {
    responseType: "stream",
    timeout: 60000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer":    "https://www.google.com/",
    },
  });
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(dest);
    res.data.pipe(ws);
    ws.on("finish", resolve);
    ws.on("error", reject);
  });
}

// ── Lấy thời lượng video bằng ffprobe ────────────────────────────────────────
async function getVideoDuration(videoPath) {
  try {
    const { stdout } = await execFileAsync(FFPROBE_BIN, [
      "-v", "quiet",
      "-print_format", "json",
      "-show_streams",
      "-select_streams", "v:0",
      videoPath,
    ], { timeout: 15000 });
    const info = JSON.parse(stdout);
    const stream = info?.streams?.[0];
    const dur = parseFloat(stream?.duration || "0");
    return isNaN(dur) ? 0 : dur;
  } catch {
    return 0;
  }
}

// ── Trích frame từ video bằng ffmpeg ─────────────────────────────────────────
async function extractFrame(videoPath, seekSec, outputPath) {
  const seekStr = String(Math.max(0, seekSec).toFixed(3));
  await execFileAsync(FFMPEG_BIN, [
    "-y",
    "-ss", seekStr,
    "-i", videoPath,
    "-frames:v", "1",
    "-q:v", "2",
    "-f", "image2",
    outputPath,
  ], { timeout: 30000 });
}

// ── Tạo text sticker ──────────────────────────────────────────────────────────
async function makeTextSticker(text, theme, outputFormat = "png") {
  const S   = STICKER_SIZE;
  const PAD = 40;

  const canvas = createCanvas(S, S);
  const ctx    = canvas.getContext("2d");

  ctx.clearRect(0, 0, S, S);

  const fontSize = autoFontSize(text);
  ctx.font = `bold ${fontSize}px "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;

  const maxW  = S - PAD * 2;
  const lines = wrapText(ctx, text, maxW);
  const lineH = fontSize * 1.2;
  const totalH = lines.length * lineH;
  const startY = (S - totalH) / 2 + fontSize * 0.8;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lw   = ctx.measureText(line).width;
    const x    = (S - lw) / 2;
    const y    = startY + i * lineH;

    if (theme.glow) {
      ctx.save();
      ctx.shadowColor = theme.glow;
      ctx.shadowBlur  = 30;
      ctx.fillStyle   = theme.glow;
      ctx.fillText(line, x, y);
      ctx.restore();
    }

    ctx.save();
    ctx.shadowColor   = theme.shadow;
    ctx.shadowBlur    = 12;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 4;
    ctx.strokeStyle   = theme.stroke;
    ctx.lineWidth     = Math.max(6, Math.round(fontSize * 0.12));
    ctx.lineJoin      = "round";
    ctx.strokeText(line, x, y);
    ctx.fillStyle = theme.fill;
    ctx.fillText(line, x, y);
    ctx.restore();
  }

  const pngBuf = canvas.toBuffer("image/png");

  if (outputFormat === "webp") {
    const webpBuf = await getSharp()(pngBuf)
      .resize(S, S, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 90, lossless: false, alphaQuality: 100 })
      .toBuffer();
    return { buffer: webpBuf, ext: "webp" };
  }

  return { buffer: pngBuf, ext: "png" };
}

// ── Chuyển ảnh/buffer thành sticker (bo góc + transparent) ───────────────────
async function makeImageSticker(imageSource, outputFormat = "png") {
  const S = STICKER_SIZE;
  const R = 60;

  const imgBuf = Buffer.isBuffer(imageSource)
    ? imageSource
    : await fetchBuffer(imageSource);

  const resized = await getSharp()(imgBuf)
    .resize(S, S, { fit: "cover", position: "center" })
    .png()
    .toBuffer();

  const canvas = createCanvas(S, S);
  const ctx    = canvas.getContext("2d");
  ctx.clearRect(0, 0, S, S);

  ctx.beginPath();
  ctx.moveTo(R, 0);
  ctx.lineTo(S - R, 0);
  ctx.quadraticCurveTo(S, 0, S, R);
  ctx.lineTo(S, S - R);
  ctx.quadraticCurveTo(S, S, S - R, S);
  ctx.lineTo(R, S);
  ctx.quadraticCurveTo(0, S, 0, S - R);
  ctx.lineTo(0, R);
  ctx.quadraticCurveTo(0, 0, R, 0);
  ctx.closePath();
  ctx.clip();

  const img = await loadImage(resized);
  ctx.drawImage(img, 0, 0, S, S);

  const pngBuf = canvas.toBuffer("image/png");

  if (outputFormat === "webp") {
    const webpBuf = await getSharp()(pngBuf)
      .webp({ quality: 90, lossless: false, alphaQuality: 100 })
      .toBuffer();
    return { buffer: webpBuf, ext: "webp" };
  }

  return { buffer: pngBuf, ext: "png" };
}

// ── Tạo sticker từ video (trích frame) ───────────────────────────────────────
async function makeVideoSticker(videoUrl, seekSec, outputFormat = "png") {
  const tmpId   = Date.now();
  const vidPath = path.join(os.tmpdir(), `stk_vid_${tmpId}.mp4`);
  const frmPath = path.join(os.tmpdir(), `stk_frm_${tmpId}.jpg`);

  try {
    // Tải video về local
    await downloadFile(videoUrl, vidPath);

    // Nếu không chỉ định giây, lấy frame ở giữa video
    let seek = seekSec;
    if (seek == null) {
      const dur = await getVideoDuration(vidPath);
      seek = dur > 2 ? Math.min(dur * 0.3, dur - 0.5) : 0;
    }

    // Trích frame
    await extractFrame(vidPath, seek, frmPath);

    if (!fs.existsSync(frmPath)) throw new Error("ffmpeg không trích được frame");

    const frameBuf = fs.readFileSync(frmPath);
    return await makeImageSticker(frameBuf, outputFormat);
  } finally {
    for (const f of [vidPath, frmPath]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    }
  }
}

// ── Lưu buffer ra file tạm ────────────────────────────────────────────────────
function saveTmp(buffer, ext) {
  const filePath = path.join(os.tmpdir(), `stk_out_${Date.now()}.${ext}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// ── Parse t=N từ args ────────────────────────────────────────────────────────
function parseSeek(args) {
  const idx = args.findIndex(a => /^t=\d+(\.\d+)?$/i.test(a));
  if (idx === -1) return { seekSec: null, filteredArgs: args };
  const seekSec = parseFloat(args[idx].slice(2));
  const filteredArgs = args.filter((_, i) => i !== idx);
  return { seekSec, filteredArgs };
}

// ── Lấy URL (ảnh hoặc video) từ quoted/reply event ───────────────────────────
function getQuoteMedia(event) {
  const raw   = event?.data ?? {};
  const quote = raw.quote || raw.refMessage || raw.quotedMsg || null;

  if (!quote) return { imageUrl: null, videoUrl: null };

  // Thử lấy từ attach array
  let items = quote.attach;
  if (typeof items === "string") {
    try { items = JSON.parse(items); } catch { items = null; }
  }

  const checkItem = (a) => {
    if (!a || typeof a !== "object") return null;

    // Ưu tiên video
    const videoUrl = a.videoUrl || a.video_url || null;
    if (videoUrl && typeof videoUrl === "string" && videoUrl.startsWith("http"))
      return { type: "video", url: videoUrl };

    // Ảnh
    const imgUrl = a.hdUrl || a.normalUrl || a.href || a.url || null;
    if (imgUrl && typeof imgUrl === "string" && imgUrl.startsWith("http")) {
      // Phân loại theo đuôi / mime
      const isVid = /\.(mp4|mov|avi|mkv|webm|3gp|flv|ts|m3u8)/i.test(imgUrl)
                    || (a.fileType || "").toLowerCase().includes("video");
      return { type: isVid ? "video" : "image", url: imgUrl };
    }
    return null;
  };

  if (Array.isArray(items)) {
    for (const a of items) {
      const r = checkItem(a);
      if (r) return r.type === "video"
        ? { imageUrl: null, videoUrl: r.url }
        : { imageUrl: r.url, videoUrl: null };
    }
  } else if (items && typeof items === "object") {
    const r = checkItem(items);
    if (r) return r.type === "video"
      ? { imageUrl: null, videoUrl: r.url }
      : { imageUrl: r.url, videoUrl: null };
  }

  // Fallback: field trực tiếp trên quote
  const directVideoUrl = quote.videoUrl || quote.video_url || null;
  if (directVideoUrl && typeof directVideoUrl === "string" && directVideoUrl.startsWith("http"))
    return { imageUrl: null, videoUrl: directVideoUrl };

  const directImgUrl = quote.hdUrl || quote.normalUrl || quote.href || quote.url || null;
  if (directImgUrl && typeof directImgUrl === "string" && directImgUrl.startsWith("http")) {
    const isVid = /\.(mp4|mov|avi|mkv|webm|3gp|flv|ts|m3u8)/i.test(directImgUrl);
    return isVid
      ? { imageUrl: null, videoUrl: directImgUrl }
      : { imageUrl: directImgUrl, videoUrl: null };
  }

  return { imageUrl: null, videoUrl: null };
}

// ── HELP ─────────────────────────────────────────────────────────────────────

const HELP_MSG =
  "🎨 MAKE STICKER (PNG/WebP)\n" +
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
  "• .makestk <text>              → Text sticker PNG\n" +
  "• .makestk webp <text>         → Text sticker WebP\n" +
  "• .makestk (reply ảnh)         → Ảnh → sticker PNG\n" +
  "• .makestk webp (reply ảnh)    → Ảnh → sticker WebP\n" +
  "• .makestk (reply video)       → Video → frame → sticker PNG\n" +
  "• .makestk webp (reply video)  → Video → frame → sticker WebP\n" +
  "• .makestk t=5 (reply video)   → Lấy frame tại giây thứ 5\n" +
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
  "Ví dụ:\n" +
  "  .makestk 🔥 Hot!\n" +
  "  .makestk webp Haha 😂\n" +
  "  (Reply ảnh/video) .makestk webp\n" +
  "  (Reply video) .makestk t=10";

// ── COMMAND ───────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name:            "makestk",
    aliases:         ["taostk", "createstk", "mstk"],
    version:         "2.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Tạo sticker PNG/WebP từ text, emoji, ảnh hoặc video",
    commandCategory: "Tiện Ích",
    usages:          HELP_MSG,
    cooldowns:       5,
  },

  run: async ({ api, event, args, send, threadID, reactLoading, reactSuccess, reactError }) => {
    // ── Parse --webp flag ─────────────────────────────────────────────────────
    let outputFormat = "png";
    let workArgs     = args;

    if ((workArgs[0] || "").toLowerCase() === "webp") {
      outputFormat = "webp";
      workArgs     = workArgs.slice(1);
    }

    // ── Parse t=N (seek giây) ─────────────────────────────────────────────────
    const { seekSec, filteredArgs } = parseSeek(workArgs);
    workArgs = filteredArgs;

    const text = workArgs.join(" ").trim();

    // ── Lấy media từ quoted message ──────────────────────────────────────────
    const { imageUrl, videoUrl } = getQuoteMedia(event);

    if (!text && !imageUrl && !videoUrl) return send(HELP_MSG);

    await reactLoading?.();

    let filePath = null;
    try {
      let result;

      if (videoUrl) {
        // ── Chế độ: video → frame → sticker
        await send(`⏳ Đang trích frame từ video → tạo sticker ${outputFormat.toUpperCase()}...`);
        result = await makeVideoSticker(videoUrl, seekSec, outputFormat);

      } else if (imageUrl && !text) {
        // ── Chế độ: ảnh → sticker
        await send(`⏳ Đang tạo sticker ${outputFormat.toUpperCase()} từ ảnh...`);
        result = await makeImageSticker(imageUrl, outputFormat);

      } else {
        // ── Chế độ: text sticker
        await send(`⏳ Đang tạo text sticker ${outputFormat.toUpperCase()}...`);
        const theme = pickTheme(text.charCodeAt(0));
        result = await makeTextSticker(text, theme, outputFormat);
      }

      filePath = saveTmp(result.buffer, result.ext);
      await api.sendMessage(
        { msg: "", attachments: [filePath] },
        threadID,
        event.type
      );
      await reactSuccess?.();

    } catch (err) {
      console.error("[MAKESTK] Lỗi:", err?.message || err);
      await send(`❌ Tạo sticker thất bại: ${err?.message || "Lỗi không xác định"}`);
      await reactError?.();
    } finally {
      if (filePath) try { fs.unlinkSync(filePath); } catch (_) {}
    }
  },
};

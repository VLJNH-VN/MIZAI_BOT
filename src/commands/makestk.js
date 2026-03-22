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
 */

const { createCanvas, loadImage } = require("canvas");
const fs   = require("fs");
const path = require("path");
const os   = require("os");
const axios = require("axios");

let _sharp;
function getSharp() {
  if (!_sharp) _sharp = require("sharp");
  return _sharp;
}

const STICKER_SIZE = 512;

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
function autoFontSize(text, maxW) {
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

// ── Tải ảnh từ URL ────────────────────────────────────────────────────────────
async function fetchBuffer(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": "https://www.google.com/",
    },
  });
  return Buffer.from(res.data);
}

// ── Tạo text sticker ──────────────────────────────────────────────────────────
async function makeTextSticker(text, theme, outputFormat = "png") {
  const S   = STICKER_SIZE;
  const PAD = 40;

  const canvas = createCanvas(S, S);
  const ctx    = canvas.getContext("2d");

  // Transparent background
  ctx.clearRect(0, 0, S, S);

  // Tự động chọn font size
  const fontSize = autoFontSize(text, S - PAD * 2);
  ctx.font = `bold ${fontSize}px "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;

  // Wrap text
  const maxW = S - PAD * 2;
  const lines = wrapText(ctx, text, maxW);
  const lineH = fontSize * 1.2;
  const totalH = lines.length * lineH;
  const startY = (S - totalH) / 2 + fontSize * 0.8;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lw   = ctx.measureText(line).width;
    const x    = (S - lw) / 2;
    const y    = startY + i * lineH;

    // Glow nếu có
    if (theme.glow) {
      ctx.save();
      ctx.shadowColor  = theme.glow;
      ctx.shadowBlur   = 30;
      ctx.fillStyle    = theme.glow;
      ctx.fillText(line, x, y);
      ctx.restore();
    }

    // Drop shadow
    ctx.save();
    ctx.shadowColor   = theme.shadow;
    ctx.shadowBlur    = 12;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 4;

    // Stroke (viền ngoài)
    ctx.strokeStyle = theme.stroke;
    ctx.lineWidth   = Math.max(6, Math.round(fontSize * 0.12));
    ctx.lineJoin    = "round";
    ctx.strokeText(line, x, y);

    // Fill
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
    return { buffer: webpBuf, ext: "webp", mime: "image/webp" };
  }

  return { buffer: pngBuf, ext: "png", mime: "image/png" };
}

// ── Chuyển ảnh thành sticker (bo góc + transparent) ──────────────────────────
async function makeImageSticker(imageUrl, outputFormat = "png") {
  const S = STICKER_SIZE;
  const R = 60; // border radius

  // Tải ảnh gốc
  const imgBuf = await fetchBuffer(imageUrl);

  // Resize ảnh về SxS (fit: cover, center)
  const resized = await getSharp()(imgBuf)
    .resize(S, S, { fit: "cover", position: "center" })
    .png()
    .toBuffer();

  // Vẽ lên canvas với rounded corners mask
  const canvas = createCanvas(S, S);
  const ctx    = canvas.getContext("2d");
  ctx.clearRect(0, 0, S, S);

  // Clip rounded rect
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
    return { buffer: webpBuf, ext: "webp", mime: "image/webp" };
  }

  return { buffer: pngBuf, ext: "png", mime: "image/png" };
}

// ── Lưu buffer ra file tạm ────────────────────────────────────────────────────
function saveTmp(buffer, ext) {
  const filePath = path.join(os.tmpdir(), `stk_${Date.now()}.${ext}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// ── Lấy image URL từ quoted/reply event ──────────────────────────────────────
function getQuoteImageUrl(event) {
  const raw = event?.data ?? {};

  // Zalo quote: raw.quote hoặc raw.refMessage
  const quote = raw.quote || raw.refMessage || raw.quotedMsg || null;
  if (quote) {
    const qAttach = quote.attach;
    if (qAttach) {
      let items = qAttach;
      if (typeof items === "string") {
        try { items = JSON.parse(items); } catch { items = null; }
      }
      if (Array.isArray(items) && items[0]) {
        const a = items[0];
        const url = a.hdUrl || a.normalUrl || a.href || a.url || null;
        if (url && typeof url === "string" && url.startsWith("http")) return url;
      }
      if (items && typeof items === "object" && !Array.isArray(items)) {
        const url = items.hdUrl || items.normalUrl || items.href || items.url || null;
        if (url && typeof url === "string" && url.startsWith("http")) return url;
      }
    }
    const qUrl = quote.hdUrl || quote.normalUrl || quote.href || quote.url || null;
    if (qUrl && typeof qUrl === "string" && qUrl.startsWith("http")) return qUrl;
  }

  return null;
}

// ── HELP ─────────────────────────────────────────────────────────────────────

const HELP_MSG =
  "🎨 MAKE STICKER (PNG/WebP)\n" +
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
  "• .makestk <text>            → Text sticker PNG\n" +
  "• .makestk webp <text>       → Text sticker WebP\n" +
  "• .makestk (reply ảnh)       → Ảnh → sticker PNG\n" +
  "• .makestk webp (reply ảnh)  → Ảnh → sticker WebP\n" +
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
  "Ví dụ:\n" +
  "  .makestk 🔥 Hot!\n" +
  "  .makestk webp Haha 😂\n" +
  "  (Reply ảnh) .makestk webp";

// ── COMMAND ───────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name:            "makestk",
    aliases:         ["taostk", "createstk", "mstk"],
    version:         "1.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Tạo sticker-like PNG/WebP từ text, emoji hoặc ảnh",
    commandCategory: "Tiện Ích",
    usages:          HELP_MSG,
    cooldowns:       5,
  },

  run: async ({ api, event, args, send, threadID }) => {
    let outputFormat = "png";
    let queryArgs    = args;

    if ((args[0] || "").toLowerCase() === "webp") {
      outputFormat = "webp";
      queryArgs    = args.slice(1);
    }

    const text = queryArgs.join(" ").trim();

    // ── Thử lấy ảnh từ quoted message ────────────────────────────────────────
    const quoteUrl = getQuoteImageUrl(event);

    if (!text && !quoteUrl) return send(HELP_MSG);

    await send(`⏳ Đang tạo sticker ${outputFormat.toUpperCase()}...`);

    let filePath = null;
    try {
      let result;

      if (quoteUrl && !text) {
        // Chế độ: convert ảnh thành sticker
        result = await makeImageSticker(quoteUrl, outputFormat);
      } else {
        // Chế độ: text sticker
        const theme = pickTheme(text.charCodeAt(0));
        result = await makeTextSticker(text, theme, outputFormat);
      }

      filePath = saveTmp(result.buffer, result.ext);
      await api.sendMessage(
        { msg: "", attachments: [filePath] },
        threadID,
        event.type
      );
    } catch (err) {
      console.error("[MAKESTK] Lỗi:", err?.message || err);
      await send(`❌ Tạo sticker thất bại: ${err?.message || "Lỗi không xác định"}`);
    } finally {
      if (filePath) try { fs.unlinkSync(filePath); } catch (_) {}
    }
  },
};

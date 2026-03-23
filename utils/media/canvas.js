"use strict";

/**
 * utils/canvas.js
 * Tất cả canvas card: music / group / menu
 */

let createCanvas, loadImage;
let _canvasAvailable = false;
try {
  const _c = require("canvas");
  createCanvas = _c.createCanvas;
  loadImage    = _c.loadImage;
  _canvasAvailable = true;
} catch (e) {
  console.warn("[canvas] Module 'canvas' chưa được build. Các lệnh card ảnh sẽ không khả dụng.");
  console.warn("[canvas] Chạy setup-termux.sh hoặc: npm rebuild canvas --build-from-source");
}

const fs    = require("fs");
const path  = require("path");
const os    = require("os");
const axios = require("axios");

function decodeHtmlEntities(url) {
  if (!url) return url;
  return url.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}

async function fetchImageBuffer(url) {
  if (!url) return null;
  url = decodeHtmlEntities(url);
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Referer": "https://www.google.com/",
      },
    });
    return Buffer.from(res.data);
  } catch (e) {
    console.warn("[canvas] fetchImageBuffer lỗi:", e?.message, "| URL:", url?.slice(0, 120));
    return null;
  }
}

async function safeLoadImage(url) {
  if (!url) return null;
  try {
    const buf = await fetchImageBuffer(url);
    if (!buf) {
      console.warn("[canvas] fetchImageBuffer trả null cho URL:", url?.slice(0, 120));
      return null;
    }
    return await loadImage(buf);
  } catch (e) {
    console.warn("[canvas] safeLoadImage lỗi:", e?.message, "| URL:", url?.slice(0, 120));
    return null;
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function savePng(canvas, prefix) {
  const outPath = path.join(os.tmpdir(), `${prefix}_${Date.now()}.png`);
  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
  return outPath;
}

// ── Music constants ───────────────────────────────────────────────────────────

const PLATFORM = {
  sc:  { name: "SoundCloud", color: "#ff5500", accent: "#ff8844", bg1: "#0f0500", bg2: "#1e0a00", icon: "☁️" },
  spt: { name: "Spotify",    color: "#1db954", accent: "#1ed760", bg1: "#020f06", bg2: "#041a0c", icon: "🎧" },
  mix: { name: "Mixcloud",   color: "#7c4dff", accent: "#a07eff", bg1: "#060010", bg2: "#0e0022", icon: "🎶" },
  yt:  { name: "YouTube",    color: "#ff0000", accent: "#ff4444", bg1: "#0f0000", bg2: "#1a0000", icon: "▶️" },
};

// ── Menu theme ────────────────────────────────────────────────────────────────

const MENU_THEME = {
  color:  "#7c5cfc",
  accent: "#a78bfa",
  bg1:    "#08001f",
  bg2:    "#12003a",
};

// ═════════════════════════════════════════════════════════════════════════════
// MUSIC CARDS
// ═════════════════════════════════════════════════════════════════════════════

function drawDefaultThumb(ctx, x, y, size, p) {
  const grad = ctx.createRadialGradient(x + size / 2, y + size / 2, 10, x + size / 2, y + size / 2, size / 2);
  grad.addColorStop(0, p.color + "44");
  grad.addColorStop(1, p.bg2);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, size, size);
  ctx.font = `bold ${size * 0.4}px sans-serif`;
  ctx.fillStyle = p.color + "aa";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("♪", x + size / 2, y + size / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawNoteIcon(ctx, x, y, size, color) {
  const s = size;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(s * 0.22, s * 0.85, s * 0.22, s * 0.16, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(s * 0.42, s * 0.1, s * 0.1, s * 0.76);
  ctx.beginPath();
  ctx.moveTo(s * 0.52, s * 0.1);
  ctx.bezierCurveTo(s * 0.9, s * 0.15, s * 0.95, s * 0.5, s * 0.52, s * 0.55);
  ctx.lineWidth = s * 0.1;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();
}

function drawPersonIcon(ctx, x, y, size, color) {
  const s = size;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(s * 0.5, s * 0.28, s * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(s * 0.5, s * 1.05, s * 0.42, Math.PI, 0);
  ctx.fill();
  ctx.restore();
}

function drawClockIcon(ctx, x, y, size, color) {
  const s = size;
  ctx.save();
  ctx.translate(x + s / 2, y + s / 2);
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -s * 0.28);
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.12;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(s * 0.22, 0);
  ctx.lineWidth = s * 0.09;
  ctx.stroke();
  ctx.restore();
}

/**
 * Card danh sách bài hát (kết quả tìm kiếm)
 */
async function drawSearchCard({ platform, query, tracks }) {
  const p       = PLATFORM[platform] || PLATFORM.sc;
  const W       = 800;
  const PAD     = 24;
  const HEADER  = 100;
  const ROW_H   = 72;
  const FOOTER  = 48;
  const H       = HEADER + tracks.length * ROW_H + FOOTER;
  const THUMB_S = 48;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // ── Background ──────────────────────────────────────────────────────────────
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, p.bg1);
  bg.addColorStop(0.6, p.bg2);
  bg.addColorStop(1, "#000000");
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 20);
  ctx.fill();

  // subtle diagonal texture lines
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  for (let i = -H; i < W + H; i += 28) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + H, H);
    ctx.stroke();
  }
  ctx.restore();

  // border glow
  const borderGrad = ctx.createLinearGradient(0, 0, W, H);
  borderGrad.addColorStop(0, p.color + "99");
  borderGrad.addColorStop(0.5, p.accent + "44");
  borderGrad.addColorStop(1, p.color + "22");
  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, W - 2, H - 2, 20);
  ctx.stroke();

  // top-right glow orb
  const orb = ctx.createRadialGradient(W, 0, 0, W, 0, 280);
  orb.addColorStop(0, p.color + "28");
  orb.addColorStop(1, "transparent");
  ctx.fillStyle = orb;
  ctx.fillRect(0, 0, W, H);

  // ── Header ──────────────────────────────────────────────────────────────────
  const hGrad = ctx.createLinearGradient(0, 0, W, HEADER);
  hGrad.addColorStop(0, p.color + "40");
  hGrad.addColorStop(1, "transparent");
  ctx.fillStyle = hGrad;
  roundRect(ctx, 0, 0, W, HEADER, 20);
  ctx.fill();

  // platform badge
  const badgeText = `${p.icon}  ${p.name.toUpperCase()}`;
  ctx.font = "bold 13px monospace";
  const bw = ctx.measureText(badgeText).width + 20;
  roundRect(ctx, PAD, 18, bw, 26, 8);
  ctx.fillStyle = p.color + "30";
  ctx.fill();
  ctx.strokeStyle = p.color + "88";
  ctx.lineWidth = 1;
  roundRect(ctx, PAD, 18, bw, 26, 8);
  ctx.stroke();
  ctx.fillStyle = p.color;
  ctx.fillText(badgeText, PAD + 10, 35);

  // query text
  ctx.font = "bold 22px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(`🔍  ${truncate(query, 44)}`, PAD, 78);

  // sub-label
  ctx.font = "13px sans-serif";
  ctx.fillStyle = p.color + "88";
  const sub = `${tracks.length} kết quả  ·  Reply số để tải nhạc`;
  ctx.fillText(sub, W - PAD - ctx.measureText(sub).width, 78);

  // divider
  const divGrad = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  divGrad.addColorStop(0, "transparent");
  divGrad.addColorStop(0.1, p.color + "66");
  divGrad.addColorStop(0.9, p.color + "66");
  divGrad.addColorStop(1, "transparent");
  ctx.strokeStyle = divGrad;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, HEADER - 1);
  ctx.lineTo(W - PAD, HEADER - 1);
  ctx.stroke();

  // ── Rows ────────────────────────────────────────────────────────────────────
  const thumbPromises = tracks.map(t => {
    const url = t.thumbnail || t.artwork_url || "";
    return safeLoadImage(url);
  });
  const thumbImgs = await Promise.all(thumbPromises);

  tracks.forEach((t, i) => {
    const rowY = HEADER + i * ROW_H;

    // alternate row bg
    if (i % 2 === 0) {
      ctx.fillStyle = "#ffffff06";
      ctx.fillRect(0, rowY, W, ROW_H);
    }

    // hover-like left accent bar
    ctx.fillStyle = p.color + (i % 2 === 0 ? "66" : "33");
    ctx.fillRect(0, rowY + 10, 3, ROW_H - 20);

    // number badge
    const numX = PAD;
    const numCY = rowY + ROW_H / 2;
    ctx.beginPath();
    ctx.arc(numX + 14, numCY, 14, 0, Math.PI * 2);
    ctx.fillStyle = p.color + "22";
    ctx.fill();
    ctx.strokeStyle = p.color + "66";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = "bold 14px monospace";
    ctx.fillStyle = p.color;
    ctx.textAlign = "center";
    ctx.fillText(`${i + 1}`, numX + 14, numCY + 5);
    ctx.textAlign = "left";

    // thumbnail
    const thumbX = numX + 36;
    const thumbY = rowY + (ROW_H - THUMB_S) / 2;
    ctx.save();
    roundRect(ctx, thumbX, thumbY, THUMB_S, THUMB_S, 8);
    ctx.clip();
    if (thumbImgs[i]) {
      ctx.drawImage(thumbImgs[i], thumbX, thumbY, THUMB_S, THUMB_S);
    } else {
      const tg = ctx.createLinearGradient(thumbX, thumbY, thumbX + THUMB_S, thumbY + THUMB_S);
      tg.addColorStop(0, p.color + "44");
      tg.addColorStop(1, p.bg2);
      ctx.fillStyle = tg;
      ctx.fillRect(thumbX, thumbY, THUMB_S, THUMB_S);
      ctx.font = `${THUMB_S * 0.45}px sans-serif`;
      ctx.fillStyle = p.color + "bb";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("♪", thumbX + THUMB_S / 2, thumbY + THUMB_S / 2);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }
    ctx.restore();
    ctx.strokeStyle = p.color + "44";
    ctx.lineWidth = 1;
    roundRect(ctx, thumbX, thumbY, THUMB_S, THUMB_S, 8);
    ctx.stroke();

    // text info
    const textX = thumbX + THUMB_S + 14;
    const maxTitleW = W - textX - PAD - 80;

    ctx.font = "bold 18px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(truncate(t.title || t.name || "Không rõ", 42), textX, rowY + 30);

    const artist = t.uploader || t.author || t.owner?.displayName || "Unknown";
    ctx.font = "14px sans-serif";
    ctx.fillStyle = "#999999";
    ctx.fillText(`👤  ${truncate(artist, 38)}`, textX, rowY + 52);

    // duration badge (right)
    const dur = t._durStr || "";
    if (dur) {
      ctx.font = "bold 13px monospace";
      const dw = ctx.measureText(dur).width + 16;
      const dX = W - PAD - dw;
      const dY = rowY + ROW_H / 2 - 11;
      roundRect(ctx, dX, dY, dw, 22, 6);
      ctx.fillStyle = p.color + "22";
      ctx.fill();
      ctx.strokeStyle = p.color + "55";
      ctx.lineWidth = 1;
      roundRect(ctx, dX, dY, dw, 22, 6);
      ctx.stroke();
      ctx.fillStyle = p.accent;
      ctx.fillText(dur, dX + 8, dY + 15);
    }

    // row separator
    if (i < tracks.length - 1) {
      const sepGrad = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
      sepGrad.addColorStop(0, "transparent");
      sepGrad.addColorStop(0.15, "#ffffff12");
      sepGrad.addColorStop(0.85, "#ffffff12");
      sepGrad.addColorStop(1, "transparent");
      ctx.strokeStyle = sepGrad;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD, rowY + ROW_H);
      ctx.lineTo(W - PAD, rowY + ROW_H);
      ctx.stroke();
    }
  });

  // ── Footer ───────────────────────────────────────────────────────────────────
  const footY = HEADER + tracks.length * ROW_H;
  const fGrad2 = ctx.createLinearGradient(0, footY, 0, footY + FOOTER);
  fGrad2.addColorStop(0, p.color + "18");
  fGrad2.addColorStop(1, p.color + "08");
  ctx.fillStyle = fGrad2;
  ctx.fillRect(0, footY, W, FOOTER);

  ctx.font = "14px sans-serif";
  ctx.fillStyle = "#888888";
  ctx.fillText(`💬  Reply số từ 1–${tracks.length} để tải nhạc`, PAD, footY + 30);
  ctx.font = "bold 13px sans-serif";
  ctx.fillStyle = p.color + "77";
  const wm1 = "✦ Mizai Bot";
  ctx.fillText(wm1, W - PAD - ctx.measureText(wm1).width, footY + 30);

  return savePng(canvas, "music_card");
}

/**
 * Card "Now Playing"
 */
async function drawNowPlayingCard({ platform, title, artist, duration, thumb }) {
  const p  = PLATFORM[platform] || PLATFORM.sc;
  const W  = 700;
  const H  = 220;
  const THUMB_SIZE = 160;
  const PAD = 24;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, p.bg1);
  bg.addColorStop(1, p.bg2);
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.fill();

  ctx.strokeStyle = p.color + "66";
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, W - 2, H - 2, 16);
  ctx.stroke();

  const thumbX = PAD;
  const thumbY = (H - THUMB_SIZE) / 2;

  ctx.save();
  roundRect(ctx, thumbX, thumbY, THUMB_SIZE, THUMB_SIZE, 12);
  ctx.clip();
  const thumbImg = await safeLoadImage(thumb);
  if (thumbImg) {
    ctx.drawImage(thumbImg, thumbX, thumbY, THUMB_SIZE, THUMB_SIZE);
  } else {
    drawDefaultThumb(ctx, thumbX, thumbY, THUMB_SIZE, p);
  }
  ctx.restore();

  ctx.strokeStyle = p.color + "88";
  ctx.lineWidth = 2;
  roundRect(ctx, thumbX, thumbY, THUMB_SIZE, THUMB_SIZE, 12);
  ctx.stroke();

  const textX = thumbX + THUMB_SIZE + PAD;

  ctx.font = "bold 14px sans-serif";
  ctx.fillStyle = p.color;
  const badge = `${p.icon} ${p.name}`;
  const bW = ctx.measureText(badge).width + 16;
  roundRect(ctx, textX, 28, bW, 26, 8);
  ctx.fillStyle = p.color + "33";
  ctx.fill();
  ctx.strokeStyle = p.color;
  ctx.lineWidth = 1;
  roundRect(ctx, textX, 28, bW, 26, 8);
  ctx.stroke();
  ctx.fillStyle = p.color;
  ctx.fillText(badge, textX + 8, 45);

  ctx.font = "bold 24px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(truncate(title, 32), textX, 92);

  ctx.font = "18px sans-serif";
  ctx.fillStyle = "#bbbbbb";
  ctx.fillText(`👤 ${truncate(artist, 36)}`, textX, 124);

  ctx.font = "bold 16px monospace";
  ctx.fillStyle = p.color;
  ctx.fillText(`⏱ ${duration}`, textX, 154);

  const barY = H - 28;
  ctx.fillStyle = "#ffffff15";
  ctx.fillRect(PAD, barY, W - PAD * 2, 8);
  const barFill = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  barFill.addColorStop(0, p.color);
  barFill.addColorStop(1, p.color + "55");
  ctx.fillStyle = barFill;
  ctx.fillRect(PAD, barY, (W - PAD * 2) * 0.45, 8);
  ctx.beginPath();
  ctx.arc(PAD + (W - PAD * 2) * 0.45, barY + 4, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.font = "bold 13px sans-serif";
  ctx.fillStyle = p.color + "66";
  const wm2 = "✦ Mizai Bot";
  ctx.fillText(wm2, W - PAD - ctx.measureText(wm2).width, 20);

  return savePng(canvas, "now_playing");
}

/**
 * Card "Đang tải"
 */
async function drawLoadingCard({ platform, title, artist, duration }) {
  const p  = PLATFORM[platform] || PLATFORM.sc;
  const W  = 660;
  const H  = 200;
  const PAD = 28;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, p.bg1);
  bg.addColorStop(1, p.bg2);
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.fill();

  ctx.strokeStyle = p.color + "55";
  ctx.lineWidth = 1.5;
  roundRect(ctx, 1, 1, W - 2, H - 2, 16);
  ctx.stroke();

  const cx = PAD + 62;
  const cy = H / 2;
  const R  = 46;

  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = p.color + "22";
  ctx.lineWidth = 8;
  ctx.stroke();

  const segments = 8;
  for (let i = 0; i < segments; i++) {
    const startAngle = (i / segments) * Math.PI * 2 - Math.PI / 2;
    const endAngle   = startAngle + (Math.PI * 2) / segments - 0.08;
    const alpha      = Math.round(((i + 1) / segments) * 220);
    const hex        = alpha.toString(16).padStart(2, "0");
    ctx.beginPath();
    ctx.arc(cx, cy, R, startAngle, endAngle);
    ctx.strokeStyle = p.color + hex;
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  const dotAngle = -Math.PI / 2;
  ctx.beginPath();
  ctx.arc(cx + R * Math.cos(dotAngle), cy + R * Math.sin(dotAngle), 6, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.font = "bold 12px monospace";
  ctx.fillStyle = p.color;
  ctx.textAlign = "center";
  ctx.fillText("LOADING", cx, cy + R + 20);
  ctx.textAlign = "left";

  const divX = PAD + 62 * 2 + 8;
  ctx.fillStyle = p.color + "33";
  ctx.fillRect(divX, PAD, 1.5, H - PAD * 2);

  const textX = divX + 22;

  ctx.font = "bold 13px monospace";
  ctx.fillStyle = p.color + "bb";
  ctx.fillText(`${p.name.toUpperCase()} · ĐANG TẢI`, textX, 44);

  drawNoteIcon(ctx, textX, 68, 18, p.color);
  ctx.font = "bold 22px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(truncate(title, 28), textX + 26, 82);

  drawPersonIcon(ctx, textX, 106, 18, "#aaaaaa");
  ctx.font = "16px sans-serif";
  ctx.fillStyle = "#aaaaaa";
  ctx.fillText(truncate(artist, 34), textX + 26, 120);

  drawClockIcon(ctx, textX, 140, 18, p.color);
  ctx.font = "bold 16px monospace";
  ctx.fillStyle = p.color;
  ctx.fillText(duration, textX + 26, 154);

  ctx.font = "bold 12px sans-serif";
  ctx.fillStyle = p.color + "55";
  const wm3 = "✦ Mizai Bot";
  ctx.fillText(wm3, W - PAD - ctx.measureText(wm3).width, H - 14);

  return savePng(canvas, "loading_card");
}

// ═════════════════════════════════════════════════════════════════════════════
// GROUP CARDS
// ═════════════════════════════════════════════════════════════════════════════

function drawParticles(ctx, W, H, color, count = 18) {
  const rng = (n) => Math.random() * n;
  const shapes = ["circle", "rect", "star"];
  for (let i = 0; i < count; i++) {
    const x = rng(W);
    const y = rng(H);
    const size = 3 + rng(7);
    const alpha = 0.15 + rng(0.25);
    const shape = shapes[i % 3];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    if (shape === "circle") {
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    } else if (shape === "rect") {
      ctx.translate(x, y);
      ctx.rotate(rng(Math.PI));
      ctx.fillRect(-size / 2, -size / 2, size, size * 0.6);
    } else {
      ctx.translate(x, y);
      ctx.rotate(rng(Math.PI));
      ctx.beginPath();
      for (let j = 0; j < 5; j++) {
        const angle = (j * 4 * Math.PI) / 5 - Math.PI / 2;
        const r = j % 2 === 0 ? size : size * 0.4;
        j === 0 ? ctx.moveTo(r * Math.cos(angle), r * Math.sin(angle)) : ctx.lineTo(r * Math.cos(angle), r * Math.sin(angle));
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawAvatarCircle(ctx, cx, cy, R, initial, color) {
  const grad = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.2, R * 0.1, cx, cy, R);
  grad.addColorStop(0, color + "cc");
  grad.addColorStop(1, color + "44");
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.font = `bold ${Math.round(R * 0.9)}px sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initial.toUpperCase().slice(0, 1), cx, cy + 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/**
 * Card chào mừng thành viên mới
 */
async function drawJoinCard({ name, groupName }) {
  const W   = 720;
  const H   = 260;
  const PAD = 28;
  const COLOR = "#00c853";
  const BG1   = "#001a06";
  const BG2   = "#003510";

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, BG1);
  bg.addColorStop(1, BG2);
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 20);
  ctx.fill();

  ctx.strokeStyle = COLOR + "77";
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, W - 2, H - 2, 20);
  ctx.stroke();

  const glare = ctx.createRadialGradient(0, 0, 0, 0, 0, 260);
  glare.addColorStop(0, COLOR + "18");
  glare.addColorStop(1, "transparent");
  ctx.fillStyle = glare;
  ctx.fillRect(0, 0, W, H);

  drawParticles(ctx, W, H, COLOR, 22);

  const AVATAR_R = 68;
  const cx = PAD + AVATAR_R + 8;
  const cy = H / 2;
  drawAvatarCircle(ctx, cx, cy, AVATAR_R, name || "?", COLOR);

  ctx.beginPath();
  ctx.arc(cx, cy, AVATAR_R + 10, 0, Math.PI * 2);
  ctx.strokeStyle = COLOR + "33";
  ctx.lineWidth = 6;
  ctx.stroke();

  const textX = cx + AVATAR_R + PAD;

  ctx.font = "bold 14px monospace";
  ctx.fillStyle = COLOR + "cc";
  ctx.fillText("✦ CHÀO MỪNG THÀNH VIÊN MỚI ✦", textX, 50);

  ctx.font = "bold 34px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(truncate(name, 22), textX, 105);

  ctx.font = "18px sans-serif";
  ctx.fillStyle = "#aaffcc";
  ctx.fillText("đã tham gia", textX, 138);

  ctx.font = "bold 22px sans-serif";
  ctx.fillStyle = COLOR;
  ctx.fillText(truncate(groupName, 28), textX, 170);

  ctx.fillStyle = COLOR + "55";
  ctx.fillRect(textX, 186, W - textX - PAD, 1.5);

  ctx.font = "italic 14px sans-serif";
  ctx.fillStyle = "#88bbaa";
  ctx.fillText("Chúc bạn có những trải nghiệm thú vị! 🎉", textX, 215);

  ctx.font = "bold 13px sans-serif";
  ctx.fillStyle = COLOR + "55";
  const wm4 = "✦ Mizai Bot";
  ctx.fillText(wm4, W - PAD - ctx.measureText(wm4).width, 20);

  return savePng(canvas, "join_card");
}

/**
 * Card rời / bị kick khỏi nhóm
 */
async function drawLeaveCard({ names, groupName, reason = "leave" }) {
  const W   = 720;
  const H   = 220;
  const PAD = 28;

  const isKick = reason === "remove";
  const COLOR  = isKick ? "#ff3d00" : "#ff9100";
  const BG1    = isKick ? "#1a0000" : "#1a0a00";
  const BG2    = isKick ? "#2d0000" : "#2d1400";
  const EMOJI  = isKick ? "🚫" : "👋";
  const LABEL  = isKick ? "ĐÃ BỊ XOÁ KHỎI NHÓM" : "ĐÃ RỜI NHÓM";

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, BG1);
  bg.addColorStop(1, BG2);
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 20);
  ctx.fill();

  ctx.strokeStyle = COLOR + "77";
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, W - 2, H - 2, 20);
  ctx.stroke();

  const glare = ctx.createRadialGradient(W, 0, 0, W, 0, 280);
  glare.addColorStop(0, COLOR + "18");
  glare.addColorStop(1, "transparent");
  ctx.fillStyle = glare;
  ctx.fillRect(0, 0, W, H);

  const cx = PAD + 60;
  const cy = H / 2;
  const R  = 52;

  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = COLOR + "22";
  ctx.fill();
  ctx.strokeStyle = COLOR + "88";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.font = `${Math.round(R * 0.9)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(EMOJI, cx, cy + 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const textX = cx + R + PAD;

  ctx.font = "bold 13px monospace";
  ctx.fillStyle = COLOR + "cc";
  ctx.fillText(`✦ ${LABEL} ✦`, textX, 50);

  ctx.font = "bold 28px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(truncate(names, 26), textX, 98);

  ctx.font = "16px sans-serif";
  ctx.fillStyle = "#aaaaaa";
  ctx.fillText("khỏi nhóm", textX, 128);

  ctx.font = "bold 20px sans-serif";
  ctx.fillStyle = COLOR;
  ctx.fillText(truncate(groupName, 30), textX, 158);

  ctx.fillStyle = COLOR + "44";
  ctx.fillRect(textX, 170, W - textX - PAD, 1);

  ctx.font = "italic 13px sans-serif";
  ctx.fillStyle = "#887766";
  ctx.fillText(isKick ? "Vi phạm nội quy nhóm." : "Hẹn gặp lại! 🌙", textX, 190);

  ctx.font = "bold 13px sans-serif";
  ctx.fillStyle = COLOR + "55";
  const wm5 = "✦ Mizai Bot";
  ctx.fillText(wm5, W - PAD - ctx.measureText(wm5).width, 20);

  return savePng(canvas, "leave_card");
}

// ═════════════════════════════════════════════════════════════════════════════
// MENU CARDS
// ═════════════════════════════════════════════════════════════════════════════

function menuBase(ctx, W, H) {
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, MENU_THEME.bg1);
  bg.addColorStop(1, MENU_THEME.bg2);
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 20);
  ctx.fill();

  ctx.strokeStyle = MENU_THEME.color + "55";
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, W - 2, H - 2, 20);
  ctx.stroke();

  const glow = ctx.createRadialGradient(W * 0.8, H * 0.1, 0, W * 0.8, H * 0.1, 300);
  glow.addColorStop(0, MENU_THEME.color + "22");
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

function menuHeader(ctx, W, titleText, subtitleText, PAD) {
  const HEADER_H = 96;
  const headerGrad = ctx.createLinearGradient(0, 0, W, HEADER_H);
  headerGrad.addColorStop(0, MENU_THEME.color + "44");
  headerGrad.addColorStop(1, "transparent");
  ctx.fillStyle = headerGrad;
  roundRect(ctx, 0, 0, W, HEADER_H, 20);
  ctx.fill();

  ctx.font = "bold 28px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(titleText, PAD, 44);

  ctx.font = "16px sans-serif";
  ctx.fillStyle = MENU_THEME.accent;
  ctx.fillText(subtitleText, PAD, 72);

  ctx.fillStyle = MENU_THEME.color + "55";
  ctx.fillRect(PAD, HEADER_H - 8, W - PAD * 2, 1);

  return HEADER_H;
}

function menuWatermark(ctx, W, PAD) {
  ctx.font = "bold 13px sans-serif";
  ctx.fillStyle = MENU_THEME.color + "66";
  const wm = "✦ Mizai Bot";
  ctx.fillText(wm, W - PAD - ctx.measureText(wm).width, 20);
}

/**
 * Card danh sách nhóm lệnh (menu chính)
 */
async function drawMenuCard({ groups, uniqueCount, prefix = "." }) {
  const W      = 760;
  const PAD    = 28;
  const ROW_H  = 58;
  const HEADER = 96;
  const FOOTER = 56;
  const H      = HEADER + groups.length * ROW_H + FOOTER;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  menuBase(ctx, W, H);
  menuHeader(ctx, W, `🤖 MIZAI BOT — MENU LỆNH`, `Tổng: ${uniqueCount} lệnh  ·  Prefix: ${prefix}`, PAD);
  menuWatermark(ctx, W, PAD);

  groups.forEach((g, i) => {
    const y = HEADER + i * ROW_H;
    if (i % 2 === 0) {
      ctx.fillStyle = "#ffffff08";
      ctx.fillRect(0, y, W, ROW_H);
    }
    const numStr = `${i + 1}`;
    ctx.font = "bold 15px monospace";
    const numW = ctx.measureText("00").width;
    roundRect(ctx, PAD, y + 14, numW + 14, 26, 6);
    ctx.fillStyle = MENU_THEME.color + "33";
    ctx.fill();
    ctx.strokeStyle = MENU_THEME.color + "88";
    ctx.lineWidth = 1;
    roundRect(ctx, PAD, y + 14, numW + 14, 26, 6);
    ctx.stroke();
    ctx.fillStyle = MENU_THEME.color;
    ctx.fillText(numStr, PAD + 7, y + 32);

    const xOff = PAD + numW + 28;
    ctx.font = "bold 19px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(truncate(g.commandCategory, 36), xOff, y + 28);

    ctx.font = "14px sans-serif";
    ctx.fillStyle = MENU_THEME.accent;
    ctx.fillText(`${g.commandsName.length} lệnh`, xOff, y + 48);

    const preview = g.commandsName.slice(0, 4).join("  ·  ");
    ctx.font = "13px monospace";
    ctx.fillStyle = "#666688";
    ctx.fillText(truncate(preview, 52), W / 2 + 10, y + 38);

    ctx.fillStyle = "#ffffff0a";
    ctx.fillRect(PAD, y + ROW_H - 1, W - PAD * 2, 1);
  });

  const footerY = HEADER + groups.length * ROW_H;
  ctx.fillStyle = "#ffffff10";
  ctx.fillRect(0, footerY, W, FOOTER);
  ctx.font = "italic 15px sans-serif";
  ctx.fillStyle = "#888888";
  ctx.fillText(`💬  Reply số từ 1–${groups.length} để xem lệnh trong nhóm`, PAD, footerY + 36);

  return savePng(canvas, "menu_card");
}

/**
 * Card danh sách lệnh trong 1 nhóm
 */
async function drawCategoryCard({ category, commands, prefix = "." }) {
  const names  = commands.map(c => (typeof c === "string" ? c : c.name));
  const COLS   = 2;
  const COL_W  = 360;
  const W      = 760;
  const PAD    = 28;
  const ROW_H  = 52;
  const HEADER = 96;
  const FOOTER = 52;
  const rows   = Math.ceil(names.length / COLS);
  const H      = HEADER + rows * ROW_H + FOOTER;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  menuBase(ctx, W, H);
  menuHeader(ctx, W, `📂 ${category}`, `${names.length} lệnh  ·  Reply STT để xem chi tiết`, PAD);
  menuWatermark(ctx, W, PAD);

  names.forEach((name, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x   = PAD + col * COL_W;
    const y   = HEADER + row * ROW_H;

    if (row % 2 === 0) {
      ctx.fillStyle = "#ffffff06";
      ctx.fillRect(col * COL_W, y, COL_W, ROW_H);
    }
    ctx.font = "bold 14px monospace";
    ctx.fillStyle = MENU_THEME.color;
    ctx.fillText(`${i + 1}.`, x + 4, y + 32);
    ctx.font = "bold 18px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(prefix + truncate(name, 18), x + 38, y + 32);
    ctx.fillStyle = "#ffffff08";
    ctx.fillRect(x, y + ROW_H - 1, COL_W - 8, 1);
  });

  const footerY = HEADER + rows * ROW_H;
  ctx.fillStyle = "#ffffff10";
  ctx.fillRect(0, footerY, W, FOOTER);
  ctx.font = "italic 15px sans-serif";
  ctx.fillStyle = "#888888";
  ctx.fillText(`💬  Reply số từ 1–${names.length} để xem chi tiết lệnh`, PAD, footerY + 34);

  return savePng(canvas, "category_card");
}

/**
 * Card thông tin chi tiết 1 lệnh
 */
async function drawCommandInfoCard({ config, prefix = "." }) {
  const W   = 720;
  const H   = 340;
  const PAD = 28;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  menuBase(ctx, W, H);
  menuWatermark(ctx, W, PAD);

  const headerGrad = ctx.createLinearGradient(0, 0, W, 100);
  headerGrad.addColorStop(0, MENU_THEME.color + "44");
  headerGrad.addColorStop(1, "transparent");
  ctx.fillStyle = headerGrad;
  roundRect(ctx, 0, 0, W, 100, 20);
  ctx.fill();

  ctx.font = "bold 32px monospace";
  ctx.fillStyle = MENU_THEME.color;
  ctx.fillText(`${prefix}${config.name}`, PAD, 52);

  ctx.font = "16px sans-serif";
  ctx.fillStyle = "#aaaaaa";
  ctx.fillText(truncate(config.description || "Không có mô tả", 60), PAD, 80);

  ctx.fillStyle = MENU_THEME.color + "44";
  ctx.fillRect(PAD, 96, W - PAD * 2, 1);

  const fields = [
    { icon: "🔖", label: "Phiên bản",  value: config.version || "1.0.0" },
    { icon: "🔐", label: "Quyền hạn",  value: config.hasPermssion == 2 ? "Admin Bot" : config.hasPermssion == 1 ? "Quản Trị Viên Nhóm" : "Thành Viên" },
    { icon: "👤", label: "Tác giả",    value: config.credits || "Không rõ" },
    { icon: "📁", label: "Nhóm lệnh",  value: config.commandCategory || "Khác" },
    { icon: "📝", label: "Cách dùng",  value: `${prefix}${config.name} ${config.usages || ""}` },
    { icon: "⏳", label: "Cooldown",   value: `${config.cooldowns || 0}s` },
  ];

  const FIELD_H = 36;
  const startY  = 110;

  fields.forEach((f, i) => {
    const y = startY + i * FIELD_H;
    if (i % 2 === 0) {
      ctx.fillStyle = "#ffffff06";
      roundRect(ctx, PAD - 6, y - 2, W - PAD * 2 + 12, FIELD_H - 4, 6);
      ctx.fill();
    }
    ctx.font = "15px sans-serif";
    ctx.fillStyle = MENU_THEME.accent;
    ctx.fillText(`${f.icon} ${f.label}:`, PAD, y + 22);
    ctx.font = "bold 15px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(truncate(String(f.value), 52), PAD + 160, y + 22);
  });

  return savePng(canvas, "cmd_info_card");
}

/**
 * Card tất cả lệnh (menu all) — hiển thị theo trang
 */
async function drawAllCommandsCard({ commands, page, totalPages, total, prefix = "." }) {
  const COLS   = 2;
  const COL_W  = 370;
  const W      = 760;
  const PAD    = 28;
  const ROW_H  = 50;
  const HEADER = 96;
  const FOOTER = 52;
  const rows   = Math.ceil(commands.length / COLS);
  const H      = HEADER + rows * ROW_H + FOOTER;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  menuBase(ctx, W, H);
  menuHeader(ctx, W, `📋 TẤT CẢ LỆNH — Trang ${page}/${totalPages}`, `Tổng: ${total} lệnh  ·  Prefix: ${prefix}`, PAD);
  menuWatermark(ctx, W, PAD);

  commands.forEach((c, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x   = PAD + col * COL_W;
    const y   = HEADER + row * ROW_H;

    if (row % 2 === 0) {
      ctx.fillStyle = "#ffffff06";
      ctx.fillRect(col * COL_W, y, COL_W, ROW_H);
    }
    ctx.font = "bold 13px monospace";
    ctx.fillStyle = MENU_THEME.color;
    ctx.fillText(`${i + 1}.`, x + 4, y + 30);
    ctx.font = "bold 17px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(prefix + truncate(c.name, 14), x + 32, y + 30);
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#777799";
    ctx.fillText(truncate(c.desc, 24), x + 32, y + 45);
    ctx.fillStyle = "#ffffff07";
    ctx.fillRect(x, y + ROW_H - 1, COL_W - 8, 1);
  });

  const footerY = HEADER + rows * ROW_H;
  ctx.fillStyle = "#ffffff10";
  ctx.fillRect(0, footerY, W, FOOTER);
  ctx.font = "italic 15px sans-serif";
  ctx.fillStyle = "#888888";
  if (totalPages > 1 && page < totalPages) {
    ctx.fillText(`💬  Reply số trang (${page + 1}–${totalPages}) để xem tiếp`, PAD, footerY + 34);
  } else {
    ctx.fillText(`✅  Đây là trang cuối (${page}/${totalPages})`, PAD, footerY + 34);
  }

  return savePng(canvas, "all_cmds_card");
}

// ═════════════════════════════════════════════════════════════════════════════
// UPTIME CARD
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Vẽ card uptime công nghệ với background image + overlay thông tin hệ thống
 * @param {object} opts
 * @param {string}  opts.uptimeStr   - Chuỗi uptime
 * @param {string}  opts.startTime   - Thời điểm khởi động
 * @param {string}  opts.vnTime      - Giờ hiện tại
 * @param {number}  opts.ramPct      - % RAM đã dùng (0-100)
 * @param {number}  opts.cpuPct      - % CPU load (0-100)
 * @param {string}  opts.usedMem     - RAM đã dùng (string)
 * @param {string}  opts.totalMem    - Tổng RAM (string)
 * @param {string}  opts.nodeVer     - Node.js version
 * @param {number}  opts.cmdCount    - Số lệnh
 * @param {string}  opts.prefix      - Prefix bot
 * @param {string}  opts.bgImagePath - Đường dẫn ảnh nền
 * @returns {Promise<string>} path to saved PNG
 */
async function drawUptimeCard({
  uptimeStr, startTime, vnTime,
  ramPct, cpuPct, cpuModel,
  usedMem, totalMem, freeMem,
  nodeVer, cmdCount, prefix,
  pingMs, threadCount, ramWarning,
  hostname, localIP, platform,
  restartCount, firstStart,
  bgImagePath,
}) {
  const W = 960, H = 660;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // ── Background ─────────────────────────────────────────────────────────────
  if (bgImagePath && fs.existsSync(bgImagePath)) {
    try {
      const bg = await loadImage(bgImagePath);
      ctx.drawImage(bg, 0, 0, W, H);
    } catch (_) {
      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, "#080020"); grad.addColorStop(1, "#001040");
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    }
  } else {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, "#080020"); grad.addColorStop(1, "#001040");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  }

  // ── Dark overlay ───────────────────────────────────────────────────────────
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(0, 0, W, H);

  // ── Outer panel ────────────────────────────────────────────────────────────
  const PAD = 24, PW = W - PAD * 2, PH = H - PAD * 2;
  ctx.save();
  roundRect(ctx, PAD, PAD, PW, PH, 18);
  ctx.fillStyle   = "rgba(8,4,32,0.75)";
  ctx.fill();
  ctx.strokeStyle = "#7c5cfc88";
  ctx.lineWidth   = 1.5;
  ctx.stroke();
  ctx.restore();

  // ── Neon top border ────────────────────────────────────────────────────────
  const topGlow = ctx.createLinearGradient(PAD, PAD, PAD + PW, PAD);
  topGlow.addColorStop(0, "transparent");
  topGlow.addColorStop(0.3, "#00e5ff");
  topGlow.addColorStop(0.7, "#7c5cfc");
  topGlow.addColorStop(1, "transparent");
  ctx.strokeStyle = topGlow; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(PAD + 18, PAD); ctx.lineTo(PAD + PW - 18, PAD);
  ctx.stroke();

  // ── Header band ────────────────────────────────────────────────────────────
  const headerGrad = ctx.createLinearGradient(PAD, PAD, PAD + PW, PAD + 80);
  headerGrad.addColorStop(0, "#7c5cfc22"); headerGrad.addColorStop(1, "transparent");
  ctx.fillStyle = headerGrad;
  roundRect(ctx, PAD, PAD, PW, 80, 18); ctx.fill();

  ctx.font = "bold 13px monospace"; ctx.fillStyle = "#00e5ffcc";
  ctx.fillText("⚡  SYSTEM UPTIME  ⚡", PAD + 20, PAD + 28);
  ctx.font = "bold 28px sans-serif"; ctx.fillStyle = "#ffffff";
  ctx.fillText("MiZai Bot  v3.0.0", PAD + 20, PAD + 62);

  ctx.font = "bold 12px sans-serif"; ctx.fillStyle = "#7c5cfc99";
  ctx.textAlign = "right";
  ctx.fillText("✦ Mizai Bot", PAD + PW - 16, PAD + 24);
  ctx.textAlign = "left";

  ctx.fillStyle = "#7c5cfc44";
  ctx.fillRect(PAD + 20, PAD + 72, PW - 40, 1);

  // ── Layout grid ────────────────────────────────────────────────────────────
  const bodyY  = PAD + 88;
  const BODY_H = H - bodyY - PAD - 50;
  const COL1X  = PAD + 18;
  const COL2X  = W / 2 + 12;
  const COL_W  = W / 2 - PAD - 12;
  const LH     = 34;

  // helper: draw a labelled row
  function infoRow(icon, label, val, x, y, valColor = "#ffffff") {
    ctx.font = "14px sans-serif"; ctx.fillStyle = "#00e5ffaa";
    ctx.fillText(icon, x, y);
    ctx.fillStyle = "#9999bb";
    ctx.fillText(label, x + 24, y);
    ctx.fillStyle = valColor;
    ctx.font = "bold 14px sans-serif";
    ctx.fillText(val, x + 148, y);
  }

  // helper: section label
  function sectionLabel(label, x, y, color = "#00e5ff") {
    ctx.font = "bold 13px monospace"; ctx.fillStyle = color;
    ctx.fillText(label, x, y);
    ctx.fillStyle = color + "33";
    ctx.fillRect(x, y + 4, COL_W - 10, 1);
  }

  // ── LEFT COLUMN ────────────────────────────────────────────────────────────
  let ly = bodyY + 18;

  sectionLabel("◈ THỜI GIAN & UPTIME", COL1X, ly); ly += 20;
  infoRow("⏰", "Thời gian :", vnTime,    COL1X, ly); ly += LH;
  infoRow("🚀", "Khởi động :", startTime, COL1X, ly); ly += LH;
  infoRow("⏳", "Hoạt động :", uptimeStr, COL1X, ly, "#00e5ff"); ly += LH;
  infoRow("🔁", "Restarts  :", `${restartCount} lần`, COL1X, ly, "#ffcc44"); ly += LH;
  infoRow("📅", "Từ ngày   :", firstStart, COL1X, ly); ly += LH + 8;

  sectionLabel("◈ BOT INFO", COL1X, ly); ly += 20;
  infoRow("🏓", "Ping API  :", `${pingMs}ms  ${pingMs < 200 ? "🟢" : pingMs < 500 ? "🟡" : "🔴"}`, COL1X, ly,
    pingMs < 200 ? "#44ff88" : pingMs < 500 ? "#ffcc00" : "#ff4444"); ly += LH;
  infoRow("💬", "Threads   :", `${threadCount} nhóm`, COL1X, ly, "#a78bfa"); ly += LH;
  infoRow("📦", "Số lệnh   :", `${cmdCount} lệnh`,   COL1X, ly); ly += LH;
  infoRow("⚙️", "Prefix    :", prefix,               COL1X, ly); ly += LH + 8;

  sectionLabel("◈ MẠNG", COL1X, ly); ly += 20;
  infoRow("🌐", "Hostname  :", hostname,  COL1X, ly); ly += LH;
  infoRow("📡", "IP nội bộ :", localIP,   COL1X, ly, "#44ddff"); ly += LH;
  infoRow("🖥️", "OS        :", platform,  COL1X, ly); ly += LH;
  infoRow("🔧", "Node.js   :", nodeVer,   COL1X, ly); ly += LH;

  // ── Vertical divider ───────────────────────────────────────────────────────
  ctx.fillStyle = "#7c5cfc33";
  ctx.fillRect(W / 2 + 2, bodyY, 1, BODY_H);

  // ── RIGHT COLUMN ───────────────────────────────────────────────────────────
  let ry = bodyY + 18;
  const barW = COL_W - 20, barH = 18;

  function drawGauge(label, pct, color, y, warn = false) {
    const gc = warn && pct >= 85 ? "#ff4444" : color;
    ctx.font = "bold 13px monospace"; ctx.fillStyle = warn && pct >= 85 ? "#ff4444" : "#aaaacc";
    ctx.fillText(label, COL2X, y);

    ctx.font = "bold 14px sans-serif"; ctx.fillStyle = gc;
    ctx.textAlign = "right";
    ctx.fillText(`${pct}%${warn && pct >= 85 ? " ⚠️" : ""}`, COL2X + barW, y);
    ctx.textAlign = "left";

    const ty = y + 5;
    ctx.fillStyle = "#ffffff15";
    roundRect(ctx, COL2X, ty, barW, barH, 5); ctx.fill();

    const fill  = Math.max(4, Math.round((pct / 100) * barW));
    const fgrad = ctx.createLinearGradient(COL2X, 0, COL2X + fill, 0);
    fgrad.addColorStop(0, gc + "88"); fgrad.addColorStop(1, gc);
    ctx.fillStyle = fgrad;
    roundRect(ctx, COL2X, ty, fill, barH, 5); ctx.fill();
  }

  sectionLabel("◈ TÀI NGUYÊN HỆ THỐNG", COL2X, ry, "#a78bfa"); ry += 24;

  ctx.font = "13px sans-serif"; ctx.fillStyle = "#9999bb";
  ctx.fillText(`🔩 CPU: ${cpuModel || ""}`, COL2X, ry); ry += 20;
  drawGauge("CPU Load", cpuPct, "#00e5ff", ry); ry += LH + 14;

  const ramFreeGB = ((parseFloat(totalMem) - parseFloat(usedMem)) / 1024).toFixed(2);
  ctx.font = "13px sans-serif"; ctx.fillStyle = "#9999bb";
  ctx.fillText(`💾 RAM: ${usedMem}MB / ${totalMem}MB  (${ramFreeGB}GB trống)`, COL2X, ry); ry += 20;
  drawGauge("RAM Usage", ramPct, "#7c5cfc", ry, true); ry += LH + 22;

  // ── Mini stat boxes ────────────────────────────────────────────────────────
  sectionLabel("◈ THỐNG KÊ NHANH", COL2X, ry, "#00e5ff"); ry += 22;
  const boxes = [
    { label: "Ping",     val: `${pingMs}ms`,        color: pingMs < 200 ? "#44ff88" : "#ffcc00" },
    { label: "Threads",  val: `${threadCount}`,      color: "#a78bfa" },
    { label: "Lệnh",     val: `${cmdCount}`,         color: "#00e5ff" },
    { label: "Restarts", val: `${restartCount}`,     color: "#ffcc44" },
  ];
  const BW = Math.floor((barW - 12) / 2), BH = 56;
  boxes.forEach((b, i) => {
    const bx = COL2X + (i % 2) * (BW + 12);
    const by = ry + Math.floor(i / 2) * (BH + 10);
    ctx.fillStyle = b.color + "18";
    roundRect(ctx, bx, by, BW, BH, 8); ctx.fill();
    ctx.strokeStyle = b.color + "55"; ctx.lineWidth = 1;
    roundRect(ctx, bx, by, BW, BH, 8); ctx.stroke();
    ctx.font = "bold 20px sans-serif"; ctx.fillStyle = b.color;
    ctx.textAlign = "center";
    ctx.fillText(b.val, bx + BW / 2, by + 28);
    ctx.font = "11px sans-serif"; ctx.fillStyle = "#888899";
    ctx.fillText(b.label, bx + BW / 2, by + 46);
    ctx.textAlign = "left";
  });

  // ── Status footer bar ──────────────────────────────────────────────────────
  const fY = H - PAD - 44;
  const statusOk = !ramWarning;
  const fGrad = ctx.createLinearGradient(PAD, fY, PAD + PW, fY);
  fGrad.addColorStop(0, statusOk ? "#00443322" : "#44000022");
  fGrad.addColorStop(1, statusOk ? "#00664422" : "#66000022");
  ctx.fillStyle = fGrad;
  roundRect(ctx, PAD + 8, fY, PW - 16, 36, 8); ctx.fill();
  ctx.strokeStyle = statusOk ? "#00cc6655" : "#cc222255"; ctx.lineWidth = 1;
  roundRect(ctx, PAD + 8, fY, PW - 16, 36, 8); ctx.stroke();

  const statusTxt = statusOk
    ? "✅  Hệ thống đang chạy ổn định"
    : `⚠️  RAM cao (${ramPct}%) — Cân nhắc restart bot!`;
  ctx.font = "bold 15px sans-serif";
  ctx.fillStyle = statusOk ? "#44dd88" : "#ff6644";
  ctx.textAlign = "center";
  ctx.fillText(statusTxt, W / 2, fY + 23);
  ctx.textAlign = "left";

  return savePng(canvas, "uptime_card");
}

// ═════════════════════════════════════════════════════════════════════════════

const _stub = async () => null;

module.exports = _canvasAvailable ? {
  drawSearchCard,
  drawNowPlayingCard,
  drawLoadingCard,
  drawJoinCard,
  drawLeaveCard,
  drawMenuCard,
  drawCategoryCard,
  drawCommandInfoCard,
  drawAllCommandsCard,
  drawUptimeCard,
} : {
  drawSearchCard      : _stub,
  drawNowPlayingCard  : _stub,
  drawLoadingCard     : _stub,
  drawJoinCard        : _stub,
  drawLeaveCard       : _stub,
  drawMenuCard        : _stub,
  drawCategoryCard    : _stub,
  drawCommandInfoCard : _stub,
  drawAllCommandsCard : _stub,
  drawUptimeCard      : _stub,
};

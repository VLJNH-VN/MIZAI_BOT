"use strict";

/**
 * utils/musicCard.js
 * Tạo ảnh card cho lệnh music
 */

const { createCanvas, loadImage } = require("canvas");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

const PLATFORM = {
  sc:  { name: "SoundCloud", color: "#ff5500", bg1: "#1a0a00", bg2: "#2d1200", icon: "🎵" },
  spt: { name: "Spotify",    color: "#1db954", bg1: "#001209", bg2: "#002b15", icon: "🎧" },
  mix: { name: "Mixcloud",   color: "#7c4dff", bg1: "#0d0022", bg2: "#1a0044", icon: "🎶" },
};

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

/**
 * Tạo ảnh danh sách bài hát (kết quả tìm kiếm)
 * @param {object} opts
 * @param {string} opts.platform  "sc" | "spt" | "mix"
 * @param {string} opts.query     Từ khóa tìm kiếm
 * @param {Array}  opts.tracks    Danh sách track [{title, author/uploader, duration, ...}]
 * @returns {string} Đường dẫn file ảnh tạm
 */
async function drawSearchCard({ platform, query, tracks }) {
  const p       = PLATFORM[platform] || PLATFORM.sc;
  const W       = 760;
  const PADDING = 28;
  const ROW_H   = 68;
  const HEADER  = 110;
  const FOOTER  = 52;
  const H       = HEADER + tracks.length * ROW_H + FOOTER;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // ── Nền gradient ──────────────────────────────────────────────────────────
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, p.bg1);
  bg.addColorStop(1, p.bg2);
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 18);
  ctx.fill();

  // ── Viền ngoài ─────────────────────────────────────────────────────────────
  ctx.strokeStyle = p.color + "55";
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, W - 2, H - 2, 18);
  ctx.stroke();

  // ── Header ─────────────────────────────────────────────────────────────────
  const headerGrad = ctx.createLinearGradient(0, 0, W, HEADER);
  headerGrad.addColorStop(0, p.color + "33");
  headerGrad.addColorStop(1, "transparent");
  ctx.fillStyle = headerGrad;
  roundRect(ctx, 0, 0, W, HEADER, 18);
  ctx.fill();

  // Platform icon + name
  ctx.font = "bold 30px sans-serif";
  ctx.fillStyle = p.color;
  ctx.fillText(`${p.icon} ${p.name}`, PADDING, 48);

  // Query label
  ctx.font = "18px sans-serif";
  ctx.fillStyle = "#cccccc";
  ctx.fillText(`🔎  "${truncate(query, 55)}"`, PADDING, 82);

  // Divider
  ctx.fillStyle = p.color + "44";
  ctx.fillRect(PADDING, HEADER - 10, W - PADDING * 2, 1);

  // ── Danh sách track ────────────────────────────────────────────────────────
  tracks.forEach((t, i) => {
    const y = HEADER + i * ROW_H;

    // Hover row (alternating)
    if (i % 2 === 0) {
      ctx.fillStyle = "#ffffff08";
      ctx.fillRect(0, y, W, ROW_H);
    }

    // Số thứ tự
    const numStr = `${i + 1}`;
    ctx.font = "bold 22px monospace";
    ctx.fillStyle = p.color;
    ctx.fillText(numStr, PADDING, y + 28);

    const numW = ctx.measureText("9.").width + 10;
    const xOff = PADDING + numW + 10;

    // Tiêu đề bài hát
    const title  = truncate(t.title || t.name || "Không rõ", 46);
    ctx.font = "bold 20px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(title, xOff, y + 28);

    // Artist + duration (dòng 2)
    const artist = truncate(t.uploader || t.author || t.owner?.displayName || "", 38);
    const dur    = t._durStr || "";
    ctx.font = "15px sans-serif";
    ctx.fillStyle = "#aaaaaa";
    ctx.fillText(`👤 ${artist}`, xOff, y + 52);

    if (dur) {
      ctx.fillStyle = p.color + "cc";
      ctx.font = "bold 15px monospace";
      const durX = W - PADDING - ctx.measureText(dur).width;
      ctx.fillText(dur, durX, y + 52);
    }

    // Separator line
    ctx.fillStyle = "#ffffff0a";
    ctx.fillRect(PADDING, y + ROW_H - 1, W - PADDING * 2, 1);
  });

  // ── Footer ─────────────────────────────────────────────────────────────────
  const footerY = HEADER + tracks.length * ROW_H;
  ctx.fillStyle = "#ffffff18";
  ctx.fillRect(0, footerY, W, FOOTER);

  ctx.font = "italic 16px sans-serif";
  ctx.fillStyle = "#888888";
  ctx.fillText(`💬  Reply số từ 1–${tracks.length} để tải nhạc`, PADDING, footerY + 34);

  // Bot watermark
  ctx.font = "bold 14px sans-serif";
  ctx.fillStyle = p.color + "88";
  const wm = "✦ Mizai Bot";
  ctx.fillText(wm, W - PADDING - ctx.measureText(wm).width, footerY + 34);

  // ── Lưu file ───────────────────────────────────────────────────────────────
  const outPath = path.join(os.tmpdir(), `music_card_${Date.now()}.png`);
  const buf     = canvas.toBuffer("image/png");
  fs.writeFileSync(outPath, buf);
  return outPath;
}

/**
 * Tạo ảnh "Now Playing" khi tải xong bài hát
 * @param {object} opts
 * @param {string} opts.platform  "sc" | "spt" | "mix"
 * @param {string} opts.title
 * @param {string} opts.artist
 * @param {string} opts.duration
 * @param {string} [opts.thumb]   URL thumbnail (optional)
 * @returns {string} Đường dẫn file ảnh tạm
 */
async function drawNowPlayingCard({ platform, title, artist, duration, thumb }) {
  const p  = PLATFORM[platform] || PLATFORM.sc;
  const W  = 700;
  const H  = 220;
  const THUMB_SIZE = 160;
  const PAD = 24;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // ── Nền ─────────────────────────────────────────────────────────────────────
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, p.bg1);
  bg.addColorStop(1, p.bg2);
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.fill();

  // Viền
  ctx.strokeStyle = p.color + "66";
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, W - 2, H - 2, 16);
  ctx.stroke();

  // ── Thumbnail ──────────────────────────────────────────────────────────────
  const thumbX = PAD;
  const thumbY = (H - THUMB_SIZE) / 2;

  ctx.save();
  roundRect(ctx, thumbX, thumbY, THUMB_SIZE, THUMB_SIZE, 12);
  ctx.clip();

  if (thumb) {
    try {
      const img = await loadImage(thumb);
      ctx.drawImage(img, thumbX, thumbY, THUMB_SIZE, THUMB_SIZE);
    } catch {
      drawDefaultThumb(ctx, thumbX, thumbY, THUMB_SIZE, p);
    }
  } else {
    drawDefaultThumb(ctx, thumbX, thumbY, THUMB_SIZE, p);
  }
  ctx.restore();

  // Viền thumbnail
  ctx.strokeStyle = p.color + "88";
  ctx.lineWidth = 2;
  roundRect(ctx, thumbX, thumbY, THUMB_SIZE, THUMB_SIZE, 12);
  ctx.stroke();

  // ── Thông tin ─────────────────────────────────────────────────────────────
  const textX = thumbX + THUMB_SIZE + PAD;
  const textW = W - textX - PAD;

  // Platform badge
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

  // Tiêu đề
  ctx.font = "bold 24px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(truncate(title, 32), textX, 92);

  // Artist
  ctx.font = "18px sans-serif";
  ctx.fillStyle = "#bbbbbb";
  ctx.fillText(`👤 ${truncate(artist, 36)}`, textX, 124);

  // Duration
  ctx.font = "bold 16px monospace";
  ctx.fillStyle = p.color;
  ctx.fillText(`⏱ ${duration}`, textX, 154);

  // Now playing bar (animation visual)
  const barY = H - 28;
  ctx.fillStyle = "#ffffff15";
  ctx.fillRect(PAD, barY, W - PAD * 2, 8);
  const barFill = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  barFill.addColorStop(0, p.color);
  barFill.addColorStop(1, p.color + "55");
  ctx.fillStyle = barFill;
  ctx.fillRect(PAD, barY, (W - PAD * 2) * 0.45, 8);

  // Circle indicator
  ctx.beginPath();
  ctx.arc(PAD + (W - PAD * 2) * 0.45, barY + 4, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  // Watermark
  ctx.font = "bold 13px sans-serif";
  ctx.fillStyle = p.color + "66";
  const wm = "✦ Mizai Bot";
  ctx.fillText(wm, W - PAD - ctx.measureText(wm).width, 20);

  const outPath = path.join(os.tmpdir(), `now_playing_${Date.now()}.png`);
  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
  return outPath;
}

/**
 * Tạo ảnh "Đang tải" thay cho text thuần
 */
async function drawLoadingCard({ platform, title, artist, duration }) {
  const p  = PLATFORM[platform] || PLATFORM.sc;
  const W  = 660;
  const H  = 200;
  const PAD = 28;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // ── Nền ─────────────────────────────────────────────────────────────────────
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

  // ── Spinner (vòng tròn loading vẽ tay) ────────────────────────────────────
  const cx = PAD + 62;
  const cy = H / 2;
  const R  = 46;

  // Vòng nền mờ
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = p.color + "22";
  ctx.lineWidth = 8;
  ctx.stroke();

  // Cung loading - nhiều đoạn với opacity giảm dần (tạo hiệu ứng spinner tĩnh)
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

  // Chấm tròn ở đầu spinner
  const dotAngle = -Math.PI / 2;
  ctx.beginPath();
  ctx.arc(cx + R * Math.cos(dotAngle), cy + R * Math.sin(dotAngle), 6, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  // Label dưới spinner
  ctx.font = "bold 12px monospace";
  ctx.fillStyle = p.color;
  ctx.textAlign = "center";
  ctx.fillText("LOADING", cx, cy + R + 20);
  ctx.textAlign = "left";

  // ── Divider dọc ────────────────────────────────────────────────────────────
  const divX = PAD + 62 * 2 + 8;
  ctx.fillStyle = p.color + "33";
  ctx.fillRect(divX, PAD, 1.5, H - PAD * 2);

  // ── Thông tin bên phải ─────────────────────────────────────────────────────
  const textX = divX + 22;

  // Header "ĐANG TẢI"
  ctx.font = "bold 13px monospace";
  ctx.fillStyle = p.color + "bb";
  ctx.fillText(`${p.name.toUpperCase()} · ĐANG TẢI`, textX, 44);

  // ── Icon + Title ────────────────────────────────────────────────────────────
  const row1Y = 82;
  drawNoteIcon(ctx, textX, row1Y - 14, 18, p.color);
  ctx.font = "bold 22px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(truncate(title, 28), textX + 26, row1Y);

  // ── Icon + Artist ──────────────────────────────────────────────────────────
  const row2Y = 120;
  drawPersonIcon(ctx, textX, row2Y - 14, 18, "#aaaaaa");
  ctx.font = "16px sans-serif";
  ctx.fillStyle = "#aaaaaa";
  ctx.fillText(truncate(artist, 34), textX + 26, row2Y);

  // ── Icon + Duration ───────────────────────────────────────────────────────
  const row3Y = 154;
  drawClockIcon(ctx, textX, row3Y - 14, 18, p.color);
  ctx.font = "bold 16px monospace";
  ctx.fillStyle = p.color;
  ctx.fillText(duration, textX + 26, row3Y);

  // Watermark
  ctx.font = "bold 12px sans-serif";
  ctx.fillStyle = p.color + "55";
  const wm = "✦ Mizai Bot";
  ctx.fillText(wm, W - PAD - ctx.measureText(wm).width, H - 14);

  const outPath = path.join(os.tmpdir(), `loading_card_${Date.now()}.png`);
  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
  return outPath;
}

// ── Icon helpers vẽ tay ───────────────────────────────────────────────────────

function drawNoteIcon(ctx, x, y, size, color) {
  const s = size;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;

  // Thân nốt nhạc (hình bầu dục)
  ctx.beginPath();
  ctx.ellipse(s * 0.22, s * 0.85, s * 0.22, s * 0.16, -0.4, 0, Math.PI * 2);
  ctx.fill();

  // Cột nốt
  ctx.fillRect(s * 0.42, s * 0.1, s * 0.1, s * 0.76);

  // Cờ nốt (cung tròn)
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

  // Đầu (hình tròn)
  ctx.beginPath();
  ctx.arc(s * 0.5, s * 0.28, s * 0.22, 0, Math.PI * 2);
  ctx.fill();

  // Thân (nửa hình tròn phía dưới)
  ctx.beginPath();
  ctx.arc(s * 0.5, s * 1.05, s * 0.42, Math.PI, 0);
  ctx.fill();

  ctx.restore();
}

function drawClockIcon(ctx, x, y, size, color) {
  const s = size;
  ctx.save();
  ctx.translate(x + s / 2, y + s / 2);

  // Mặt đồng hồ
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.1;
  ctx.stroke();

  // Kim giờ
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -s * 0.28);
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.12;
  ctx.lineCap = "round";
  ctx.stroke();

  // Kim phút
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(s * 0.22, 0);
  ctx.lineWidth = s * 0.09;
  ctx.stroke();

  ctx.restore();
}

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

module.exports = { drawSearchCard, drawNowPlayingCard, drawLoadingCard };

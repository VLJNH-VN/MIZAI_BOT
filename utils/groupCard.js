"use strict";

/**
 * utils/groupCard.js
 * Canvas cards cho Join / Leave notification
 */

const { createCanvas } = require("canvas");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

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
 * @param {object} opts
 * @param {string} opts.name       Tên thành viên
 * @param {string} opts.groupName  Tên nhóm
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

  // Nền gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, BG1);
  bg.addColorStop(1, BG2);
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 20);
  ctx.fill();

  // Viền
  ctx.strokeStyle = COLOR + "77";
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, W - 2, H - 2, 20);
  ctx.stroke();

  // Glare góc trên trái
  const glare = ctx.createRadialGradient(0, 0, 0, 0, 0, 260);
  glare.addColorStop(0, COLOR + "18");
  glare.addColorStop(1, "transparent");
  ctx.fillStyle = glare;
  ctx.fillRect(0, 0, W, H);

  // Particles
  drawParticles(ctx, W, H, COLOR, 22);

  // Avatar circle
  const AVATAR_R = 68;
  const cx = PAD + AVATAR_R + 8;
  const cy = H / 2;
  drawAvatarCircle(ctx, cx, cy, AVATAR_R, name || "?", COLOR);

  // Glow ring
  ctx.beginPath();
  ctx.arc(cx, cy, AVATAR_R + 10, 0, Math.PI * 2);
  ctx.strokeStyle = COLOR + "33";
  ctx.lineWidth = 6;
  ctx.stroke();

  // Header badge
  const textX = cx + AVATAR_R + PAD;
  ctx.font = "bold 14px monospace";
  ctx.fillStyle = COLOR + "cc";
  ctx.fillText("✦ CHÀO MỪNG THÀNH VIÊN MỚI ✦", textX, 50);

  // Tên thành viên
  ctx.font = `bold 34px sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(truncate(name, 22), textX, 105);

  // Dòng "đã tham gia"
  ctx.font = "18px sans-serif";
  ctx.fillStyle = "#aaffcc";
  ctx.fillText("đã tham gia", textX, 138);

  // Tên nhóm
  ctx.font = "bold 22px sans-serif";
  ctx.fillStyle = COLOR;
  ctx.fillText(truncate(groupName, 28), textX, 170);

  // Đường kẻ trang trí
  ctx.fillStyle = COLOR + "55";
  ctx.fillRect(textX, 186, W - textX - PAD, 1.5);

  // Hướng dẫn nhỏ phía dưới
  ctx.font = "italic 14px sans-serif";
  ctx.fillStyle = "#88bbaa";
  ctx.fillText("Chúc bạn có những trải nghiệm thú vị! 🎉", textX, 215);

  // Watermark
  ctx.font = "bold 13px sans-serif";
  ctx.fillStyle = COLOR + "55";
  const wm = "✦ Mizai Bot";
  ctx.fillText(wm, W - PAD - ctx.measureText(wm).width, 20);

  const outPath = path.join(os.tmpdir(), `join_card_${Date.now()}.png`);
  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
  return outPath;
}

/**
 * Card rời / bị kick khỏi nhóm
 * @param {object} opts
 * @param {string} opts.names      Tên (có thể nhiều, cách nhau ", ")
 * @param {string} opts.groupName  Tên nhóm
 * @param {string} opts.reason     "leave" | "remove" | "unknown"
 */
async function drawLeaveCard({ names, groupName, reason = "leave" }) {
  const W   = 720;
  const H   = 220;
  const PAD = 28;

  const isKick   = reason === "remove";
  const COLOR    = isKick ? "#ff3d00" : "#ff9100";
  const BG1      = isKick ? "#1a0000" : "#1a0a00";
  const BG2      = isKick ? "#2d0000" : "#2d1400";
  const EMOJI    = isKick ? "🚫" : "👋";
  const LABEL    = isKick ? "ĐÃ BỊ XOÁ KHỎI NHÓM" : "ĐÃ RỜI NHÓM";

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // Nền
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, BG1);
  bg.addColorStop(1, BG2);
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 20);
  ctx.fill();

  // Viền
  ctx.strokeStyle = COLOR + "77";
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, W - 2, H - 2, 20);
  ctx.stroke();

  // Glare
  const glare = ctx.createRadialGradient(W, 0, 0, W, 0, 280);
  glare.addColorStop(0, COLOR + "18");
  glare.addColorStop(1, "transparent");
  ctx.fillStyle = glare;
  ctx.fillRect(0, 0, W, H);

  // Icon vòng tròn bên trái
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

  // Nội dung
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

  // Divider
  ctx.fillStyle = COLOR + "44";
  ctx.fillRect(textX, 170, W - textX - PAD, 1);

  ctx.font = "italic 13px sans-serif";
  ctx.fillStyle = "#887766";
  ctx.fillText(isKick ? "Vi phạm nội quy nhóm." : "Hẹn gặp lại! 🌙", textX, 190);

  // Watermark
  ctx.font = "bold 13px sans-serif";
  ctx.fillStyle = COLOR + "55";
  const wm = "✦ Mizai Bot";
  ctx.fillText(wm, W - PAD - ctx.measureText(wm).width, 20);

  const outPath = path.join(os.tmpdir(), `leave_card_${Date.now()}.png`);
  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
  return outPath;
}

module.exports = { drawJoinCard, drawLeaveCard };

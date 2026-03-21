"use strict";

/**
 * utils/menuCard.js
 * Canvas cards cho lệnh menu / help
 */

const { createCanvas } = require("canvas");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

const THEME = {
  color:  "#7c5cfc",
  accent: "#a78bfa",
  bg1:    "#08001f",
  bg2:    "#12003a",
  dim:    "#3d2a70",
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

function drawBase(ctx, W, H) {
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, THEME.bg1);
  bg.addColorStop(1, THEME.bg2);
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 20);
  ctx.fill();

  ctx.strokeStyle = THEME.color + "55";
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, W - 2, H - 2, 20);
  ctx.stroke();

  // Corner glow
  const glow = ctx.createRadialGradient(W * 0.8, H * 0.1, 0, W * 0.8, H * 0.1, 300);
  glow.addColorStop(0, THEME.color + "22");
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

function drawHeader(ctx, W, titleText, subtitleText, PAD) {
  const HEADER_H = 96;

  // Header tint
  const headerGrad = ctx.createLinearGradient(0, 0, W, HEADER_H);
  headerGrad.addColorStop(0, THEME.color + "44");
  headerGrad.addColorStop(1, "transparent");
  ctx.fillStyle = headerGrad;
  roundRect(ctx, 0, 0, W, HEADER_H, 20);
  ctx.fill();

  // Title
  ctx.font = "bold 28px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(titleText, PAD, 44);

  // Subtitle
  ctx.font = "16px sans-serif";
  ctx.fillStyle = THEME.accent;
  ctx.fillText(subtitleText, PAD, 72);

  // Divider
  ctx.fillStyle = THEME.color + "55";
  ctx.fillRect(PAD, HEADER_H - 8, W - PAD * 2, 1);

  return HEADER_H;
}

function drawWatermark(ctx, W, H, PAD) {
  ctx.font = "bold 13px sans-serif";
  ctx.fillStyle = THEME.color + "66";
  const wm = "✦ Mizai Bot";
  ctx.fillText(wm, W - PAD - ctx.measureText(wm).width, 20);
}

/**
 * Card danh sách nhóm lệnh (menu chính)
 * @param {object} opts
 * @param {Array}  opts.groups       [{commandCategory, commandsName:[]}]
 * @param {number} opts.uniqueCount  Tổng số lệnh
 * @param {string} opts.prefix       Prefix lệnh
 */
async function drawMenuCard({ groups, uniqueCount, prefix = "." }) {
  const W       = 760;
  const PAD     = 28;
  const ROW_H   = 58;
  const HEADER  = 96;
  const FOOTER  = 56;
  const H       = HEADER + groups.length * ROW_H + FOOTER;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  drawBase(ctx, W, H);
  drawHeader(ctx, W, `🤖 MIZAI BOT — MENU LỆNH`, `Tổng: ${uniqueCount} lệnh  ·  Prefix: ${prefix}`, PAD);
  drawWatermark(ctx, W, H, PAD);

  // Rows
  groups.forEach((g, i) => {
    const y = HEADER + i * ROW_H;

    if (i % 2 === 0) {
      ctx.fillStyle = "#ffffff08";
      ctx.fillRect(0, y, W, ROW_H);
    }

    // Số thứ tự badge
    const numStr = `${i + 1}`;
    ctx.font = "bold 15px monospace";
    const numW = ctx.measureText("00").width;
    roundRect(ctx, PAD, y + 14, numW + 14, 26, 6);
    ctx.fillStyle = THEME.color + "33";
    ctx.fill();
    ctx.strokeStyle = THEME.color + "88";
    ctx.lineWidth = 1;
    roundRect(ctx, PAD, y + 14, numW + 14, 26, 6);
    ctx.stroke();
    ctx.fillStyle = THEME.color;
    ctx.fillText(numStr, PAD + 7, y + 32);

    const xOff = PAD + numW + 28;

    // Tên nhóm
    ctx.font = "bold 19px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(truncate(g.commandCategory, 36), xOff, y + 28);

    // Số lệnh
    const countTxt = `${g.commandsName.length} lệnh`;
    ctx.font = "14px sans-serif";
    ctx.fillStyle = THEME.accent;
    ctx.fillText(countTxt, xOff, y + 48);

    // Dot preview (hiện 4 tên lệnh đầu)
    const preview = g.commandsName.slice(0, 4).join("  ·  ");
    ctx.font = "13px monospace";
    ctx.fillStyle = "#666688";
    ctx.fillText(truncate(preview, 52), W / 2 + 10, y + 38);

    // Separator
    ctx.fillStyle = "#ffffff0a";
    ctx.fillRect(PAD, y + ROW_H - 1, W - PAD * 2, 1);
  });

  // Footer
  const footerY = HEADER + groups.length * ROW_H;
  ctx.fillStyle = "#ffffff10";
  ctx.fillRect(0, footerY, W, FOOTER);

  ctx.font = "italic 15px sans-serif";
  ctx.fillStyle = "#888888";
  ctx.fillText(`💬  Reply số từ 1–${groups.length} để xem lệnh trong nhóm`, PAD, footerY + 36);

  const outPath = path.join(os.tmpdir(), `menu_card_${Date.now()}.png`);
  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
  return outPath;
}

/**
 * Card danh sách lệnh trong 1 nhóm
 * @param {object} opts
 * @param {string} opts.category  Tên nhóm lệnh
 * @param {Array}  opts.commands  [{name}] hoặc [string]
 * @param {string} opts.prefix
 */
async function drawCategoryCard({ category, commands, prefix = "." }) {
  const names   = commands.map(c => (typeof c === "string" ? c : c.name));
  const COLS    = 2;
  const COL_W   = 360;
  const W       = 760;
  const PAD     = 28;
  const ROW_H   = 52;
  const HEADER  = 96;
  const FOOTER  = 52;
  const rows    = Math.ceil(names.length / COLS);
  const H       = HEADER + rows * ROW_H + FOOTER;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  drawBase(ctx, W, H);
  drawHeader(ctx, W, `📂 ${category}`, `${names.length} lệnh  ·  Reply STT để xem chi tiết`, PAD);
  drawWatermark(ctx, W, H, PAD);

  names.forEach((name, i) => {
    const col  = i % COLS;
    const row  = Math.floor(i / COLS);
    const x    = PAD + col * COL_W;
    const y    = HEADER + row * ROW_H;

    if (row % 2 === 0) {
      ctx.fillStyle = "#ffffff06";
      ctx.fillRect(col * COL_W, y, COL_W, ROW_H);
    }

    // Number badge
    ctx.font = "bold 14px monospace";
    ctx.fillStyle = THEME.color;
    ctx.fillText(`${i + 1}.`, x + 4, y + 32);

    // Command name
    ctx.font = "bold 18px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(prefix + truncate(name, 18), x + 38, y + 32);

    // Divider
    ctx.fillStyle = "#ffffff08";
    ctx.fillRect(x, y + ROW_H - 1, COL_W - 8, 1);
  });

  // Footer
  const footerY = HEADER + rows * ROW_H;
  ctx.fillStyle = "#ffffff10";
  ctx.fillRect(0, footerY, W, FOOTER);
  ctx.font = "italic 15px sans-serif";
  ctx.fillStyle = "#888888";
  ctx.fillText(`💬  Reply số từ 1–${names.length} để xem chi tiết lệnh`, PAD, footerY + 34);

  const outPath = path.join(os.tmpdir(), `category_card_${Date.now()}.png`);
  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
  return outPath;
}

/**
 * Card thông tin chi tiết 1 lệnh
 * @param {object} opts
 * @param {object} opts.config  Command config object
 * @param {string} opts.prefix
 */
async function drawCommandInfoCard({ config, prefix = "." }) {
  const W   = 720;
  const H   = 340;
  const PAD = 28;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  drawBase(ctx, W, H);
  drawWatermark(ctx, W, H, PAD);

  // Header
  const headerGrad = ctx.createLinearGradient(0, 0, W, 100);
  headerGrad.addColorStop(0, THEME.color + "44");
  headerGrad.addColorStop(1, "transparent");
  ctx.fillStyle = headerGrad;
  roundRect(ctx, 0, 0, W, 100, 20);
  ctx.fill();

  // Command name big
  ctx.font = "bold 32px monospace";
  ctx.fillStyle = THEME.color;
  ctx.fillText(`${prefix}${config.name}`, PAD, 52);

  ctx.font = "16px sans-serif";
  ctx.fillStyle = "#aaaaaa";
  ctx.fillText(truncate(config.description || "Không có mô tả", 60), PAD, 80);

  ctx.fillStyle = THEME.color + "44";
  ctx.fillRect(PAD, 96, W - PAD * 2, 1);

  // Fields
  const fields = [
    { icon: "🔖", label: "Phiên bản",   value: config.version || "1.0.0" },
    { icon: "🔐", label: "Quyền hạn",   value: config.hasPermssion == 2 ? "Admin Bot" : config.hasPermssion == 1 ? "Quản Trị Viên Nhóm" : "Thành Viên" },
    { icon: "👤", label: "Tác giả",     value: config.credits || "Không rõ" },
    { icon: "📁", label: "Nhóm lệnh",   value: config.commandCategory || "Khác" },
    { icon: "📝", label: "Cách dùng",   value: `${prefix}${config.name} ${config.usages || ""}` },
    { icon: "⏳", label: "Cooldown",    value: `${config.cooldowns || 0}s` },
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
    ctx.fillStyle = THEME.accent;
    ctx.fillText(`${f.icon} ${f.label}:`, PAD, y + 22);

    ctx.font = "bold 15px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(truncate(String(f.value), 52), PAD + 160, y + 22);
  });

  const outPath = path.join(os.tmpdir(), `cmd_info_card_${Date.now()}.png`);
  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
  return outPath;
}

module.exports = { drawMenuCard, drawCategoryCard, drawCommandInfoCard };

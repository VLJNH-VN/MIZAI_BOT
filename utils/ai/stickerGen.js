/**
 * utils/ai/stickerGen.js
 * Tạo sticker tùy chỉnh cho Mizai goibot:
 *   1. Text sticker — vẽ bằng canvas (gradient + emoji + text)
 *   2. AI sticker  — dùng Flux API (anime mini style)
 */

const { createCanvas, registerFont } = require("canvas");
const path  = require("path");
const fs    = require("fs");
const os    = require("os");
const axios = require("axios");

// ── Bảng màu gradient theo cảm xúc ───────────────────────────────────────────
const EMOTION_THEMES = {
  vui      : { grad: ["#FFE066", "#FF9A3C"], deco: ["⭐", "✨", "🌟"], emoji: "😄" },
  "rất vui": { grad: ["#FFD700", "#FF6B35"], deco: ["🎉", "✨", "🎊"], emoji: "🤩" },
  phấn_khích: { grad: ["#FF6EC7", "#FFAB40"], deco: ["🚀", "💥", "⚡"], emoji: "🔥" },
  buồn     : { grad: ["#89CFF0", "#A9BCD0"], deco: ["💧", "🌧️", "☁️"], emoji: "😢" },
  "rất buồn": { grad: ["#5B8FA8", "#7B9EB9"], deco: ["💔", "😭", "🌧️"], emoji: "😭" },
  mệt      : { grad: ["#B0BEC5", "#90A4AE"], deco: ["💤", "😴", "🌙"], emoji: "😴" },
  tức_giận : { grad: ["#FF5252", "#FF1744"], deco: ["💢", "🔥", "😡"], emoji: "😤" },
  lo_lắng  : { grad: ["#CE93D8", "#AB47BC"], deco: ["😰", "💭", "❓"], emoji: "😰" },
  cô_đơn   : { grad: ["#80CBC4", "#4DB6AC"], deco: ["🌙", "⭐", "💫"], emoji: "🥺" },
  tim      : { grad: ["#F48FB1", "#E91E63"], deco: ["💕", "💗", "💖"], emoji: "❤️" },
  cute     : { grad: ["#CE93D8", "#F48FB1"], deco: ["🌸", "✨", "💫"], emoji: "🌸" },
  haha     : { grad: ["#FFF176", "#FFD54F"], deco: ["😂", "🤣", "😹"], emoji: "😂" },
  wow      : { grad: ["#80DEEA", "#4DD0E1"], deco: ["😮", "✨", "💫"], emoji: "😲" },
  ok       : { grad: ["#A5D6A7", "#66BB6A"], deco: ["✅", "👍", "💪"], emoji: "👌" },
  default  : { grad: ["#80CBC4", "#4FC3F7"], deco: ["✨", "💫", "🌟"], emoji: "😊" },
};

// Normalize emotion key
function normalizeEmotion(key) {
  if (!key) return "default";
  const k = key.toLowerCase().replace(/[\s-]/g, "_");
  return EMOTION_THEMES[k] ? k : "default";
}

// ── Vẽ text sticker bằng canvas ───────────────────────────────────────────────
async function createTextSticker({ text = "", emotion = "default", width = 400, height = 320 }) {
  const theme = EMOTION_THEMES[normalizeEmotion(emotion)] || EMOTION_THEMES.default;
  const canvas = createCanvas(width, height);
  const ctx    = canvas.getContext("2d");

  // Rounded rect clip
  const r = 32;
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(width - r, 0);
  ctx.quadraticCurveTo(width, 0, width, r);
  ctx.lineTo(width, height - r);
  ctx.quadraticCurveTo(width, height, width - r, height);
  ctx.lineTo(r, height); ctx.quadraticCurveTo(0, height, 0, height - r);
  ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.clip();

  // Gradient background
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, theme.grad[0]);
  grad.addColorStop(1, theme.grad[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Soft inner glow
  const glow = ctx.createRadialGradient(width / 2, height / 2, 10, width / 2, height / 2, width * 0.6);
  glow.addColorStop(0, "rgba(255,255,255,0.25)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Deco emoji (corners & scattered)
  const decoEmojis = theme.deco;
  const decoPositions = [
    [18, 20], [width - 40, 20],
    [12, height - 28], [width - 44, height - 28],
    [width * 0.5 - 10, 12],
  ];
  ctx.font = "22px sans-serif";
  ctx.globalAlpha = 0.7;
  decoPositions.forEach(([x, y], i) => {
    ctx.fillText(decoEmojis[i % decoEmojis.length], x, y + 16);
  });
  ctx.globalAlpha = 1;

  // Big emoji center-top
  ctx.font = "72px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const emojiY = text ? height * 0.32 : height * 0.48;
  ctx.fillText(theme.emoji, width / 2, emojiY);

  // Text (if provided)
  if (text) {
    const maxFontSize = 36;
    const minFontSize = 18;
    let fontSize = maxFontSize;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Shrink font to fit
    while (fontSize > minFontSize) {
      ctx.font = `bold ${fontSize}px sans-serif`;
      if (ctx.measureText(text).width < width - 48) break;
      fontSize -= 2;
    }

    // Text shadow
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur  = 4;
    ctx.shadowOffsetY = 2;

    ctx.fillStyle = "#FFFFFF";
    ctx.font = `bold ${fontSize}px sans-serif`;

    // Word wrap
    const words    = text.split(" ");
    const maxW     = width - 48;
    const lines    = [];
    let   line     = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);

    const lineH = fontSize * 1.3;
    const startY = height * 0.6 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((l, i) => {
      ctx.fillText(l, width / 2, startY + i * lineH);
    });

    ctx.shadowColor   = "transparent";
    ctx.shadowBlur    = 0;
    ctx.shadowOffsetY = 0;
  }

  // Border
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth   = 3;
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(width - r, 0);
  ctx.quadraticCurveTo(width, 0, width, r);
  ctx.lineTo(width, height - r);
  ctx.quadraticCurveTo(width, height, width - r, height);
  ctx.lineTo(r, height); ctx.quadraticCurveTo(0, height, 0, height - r);
  ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.stroke();

  return canvas.toBuffer("image/png");
}

// ── Tạo AI sticker dùng Flux API ─────────────────────────────────────────────
const FLUX_API_BASE = "https://flux-image-gen-9rew.onrender.com";

async function createAiSticker({ prompt, emotion = "cute" }) {
  const stickerPrompt = `${prompt}, cute anime sticker style, chibi, white background, simple, clean, high quality, sticker design`;

  try {
    // Enhance prompt bằng Gemini
    const promptRes = await axios.post(
      `${FLUX_API_BASE}/api/generate-prompt`,
      { idea: stickerPrompt, style: "anime" },
      { timeout: 25000 }
    );
    const enhanced = promptRes.data?.prompt || stickerPrompt;

    // Tạo ảnh nhỏ 512x512
    const imageRes = await axios.post(
      `${FLUX_API_BASE}/api/generate-image`,
      { prompt: enhanced, width: 512, height: 512, steps: 4 },
      { timeout: 80000 }
    );
    const { image } = imageRes.data;
    if (!image) throw new Error("Flux API không trả về ảnh");
    return Buffer.from(image, "base64");
  } catch (err) {
    // Fallback: vẽ canvas sticker với text từ prompt
    global.logWarn?.(`[stickerGen/ai] Flux thất bại (${err.message}), fallback canvas...`);
    const shortText = prompt.slice(0, 40);
    return createTextSticker({ text: shortText, emotion });
  }
}

// ── Hàm chính — tạo sticker và lưu file tmp ──────────────────────────────────
async function generateSticker({ text = "", emotion = "default", aiPrompt = "", mode = "text" }) {
  let buf;
  if (mode === "ai" && aiPrompt) {
    buf = await createAiSticker({ prompt: aiPrompt, emotion });
  } else {
    buf = await createTextSticker({ text, emotion });
  }

  const tmpPath = path.join(os.tmpdir(), `mizai_sticker_${Date.now()}.png`);
  fs.writeFileSync(tmpPath, buf);
  return tmpPath;
}

module.exports = { generateSticker, createTextSticker, createAiSticker, EMOTION_THEMES };

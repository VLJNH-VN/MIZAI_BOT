/**
 * utils/ai/stickerGen.js  —  v3.0.0
 * Tạo sticker cho Mizai goibot:
 *
 *  Luồng khi mode="ai" (tạo stk từ ảnh hoặc mô tả):
 *    1. Nếu có imgUrl  → HuggingFace imageToImage anime style
 *    2. Nếu có prompt  → Pollinations.ai text-to-image (hoàn toàn miễn phí)
 *    3. Fallback       → sharp xử lý ảnh gốc (resize + viền tròn)
 *    4. Fallback cuối  → canvas text sticker
 *
 *  Luồng khi mode="text":
 *    → canvas gradient + emoji + text
 */

"use strict";

const { createCanvas }   = require("canvas");
const { HfInference }    = require("@huggingface/inference");
const sharp              = require("sharp");
const axios              = require("axios");
const path               = require("path");
const fs                 = require("fs");
const os                 = require("os");

// ── HuggingFace helper ────────────────────────────────────────────────────────
const getHf = () => {
  const token = global?.config?.hfToken || process.env.HF_TOKEN || "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";
  return new HfInference(token);
};

// Các model anime img2img miễn phí trên HuggingFace (theo thứ tự ưu tiên)
const ANIME_I2I_MODELS = [
  "Linaqruf/anything-v3-1",
  "dreamlike-art/dreamlike-anime-1.0",
];

// ── Tải ảnh từ URL → Buffer ───────────────────────────────────────────────────
async function fetchBuffer(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout     : 25000,
    headers     : { "User-Agent": "Mozilla/5.0" },
  });
  return Buffer.from(res.data);
}

// ── Bảng màu gradient text sticker ───────────────────────────────────────────
const EMOTION_THEMES = {
  vui        : { grad: ["#FFE066", "#FF9A3C"], deco: ["⭐","✨","🌟"], emoji: "😄" },
  "rất vui"  : { grad: ["#FFD700", "#FF6B35"], deco: ["🎉","✨","🎊"], emoji: "🤩" },
  phấn_khích : { grad: ["#FF6EC7", "#FFAB40"], deco: ["🚀","💥","⚡"],  emoji: "🔥" },
  buồn       : { grad: ["#89CFF0", "#A9BCD0"], deco: ["💧","🌧️","☁️"],  emoji: "😢" },
  "rất buồn" : { grad: ["#5B8FA8", "#7B9EB9"], deco: ["💔","😭","🌧️"], emoji: "😭" },
  mệt        : { grad: ["#B0BEC5", "#90A4AE"], deco: ["💤","😴","🌙"], emoji: "😴" },
  tức_giận   : { grad: ["#FF5252", "#FF1744"], deco: ["💢","🔥","😡"], emoji: "😤" },
  lo_lắng    : { grad: ["#CE93D8", "#AB47BC"], deco: ["😰","💭","❓"],  emoji: "😰" },
  cô_đơn     : { grad: ["#80CBC4", "#4DB6AC"], deco: ["🌙","⭐","💫"], emoji: "🥺" },
  tim        : { grad: ["#F48FB1", "#E91E63"], deco: ["💕","💗","💖"], emoji: "❤️" },
  cute       : { grad: ["#CE93D8", "#F48FB1"], deco: ["🌸","✨","💫"], emoji: "🌸" },
  haha       : { grad: ["#FFF176", "#FFD54F"], deco: ["😂","🤣","😹"], emoji: "😂" },
  wow        : { grad: ["#80DEEA", "#4DD0E1"], deco: ["😮","✨","💫"], emoji: "😲" },
  ok         : { grad: ["#A5D6A7", "#66BB6A"], deco: ["✅","👍","💪"], emoji: "👌" },
  default    : { grad: ["#80CBC4", "#4FC3F7"], deco: ["✨","💫","🌟"], emoji: "😊" },
};

function normalizeEmotion(key) {
  if (!key) return "default";
  const k = key.toLowerCase().replace(/[\s-]/g, "_");
  return EMOTION_THEMES[k] ? k : "default";
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1.  TEXT STICKER — canvas gradient
// ═══════════════════════════════════════════════════════════════════════════════
async function createTextSticker({ text = "", emotion = "default", width = 400, height = 320 }) {
  const theme  = EMOTION_THEMES[normalizeEmotion(emotion)] || EMOTION_THEMES.default;
  const canvas = createCanvas(width, height);
  const ctx    = canvas.getContext("2d");
  const r      = 32;

  // Clip rounded rect
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(width - r, 0);
  ctx.quadraticCurveTo(width, 0, width, r);
  ctx.lineTo(width, height - r);
  ctx.quadraticCurveTo(width, height, width - r, height);
  ctx.lineTo(r, height); ctx.quadraticCurveTo(0, height, 0, height - r);
  ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath(); ctx.clip();

  // Gradient BG
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, theme.grad[0]); grad.addColorStop(1, theme.grad[1]);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height);

  // Glow
  const glow = ctx.createRadialGradient(width/2, height/2, 10, width/2, height/2, width*0.6);
  glow.addColorStop(0, "rgba(255,255,255,0.25)"); glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);

  // Deco corners
  const decoPos = [[18,20],[width-40,20],[12,height-28],[width-44,height-28],[width*0.5-10,12]];
  ctx.font = "22px sans-serif"; ctx.globalAlpha = 0.7;
  decoPos.forEach(([x,y],i) => ctx.fillText(theme.deco[i % theme.deco.length], x, y + 16));
  ctx.globalAlpha = 1;

  // Big emoji
  ctx.font = "72px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(theme.emoji, width/2, text ? height*0.32 : height*0.48);

  // Text
  if (text) {
    let fontSize = 36;
    while (fontSize > 18) {
      ctx.font = `bold ${fontSize}px sans-serif`;
      if (ctx.measureText(text).width < width - 48) break;
      fontSize -= 2;
    }
    ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
    ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "center"; ctx.textBaseline = "middle";

    const words = text.split(" "); const maxW = width - 48; const lines = []; let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    const lineH = fontSize * 1.3;
    const startY = height * 0.62 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((l, i) => ctx.fillText(l, width/2, startY + i*lineH));
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  }

  // Border
  ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(r,0); ctx.lineTo(width-r,0); ctx.quadraticCurveTo(width,0,width,r);
  ctx.lineTo(width,height-r); ctx.quadraticCurveTo(width,height,width-r,height);
  ctx.lineTo(r,height); ctx.quadraticCurveTo(0,height,0,height-r);
  ctx.lineTo(0,r); ctx.quadraticCurveTo(0,0,r,0);
  ctx.closePath(); ctx.stroke();

  return canvas.toBuffer("image/png");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2.  SHARP STICKER — xử lý ảnh gốc thành sticker đẹp (offline, miễn phí)
// ═══════════════════════════════════════════════════════════════════════════════
async function createSharpSticker(inputBuf, size = 512) {
  // Tạo SVG mask bo tròn
  const svgMask = Buffer.from(
    `<svg width="${size}" height="${size}">
      <rect x="8" y="8" width="${size-16}" height="${size-16}" rx="48" ry="48" fill="white"/>
    </svg>`
  );

  // Resize về square + bo góc + viền trắng
  const processed = await sharp(inputBuf)
    .resize(size - 16, size - 16, { fit: "cover", position: "center" })
    .png()
    .toBuffer();

  // Composite: đặt ảnh lên canvas trắng với mask bo tròn
  const base = await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).png().toBuffer();

  const result = await sharp(base)
    .composite([
      { input: processed, left: 8, top: 8 },
      { input: svgMask,   blend: "dest-in" },
    ])
    .png()
    .toBuffer();

  // Thêm viền ngoài trắng (stroke effect)
  const withBorder = await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 255 } }
  })
    .composite([{ input: result, left: 0, top: 0 }])
    .png()
    .toBuffer();

  // Bo góc lần cuối toàn bộ
  const finalMask = Buffer.from(
    `<svg width="${size}" height="${size}">
      <rect x="0" y="0" width="${size}" height="${size}" rx="52" ry="52" fill="white"/>
    </svg>`
  );

  return await sharp(withBorder)
    .composite([{ input: finalMask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3.  POLLINATIONS — text-to-image anime (hoàn toàn miễn phí, không cần key)
// ═══════════════════════════════════════════════════════════════════════════════
async function createPollinationsSticker(prompt) {
  const full    = encodeURIComponent(
    `${prompt}, cute anime sticker, chibi style, white background, clean outline, high quality`
  );
  const seed    = Math.floor(Math.random() * 999999);
  const url     = `https://image.pollinations.ai/prompt/${full}?width=512&height=512&model=flux&seed=${seed}&nologo=true`;

  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout     : 90000,
    headers     : { "User-Agent": "Mozilla/5.0" },
  });
  const buf = Buffer.from(res.data);
  if (buf.byteLength < 1000) throw new Error("Pollinations trả về ảnh rỗng");
  return buf;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4.  HuggingFace image-to-image (anime style, miễn phí với HF token)
// ═══════════════════════════════════════════════════════════════════════════════
async function createHfAnimeSticker(imgBuf, prompt) {
  const hf = getHf();
  const fullPrompt = `${prompt}, anime sticker style, chibi, white background, cute, clean, high quality`;

  for (const model of ANIME_I2I_MODELS) {
    try {
      const blob = await hf.imageToImage({
        model,
        inputs           : new Blob([imgBuf], { type: "image/png" }),
        parameters       : { prompt: fullPrompt, strength: 0.65, guidance_scale: 7.5 },
      });
      const buf = Buffer.from(await blob.arrayBuffer());
      if (buf.byteLength > 500) {
        global.logInfo?.(`[stickerGen] HF img2img OK (${model})`);
        return buf;
      }
    } catch (e) {
      global.logWarn?.(`[stickerGen] HF ${model} lỗi: ${e?.message}`);
    }
  }
  throw new Error("Tất cả HF model img2img thất bại");
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC: createAiSticker
//   imgUrl   — URL ảnh gốc người dùng gửi (tuỳ chọn)
//   prompt   — mô tả ảnh bằng tiếng Anh
//   emotion  — cảm xúc (dùng khi không có ảnh)
// ═══════════════════════════════════════════════════════════════════════════════
async function createAiSticker({ prompt = "", emotion = "cute", imgUrl = null }) {
  // ── Nhánh 1: có ảnh gốc → thử convert anime style ──────────────────────────
  if (imgUrl) {
    let origBuf;
    try { origBuf = await fetchBuffer(imgUrl); } catch (_) {}

    if (origBuf) {
      // 1a. HuggingFace img2img anime
      try {
        const animeBuf = await createHfAnimeSticker(origBuf, prompt || "cute portrait");
        return await createSharpSticker(animeBuf);
      } catch (_) {}

      // 1b. Sharp sticker từ ảnh gốc (không cần AI)
      try {
        global.logInfo?.(`[stickerGen] Dùng sharp xử lý ảnh gốc.`);
        return await createSharpSticker(origBuf);
      } catch (_) {}
    }
  }

  // ── Nhánh 2: không có ảnh → tạo từ prompt ──────────────────────────────────
  if (prompt) {
    // 2a. Pollinations (free, no key)
    try {
      const buf = await createPollinationsSticker(prompt);
      return await createSharpSticker(buf);
    } catch (e) {
      global.logWarn?.(`[stickerGen] Pollinations lỗi: ${e?.message}`);
    }

    // 2b. HuggingFace text-to-image
    try {
      const hf   = getHf();
      const blob = await hf.textToImage({
        model     : "stabilityai/stable-diffusion-xl-base-1.0",
        inputs    : `${prompt}, anime sticker, chibi, white background`,
        parameters: { width: 512, height: 512 },
      });
      const buf = Buffer.from(await blob.arrayBuffer());
      if (buf.byteLength > 500) return await createSharpSticker(buf);
    } catch (e) {
      global.logWarn?.(`[stickerGen] HF t2i lỗi: ${e?.message}`);
    }
  }

  // ── Nhánh cuối: canvas text sticker ────────────────────────────────────────
  global.logWarn?.(`[stickerGen] Fallback canvas text sticker.`);
  const shortText = (prompt || "Mizai~").slice(0, 40);
  return createTextSticker({ text: shortText, emotion });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC: generateSticker  (entry point)
// ═══════════════════════════════════════════════════════════════════════════════
async function generateSticker({ text = "", emotion = "default", aiPrompt = "", mode = "text", imgUrl = null }) {
  let buf;

  if (mode === "ai") {
    buf = await createAiSticker({ prompt: aiPrompt || text, emotion, imgUrl });
  } else {
    buf = await createTextSticker({ text, emotion });
  }

  const tmpPath = path.join(os.tmpdir(), `mizai_sticker_${Date.now()}.png`);
  fs.writeFileSync(tmpPath, buf);
  return tmpPath;
}

module.exports = { generateSticker, createTextSticker, createAiSticker, createSharpSticker, EMOTION_THEMES };

"use strict";

/**
 * src/commands/stk.js
 * Tạo sticker từ ảnh, video, text — dùng sharp + ffmpeg
 *
 * Cách dùng:
 *   stk                   → Sticker từ ảnh được reply
 *   stk <url>             → Sticker từ URL ảnh/gif
 *   stk text <nội dung>   → Sticker text nghệ thuật
 *   stk video             → Sticker từ frame video được reply
 *   stk babgwf [text]     → Sticker nền gradient động + text
 */

const fs    = require("fs");
const path  = require("path");
const os    = require("os");
const axios = require("axios");
const sharp = require("sharp");
const { execSync, spawnSync } = require("child_process");

const CACHE_DIR = path.join(process.cwd(), "includes", "cache");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function tmpPath(ext) {
  return path.join(os.tmpdir(), `stk_${uid()}.${ext}`);
}

function cleanup(...files) {
  setTimeout(() => {
    for (const f of files) {
      try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    }
  }, 15_000);
}

async function downloadUrl(url, dest) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 60_000,
    maxContentLength: 100 * 1024 * 1024,
    headers: { "User-Agent": global.userAgent || "Mozilla/5.0" },
  });
  fs.writeFileSync(dest, Buffer.from(res.data));
  if (fs.statSync(dest).size === 0) throw new Error("File tải về rỗng");
}

// ── Lấy URL media từ reply/quote ─────────────────────────────────────────────

async function getMediaUrl({ event, api, threadID, acceptVideo = false }) {
  const raw = event?.data || {};
  const ctx = await global.resolveQuote({ raw, api, threadId: threadID, event });

  if (ctx && ctx.isMedia) {
    const attachments = ctx.attach?.length > 0 ? ctx.attach : [{ url: ctx.mediaUrl }];
    for (const a of attachments) {
      const url = a.hdUrl || a.url || a.normalUrl || a.href || a.fileUrl || a.downloadUrl;
      if (!url) continue;
      if (!acceptVideo) return { url, type: "image" };
      const lower = url.toLowerCase();
      const isVideo = lower.includes(".mp4") || lower.includes(".mov") || lower.includes(".avi")
        || lower.includes(".webm") || ctx.mediaType === "video";
      return { url, type: isVideo ? "video" : "image" };
    }
  }
  return null;
}

// ── 1. Sticker từ ảnh — sharp ─────────────────────────────────────────────────

async function makeStickerFromImage(inputPath, outputPath, opts = {}) {
  const { size = 512, rounded = true, border = true, borderColor = "#ffffff", borderWidth = 12 } = opts;

  let pipeline = sharp(inputPath).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });

  const meta = await sharp(inputPath).metadata();
  const isGif = meta.format === "gif" || meta.pages > 1;

  if (!isGif) {
    const imgBuf = await pipeline.png().toBuffer();

    if (rounded) {
      const mask = Buffer.from(
        `<svg><rect x="0" y="0" width="${size}" height="${size}" rx="${size / 2}" ry="${size / 2}" fill="white"/></svg>`
      );
      const roundedBuf = await sharp(imgBuf)
        .composite([{ input: mask, blend: "dest-in" }])
        .png()
        .toBuffer();

      if (border) {
        const circleSize = size + borderWidth * 2;
        const borderSvg = Buffer.from(
          `<svg width="${circleSize}" height="${circleSize}">
            <circle cx="${circleSize / 2}" cy="${circleSize / 2}" r="${circleSize / 2}" fill="${borderColor}"/>
           </svg>`
        );
        const composed = await sharp(borderSvg)
          .composite([{ input: roundedBuf, top: borderWidth, left: borderWidth }])
          .png()
          .toBuffer();
        fs.writeFileSync(outputPath, composed);
      } else {
        fs.writeFileSync(outputPath, roundedBuf);
      }
    } else {
      fs.writeFileSync(outputPath, imgBuf);
    }
  } else {
    // GIF: chỉ resize bằng ffmpeg
    const result = spawnSync("ffmpeg", [
      "-y", "-i", inputPath,
      "-vf", `scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
      "-loop", "0",
      outputPath,
    ], { encoding: "utf-8" });
    if (result.status !== 0) throw new Error("ffmpeg xử lý GIF thất bại: " + result.stderr?.slice(0, 200));
  }

  return outputPath;
}

// ── 2. Sticker từ video — ffmpeg lấy frame ────────────────────────────────────

async function makeStickerFromVideo(videoPath, outputPath) {
  const probedStr = execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
    { encoding: "utf-8" }
  ).trim();
  const dur = parseFloat(probedStr) || 1;
  const at  = Math.min(dur * 0.25, 3).toFixed(2);

  const framePath = tmpPath("png");
  const r1 = spawnSync("ffmpeg", [
    "-y", "-ss", at, "-i", videoPath,
    "-frames:v", "1", "-q:v", "2", framePath,
  ], { encoding: "utf-8" });
  if (r1.status !== 0) throw new Error("ffmpeg lấy frame thất bại: " + r1.stderr?.slice(0, 200));

  await makeStickerFromImage(framePath, outputPath, { size: 512 });
  cleanup(framePath);
  return outputPath;
}

// ── 3. Sticker text nghệ thuật — sharp SVG ───────────────────────────────────

async function makeStickerText(text, outputPath, opts = {}) {
  const {
    size       = 512,
    fontSize   = 52,
    fontColor  = "#ffffff",
    stroke     = "#000000",
    strokeWidth= 5,
    bg         = ["#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff"],
    emoji      = "✨",
  } = opts;

  const colA = bg[Math.floor(Math.random() * bg.length)];
  const colB = bg[Math.floor(Math.random() * bg.length)];

  const lines = wrapText(text, 18);
  const lineH = fontSize + 12;
  const textH = lines.length * lineH;
  const offsetY = (size - textH) / 2 + fontSize;

  const textRows = lines.map((line, i) => `
    <text
      x="50%" y="${offsetY + i * lineH}"
      text-anchor="middle"
      font-family="Arial, sans-serif"
      font-weight="bold"
      font-size="${fontSize}"
      fill="${fontColor}"
      stroke="${stroke}"
      stroke-width="${strokeWidth}"
      paint-order="stroke"
    >${escapeXml(line)}</text>
  `).join("");

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${colA}"/>
          <stop offset="100%" style="stop-color:${colB}"/>
        </linearGradient>
        <clipPath id="circle"><circle cx="${size/2}" cy="${size/2}" r="${size/2}"/></clipPath>
      </defs>
      <rect width="${size}" height="${size}" rx="${size/2}" ry="${size/2}" fill="url(#g)"/>
      <text x="${size/2}" y="${offsetY - lineH}" text-anchor="middle" font-size="${fontSize + 8}">${emoji}</text>
      ${textRows}
    </svg>
  `;

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return outputPath;
}

// ── 4. Sticker BABGWF — nền gradient sóng + text ─────────────────────────────

async function makeStickerBabgwf(text, outputPath) {
  const size  = 512;
  const lines = text ? wrapText(text, 16) : [];

  const fontSize   = text ? Math.max(30, Math.min(60, Math.floor(size / (lines.length + 2)))) : 0;
  const lineH      = fontSize + 10;
  const totalTextH = lines.length * lineH;
  const startY     = (size - totalTextH) / 2 + fontSize;

  const palettes = [
    ["#0f0c29", "#302b63", "#24243e"],
    ["#4facfe", "#00f2fe", "#43e97b"],
    ["#f7971e", "#ffd200", "#f9484a"],
    ["#833ab4", "#fd1d1d", "#fcb045"],
    ["#11998e", "#38ef7d", "#43e97b"],
  ];
  const pal = palettes[Math.floor(Math.random() * palettes.length)];

  const waves = Array.from({ length: 6 }, (_, i) => {
    const amp  = 20 + i * 8;
    const freq = 0.012 + i * 0.003;
    const yOff = size * (0.3 + i * 0.08);
    const col  = pal[i % pal.length] + Math.floor((1 - i / 8) * 255).toString(16).padStart(2, "0");
    let d = `M 0 ${yOff}`;
    for (let x = 0; x <= size; x += 10) {
      const y = yOff + Math.sin(x * freq + i) * amp;
      d += ` L ${x} ${y}`;
    }
    d += ` L ${size} ${size} L 0 ${size} Z`;
    return `<path d="${d}" fill="${col}"/>`;
  }).join("\n");

  const stars = Array.from({ length: 40 }, () => {
    const x = Math.random() * size;
    const y = Math.random() * size * 0.5;
    const r = 0.5 + Math.random() * 2;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="white" opacity="${0.4 + Math.random() * 0.6}"/>`;
  }).join("\n");

  const textRows = lines.map((line, i) => `
    <text x="50%" y="${startY + i * lineH}"
      text-anchor="middle"
      font-family="Arial Black, Arial, sans-serif"
      font-weight="900"
      font-size="${fontSize}"
      fill="white"
      stroke="#000000"
      stroke-width="4"
      paint-order="stroke"
    >${escapeXml(line)}</text>
  `).join("");

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <defs>
        <linearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:${pal[0]}"/>
          <stop offset="100%" style="stop-color:${pal[1]}"/>
        </linearGradient>
        <clipPath id="circ"><circle cx="${size/2}" cy="${size/2}" r="${size/2}"/></clipPath>
      </defs>
      <g clip-path="url(#circ)">
        <rect width="${size}" height="${size}" fill="url(#sky)"/>
        ${stars}
        ${waves}
        ${textRows}
      </g>
    </svg>
  `;

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return outputPath;
}

// ── Tiện ích text ─────────────────────────────────────────────────────────────

function wrapText(text, maxChars) {
  const words  = text.split(" ");
  const lines  = [];
  let cur      = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur.trim());
  return lines.length ? lines : [text.slice(0, maxChars)];
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Export command ────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name:            "stk",
    aliases:         ["sticker", "nhanhstk"],
    version:         "1.0.0",
    hasPermssion:    0,
    credits:         "MIZAI",
    description:     "Tạo sticker từ ảnh, video, text — dùng sharp + ffmpeg",
    commandCategory: "Tiện Ích",
    usages: [
      "stk              → Sticker từ ảnh reply",
      "stk <url>        → Sticker từ URL ảnh/GIF",
      "stk text <nội dung> → Sticker text nghệ thuật",
      "stk video        → Sticker từ frame video reply",
      "stk babgwf [text] → Sticker nền sóng gradient",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ api, event, args, send, threadID }) => {
    const sub  = (args[0] || "").toLowerCase();
    const rest = args.slice(1).join(" ").trim();

    // ── stk text <nội dung> ───────────────────────────────────────────────────
    if (sub === "text" || sub === "txt" || sub === "chữ") {
      const content = rest || "MIZAI BOT";
      await send("🎨 Đang tạo sticker text...");
      const out = tmpPath("png");
      try {
        await makeStickerText(content, out);
        await send({ msg: `✅ Sticker text: "${content}"`, attachments: [out] });
      } catch (e) {
        await send(`❌ Lỗi tạo sticker text: ${e.message}`);
      } finally { cleanup(out); }
      return;
    }

    // ── stk babgwf [text] ─────────────────────────────────────────────────────
    if (sub === "babgwf" || sub === "bg" || sub === "wave" || sub === "song") {
      const content = rest || "MIZAI ✨";
      await send("🌊 Đang tạo sticker nền sóng...");
      const out = tmpPath("png");
      try {
        await makeStickerBabgwf(content, out);
        await send({ msg: `✅ Sticker babgwf: "${content}"`, attachments: [out] });
      } catch (e) {
        await send(`❌ Lỗi tạo sticker babgwf: ${e.message}`);
      } finally { cleanup(out); }
      return;
    }

    // ── stk video → lấy frame từ video reply ─────────────────────────────────
    if (sub === "video" || sub === "vid" || sub === "vd") {
      const media = await getMediaUrl({ event, api, threadID, acceptVideo: true });
      if (!media) return send("❌ Reply vào tin nhắn có video để tạo sticker nhé!");
      await send("🎬 Đang xử lý video...");

      const vidPath = tmpPath("mp4");
      const out     = tmpPath("png");
      try {
        await downloadUrl(media.url, vidPath);
        await makeStickerFromVideo(vidPath, out);
        await send({ msg: "✅ Sticker từ video!", attachments: [out] });
      } catch (e) {
        await send(`❌ Lỗi xử lý video: ${e.message}`);
      } finally { cleanup(vidPath, out); }
      return;
    }

    // ── stk <url> → từ URL trực tiếp ─────────────────────────────────────────
    if (sub.startsWith("http")) {
      await send("⏳ Đang tải và xử lý ảnh...");
      const url  = sub;
      const isGif = url.toLowerCase().includes(".gif");
      const inp  = tmpPath(isGif ? "gif" : "jpg");
      const out  = tmpPath("png");
      try {
        await downloadUrl(url, inp);
        await makeStickerFromImage(inp, out);
        await send({ msg: "✅ Sticker từ URL!", attachments: [out] });
      } catch (e) {
        await send(`❌ Lỗi xử lý ảnh: ${e.message}`);
      } finally { cleanup(inp, out); }
      return;
    }

    // ── stk (không sub) / stk ảnh → từ ảnh reply ────────────────────────────
    const media = await getMediaUrl({ event, api, threadID, acceptVideo: false });
    if (!media) {
      return send(
        "📌 STICKER MAKER — sharp + ffmpeg\n" +
        "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
        "• stk               → Sticker từ ảnh reply\n" +
        "• stk <url>         → Sticker từ URL ảnh/GIF\n" +
        "• stk text <nội dung>  → Text nghệ thuật\n" +
        "• stk video         → Frame từ video reply\n" +
        "• stk babgwf [text] → Nền sóng gradient\n" +
        "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
        "💡 Reply vào ảnh rồi gõ .stk để tạo sticker!"
      );
    }

    await send("⚙️ Đang xử lý ảnh bằng sharp...");
    const isGif = media.url.toLowerCase().includes(".gif");
    const inp   = tmpPath(isGif ? "gif" : "jpg");
    const out   = tmpPath(isGif ? "gif" : "png");
    try {
      await downloadUrl(media.url, inp);
      await makeStickerFromImage(inp, out, { size: 512, rounded: !isGif });
      await send({ msg: "✅ Sticker đã tạo!", attachments: [out] });
    } catch (e) {
      await send(`❌ Lỗi tạo sticker: ${e.message}`);
    } finally { cleanup(inp, out); }
  },
};

"use strict";

/**
 * src/commands/stk.js
 * Gửi STICKER Zalo thật (searchSticker + sendSticker) hoặc
 * tạo ảnh sticker custom bằng sharp + ffmpeg
 *
 * Cách dùng:
 *   stk <từ khoá>       → Tìm + gửi sticker Zalo thật theo từ khoá
 *   stk ảnh             → Gửi sticker webp từ ảnh reply (sharp)
 *   stk video           → Lấy frame video → sticker webp (ffmpeg)
 *   stk text <nội dung> → Sticker text nghệ thuật (svg → webp)
 *   stk babgwf [text]   → Sticker nền sóng gradient (svg → webp)
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
  if (!ctx || !ctx.isMedia) return null;
  const attachments = ctx.attach?.length > 0 ? ctx.attach : [{ url: ctx.mediaUrl }];
  for (const a of attachments) {
    const url = a.hdUrl || a.url || a.normalUrl || a.href || a.fileUrl || a.downloadUrl;
    if (!url) continue;
    const lower = url.toLowerCase();
    const isVideo = lower.includes(".mp4") || lower.includes(".mov") || lower.includes(".avi")
      || lower.includes(".webm") || ctx.mediaType === "video";
    if (!acceptVideo && isVideo) continue;
    return { url, type: isVideo ? "video" : "image" };
  }
  return null;
}

// ── Gửi sticker Zalo thật qua searchSticker + sendSticker ────────────────────

async function sendZaloSticker(api, keyword, threadID, threadType) {
  const results = await api.searchSticker(keyword, 10);
  if (!results || results.length === 0) return false;
  const sticker = results[Math.floor(Math.random() * results.length)];
  await api.sendSticker(
    { id: sticker.sticker_id, cateId: sticker.cate_id, type: sticker.type ?? 1 },
    threadID,
    threadType
  );
  return true;
}

// ── Xử lý ảnh → webp sticker (sharp) ────────────────────────────────────────

async function imageToStickerWebp(inputPath, outputPath, size = 512) {
  const meta = await sharp(inputPath).metadata();

  if (meta.format === "gif" || (meta.pages && meta.pages > 1)) {
    const r = spawnSync("ffmpeg", [
      "-y", "-i", inputPath,
      "-vf", `scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=white@0`,
      "-loop", "0", "-compression_level", "6",
      outputPath,
    ], { encoding: "utf-8" });
    if (r.status !== 0) throw new Error("ffmpeg GIF thất bại");
    return;
  }

  const mask = Buffer.from(
    `<svg><rect x="0" y="0" width="${size}" height="${size}" rx="${Math.floor(size / 10)}" ry="${Math.floor(size / 10)}" fill="white"/></svg>`
  );

  const processed = await sharp(inputPath)
    .resize(size, size, { fit: "cover", position: "center" })
    .png()
    .toBuffer();

  const rounded = await sharp(processed)
    .composite([{ input: mask, blend: "dest-in" }])
    .webp({ quality: 90, lossless: false })
    .toBuffer();

  fs.writeFileSync(outputPath, rounded);
}

// ── Video → lấy frame → webp sticker (ffmpeg) ────────────────────────────────

async function videoToStickerWebp(videoPath, outputPath, size = 512) {
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
  if (r1.status !== 0) throw new Error("ffmpeg lấy frame thất bại");

  await imageToStickerWebp(framePath, outputPath, size);
  cleanup(framePath);
}

// ── SVG text sticker → webp ───────────────────────────────────────────────────

async function textToStickerWebp(text, outputPath) {
  const size   = 512;
  const colors = [
    ["#FF6B6B","#FECA57"], ["#48DBFB","#FF9FF3"], ["#54A0FF","#5F27CD"],
    ["#00D2D3","#FF9F43"], ["#1DD1A1","#10AC84"], ["#EE5A24","#F79F1F"],
  ];
  const [c1, c2] = colors[Math.floor(Math.random() * colors.length)];
  const lines  = wrapText(text, 16);
  const fSize  = Math.max(32, Math.min(64, Math.floor(360 / (lines.length + 1))));
  const lineH  = fSize + 14;
  const startY = (size - lines.length * lineH) / 2 + fSize;

  const textSvg = lines.map((l, i) => `
    <text x="50%" y="${startY + i * lineH}"
      text-anchor="middle" dominant-baseline="auto"
      font-family="'Arial Black',Arial,sans-serif" font-weight="900"
      font-size="${fSize}" fill="white"
      stroke="#00000066" stroke-width="5" paint-order="stroke"
    >${escapeXml(l)}</text>`).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
      <clipPath id="rr"><rect width="${size}" height="${size}" rx="${Math.floor(size/10)}" ry="${Math.floor(size/10)}"/></clipPath>
    </defs>
    <rect width="${size}" height="${size}" rx="${Math.floor(size/10)}" ry="${Math.floor(size/10)}" fill="url(#g)"/>
    ${textSvg}
  </svg>`;

  await sharp(Buffer.from(svg))
    .webp({ quality: 90 })
    .toFile(outputPath);
}

// ── SVG babgwf (sóng gradient) → webp ────────────────────────────────────────

async function babgwfToStickerWebp(text, outputPath) {
  const size = 512;
  const palettes = [
    ["#0f0c29","#302b63","#24243e"],
    ["#4facfe","#00f2fe","#43e97b"],
    ["#f7971e","#ffd200","#f9484a"],
    ["#833ab4","#fd1d1d","#fcb045"],
    ["#11998e","#38ef7d","#43e97b"],
  ];
  const pal = palettes[Math.floor(Math.random() * palettes.length)];

  const waves = Array.from({ length: 6 }, (_, i) => {
    const amp  = 20 + i * 9;
    const freq = 0.012 + i * 0.003;
    const yOff = size * (0.3 + i * 0.08);
    const col  = pal[i % pal.length];
    const alpha = Math.floor((1 - i / 8) * 255).toString(16).padStart(2, "0");
    let d = `M 0 ${yOff}`;
    for (let x = 0; x <= size; x += 8) {
      d += ` L ${x} ${yOff + Math.sin(x * freq + i) * amp}`;
    }
    d += ` L ${size} ${size} L 0 ${size} Z`;
    return `<path d="${d}" fill="${col}${alpha}"/>`;
  }).join("\n");

  const stars = Array.from({ length: 35 }, () => {
    const x = Math.random() * size;
    const y = Math.random() * size * 0.55;
    const r = 0.5 + Math.random() * 2;
    const op = (0.4 + Math.random() * 0.6).toFixed(2);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="white" opacity="${op}"/>`;
  }).join("\n");

  const lines  = text ? wrapText(text, 15) : [];
  const fSize  = text ? Math.max(32, Math.min(60, Math.floor(380 / (lines.length + 1)))) : 0;
  const lineH  = fSize + 10;
  const startY = (size - lines.length * lineH) / 2 + fSize;
  const textSvg = lines.map((l, i) => `
    <text x="50%" y="${startY + i * lineH}"
      text-anchor="middle" dominant-baseline="auto"
      font-family="'Arial Black',Arial,sans-serif" font-weight="900"
      font-size="${fSize}" fill="white"
      stroke="#00000088" stroke-width="5" paint-order="stroke"
    >${escapeXml(l)}</text>`).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <linearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="${pal[0]}"/>
        <stop offset="100%" stop-color="${pal[1]}"/>
      </linearGradient>
      <clipPath id="circ"><rect width="${size}" height="${size}" rx="${Math.floor(size/10)}" ry="${Math.floor(size/10)}"/></clipPath>
    </defs>
    <g clip-path="url(#circ)">
      <rect width="${size}" height="${size}" fill="url(#sky)"/>
      ${stars}
      ${waves}
      ${textSvg}
    </g>
  </svg>`;

  await sharp(Buffer.from(svg))
    .webp({ quality: 90 })
    .toFile(outputPath);
}

// ── Text utils ────────────────────────────────────────────────────────────────

function wrapText(text, maxChars) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (test.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text.slice(0, maxChars)];
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── HELP ─────────────────────────────────────────────────────────────────────

const HELP_MSG =
  "🎭 STICKER MAKER\n" +
  "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
  "• stk <từ khoá>       → Tìm sticker Zalo thật\n" +
  "• stk ảnh             → Sticker từ ảnh reply\n" +
  "• stk video           → Sticker từ video reply\n" +
  "• stk text <nội dung> → Sticker text nghệ thuật\n" +
  "• stk babgwf [text]   → Sticker nền sóng gradient\n" +
  "━━━━━━━━━━━━━━━━━━━━━━━━\n" +
  "💡 Reply vào ảnh/video rồi gõ .stk ảnh (hoặc .stk video)";

// ── COMMAND ───────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name:            "stk",
    aliases:         ["sticker", "nhanhstk"],
    version:         "2.0.0",
    hasPermssion:    0,
    credits:         "MIZAI",
    description:     "Gửi sticker Zalo / tạo sticker từ ảnh+video+text bằng sharp+ffmpeg",
    commandCategory: "Tiện Ích",
    usages: HELP_MSG,
    cooldowns: 5,
  },

  run: async ({ api, event, args, send, threadID }) => {
    const sub  = (args[0] || "").toLowerCase();
    const rest = args.slice(1).join(" ").trim();

    // ── stk text <nội dung> ───────────────────────────────────────────────────
    if (sub === "text" || sub === "txt" || sub === "chữ") {
      const content = rest || "MIZAI BOT";
      await send("🎨 Đang tạo sticker text...");
      const out = tmpPath("webp");
      try {
        await textToStickerWebp(content, out);
        await send({ msg: "", attachments: [out] });
      } catch (e) {
        await send(`❌ Lỗi: ${e.message}`);
      } finally { cleanup(out); }
      return;
    }

    // ── stk babgwf [text] ─────────────────────────────────────────────────────
    if (sub === "babgwf" || sub === "bg" || sub === "wave" || sub === "song") {
      const content = rest || "";
      await send("🌊 Đang tạo sticker sóng gradient...");
      const out = tmpPath("webp");
      try {
        await babgwfToStickerWebp(content, out);
        await send({ msg: "", attachments: [out] });
      } catch (e) {
        await send(`❌ Lỗi: ${e.message}`);
      } finally { cleanup(out); }
      return;
    }

    // ── stk video → frame từ video reply ─────────────────────────────────────
    if (sub === "video" || sub === "vid" || sub === "vd") {
      const media = await getMediaUrl({ event, api, threadID, acceptVideo: true });
      if (!media) return send("❌ Reply vào tin nhắn có video để dùng lệnh này!");
      await send("🎬 Đang xử lý video bằng ffmpeg...");
      const vidPath = tmpPath("mp4");
      const out     = tmpPath("webp");
      try {
        await downloadUrl(media.url, vidPath);
        await videoToStickerWebp(vidPath, out);
        await send({ msg: "", attachments: [out] });
      } catch (e) {
        await send(`❌ Lỗi: ${e.message}`);
      } finally { cleanup(vidPath, out); }
      return;
    }

    // ── stk ảnh / stk (không args) → ảnh reply ───────────────────────────────
    if (sub === "ảnh" || sub === "anh" || sub === "img" || sub === "image" || sub === "") {
      const media = await getMediaUrl({ event, api, threadID, acceptVideo: false });
      if (!media) {
        if (sub === "") return send(HELP_MSG);
        return send("❌ Reply vào tin nhắn có ảnh để dùng lệnh này!");
      }
      await send("⚙️ Đang xử lý ảnh bằng sharp...");
      const isGif  = media.url.toLowerCase().includes(".gif");
      const inp    = tmpPath(isGif ? "gif" : "jpg");
      const out    = tmpPath(isGif ? "gif" : "webp");
      try {
        await downloadUrl(media.url, inp);
        await imageToStickerWebp(inp, out);
        await send({ msg: "", attachments: [out] });
      } catch (e) {
        await send(`❌ Lỗi: ${e.message}`);
      } finally { cleanup(inp, out); }
      return;
    }

    // ── stk <url> → từ URL ───────────────────────────────────────────────────
    if (sub.startsWith("http")) {
      await send("⏳ Đang tải ảnh...");
      const isGif = sub.toLowerCase().includes(".gif");
      const inp   = tmpPath(isGif ? "gif" : "jpg");
      const out   = tmpPath(isGif ? "gif" : "webp");
      try {
        await downloadUrl(sub, inp);
        await imageToStickerWebp(inp, out);
        await send({ msg: "", attachments: [out] });
      } catch (e) {
        await send(`❌ Lỗi: ${e.message}`);
      } finally { cleanup(inp, out); }
      return;
    }

    // ── stk <từ khoá> → tìm sticker Zalo thật ───────────────────────────────
    const keyword = args.join(" ").trim();
    if (!keyword) return send(HELP_MSG);

    try {
      const ok = await sendZaloSticker(api, keyword, threadID, event.type);
      if (!ok) {
        const fallback = await sendZaloSticker(api, keyword.split(" ")[0], threadID, event.type);
        if (!fallback) await send(`❌ Không tìm thấy sticker nào cho: "${keyword}"`);
      }
    } catch (e) {
      await send(`❌ Lỗi tìm sticker: ${e.message}`);
    }
  },
};

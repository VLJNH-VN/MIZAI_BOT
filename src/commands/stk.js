"use strict";

/**
 * src/commands/stk.js  v5.0.0
 * Combo: Zalo Sticker Search + GIF / Video Sticker + Xóa Nền Động
 *
 * Pipeline (khi reply media hoặc truyền link):
 *   input (ảnh / gif / video / link)
 *     → detect type  (fileTypeFromBuffer)
 *     → (nếu stk xoanen) remove background [HuggingFace briaai/RMBG-1.4]
 *     → ffmpeg  → animated WebP 512x512  (gif / video)
 *     → sharp   → static WebP   512x512  (ảnh tĩnh)
 *     → send Zalo
 *
 * Cách dùng:
 *   stk <từ khoá>        → Tìm & gửi Zalo sticker (pack + API)
 *   stk gif <từ khoá>    → Tìm sticker hoạt hình (type=2)
 *   stk random           → Sticker ngẫu nhiên
 *   stk pack [số|tên]    → Xem / gửi từ pack
 *   stk list <từ khoá>   → Debug – liệt kê ID sticker
 *
 *   (reply ảnh/gif/video hoặc thêm link):
 *   stk                  → Chuyển media → WebP sticker
 *   stk xoanen           → Xóa nền → WebP sticker trong suốt
 */

const fs            = require("fs");
const path          = require("path");
const os            = require("os");
const axios         = require("axios");
const { spawnSync } = require("child_process");
const sharp         = require("sharp");
const { HfInference } = require("@huggingface/inference");

// ─────────────────────────────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const STICKER_SIZE  = 512;
const MAX_GIF_FRAMES = 12;        // Giới hạn frame khi xóa nền GIF
const MAX_VID_SEC   = 4;          // Cắt video tối đa N giây
const GIF_FPS       = 10;         // FPS cho animated WebP từ video

// ─────────────────────────────────────────────────────────────────────────────
//  ZALO STICKER PACKS (giữ từ v4)
// ─────────────────────────────────────────────────────────────────────────────

const STICKER_PACKS = [
  { id:  1, name: "Mèo Dễ Thương",    cateId: 22,  keywords: ["mèo", "cat", "cute"] },
  { id:  2, name: "Gấu Bống",          cateId: 10,  keywords: ["gấu", "bear", "teddy"] },
  { id:  3, name: "Thỏ Nâu",           cateId: 3,   keywords: ["thỏ", "rabbit", "bunny"] },
  { id:  4, name: "Emoji Cảm Xúc",    cateId: 5,   keywords: ["cảm xúc", "emotion", "face"] },
  { id:  5, name: "Trái Tim Tình Yêu", cateId: 7,   keywords: ["love", "tim", "heart"] },
  { id:  6, name: "Chó Cún",           cateId: 30,  keywords: ["chó", "dog", "puppy"] },
  { id:  7, name: "Vui Vẻ & Cười",    cateId: 8,   keywords: ["vui", "cười", "haha", "lol"] },
  { id:  8, name: "Buồn & Khóc",       cateId: 9,   keywords: ["buồn", "khóc", "sad", "cry"] },
  { id:  9, name: "Tức Giận",          cateId: 11,  keywords: ["tức", "giận", "angry", "mad"] },
  { id: 10, name: "Chào Hỏi",          cateId: 13,  keywords: ["hi", "hello", "chào", "bye"] },
  { id: 11, name: "Ăn Uống",           cateId: 14,  keywords: ["ăn", "đói", "food", "eat"] },
  { id: 12, name: "Học Tập",           cateId: 18,  keywords: ["học", "study", "sách"] },
  { id: 13, name: "Lễ Tết",            cateId: 26,  keywords: ["tết", "lễ", "festival", "new year"] },
  { id: 14, name: "Hoa & Thiên Nhiên", cateId: 28,  keywords: ["hoa", "flower", "nature"] },
  { id: 15, name: "Đồ Ăn Vặt",         cateId: 32,  keywords: ["snack", "ăn vặt", "bánh"] },
];

// ─────────────────────────────────────────────────────────────────────────────
//  UTILS — File tạm
// ─────────────────────────────────────────────────────────────────────────────

function tmpFile(ext) {
  return path.join(os.tmpdir(), `stk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`);
}

function cleanFiles(...files) {
  for (const f of files) {
    if (f) try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  DETECT TYPE — Magic bytes (không cần package ESM đồng bộ)
// ─────────────────────────────────────────────────────────────────────────────

async function detectType(buf) {
  // Thử file-type trước (ESM dynamic import)
  try {
    const ft = await import("file-type");
    const result = await ft.fileTypeFromBuffer(buf);
    if (result) return result.mime; // "image/gif", "video/mp4", "image/png", ...
  } catch (_) {}

  // Fallback magic bytes
  if (!buf || buf.length < 4) return "application/octet-stream";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf[0] === 0xFF && buf[1] === 0xD8)                     return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E) return "image/png";
  if (buf[0] === 0x52 && buf[4] === 0x57 && buf[5] === 0x45) return "image/webp";
  if (buf.length > 8) {
    const ftyp = buf.slice(4, 8).toString("ascii");
    if (["ftyp", "moov", "mdat"].includes(ftyp))             return "video/mp4";
  }
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF) return "video/webm";
  return "application/octet-stream";
}

// ─────────────────────────────────────────────────────────────────────────────
//  DOWNLOAD
// ─────────────────────────────────────────────────────────────────────────────

async function downloadBuffer(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30_000,
    maxContentLength: 50 * 1024 * 1024,
    headers: {
      "User-Agent": global.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": "https://www.google.com/",
    },
  });
  return Buffer.from(res.data);
}

// ─────────────────────────────────────────────────────────────────────────────
//  EXTRACT MEDIA từ event (quoted msg) hoặc URL trong args
// ─────────────────────────────────────────────────────────────────────────────

async function extractMediaUrl(event, api, threadID, args) {
  // 1. URL trong args
  const urlArg = args.find(a => /^https?:\/\//i.test(a));
  if (urlArg) return urlArg;

  // 2. Quoted message qua global.resolveQuote
  if (global.resolveQuote) {
    const raw = event?.data ?? {};
    const ctx = await global.resolveQuote({ raw, api, threadId: threadID, event }).catch(() => null);
    if (ctx?.isMedia && ctx.mediaUrl) return ctx.mediaUrl;
    if (ctx?.attach?.length > 0) {
      const a = ctx.attach[0];
      const u = a.hdUrl || a.normalUrl || a.url || a.href || a.fileUrl || null;
      if (u) return u;
    }
  }

  // 3. Fallback tự parse event.data
  const raw = event?.data ?? {};
  const quote = raw.quote || raw.msgReply || raw.replyTo || null;
  if (quote) {
    const c = quote.content;
    if (typeof c === "string" && /^https?:\/\//i.test(c.trim())) return c.trim();
    if (c && typeof c === "object") {
      const u = c.hdUrl || c.normalUrl || c.url || c.fileUrl || null;
      if (u) return u;
    }
    const att = Array.isArray(quote.attach) ? quote.attach : [];
    if (att.length > 0) {
      const a = att[0];
      const u = a.hdUrl || a.normalUrl || a.url || a.fileUrl || null;
      if (u) return u;
    }
    // content là JSON string
    if (typeof c === "string" && (c.startsWith("{") || c.startsWith("["))) {
      try {
        const parsed = JSON.parse(c);
        const u = parsed.hdUrl || parsed.normalUrl || parsed.url || parsed.href || parsed.fileUrl || null;
        if (u) return u;
      } catch (_) {}
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  FFMPEG HELPER
// ─────────────────────────────────────────────────────────────────────────────

function ffmpeg(...args) {
  const bin = require("ffmpeg-static") || "ffmpeg";
  const result = spawnSync(bin, args, { timeout: 120_000, maxBuffer: 100 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = result.stderr?.toString() || "";
    throw new Error(`FFmpeg lỗi (status ${result.status}): ${stderr.slice(-300)}`);
  }
}

// GIF / Video → animated WebP 512x512
function toAnimatedWebP(inputPath, outputPath, isVideo = false) {
  const vf = `fps=${GIF_FPS},scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=decrease,pad=${STICKER_SIZE}:${STICKER_SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;
  const args = ["-y", "-i", inputPath];
  if (isVideo) args.push("-t", String(MAX_VID_SEC));
  args.push(
    "-vf", vf,
    "-c:v", "libwebp_anim",
    "-lossless", "0",
    "-q:v", "75",
    "-loop", "0",
    "-an",
    "-vsync", "0",
    outputPath
  );
  ffmpeg(...args);
}

// Ảnh tĩnh hoặc 1 frame → static WebP 512x512
async function toStaticWebP(inputBuf, outputPath, hasAlpha = false) {
  let pipeline = sharp(inputBuf).resize(STICKER_SIZE, STICKER_SIZE, {
    fit: "contain",
    background: hasAlpha
      ? { r: 0, g: 0, b: 0, alpha: 0 }
      : { r: 255, g: 255, b: 255, alpha: 1 },
  });
  if (hasAlpha) pipeline = pipeline.png(); else pipeline = pipeline.flatten({ background: "#ffffff" });
  const processed = await pipeline.toBuffer();
  await sharp(processed)
    .webp({ quality: 90, alphaQuality: 100, lossless: false })
    .toFile(outputPath);
}

// Extract frame GIFs từ file → thư mục frame PNG
function extractFrames(gifOrVideoPath, framesDir, limit = MAX_GIF_FRAMES) {
  fs.mkdirSync(framesDir, { recursive: true });
  ffmpeg(
    "-y", "-i", gifOrVideoPath,
    "-vf", `fps=${GIF_FPS},scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=decrease,pad=${STICKER_SIZE}:${STICKER_SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
    "-vframes", String(limit),
    path.join(framesDir, "frame_%04d.png")
  );
  return fs.readdirSync(framesDir)
    .filter(f => f.endsWith(".png"))
    .sort()
    .map(f => path.join(framesDir, f));
}

// Ghép frames PNG → animated WebP
function assembleFramesToWebP(framePaths, outputPath) {
  const listFile = tmpFile("txt");
  const lines = framePaths.map(f => `file '${f}'\nduration 0.1`).join("\n");
  fs.writeFileSync(listFile, lines);
  try {
    ffmpeg(
      "-y",
      "-f", "concat", "-safe", "0", "-i", listFile,
      "-c:v", "libwebp_anim",
      "-lossless", "0",
      "-q:v", "75",
      "-loop", "0",
      "-vsync", "0",
      outputPath
    );
  } finally {
    cleanFiles(listFile);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  REMOVE BACKGROUND — HuggingFace briaai/RMBG-1.4
// ─────────────────────────────────────────────────────────────────────────────

function getHf() {
  const token = global?.config?.hfToken || process.env.HF_TOKEN || "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";
  return new HfInference(token);
}

/**
 * Xóa nền 1 frame (PNG buffer) → trả về PNG buffer trong suốt
 */
async function removeBgFrame(pngBuffer) {
  const hf = getHf();
  const blob = new Blob([pngBuffer], { type: "image/png" });
  const result = await hf.imageSegmentation({
    model: "briaai/RMBG-1.4",
    data: blob,
  });

  // result là array các segment, lấy segment foreground (score cao nhất)
  if (!Array.isArray(result) || result.length === 0) {
    throw new Error("RMBG không trả về kết quả");
  }

  // Lấy mask segment có label "foreground" hoặc score cao nhất
  const seg = result.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  if (!seg?.mask) throw new Error("Không lấy được mask từ RMBG");

  // mask là base64 PNG hoặc URL data
  let maskBuf;
  if (typeof seg.mask === "string") {
    if (seg.mask.startsWith("data:")) {
      maskBuf = Buffer.from(seg.mask.split(",")[1], "base64");
    } else {
      maskBuf = Buffer.from(seg.mask, "base64");
    }
  } else if (seg.mask instanceof Blob) {
    maskBuf = Buffer.from(await seg.mask.arrayBuffer());
  } else {
    throw new Error("Định dạng mask không hỗ trợ");
  }

  // Áp dụng mask lên ảnh gốc: composite với alpha từ mask
  const { data: maskData, info: maskInfo } = await sharp(maskBuf)
    .resize(STICKER_SIZE, STICKER_SIZE, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data: imgData, info: imgInfo } = await sharp(pngBuffer)
    .resize(STICKER_SIZE, STICKER_SIZE, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = 4;
  const out = Buffer.alloc(STICKER_SIZE * STICKER_SIZE * channels);
  for (let i = 0; i < STICKER_SIZE * STICKER_SIZE; i++) {
    out[i * channels + 0] = imgData[i * channels + 0];
    out[i * channels + 1] = imgData[i * channels + 1];
    out[i * channels + 2] = imgData[i * channels + 2];
    out[i * channels + 3] = maskData[i]; // alpha từ mask
  }

  return sharp(out, {
    raw: { width: STICKER_SIZE, height: STICKER_SIZE, channels },
  }).png().toBuffer();
}

/**
 * Xóa nền GIF / video (frame-by-frame)
 * inputPath → animated WebP trong suốt → outputPath
 */
async function removeBgAnimated(inputPath, outputPath, onProgress) {
  const framesDir = path.join(os.tmpdir(), `stk_frames_${Date.now()}`);
  const outFramesDir = path.join(os.tmpdir(), `stk_out_${Date.now()}`);
  fs.mkdirSync(outFramesDir, { recursive: true });

  let framePaths = [];
  try {
    framePaths = extractFrames(inputPath, framesDir, MAX_GIF_FRAMES);
    if (!framePaths.length) throw new Error("Không extract được frame nào");

    const outFramePaths = [];
    for (let i = 0; i < framePaths.length; i++) {
      onProgress?.(i + 1, framePaths.length);
      const frameBuf = fs.readFileSync(framePaths[i]);
      const rmbgBuf  = await removeBgFrame(frameBuf);
      const outFrame  = path.join(outFramesDir, `out_${String(i).padStart(4, "0")}.png`);
      fs.writeFileSync(outFrame, rmbgBuf);
      outFramePaths.push(outFrame);
    }

    assembleFramesToWebP(outFramePaths, outputPath);
  } finally {
    cleanFiles(...framePaths);
    cleanFiles(...(fs.existsSync(outFramesDir) ? fs.readdirSync(outFramesDir).map(f => path.join(outFramesDir, f)) : []));
    try { fs.rmdirSync(framesDir);    } catch (_) {}
    try { fs.rmdirSync(outFramesDir); } catch (_) {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN PIPELINE — input → WebP sticker file
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Buffer}  buf       — Buffer dữ liệu gốc
 * @param {string}  mime      — MIME type đã detect
 * @param {boolean} rmbg      — Có xóa nền không?
 * @param {Function} onProgress
 * @returns {string}          — Đường dẫn file WebP tạm (caller phải xóa)
 */
async function buildStickerFile(buf, mime, rmbg = false, onProgress = null) {
  const isGif   = mime === "image/gif";
  const isVideo = mime.startsWith("video/");
  const isImage = mime.startsWith("image/") && !isGif;

  const outputPath = tmpFile("webp");

  if (isImage && !rmbg) {
    // ── Ảnh tĩnh → static WebP ──────────────────────────────────────────────
    await toStaticWebP(buf, outputPath, false);
    return outputPath;
  }

  if (isImage && rmbg) {
    // ── Ảnh tĩnh + xóa nền → static WebP trong suốt ─────────────────────────
    const pngBuf = await sharp(buf)
      .resize(STICKER_SIZE, STICKER_SIZE, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png().toBuffer();
    const rmbgBuf = await removeBgFrame(pngBuf);
    await sharp(rmbgBuf)
      .webp({ quality: 90, alphaQuality: 100 })
      .toFile(outputPath);
    return outputPath;
  }

  if ((isGif || isVideo) && !rmbg) {
    // ── GIF / Video → animated WebP ─────────────────────────────────────────
    const inputPath = tmpFile(isGif ? "gif" : "mp4");
    try {
      fs.writeFileSync(inputPath, buf);
      toAnimatedWebP(inputPath, outputPath, isVideo);
    } finally {
      cleanFiles(inputPath);
    }
    return outputPath;
  }

  if ((isGif || isVideo) && rmbg) {
    // ── GIF / Video + xóa nền → animated WebP trong suốt ────────────────────
    const inputPath = tmpFile(isGif ? "gif" : "mp4");
    try {
      fs.writeFileSync(inputPath, buf);
      if (isVideo) {
        // Cắt trước rồi mới xóa nền (giới hạn MAX_VID_SEC)
        const cutPath = tmpFile("mp4");
        try {
          ffmpeg("-y", "-i", inputPath, "-t", String(MAX_VID_SEC), "-c", "copy", cutPath);
          await removeBgAnimated(cutPath, outputPath, onProgress);
        } finally {
          cleanFiles(cutPath);
        }
      } else {
        await removeBgAnimated(inputPath, outputPath, onProgress);
      }
    } finally {
      cleanFiles(inputPath);
    }
    return outputPath;
  }

  // Fallback: static WebP
  await toStaticWebP(buf, outputPath, false);
  return outputPath;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ZALO STICKER SEARCH (giữ từ v4)
// ─────────────────────────────────────────────────────────────────────────────

function findPackByQuery(query) {
  const q = query.trim().toLowerCase();
  const num = parseInt(q, 10);
  if (!isNaN(num) && num >= 1 && num <= STICKER_PACKS.length) return STICKER_PACKS[num - 1];
  return STICKER_PACKS.find(p =>
    p.name.toLowerCase().includes(q) ||
    p.keywords.some(k => k.includes(q) || q.includes(k))
  ) || null;
}

function extractStickerList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw))          return raw;
  if (Array.isArray(raw.data))     return raw.data;
  if (Array.isArray(raw.items))    return raw.items;
  if (Array.isArray(raw.stickers)) return raw.stickers;
  return [];
}

async function sendStickerFromPack(api, cateId, threadID, threadType) {
  const detail  = await api.getStickerCategoryDetail(cateId);
  const d       = detail?.data ?? detail;
  const stickers = d?.stickers ?? d?.items ?? d?.listSticker ?? (Array.isArray(d) ? d : []);
  if (!stickers.length) return false;
  const s = stickers[Math.floor(Math.random() * stickers.length)];
  const obj = {
    id:     Number(s.stickerId ?? s.sticker_id ?? s.id),
    cateId: Number(s.cateId   ?? s.cate_id    ?? cateId),
    type:   Number(s.type)    || 1,
  };
  if (!obj.id) return false;
  await api.sendSticker(obj, threadID, threadType);
  return true;
}

async function searchAndSend(api, keyword, threadID, threadType, preferAnimated = false) {
  const raw  = await api.searchSticker(keyword, 30).catch(() => null);
  let list = extractStickerList(raw).filter(s => s && (s.sticker_id || s.id));
  if (!list.length) return false;
  if (preferAnimated) {
    const animated = list.filter(s => Number(s.type) === 2);
    if (animated.length) list = animated;
  }
  const s = list[Math.floor(Math.random() * list.length)];
  const obj = {
    id:     Number(s.sticker_id ?? s.id),
    cateId: Number(s.cate_id    ?? s.cateId ?? 0),
    type:   Number(s.type)      || 1,
  };
  if (!obj.id) return false;
  await api.sendSticker(obj, threadID, threadType);
  return true;
}

async function sendCombo(api, keyword, threadID, threadType, preferAnimated = false) {
  const pack = findPackByQuery(keyword);
  if (pack && !preferAnimated) {
    const ok = await sendStickerFromPack(api, pack.cateId, threadID, threadType).catch(() => false);
    if (ok) return { ok: true, source: `pack "${pack.name}"` };
  }
  const ok1 = await searchAndSend(api, keyword, threadID, threadType, preferAnimated).catch(() => false);
  if (ok1) return { ok: true, source: "API search" };
  const words = keyword.split(/\s+/).filter(Boolean);
  for (const w of words) {
    if (w === keyword) continue;
    const ok2 = await searchAndSend(api, w, threadID, threadType, preferAnimated).catch(() => false);
    if (ok2) return { ok: true, source: `API "${w}"` };
  }
  return { ok: false };
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELP
// ─────────────────────────────────────────────────────────────────────────────

const HELP_MSG =
  "🎭 STK v5 — COMBO STICKER\n" +
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
  "📌 TÌM STICKER ZALO:\n" +
  "  stk <từ khoá>         → Tìm & gửi sticker\n" +
  "  stk gif <từ khoá>     → Sticker hoạt hình\n" +
  "  stk random            → Sticker ngẫu nhiên\n" +
  "  stk pack              → Danh sách pack\n" +
  "  stk pack <số|tên>     → Sticker từ pack đó\n" +
  "  stk list <từ khoá>    → Liệt kê ID sticker\n" +
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
  "🎞️ TẠO STICKER TỪ MEDIA (reply ảnh/gif/video hoặc thêm link):\n" +
  "  stk                   → Chuyển media → WebP sticker\n" +
  "  stk gif               → Giữ hiệu ứng động → animated WebP\n" +
  "  stk xoanen            → Xóa nền → sticker trong suốt\n" +
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
  "💡 Ví dụ:\n" +
  "  .stk mèo | .stk gif buồn | .stk random\n" +
  "  (Reply GIF) .stk xoanen\n" +
  "  .stk https://example.com/anim.gif";

// ─────────────────────────────────────────────────────────────────────────────
//  COMMAND
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name:            "stk",
    aliases:         ["sticker", "nhanhstk"],
    version:         "5.0.0",
    hasPermssion:    0,
    credits:         "MIZAI",
    description:     "Combo Sticker: Zalo API + GIF/Video/Xóa Nền Động → WebP 512×512",
    commandCategory: "Tiện Ích",
    usages:          HELP_MSG,
    cooldowns:       5,
  },

  run: async ({ api, event, args, send, threadID }) => {
    const sub  = (args[0] || "").toLowerCase().trim();
    const rest = args.slice(1).join(" ").trim();

    // ── Không args, không media → help ──────────────────────────────────────
    if (!sub) {
      const mediaUrl = await extractMediaUrl(event, api, threadID, []).catch(() => null);
      if (!mediaUrl) return send(HELP_MSG);
      // Có media nhưng không có sub → convert tĩnh
      return handleMediaPipeline({ api, event, args, send, threadID, rmbg: false });
    }

    // ── SUBCOMMAND: pack ─────────────────────────────────────────────────────
    if (sub === "pack") {
      if (!rest) {
        const lines = STICKER_PACKS.map(p =>
          `${String(p.id).padStart(2)}. ${p.name}  [cateId: ${p.cateId}]`
        );
        return send(
          "📦 DANH SÁCH STICKER PACKS\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          lines.join("\n") +
          "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          "💡 Dùng: .stk pack <số hoặc tên>"
        );
      }
      const pack = findPackByQuery(rest);
      if (!pack) return send(`❌ Không tìm thấy pack: "${rest}"\n💡 Gõ .stk pack để xem danh sách.`);
      try {
        const ok = await sendStickerFromPack(api, pack.cateId, threadID, event.type);
        if (!ok) {
          const ok2 = await searchAndSend(api, pack.keywords[0], threadID, event.type).catch(() => false);
          if (!ok2) await send(`❌ Pack "${pack.name}" không có sticker. Thử lại sau!`);
        }
      } catch (e) { await send(`❌ Lỗi: ${e.message}`); }
      return;
    }

    // ── SUBCOMMAND: random ───────────────────────────────────────────────────
    if (sub === "random" || sub === "rand" || sub === "ngaunhien") {
      const pack = STICKER_PACKS[Math.floor(Math.random() * STICKER_PACKS.length)];
      try {
        const ok = await sendStickerFromPack(api, pack.cateId, threadID, event.type);
        if (!ok) {
          const ok2 = await searchAndSend(api, pack.keywords[0], threadID, event.type).catch(() => false);
          if (!ok2) await send("❌ Không lấy được sticker ngẫu nhiên. Thử lại sau!");
        }
      } catch (e) { await send(`❌ Lỗi: ${e.message}`); }
      return;
    }

    // ── SUBCOMMAND: list ─────────────────────────────────────────────────────
    if (sub === "list" || sub === "ds") {
      const keyword = rest || "mèo";
      try {
        const raw  = await api.searchSticker(keyword, 10);
        const list = extractStickerList(raw).filter(s => s && (s.sticker_id || s.id));
        if (!list.length) return send(`❌ Không tìm thấy sticker nào cho: "${keyword}"`);
        const lines = list.map((s, i) =>
          `${i + 1}. ID=${s.sticker_id ?? s.id} | CateID=${s.cate_id ?? s.cateId ?? "?"} | Type=${s.type ?? 1}`
        );
        return send(`🔍 ${list.length} sticker cho "${keyword}":\n` + lines.join("\n"));
      } catch (e) {
        return send(`❌ Lỗi: ${e.message}`);
      }
    }

    // ── SUBCOMMAND: gif (có thể kèm media hoặc keyword) ─────────────────────
    if (sub === "gif") {
      const mediaUrl = await extractMediaUrl(event, api, threadID, args.slice(1)).catch(() => null);
      if (mediaUrl && !/^.{1,60}$/.test(rest.replace(/https?:\/\/\S+/g, ""))) {
        // Media mode: animated WebP từ GIF/video
        return handleMediaPipeline({ api, event, args: args.slice(1), send, threadID, rmbg: false, forceAnimated: true, mediaUrlOverride: mediaUrl });
      }
      // Keyword mode: tìm animated sticker
      const keyword = rest || "mèo";
      try {
        const result = await sendCombo(api, keyword, threadID, event.type, true);
        if (!result.ok) await send(`❌ Không tìm thấy sticker động cho: "${keyword}"\n💡 Thử: .stk gif mèo`);
      } catch (e) { await send(`❌ Lỗi: ${e.message}`); }
      return;
    }

    // ── SUBCOMMAND: xoanen / rmbg / xonnen ──────────────────────────────────
    if (["xoanen", "rmbg", "xonnen", "xn", "removebg"].includes(sub)) {
      return handleMediaPipeline({ api, event, args: args.slice(1), send, threadID, rmbg: true });
    }

    // ── Có media trong reply/args → pipeline ─────────────────────────────────
    const urlInArgs = args.find(a => /^https?:\/\//i.test(a));
    const mediaFromQuote = await extractMediaUrl(event, api, threadID, []).catch(() => null);
    if (urlInArgs || mediaFromQuote) {
      return handleMediaPipeline({ api, event, args, send, threadID, rmbg: false });
    }

    // ── Fallback: Zalo sticker search ────────────────────────────────────────
    const keyword = args.join(" ").trim();
    try {
      const result = await sendCombo(api, keyword, threadID, event.type);
      if (!result.ok) {
        await send(
          `❌ Không tìm thấy sticker cho: "${keyword}"\n` +
          `💡 Thử: .stk pack | .stk random | .stk gif ${keyword}`
        );
      }
    } catch (e) {
      await send(`❌ Lỗi: ${e.message}`);
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  PIPELINE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

async function handleMediaPipeline({ api, event, args, send, threadID, rmbg, forceAnimated = false, mediaUrlOverride = null }) {
  let stickerPath = null;
  try {
    // Bước 1: Lấy URL
    const mediaUrl = mediaUrlOverride
      || await extractMediaUrl(event, api, threadID, args);

    if (!mediaUrl) {
      return send(
        "❎ Không tìm thấy media!\n" +
        "💡 Reply ảnh / GIF / video, hoặc thêm link vào lệnh.\n" +
        "Ví dụ: .stk https://example.com/anim.gif"
      );
    }

    await send("⏳ Đang tải & xử lý media...");

    // Bước 2: Download
    const buf = await downloadBuffer(mediaUrl);

    // Bước 3: Detect type
    const mime = await detectType(buf);
    const isGif   = mime === "image/gif";
    const isVideo  = mime.startsWith("video/");
    const isImage  = mime.startsWith("image/") && !isGif;

    const typeLabel = isGif ? "GIF" : isVideo ? "Video" : "Ảnh";

    if (!isGif && !isVideo && !isImage) {
      return send(`❌ Định dạng không hỗ trợ: ${mime}`);
    }

    // Thông báo tiến trình
    if (rmbg) {
      const frameInfo = (isGif || isVideo) ? ` (tối đa ${MAX_GIF_FRAMES} frames)` : "";
      await send(`🧠 Đang xóa nền ${typeLabel}${frameInfo}...`);
    } else if (isGif || isVideo) {
      await send(`🎞️ Đang chuyển ${typeLabel} → animated WebP...`);
    }

    // Bước 4-7: Pipeline → file WebP
    const progressCb = (rmbg && (isGif || isVideo))
      ? (cur, total) => { /* silent progress */ }
      : null;

    stickerPath = await buildStickerFile(buf, mime, rmbg, progressCb);

    if (!fs.existsSync(stickerPath) || fs.statSync(stickerPath).size < 100) {
      throw new Error("File WebP đầu ra rỗng hoặc không tồn tại");
    }

    // Bước 8: Gửi Zalo
    await api.sendMessage(
      { msg: "", attachments: [stickerPath] },
      threadID,
      event.type
    );

  } catch (err) {
    console.error("[STK pipeline]", err?.message || err);
    const msg = err?.message || "Lỗi không xác định";
    if (msg.includes("RMBG") || msg.includes("mask") || msg.includes("imageSegmentation")) {
      await send(`❌ Xóa nền thất bại: ${msg}\n💡 Model HuggingFace có thể đang bận, thử lại sau ít phút.`);
    } else if (msg.includes("FFmpeg") || msg.includes("ffmpeg")) {
      await send(`❌ Lỗi xử lý media: ${msg}`);
    } else {
      await send(`❌ Thất bại: ${msg}`);
    }
  } finally {
    cleanFiles(stickerPath);
  }
}

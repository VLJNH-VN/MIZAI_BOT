"use strict";

/**
 * src/commands/stk.js  v5.1.0
 * Combo: Zalo Sticker Search + GIF / Video Sticker + Xóa Nền Động
 *
 * Pipeline (reply media hoặc link):
 *   input (ảnh / gif / video / link)
 *     → detect type  (fileTypeFromBuffer + magic bytes)
 *     → (nếu stk xoanen) remove background [HuggingFace briaai/RMBG-1.4]
 *     → ffmpeg  → animated WebP 512×512  (gif / video)
 *     → sharp   → static  WebP 512×512  (ảnh tĩnh)
 *     → send Zalo
 *
 * Lệnh:
 *   stk <từ khoá>        → Tìm & gửi Zalo sticker (pack + API)
 *   stk gif <từ khoá>    → Tìm sticker hoạt hình (type=2)
 *   stk random           → Sticker ngẫu nhiên
 *   stk pack [số|tên]    → Xem / gửi từ pack
 *   stk list <từ khoá>   → Debug – liệt kê ID sticker
 *   (reply ảnh/gif/video hoặc link) stk           → convert → WebP sticker
 *   (reply ảnh/gif/video hoặc link) stk xoanen    → xóa nền → WebP trong suốt
 */

const fs              = require("fs");
const path            = require("path");
const os              = require("os");
const axios           = require("axios");
const { spawnSync }   = require("child_process");
const sharp           = require("sharp");
const { HfInference } = require("@huggingface/inference");

// ─────────────────────────────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const STICKER_SIZE   = 512;
const MAX_GIF_FRAMES = 12;
const MAX_VID_SEC    = 4;
const GIF_FPS        = 10;

// Keyword-only subcommands — KHÔNG trigger media pipeline
const TEXT_SUBS = new Set([
  "pack", "random", "rand", "ngaunhien",
  "list", "ds",
  "help", "hdsd",
]);

// ─────────────────────────────────────────────────────────────────────────────
//  ZALO STICKER PACKS
// ─────────────────────────────────────────────────────────────────────────────

const STICKER_PACKS = [
  { id:  1, name: "Mèo Dễ Thương",    cateId: 22,  keywords: ["mèo","cat","cute"] },
  { id:  2, name: "Gấu Bống",          cateId: 10,  keywords: ["gấu","bear","teddy"] },
  { id:  3, name: "Thỏ Nâu",           cateId: 3,   keywords: ["thỏ","rabbit","bunny"] },
  { id:  4, name: "Emoji Cảm Xúc",    cateId: 5,   keywords: ["cảm xúc","emotion","face"] },
  { id:  5, name: "Trái Tim Tình Yêu", cateId: 7,   keywords: ["love","tim","heart"] },
  { id:  6, name: "Chó Cún",           cateId: 30,  keywords: ["chó","dog","puppy"] },
  { id:  7, name: "Vui Vẻ & Cười",    cateId: 8,   keywords: ["vui","cười","haha","lol"] },
  { id:  8, name: "Buồn & Khóc",       cateId: 9,   keywords: ["buồn","khóc","sad","cry"] },
  { id:  9, name: "Tức Giận",          cateId: 11,  keywords: ["tức","giận","angry","mad"] },
  { id: 10, name: "Chào Hỏi",          cateId: 13,  keywords: ["hi","hello","chào","bye"] },
  { id: 11, name: "Ăn Uống",           cateId: 14,  keywords: ["ăn","đói","food","eat"] },
  { id: 12, name: "Học Tập",           cateId: 18,  keywords: ["học","study","sách"] },
  { id: 13, name: "Lễ Tết",            cateId: 26,  keywords: ["tết","lễ","festival","new year"] },
  { id: 14, name: "Hoa & Thiên Nhiên", cateId: 28,  keywords: ["hoa","flower","nature"] },
  { id: 15, name: "Đồ Ăn Vặt",         cateId: 32,  keywords: ["snack","ăn vặt","bánh"] },
];

// ─────────────────────────────────────────────────────────────────────────────
//  FILE UTILS
// ─────────────────────────────────────────────────────────────────────────────

function tmpFile(ext) {
  return path.join(os.tmpdir(), `stk_${Date.now()}_${Math.random().toString(36).slice(2,6)}.${ext}`);
}

function cleanFiles(...files) {
  for (const f of files) {
    if (f) try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  DETECT TYPE — fileType (ESM) với magic bytes fallback
// ─────────────────────────────────────────────────────────────────────────────

async function detectType(buf) {
  try {
    const ft = await import("file-type");
    const r  = await ft.fileTypeFromBuffer(buf);
    if (r?.mime) return r.mime;
  } catch (_) {}

  if (!buf || buf.length < 4) return "application/octet-stream";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf[0] === 0xFF && buf[1] === 0xD8)                     return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E) return "image/png";
  if (buf[0] === 0x52 && buf[4] === 0x57 && buf[5] === 0x45) return "image/webp";
  if (buf.length > 8) {
    const ftyp = buf.slice(4, 8).toString("ascii");
    if (["ftyp","moov","mdat"].includes(ftyp)) return "video/mp4";
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
      Referer: "https://www.google.com/",
    },
  });
  return Buffer.from(res.data);
}

// ─────────────────────────────────────────────────────────────────────────────
//  EXTRACT MEDIA URL từ quote (hỗ trợ attach dạng string JSON / object / array)
// ─────────────────────────────────────────────────────────────────────────────

function _urlFromAttach(a) {
  if (!a || typeof a !== "object") return null;
  return a.hdUrl || a.normalUrl || a.url || a.href || a.fileUrl || a.downloadUrl || a.src || null;
}

function _extractUrlFromQuote(quote) {
  if (!quote) return null;

  // 1. content: URL trực tiếp
  const c = quote.content;
  if (typeof c === "string" && /^https?:\/\//i.test(c.trim())) return c.trim();

  // 2. content: object
  if (c && typeof c === "object") {
    const u = _urlFromAttach(c);
    if (u) return u;
  }

  // 3. content: JSON string
  if (typeof c === "string" && (c.startsWith("{") || c.startsWith("["))) {
    try {
      const parsed = JSON.parse(c);
      const items  = Array.isArray(parsed) ? parsed : [parsed];
      for (const a of items) { const u = _urlFromAttach(a); if (u) return u; }
    } catch (_) {}
  }

  // 4. attach: string JSON (Zalo thường dùng kiểu này cho ảnh trong quote)
  const rawAttach = quote.attach;
  if (rawAttach) {
    if (typeof rawAttach === "string") {
      // Thử regex trích URL trực tiếp trước (nhanh hơn)
      const m = rawAttach.match(/https?:\/\/[^\s"'\\}]+/);
      if (m && m[0]) return m[0].replace(/\\+$/, "");

      // Thử parse JSON
      try {
        const parsed = JSON.parse(rawAttach);
        const items  = Array.isArray(parsed) ? parsed : [parsed];
        for (const a of items) { const u = _urlFromAttach(a); if (u) return u; }
      } catch (_) {}
    } else if (Array.isArray(rawAttach)) {
      for (const a of rawAttach) { const u = _urlFromAttach(a); if (u) return u; }
    } else if (typeof rawAttach === "object") {
      const u = _urlFromAttach(rawAttach);
      if (u) return u;
    }
  }

  return null;
}

async function extractMediaUrl(event, api, threadID, args) {
  // 1. URL trực tiếp trong args (link paste)
  const urlArg = args.find(a => /^https?:\/\//i.test(a));
  if (urlArg) return urlArg;

  // 2. resolveQuote — đã normalize, xử lý cache + history
  if (global.resolveQuote) {
    const raw = event?.data ?? {};
    const ctx = await global.resolveQuote({ raw, api, threadId: threadID, event }).catch(() => null);
    if (ctx?.isMedia && ctx.mediaUrl) return ctx.mediaUrl;
    if (ctx?.attach?.length) {
      const u = _urlFromAttach(ctx.attach[0]);
      if (u) return u;
    }
  }

  // 3. Fallback thủ công — parse event.data.quote (hỗ trợ string attach)
  const raw   = event?.data ?? {};
  const quote = raw.quote || raw.msgReply || raw.replyTo || raw.replyMessage || null;
  if (quote) {
    const u = _extractUrlFromQuote(quote);
    if (u) return u;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  FFMPEG HELPER
// ─────────────────────────────────────────────────────────────────────────────

function ffmpegRun(...args) {
  const bin = (() => {
    try {
      const p = require("ffmpeg-static");
      if (p && fs.existsSync(p)) return p;
    } catch (_) {}
    return "ffmpeg";
  })();
  const result = spawnSync(bin, args, { timeout: 120_000, maxBuffer: 100 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = (result.stderr || Buffer.alloc(0)).toString();
    throw new Error(`FFmpeg (${result.status}): ${stderr.slice(-300)}`);
  }
}

// GIF / Video → animated WebP 512×512
function toAnimatedWebP(inputPath, outputPath, isVideo = false) {
  const vf   = `fps=${GIF_FPS},scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=decrease,pad=${STICKER_SIZE}:${STICKER_SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;
  const args = ["-y", "-i", inputPath];
  if (isVideo) args.push("-t", String(MAX_VID_SEC));
  args.push(
    "-vf", vf,
    "-c:v", "libwebp_anim",
    "-lossless", "0",
    "-q:v", "75",
    "-loop", "0",
    "-an", "-vsync", "0",
    outputPath
  );
  ffmpegRun(...args);
}

// Ảnh tĩnh → static WebP 512×512 (white bg)
async function toStaticWebP(inputBuf, outputPath) {
  await sharp(inputBuf)
    .resize(STICKER_SIZE, STICKER_SIZE, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .webp({ quality: 90, lossless: false })
    .toFile(outputPath);
}

// Ảnh tĩnh → static WebP 512×512 (transparent bg)
async function toStaticWebPAlpha(inputBuf, outputPath) {
  await sharp(inputBuf)
    .resize(STICKER_SIZE, STICKER_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .webp({ quality: 90, alphaQuality: 100, lossless: false })
    .toFile(outputPath);
}

// Extract frames từ GIF / video
function extractFrames(inputPath, framesDir, limit = MAX_GIF_FRAMES) {
  fs.mkdirSync(framesDir, { recursive: true });
  ffmpegRun(
    "-y", "-i", inputPath,
    "-vf", `fps=${GIF_FPS},scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=decrease,pad=${STICKER_SIZE}:${STICKER_SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
    "-vframes", String(limit),
    path.join(framesDir, "frame_%04d.png")
  );
  return fs.readdirSync(framesDir)
    .filter(f => f.endsWith(".png"))
    .sort()
    .map(f => path.join(framesDir, f));
}

// Ghép PNG frames → animated WebP
function assembleFramesToWebP(framePaths, outputPath) {
  const listFile = tmpFile("txt");
  fs.writeFileSync(listFile, framePaths.map(f => `file '${f}'\nduration 0.1`).join("\n"));
  try {
    ffmpegRun(
      "-y",
      "-f", "concat", "-safe", "0", "-i", listFile,
      "-c:v", "libwebp_anim",
      "-lossless", "0",
      "-q:v", "75",
      "-loop", "0",
      "-vsync", "0",
      outputPath
    );
  } finally { cleanFiles(listFile); }
}

// ─────────────────────────────────────────────────────────────────────────────
//  REMOVE BACKGROUND — HuggingFace briaai/RMBG-1.4
// ─────────────────────────────────────────────────────────────────────────────

function getHf() {
  const token = global?.config?.hfToken || process.env.HF_TOKEN || "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";
  return new HfInference(token);
}

async function removeBgFrame(pngBuffer) {
  const hf     = getHf();
  const blob   = new Blob([pngBuffer], { type: "image/png" });
  const result = await hf.imageSegmentation({ model: "briaai/RMBG-1.4", data: blob });
  if (!Array.isArray(result) || !result.length) throw new Error("RMBG không trả về kết quả");

  const seg = result.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  if (!seg?.mask) throw new Error("Không lấy được mask từ RMBG");

  let maskBuf;
  if (typeof seg.mask === "string") {
    maskBuf = Buffer.from(seg.mask.startsWith("data:") ? seg.mask.split(",")[1] : seg.mask, "base64");
  } else if (seg.mask instanceof Blob) {
    maskBuf = Buffer.from(await seg.mask.arrayBuffer());
  } else throw new Error("Định dạng mask không hỗ trợ");

  const { data: maskData } = await sharp(maskBuf)
    .resize(STICKER_SIZE, STICKER_SIZE, { fit: "fill" })
    .grayscale().raw().toBuffer({ resolveWithObject: true });

  const { data: imgData } = await sharp(pngBuffer)
    .resize(STICKER_SIZE, STICKER_SIZE, { fit: "fill" })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(STICKER_SIZE * STICKER_SIZE * 4);
  for (let i = 0; i < STICKER_SIZE * STICKER_SIZE; i++) {
    out[i * 4 + 0] = imgData[i * 4 + 0];
    out[i * 4 + 1] = imgData[i * 4 + 1];
    out[i * 4 + 2] = imgData[i * 4 + 2];
    out[i * 4 + 3] = maskData[i];
  }
  return sharp(out, { raw: { width: STICKER_SIZE, height: STICKER_SIZE, channels: 4 } }).png().toBuffer();
}

async function removeBgAnimated(inputPath, outputPath) {
  const framesDir    = path.join(os.tmpdir(), `stk_f_${Date.now()}`);
  const outFramesDir = path.join(os.tmpdir(), `stk_o_${Date.now()}`);
  fs.mkdirSync(outFramesDir, { recursive: true });
  const framePaths = [];
  const outPaths   = [];
  try {
    const frames = extractFrames(inputPath, framesDir, MAX_GIF_FRAMES);
    framePaths.push(...frames);
    if (!frames.length) throw new Error("Không extract được frame nào");
    for (let i = 0; i < frames.length; i++) {
      const rmbgBuf = await removeBgFrame(fs.readFileSync(frames[i]));
      const out     = path.join(outFramesDir, `out_${String(i).padStart(4,"0")}.png`);
      fs.writeFileSync(out, rmbgBuf);
      outPaths.push(out);
    }
    assembleFramesToWebP(outPaths, outputPath);
  } finally {
    cleanFiles(...framePaths, ...outPaths);
    try { fs.rmdirSync(framesDir); }    catch (_) {}
    try { fs.rmdirSync(outFramesDir); } catch (_) {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN PIPELINE — buffer + mime → WebP file
// ─────────────────────────────────────────────────────────────────────────────

async function buildStickerFile(buf, mime, rmbg = false) {
  const isGif   = mime === "image/gif";
  const isVideo = mime.startsWith("video/");
  const isImage = mime.startsWith("image/") && !isGif;
  const output  = tmpFile("webp");

  if (isImage && !rmbg) {
    await toStaticWebP(buf, output);
    return output;
  }

  if (isImage && rmbg) {
    const png = await sharp(buf)
      .resize(STICKER_SIZE, STICKER_SIZE, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png().toBuffer();
    const rmbgBuf = await removeBgFrame(png);
    await toStaticWebPAlpha(rmbgBuf, output);
    return output;
  }

  // GIF hoặc Video
  const inputPath = tmpFile(isGif ? "gif" : "mp4");
  try {
    fs.writeFileSync(inputPath, buf);
    if (!rmbg) {
      toAnimatedWebP(inputPath, output, isVideo);
    } else {
      let srcPath = inputPath;
      let cutPath = null;
      if (isVideo) {
        cutPath = tmpFile("mp4");
        ffmpegRun("-y", "-i", inputPath, "-t", String(MAX_VID_SEC), "-c", "copy", cutPath);
        srcPath = cutPath;
      }
      try { await removeBgAnimated(srcPath, output); }
      finally { cleanFiles(cutPath); }
    }
  } finally { cleanFiles(inputPath); }

  return output;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PIPELINE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

async function handleMediaPipeline({ api, event, args, send, threadID, rmbg, mediaUrlOverride }) {
  let stickerPath = null;
  try {
    const mediaUrl = mediaUrlOverride ?? await extractMediaUrl(event, api, threadID, args);
    if (!mediaUrl) {
      return send(
        "❎ Không tìm thấy media!\n" +
        "💡 Reply ảnh / GIF / video, hoặc thêm link vào lệnh.\n" +
        "Ví dụ: .stk https://example.com/anim.gif"
      );
    }

    await send("⏳ Đang tải & xử lý media...");

    const buf  = await downloadBuffer(mediaUrl);
    const mime = await detectType(buf);

    const isGif   = mime === "image/gif";
    const isVideo = mime.startsWith("video/");
    const isImage = mime.startsWith("image/") && !isGif;

    if (!isGif && !isVideo && !isImage) {
      return send(`❌ Định dạng không hỗ trợ: ${mime}\n💡 Chỉ hỗ trợ ảnh, GIF, video.`);
    }

    const label = isGif ? "GIF" : isVideo ? "Video" : "Ảnh";

    if (rmbg) {
      const frameNote = (isGif || isVideo) ? ` (tối đa ${MAX_GIF_FRAMES} frame)` : "";
      await send(`🧠 Đang xóa nền ${label}${frameNote}...`);
    } else if (isGif || isVideo) {
      await send(`🎞️ Đang chuyển ${label} → animated WebP 512×512...`);
    }

    stickerPath = await buildStickerFile(buf, mime, rmbg);

    if (!fs.existsSync(stickerPath) || fs.statSync(stickerPath).size < 100) {
      throw new Error("File WebP đầu ra rỗng");
    }

    await api.sendMessage({ msg: "", attachments: [stickerPath] }, threadID, event.type);

  } catch (err) {
    console.error("[STK]", err?.message || err);
    const msg = err?.message || "Lỗi không xác định";
    if (msg.includes("RMBG") || msg.includes("mask") || msg.includes("imageSegmentation")) {
      await send(`❌ Xóa nền thất bại: ${msg}\n💡 Model đang bận, thử lại sau.`);
    } else if (msg.includes("FFmpeg") || msg.includes("ffmpeg")) {
      await send(`❌ Lỗi xử lý media: ${msg.slice(0, 150)}`);
    } else {
      await send(`❌ Thất bại: ${msg.slice(0, 150)}`);
    }
  } finally {
    cleanFiles(stickerPath);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ZALO STICKER SEARCH HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function findPackByQuery(q) {
  q = q.trim().toLowerCase();
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
  const detail   = await api.getStickerCategoryDetail(cateId);
  const d        = detail?.data ?? detail;
  const stickers = d?.stickers ?? d?.items ?? d?.listSticker ?? (Array.isArray(d) ? d : []);
  if (!stickers.length) return false;
  const s   = stickers[Math.floor(Math.random() * stickers.length)];
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
  let   list = extractStickerList(raw).filter(s => s && (s.sticker_id || s.id));
  if (!list.length) return false;
  if (preferAnimated) {
    const animated = list.filter(s => Number(s.type) === 2);
    if (animated.length) list = animated;
  }
  const s   = list[Math.floor(Math.random() * list.length)];
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
  // Pack-based (chỉ khi không ưu tiên animated)
  if (!preferAnimated) {
    const pack = findPackByQuery(keyword);
    if (pack) {
      const ok = await sendStickerFromPack(api, pack.cateId, threadID, threadType).catch(() => false);
      if (ok) return { ok: true, source: `pack "${pack.name}"` };
    }
  }
  // API search
  const ok1 = await searchAndSend(api, keyword, threadID, threadType, preferAnimated).catch(() => false);
  if (ok1) return { ok: true, source: "API search" };
  // Tách từng từ
  for (const w of keyword.split(/\s+/).filter(Boolean)) {
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
  "🎞️ TẠO STICKER TỪ MEDIA (reply hoặc link):\n" +
  "  stk                   → Media → WebP 512×512\n" +
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
    version:         "5.1.0",
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

    // ─── 0. Không có args → check có media không ──────────────────────────
    if (!sub) {
      const mediaUrl = await extractMediaUrl(event, api, threadID, []).catch(() => null);
      if (!mediaUrl) return send(HELP_MSG);
      return handleMediaPipeline({ api, event, args: [], send, threadID, rmbg: false });
    }

    // ─── 1. PACK ──────────────────────────────────────────────────────────
    if (sub === "pack") {
      if (!rest) {
        const lines = STICKER_PACKS.map(p => `${String(p.id).padStart(2)}. ${p.name}  [cateId: ${p.cateId}]`);
        return send(
          "📦 DANH SÁCH STICKER PACKS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          lines.join("\n") +
          "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 Dùng: .stk pack <số hoặc tên>"
        );
      }
      const pack = findPackByQuery(rest);
      if (!pack) return send(`❌ Không tìm thấy pack: "${rest}"\n💡 Gõ .stk pack để xem danh sách.`);
      try {
        const ok = await sendStickerFromPack(api, pack.cateId, threadID, event.type);
        if (!ok) {
          const ok2 = await searchAndSend(api, pack.keywords[0], threadID, event.type).catch(() => false);
          if (!ok2) await send(`❌ Pack "${pack.name}" không có sticker khả dụng. Thử lại sau!`);
        }
      } catch (e) { await send(`❌ Lỗi: ${e.message}`); }
      return;
    }

    // ─── 2. RANDOM ────────────────────────────────────────────────────────
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

    // ─── 3. LIST ──────────────────────────────────────────────────────────
    if (sub === "list" || sub === "ds") {
      const keyword = rest || "mèo";
      try {
        const raw  = await api.searchSticker(keyword, 10);
        const list = extractStickerList(raw).filter(s => s && (s.sticker_id || s.id));
        if (!list.length) return send(`❌ Không tìm thấy sticker nào cho: "${keyword}"`);
        return send(
          `🔍 ${list.length} sticker cho "${keyword}":\n` +
          list.map((s, i) =>
            `${i + 1}. ID=${s.sticker_id ?? s.id} | CateID=${s.cate_id ?? s.cateId ?? "?"} | Type=${s.type ?? 1}`
          ).join("\n")
        );
      } catch (e) { return send(`❌ Lỗi: ${e.message}`); }
    }

    // ─── 4. GIF (keyword hoặc media) ─────────────────────────────────────
    if (sub === "gif") {
      // Kiểm tra có link URL trong args không
      const urlInRestArgs = args.slice(1).find(a => /^https?:\/\//i.test(a));
      // Kiểm tra có quoted media không
      const quotedUrl = !rest || urlInRestArgs
        ? await extractMediaUrl(event, api, threadID, args.slice(1)).catch(() => null)
        : null;

      if (quotedUrl || urlInRestArgs) {
        // Media mode → giữ animation, convert → animated WebP
        return handleMediaPipeline({
          api, event, args: args.slice(1), send, threadID,
          rmbg: false,
          mediaUrlOverride: urlInRestArgs || quotedUrl,
        });
      }

      // Keyword mode → tìm animated sticker
      const keyword = rest || "mèo";
      try {
        const result = await sendCombo(api, keyword, threadID, event.type, true);
        if (!result.ok) await send(`❌ Không tìm thấy sticker động cho: "${keyword}"\n💡 Thử: .stk gif mèo`);
      } catch (e) { await send(`❌ Lỗi: ${e.message}`); }
      return;
    }

    // ─── 5. XOANEN ────────────────────────────────────────────────────────
    if (["xoanen","rmbg","xonnen","xn","removebg"].includes(sub)) {
      return handleMediaPipeline({ api, event, args: args.slice(1), send, threadID, rmbg: true });
    }

    // ─── 6. Sub không phải text command → check có phải link hay không ───
    //        Nếu sub trông như URL → media pipeline
    if (/^https?:\/\//i.test(sub)) {
      return handleMediaPipeline({ api, event, args, send, threadID, rmbg: false, mediaUrlOverride: sub });
    }

    // ─── 7. Check quoted media (user có thể reply ảnh rồi gõ tên sub lạ) ─
    //        Chỉ check nếu sub KHÔNG phải keyword Zalo sticker rõ ràng
    //        (tránh ".stk pack" bị nhảy vào pipeline)
    //        TEXT_SUBS đã xử lý ở trên hết rồi, nên không cần check ở đây

    // ─── 8. Fallback: Zalo sticker search theo keyword ───────────────────
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
      await send(`❌ Lỗi gửi sticker: ${e.message}`);
    }
  },
};

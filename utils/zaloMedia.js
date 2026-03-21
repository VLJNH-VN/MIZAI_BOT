"use strict";

/**
 * utils/zaloMedia.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tiện ích gửi media Zalo — tái sử dụng cho mọi dự án zca-js.
 *
 * Đóng gói 3 pattern chuẩn học từ GwenDev:
 *   1. uploadThumbnail  — Tạo thumbnail từ video → upload lên Zalo CDN
 *   2. zaloSendVideo    — sendVideo với thumbnailUrl đúng chuẩn
 *   3. zaloSendVoice    — upload AAC → sendVoice qua Zalo CDN
 *
 * ─── Tại sao cần uploadAttachment cho thumbnail? ────────────────────────────
 * api.sendVideo(thumbnailUrl) yêu cầu URL có thể fetch được bởi Zalo server.
 * URL bên ngoài (external) thường bị block hoặc hết hạn.
 * Giải pháp: upload thumbnail lên Zalo CDN qua api.uploadAttachment → URL vĩnh cửu.
 *
 * ─── Trick .bin (học từ GwenDev) ────────────────────────────────────────────
 * zca-js xử lý file theo extension:
 *   .jpg/.png → UploadAttachmentImageResponse  → { normalUrl, hdUrl }     ✗ không dùng cho thumbnailUrl
 *   .bin/.aac → UploadAttachmentFileResponse   → { fileUrl, fileName }    ✓ dùng được cho thumbnailUrl / voiceUrl
 *
 * Trick: tạo thumbnail bằng ffmpeg (output .jpg) → rename thành .bin → upload
 *        → nhận { fileUrl, fileName } → thumbnailUrl = fileUrl + "/" + fileName
 *
 * ─── Cách dùng ───────────────────────────────────────────────────────────────
 * const { zaloSendVideo, zaloSendVoice, uploadThumbnail } = require("../../utils/zaloMedia");
 *
 * // Gửi video với thumbnail tự động
 * await zaloSendVideo(api, {
 *   videoUrl:  "https://...",          // URL video vĩnh cửu (GitHub Releases, CDN...)
 *   videoPath: "/tmp/video.mp4",       // File local để tạo thumbnail (optional)
 *   msg:       "Caption video",
 *   width:     720, height: 1280,
 *   duration:  30,                     // giây
 * }, threadId, threadType);
 *
 * // Gửi voice từ file local
 * await zaloSendVoice(api, "/tmp/audio.aac", threadId, threadType);
 */

const fs           = require("fs");
const path         = require("path");
const { execSync } = require("child_process");

// ── Thư mục cache tạm ────────────────────────────────────────────────────────
const CACHE_DIR = path.join(process.cwd(), "includes", "cache");
function ensureCache() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// ── Xoá file tạm sau 15 giây ─────────────────────────────────────────────────
function defer(...files) {
  setTimeout(() => {
    files.forEach(f => { try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {} });
  }, 15000);
}

// ── ID duy nhất ───────────────────────────────────────────────────────────────
function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. uploadAttachmentToZalo
//    Upload bất kỳ file nào lên Zalo CDN, trả về URL dùng được.
//
//    zca-js response theo extension:
//      image (jpg/png) → { fileType:"image", hdUrl, normalUrl }
//      others (.bin)   → { fileType:"others", fileUrl, fileName }  ← cần cho thumbnailUrl
//      video (.mp4)    → { fileType:"video",  fileUrl, fileName }
//      audio (.aac)    → { fileType:"others", fileUrl, fileName }  ← dùng cho voiceUrl
// ─────────────────────────────────────────────────────────────────────────────
async function uploadAttachmentToZalo(api, filePath, threadId, threadType) {
  const uploaded = await api.uploadAttachment([filePath], threadId, threadType);
  const file = uploaded?.[0];
  if (!file) return null;

  // file/video response → fileUrl + "/" + fileName
  if (file.fileUrl && file.fileName) {
    return `${file.fileUrl}/${file.fileName}`;
  }
  // image response → hdUrl / normalUrl
  if (file.fileType === "image") {
    return file.hdUrl || file.normalUrl || null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. uploadThumbnail
//    Tạo thumbnail từ video local (hoặc dùng thumbnailUrl bên ngoài),
//    upload lên Zalo CDN, trả về URL.
//
//    Trick .bin (GwenDev):
//      ffmpeg → output .jpg → rename .bin → uploadAttachment
//      zca-js xử lý .bin như "others" → trả { fileUrl, fileName } → URL dùng được
//
//    @param api         — zca-js API instance
//    @param videoPath   — đường dẫn file video local để trích thumbnail
//    @param threadId    — ID luồng chat
//    @param threadType  — loại luồng (ThreadType.Group / User)
//    @returns           — URL thumbnail trên Zalo CDN, hoặc null nếu lỗi
// ─────────────────────────────────────────────────────────────────────────────
async function uploadThumbnail(api, videoPath, threadId, threadType) {
  ensureCache();
  const id      = uid();
  const jpgPath = path.join(CACHE_DIR, `thumb_${id}.jpg`);
  const binPath = path.join(CACHE_DIR, `thumb_${id}.bin`);

  try {
    // Bước 1: ffmpeg trích frame giây 1
    execSync(
      `ffmpeg -y -i "${videoPath}" -ss 00:00:01 -vframes 1 -vf scale=320:-1 -q:v 5 "${jpgPath}"`,
      { timeout: 30000, stdio: "pipe" }
    );
    if (!fs.existsSync(jpgPath) || fs.statSync(jpgPath).size === 0) return null;

    // Bước 2: rename .jpg → .bin (trick của GwenDev)
    fs.renameSync(jpgPath, binPath);

    // Bước 3: upload lên Zalo CDN
    const url = await uploadAttachmentToZalo(api, binPath, threadId, threadType);
    return url;
  } catch (e) {
    global.logWarn?.(`[zaloMedia] uploadThumbnail lỗi: ${e.message}`);
    return null;
  } finally {
    defer(jpgPath, binPath);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. zaloSendVideo
//    Gửi video theo chuẩn GwenDev:
//      - Tạo thumbnail từ videoPath (nếu có) → upload lên Zalo CDN
//      - Gửi api.sendVideo với thumbnailUrl đúng chuẩn
//      - Fallback: sendMessage + attachments
//
//    @param api          — zca-js API instance
//    @param opts         — { videoUrl, videoPath?, msg?, width?, height?, duration?, ttl? }
//      videoUrl          — URL video vĩnh cửu (GitHub Releases, Zalo CDN, CDN khác)
//      videoPath         — file local để tạo thumbnail (optional, nhưng nên có)
//      msg               — caption hiển thị dưới video
//      width, height     — kích thước video (pixel)
//      duration          — thời lượng (giây)
//      ttl               — thời gian sống tin nhắn (ms), mặc định 500_000
//    @param threadId     — ID luồng chat
//    @param threadType   — loại luồng
// ─────────────────────────────────────────────────────────────────────────────
async function zaloSendVideo(api, opts, threadId, threadType) {
  const {
    videoUrl,
    videoPath   = null,
    msg         = "",
    width       = 720,
    height      = 1280,
    duration    = 30,
    ttl         = 500_000,
  } = opts;

  if (!videoUrl) throw new Error("[zaloSendVideo] Thiếu videoUrl");

  // Upload thumbnail lên Zalo CDN
  let thumbnailUrl = "";
  if (videoPath && fs.existsSync(videoPath)) {
    try {
      thumbnailUrl = await uploadThumbnail(api, videoPath, threadId, threadType) || "";
      global.logInfo?.(`[zaloMedia] thumbnailUrl: ${thumbnailUrl?.slice(0, 60)}`);
    } catch (e) {
      global.logWarn?.(`[zaloMedia] thumbnail lỗi: ${e.message}`);
    }
  }

  // Gửi video
  try {
    await api.sendVideo({
      videoUrl,
      thumbnailUrl,
      msg,
      width,
      height,
      duration: duration * 1000,
      ttl,
    }, threadId, threadType);
    global.logInfo?.("[zaloMedia] sendVideo thành công.");
    return true;
  } catch (e) {
    global.logWarn?.(`[zaloMedia] sendVideo thất bại: ${e.message}`);

    // Fallback: gửi file nếu có videoPath
    if (videoPath && fs.existsSync(videoPath)) {
      try {
        await api.sendMessage({ msg, attachments: [videoPath], ttl }, threadId, threadType);
        global.logInfo?.("[zaloMedia] sendVideo fallback attachment thành công.");
        return true;
      } catch {}
    }
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. zaloSendVoice
//    Gửi voice theo chuẩn GwenDev:
//      - Upload AAC lên Zalo CDN qua uploadAttachment → lấy voiceUrl
//      - Gọi api.sendVoice({ voiceUrl })
//      - Fallback: sendVoice(direct URL) → sendMessage attachment
//
//    @param api         — zca-js API instance
//    @param source      — path file local AAC, hoặc URL audio trực tiếp
//    @param threadId    — ID luồng chat
//    @param threadType  — loại luồng
//    @param ttl         — thời gian sống (ms), mặc định 900_000
// ─────────────────────────────────────────────────────────────────────────────
async function zaloSendVoice(api, source, threadId, threadType, ttl = 900_000) {
  const isLocalFile = typeof source === "string" && !source.startsWith("http");
  let aacPath = null;
  let tmpPath = null;
  let needCleanup = false;

  try {
    ensureCache();

    // Nếu là URL → download về local
    if (!isLocalFile) {
      const axios = require("axios");
      tmpPath = path.join(CACHE_DIR, `voice_${uid()}`);
      const res = await axios.get(source, {
        responseType: "arraybuffer", timeout: 120000,
        maxContentLength: 100 * 1024 * 1024,
      });
      fs.writeFileSync(tmpPath, Buffer.from(res.data));
      needCleanup = true;
    } else {
      tmpPath = source;
    }

    // Convert sang AAC nếu chưa phải
    const isAac = tmpPath.toLowerCase().endsWith(".aac");
    if (isAac) {
      aacPath = tmpPath;
    } else {
      aacPath = path.join(CACHE_DIR, `voice_${uid()}.aac`);
      execSync(
        `ffmpeg -y -i "${tmpPath}" -vn -c:a aac -b:a 128k "${aacPath}"`,
        { timeout: 120000, stdio: "pipe" }
      );
      needCleanup = true;
    }

    // Bước 1: uploadAttachment(AAC) → voiceUrl (Zalo CDN)
    const voiceUrl = await uploadAttachmentToZalo(api, aacPath, threadId, threadType);
    if (voiceUrl) {
      await api.sendVoice({ voiceUrl, ttl }, threadId, threadType);
      global.logInfo?.("[zaloMedia] sendVoice (uploadAttachment) thành công.");
      return true;
    }

    // Bước 2: Fallback → sendVoice với direct URL (nếu source là URL)
    if (!isLocalFile) {
      try {
        await api.sendVoice({ voiceUrl: source, ttl }, threadId, threadType);
        global.logInfo?.("[zaloMedia] sendVoice (direct URL) thành công.");
        return true;
      } catch {}
    }

    // Bước 3: Fallback → sendMessage attachment
    await api.sendMessage({ attachments: [aacPath], ttl }, threadId, threadType);
    global.logInfo?.("[zaloMedia] sendVoice fallback attachment thành công.");
    return true;

  } catch (e) {
    global.logWarn?.(`[zaloMedia] sendVoice lỗi: ${e.message}`);
    return false;
  } finally {
    if (needCleanup) defer(tmpPath, aacPath);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  uploadAttachmentToZalo,
  uploadThumbnail,
  zaloSendVideo,
  zaloSendVoice,
};

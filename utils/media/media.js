"use strict";

/**
 * utils/media/media.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tiện ích xử lý media (video, voice) dùng chung cho toàn bot.
 *
 * EXPORTS:
 *   sendVideo(api, videoPath, threadId, threadType, opts)
 *     opts: { msg?, thumbnailUrl?, width?, height?, duration? }  duration = giây
 *   sendVoice(api, audioPath, threadId, threadType)
 *   getVideoMeta(videoPath)  → { width, height, duration }       duration = giây
 *   VIDEO_DIR   — thư mục chứa video mặc định
 *   tempDir     — thư mục cache tạm
 */

const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ── Thư mục dùng chung ────────────────────────────────────────────────────────
const tempDir   = path.join(process.cwd(), "includes", "cache");
const VIDEO_DIR = path.join(tempDir, "videos");

// ── getVideoMeta ──────────────────────────────────────────────────────────────
/**
 * Lấy metadata video bằng ffprobe.
 * @param {string} filePath
 * @returns {{ width: number, height: number, duration: number }}  duration = giây
 */
function getVideoMeta(filePath) {
  try {
    const out = execSync(
      `ffprobe -v error -show_format -show_streams -of json "${filePath}"`,
      { timeout: 15000 }
    ).toString();
    const data = JSON.parse(out);
    const vs   = data.streams?.find(s => s.codec_type === "video");
    const dur  = parseFloat(data.format?.duration || 0);
    return {
      width:    vs?.width    || 720,
      height:   vs?.height   || 1280,
      duration: dur > 0 ? Math.max(1, Math.ceil(dur)) : 1,
    };
  } catch {
    return { width: 720, height: 1280, duration: 1 };
  }
}

// ── sendVideo ─────────────────────────────────────────────────────────────────
/**
 * Upload video local rồi gửi qua Zalo.
 *
 * @param {object} api         — Zalo API instance
 * @param {string} videoPath   — Đường dẫn file video local
 * @param {string} threadId
 * @param {*}      threadType  — ThreadType.Group | ThreadType.User
 * @param {object} [opts]
 * @param {string}  [opts.msg]          — Caption kèm video
 * @param {string}  [opts.thumbnailUrl] — URL ảnh thumbnail
 * @param {number}  [opts.width]        — Chiều rộng (px)
 * @param {number}  [opts.height]       — Chiều cao (px)
 * @param {number}  [opts.duration]     — Thời lượng (giây)
 */
async function sendVideo(api, videoPath, threadId, threadType, opts = {}) {
  const {
    msg          = "",
    thumbnailUrl = "",
    width        = 720,
    height       = 1280,
    duration     = 1,
  } = opts;

  // Upload file lên Zalo lấy fileUrl
  const uploaded = await api.uploadAttachment([videoPath], threadId, threadType);
  const fileInfo = Array.isArray(uploaded) ? uploaded[0] : uploaded;
  const videoUrl = fileInfo?.fileUrl || fileInfo?.url || fileInfo;

  if (!videoUrl) throw new Error("[sendVideo] Không lấy được videoUrl sau khi upload");

  await api.sendVideo(
    {
      videoUrl,
      thumbnailUrl,
      msg,
      width,
      height,
      duration: Math.max(1000, duration * 1000),   // ms, tối thiểu 1 giây
      ttl: 500_000,
    },
    threadId,
    threadType
  );
}

// ── sendVoice ─────────────────────────────────────────────────────────────────
/**
 * Upload audio local (aac/mp3) rồi gửi dạng voice qua Zalo.
 *
 * @param {object} api
 * @param {string} audioPath  — Đường dẫn file âm thanh local
 * @param {string} threadId
 * @param {*}      threadType
 */
async function sendVoice(api, audioPath, threadId, threadType) {
  const uploaded = await api.uploadAttachment([audioPath], threadId, threadType);
  const fileInfo = Array.isArray(uploaded) ? uploaded[0] : uploaded;
  const fileUrl  = fileInfo?.fileUrl || fileInfo?.url || fileInfo;

  if (!fileUrl) throw new Error("[sendVoice] Không lấy được fileUrl sau khi upload");

  // Thử sendVoice trước, fallback sendMessage nếu API không hỗ trợ
  if (typeof api.sendVoice === "function") {
    await api.sendVoice({ voiceUrl: fileUrl, ttl: 500_000 }, threadId, threadType);
  } else {
    await api.sendMessage({ msg: "", attachments: [audioPath], ttl: 500_000 }, threadId, threadType);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = { sendVideo, sendVoice, getVideoMeta, VIDEO_DIR, tempDir };

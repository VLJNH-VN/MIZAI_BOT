"use strict";

/**
 * utils/system/ljzi.js
 * Module Ljzi — Quản lý danh sách video gái/anime + gửi video chuẩn zca-js
 *
 * Đăng ký global:
 *   global.Ljzi.vdgai          → string[]   danh sách URL video gái
 *   global.Ljzi.vdani          → string[]   danh sách URL video anime
 *   global.Ljzi.pick(name)     → string|null  lấy random 1 URL từ "vdgai" hoặc "vdani"
 *   global.Ljzi.send(api, event, name) → Promise  download → H264 → sendVideo/fallback
 */

const fs           = require("fs");
const path         = require("path");
const axios        = require("axios");
const { execSync } = require("child_process");

const LISTAPI_DIR = path.join(__dirname, "../../includes/listapi");
const TEMP_DIR    = path.join(__dirname, "../../includes/cache");

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function cleanup(...files) {
  setTimeout(() => {
    files.forEach(f => {
      try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    });
  }, 10000);
}

async function downloadFile(url, filePath) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  const res = await axios.get(url, {
    responseType:     "arraybuffer",
    timeout:          120000,
    maxContentLength: 200 * 1024 * 1024,
    headers: { "User-Agent": global.userAgent || "Mozilla/5.0" },
  });
  fs.writeFileSync(filePath, Buffer.from(res.data));
  if (fs.statSync(filePath).size === 0) throw new Error("File tải về rỗng");
}

function probeStreams(filePath) {
  try {
    const out  = execSync(
      `ffprobe -v error -show_format -show_streams -of json "${filePath}"`,
      { timeout: 30000, stdio: "pipe" }
    ).toString();
    const data = JSON.parse(out);
    const vs   = data.streams?.find(s => s.codec_type === "video");
    const dur  = parseFloat(data.format?.duration || 0);
    return {
      width:    vs?.width    || 576,
      height:   vs?.height   || 1024,
      duration: dur > 0 ? Math.max(1, Math.ceil(dur)) : 10,
    };
  } catch {
    return { width: 576, height: 1024, duration: 10 };
  }
}

function convertToH264(inputPath, outputPath) {
  execSync(
    `ffmpeg -y -i "${inputPath}" -map 0:v:0 -map 0:a:0? ` +
    `-c:v libx264 -preset fast -crf 23 -profile:v baseline -level 3.1 ` +
    `-pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" ` +
    `-c:a aac -b:a 128k -ar 44100 -movflags +faststart "${outputPath}"`,
    { timeout: 180000, stdio: "pipe" }
  );
}

// ── Load JSON list ─────────────────────────────────────────────────────────────

function loadList(filename) {
  const filePath = path.join(LISTAPI_DIR, filename);
  try {
    if (fs.existsSync(filePath))
      return JSON.parse(fs.readFileSync(filePath, "utf8")).slice();
  } catch (e) {
    global.logWarn?.(`[Ljzi] Không load được ${filename}: ${e.message}`);
  }
  return [];
}

// ── sendOneVideo: download → H264 → thumbnail → sendVideo / fallback ──────────

async function sendOneVideo(api, event, srcUrl, caption) {
  const id       = uid();
  const rawPath  = path.join(TEMP_DIR, `ljzi_raw_${id}.mp4`);
  const h264Path = path.join(TEMP_DIR, `ljzi_h264_${id}.mp4`);

  try {
    await downloadFile(srcUrl, rawPath);

    let uploadPath = rawPath;
    try {
      convertToH264(rawPath, h264Path);
      if (fs.existsSync(h264Path) && fs.statSync(h264Path).size > 0)
        uploadPath = h264Path;
    } catch (e) {
      global.logWarn?.(`[Ljzi] Convert H264 lỗi, dùng file gốc: ${e.message}`);
    }

    const meta     = probeStreams(uploadPath);
    const fileSize = fs.statSync(uploadPath).size;
    global.logInfo?.(`[Ljzi] size=${(fileSize / 1024).toFixed(0)}KB w=${meta.width} h=${meta.height} dur=${meta.duration}s`);

    let thumbnailUrl = "";
    try {
      thumbnailUrl = await global.zaloUploadThumbnail(api, uploadPath, event.threadId, event.type) || "";
    } catch (et) {
      global.logWarn?.(`[Ljzi] Thumbnail lỗi: ${et.message}`);
    }

    let sentAsVideo = false;

    if (typeof global.githubReleaseUpload === "function" && fileSize < 50 * 1024 * 1024) {
      try {
        const releaseUrl = await global.githubReleaseUpload(uploadPath, `ljzi_${id}.mp4`);
        if (releaseUrl) {
          await api.sendVideo({
            videoUrl:     releaseUrl,
            thumbnailUrl,
            msg:          caption || "",
            width:        meta.width,
            height:       meta.height,
            duration:     meta.duration * 1000,
            ttl:          500_000,
          }, event.threadId, event.type);
          global.logInfo?.("[Ljzi] sendVideo (Release) thành công.");
          sentAsVideo = true;
        }
      } catch (e) {
        global.logWarn?.(`[Ljzi] Release upload/sendVideo thất bại: ${e.message}`);
      }
    }

    if (!sentAsVideo) {
      await api.sendMessage(
        { msg: caption || "", attachments: [uploadPath], ttl: 500_000 },
        event.threadId, event.type
      );
      global.logInfo?.("[Ljzi] fallback sendMessage attachment thành công.");
    }

  } finally {
    cleanup(rawPath, h264Path);
  }
}

// ── Đăng ký global.Ljzi ───────────────────────────────────────────────────────

const vdgai = loadList("gai.json");
const vdani = loadList("ani.json");

global.Ljzi = {
  vdgai,
  vdani,

  pick(name) {
    const list = this[name];
    if (!list || !list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  },

  async send(api, event, name) {
    const url = this.pick(name);
    if (!url) throw new Error(`[Ljzi] Danh sách "${name}" trống hoặc chưa có.`);
    await sendOneVideo(api, event, url, `🎬 ${name}`);
  },
};

global.logInfo?.(`[Ljzi] Đã load: vdgai=${vdgai.length} | vdani=${vdani.length}`);

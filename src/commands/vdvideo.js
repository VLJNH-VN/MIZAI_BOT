"use strict";

/**
 * src/commands/vdvideo.js
 * Gửi video gái hoặc anime ngẫu nhiên từ global.Ljzi
 *
 * Cách dùng:
 *   .vdvideo         → video gái ngẫu nhiên
 *   .vdvideo anime   → video anime ngẫu nhiên
 */

const fs           = require("fs");
const path         = require("path");
const axios        = require("axios");
const { execSync } = require("child_process");

const TEMP_DIR = path.join(process.cwd(), "includes", "cache");

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

async function sendOneVideo(api, event, srcUrl, caption) {
  const id       = uid();
  const rawPath  = path.join(TEMP_DIR, `vdvideo_raw_${id}.mp4`);
  const h264Path = path.join(TEMP_DIR, `vdvideo_h264_${id}.mp4`);

  try {
    await downloadFile(srcUrl, rawPath);

    let uploadPath = rawPath;
    try {
      convertToH264(rawPath, h264Path);
      if (fs.existsSync(h264Path) && fs.statSync(h264Path).size > 0)
        uploadPath = h264Path;
    } catch (e) {
      global.logWarn?.(`[vdvideo] Convert H264 lỗi, dùng file gốc: ${e.message}`);
    }

    const meta     = probeStreams(uploadPath);
    const fileSize = fs.statSync(uploadPath).size;
    global.logInfo?.(`[vdvideo] size=${(fileSize/1024).toFixed(0)}KB w=${meta.width} h=${meta.height} dur=${meta.duration}s`);

    let thumbnailUrl = "";
    try {
      thumbnailUrl = await global.zaloUploadThumbnail(api, uploadPath, event.threadId, event.type) || "";
    } catch (et) {
      global.logWarn?.(`[vdvideo] Thumbnail lỗi: ${et.message}`);
    }

    let sentAsVideo = false;

    if (typeof global.githubReleaseUpload === "function" && fileSize < 50 * 1024 * 1024) {
      try {
        const releaseUrl = await global.githubReleaseUpload(uploadPath, `vdvideo_${id}.mp4`);
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
          sentAsVideo = true;
        }
      } catch (e) {
        global.logWarn?.(`[vdvideo] Release upload/sendVideo thất bại: ${e.message}`);
      }
    }

    if (!sentAsVideo) {
      await api.sendMessage(
        { msg: caption || "", attachments: [uploadPath], ttl: 500_000 },
        event.threadId, event.type
      );
    }

  } finally {
    cleanup(rawPath, h264Path);
  }
}

module.exports = {
  config: {
    name:            "vdvideo",
    version:         "2.1.0",
    hasPermssion:    2,
    credits:         "Bat + GPT",
    description:     "Gửi video gái hoặc anime ngẫu nhiên",
    commandCategory: "Giải Trí",
    usages:          "vdvideo [anime]",
    cooldowns:       5,
  },

  run: async ({ api, event, send }) => {
    const body    = (event.body || "").toLowerCase().trim();
    const isAnime = body.includes("anime");
    const list    = isAnime ? global.Ljzi?.vdani : global.Ljzi?.vdgai;
    const tipName = isAnime ? "vdani" : "vdgai";

    if (!list || !list.length)
      return send("⏳ Đợi một lát nhé, video đang được chuẩn bị...");

    const videoUrl = list[Math.floor(Math.random() * list.length)];
    if (!videoUrl)
      return send("❌ Lỗi video, thử lại sau!");

    try {
      await sendOneVideo(api, event, videoUrl, `🎬 ${tipName}`);
    } catch (err) {
      global.logWarn?.(`[vdvideo] Lỗi: ${err?.message}`);
      await send(`❌ Gửi video thất bại: ${err?.message || "Lỗi không xác định"}`);
    }
  },
};

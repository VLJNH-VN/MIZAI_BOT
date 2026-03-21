"use strict";

/**
 * src/commands/vd.js
 * Xem video ngẫu nhiên từ listapi/<tên>.json
 *
 * Flow (theo chuẩn autoDown):
 *   1. Download GitHub URL về local
 *   2. Convert sang H264 (Zalo yêu cầu)
 *   3. Serve local → Replit public URL (video/mp4) → api.sendVideo
 *   4. Fallback: sendMessage + attachments (file local)
 *
 * Cách dùng:
 *   .vd              → Xem danh sách listapi có sẵn
 *   .vd <tên>        → Gửi 1 video ngẫu nhiên từ listapi/<tên>
 *   .vd <tên> <số>   → Gửi n video ngẫu nhiên liên tiếp (tối đa 10)
 */

const fs             = require("fs");
const path           = require("path");
const axios          = require("axios");
const { execSync }   = require("child_process");

const LISTAPI_DIR = path.join(process.cwd(), "includes", "listapi");
const TEMP_DIR    = path.join(process.cwd(), "includes", "cache");

// ── Lấy danh sách file listapi đang có ────────────────────────────────────────
function getListapiFiles() {
  if (!fs.existsSync(LISTAPI_DIR)) return [];
  return fs.readdirSync(LISTAPI_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => f.replace(".json", ""));
}

// ── Chọn ngẫu nhiên n phần tử không trùng từ mảng ────────────────────────────
function pickRandN(arr, n) {
  if (!arr.length) return [];
  const copy  = [...arr];
  const picks = [];
  const count = Math.min(n, copy.length);
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    picks.push(copy.splice(idx, 1)[0]);
  }
  return picks;
}

// ── Unique ID cho file tạm ────────────────────────────────────────────────────
function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ── Xoá file tạm sau 10 giây ─────────────────────────────────────────────────
function cleanup(...files) {
  setTimeout(() => {
    files.forEach(f => {
      try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    });
  }, 10000);
}

// ── Tải URL về file tạm ───────────────────────────────────────────────────────
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

// ── Probe stream để lấy width/height/duration ─────────────────────────────────
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

// ── Convert sang H264 (Zalo yêu cầu) ─────────────────────────────────────────
function convertToH264(inputPath, outputPath) {
  execSync(
    `ffmpeg -y -i "${inputPath}" -map 0:v:0 -map 0:a:0? ` +
    `-c:v libx264 -preset fast -crf 23 -profile:v baseline -level 3.1 ` +
    `-pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" ` +
    `-c:a aac -b:a 128k -ar 44100 -movflags +faststart "${outputPath}"`,
    { timeout: 180000, stdio: "pipe" }
  );
}

// ── Tạo thumbnail từ video (theo GwenDev pattern) ────────────────────────────
// Tạo .jpg trước → rename thành .bin → upload như "others" → nhận fileUrl/fileName
function createThumbnail(videoPath, thumbBinPath) {
  const tmpJpg = thumbBinPath.replace(/\.bin$/, ".jpg");
  execSync(
    `ffmpeg -y -i "${videoPath}" -ss 00:00:01 -vframes 1 -vf scale=320:-1 -q:v 5 "${tmpJpg}"`,
    { timeout: 30000, stdio: "pipe" }
  );
  fs.renameSync(tmpJpg, thumbBinPath);
}

// ── Upload file lên Zalo CDN qua uploadAttachment → trả về URL ───────────────
// .bin file → zca-js trả về { fileType:"others", fileUrl, fileName }
// → thumbnailUrl = fileUrl + "/" + fileName (dùng được cho sendVideo)
async function uploadAttachmentToZalo(api, filePath, threadId, threadType) {
  try {
    const uploaded = await api.uploadAttachment([filePath], threadId, threadType);
    const file = uploaded?.[0];
    if (!file) return null;
    if (file.fileUrl && file.fileName) {
      return `${file.fileUrl}/${file.fileName}`;
    }
    if (file.fileType === "image") {
      return file.hdUrl || file.normalUrl || null;
    }
  } catch (e) {
    global.logWarn?.(`[vd] uploadAttachment thất bại: ${e.message}`);
  }
  return null;
}

// ── Gửi 1 video: download → H264 → thumbnail → uploadAttachment → sendVideo ──
// Flow (theo pattern GwenDev):
//   1. Download srcUrl về local
//   2. Convert H264 (Zalo yêu cầu codec này)
//   3. Tạo thumbnail → uploadAttachment(thumb) → thumbnailZaloUrl
//   4. githubReleaseUpload → sendVideo(releaseUrl, thumbnailZaloUrl)
//   5. Fallback: sendMessage + attachments
async function sendOneVideo(api, event, srcUrl, caption) {
  const id        = uid();
  const rawPath   = path.join(TEMP_DIR, `vd_raw_${id}.mp4`);
  const h264Path  = path.join(TEMP_DIR, `vd_h264_${id}.mp4`);
  const thumbPath = path.join(TEMP_DIR, `vd_thumb_${id}.bin`);

  try {
    // Bước 1: Tải về local
    await downloadFile(srcUrl, rawPath);

    // Bước 2: Convert H264 (Zalo yêu cầu codec này)
    let uploadPath = rawPath;
    try {
      convertToH264(rawPath, h264Path);
      if (fs.existsSync(h264Path) && fs.statSync(h264Path).size > 0)
        uploadPath = h264Path;
    } catch (e) {
      global.logWarn?.(`[vd] Convert H264 lỗi, dùng file gốc: ${e.message}`);
    }

    const meta     = probeStreams(uploadPath);
    const fileSize = fs.statSync(uploadPath).size;
    global.logInfo?.(`[vd] size=${(fileSize/1024).toFixed(0)}KB | w=${meta.width} h=${meta.height} dur=${meta.duration}s`);

    // Bước 3: Tạo thumbnail → uploadAttachment → lấy Zalo CDN URL (theo GwenDev)
    let thumbnailZaloUrl = "";
    try {
      createThumbnail(uploadPath, thumbPath);
      if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0) {
        global.logInfo?.(`[vd] Upload thumbnail: ${path.basename(thumbPath)}`);
        thumbnailZaloUrl = await uploadAttachmentToZalo(api, thumbPath, event.threadId, event.type) || "";
        global.logInfo?.(`[vd] Thumbnail Zalo URL: ${thumbnailZaloUrl?.slice(0, 60)}`);
      }
    } catch (et) {
      global.logWarn?.(`[vd] Tạo/upload thumbnail lỗi: ${et.message}`);
    }

    // Bước 4: GitHub Releases upload → sendVideo
    let sentAsVideo = false;

    if (typeof global.githubReleaseUpload === "function" && fileSize < 50 * 1024 * 1024) {
      try {
        const filename    = `vd_${id}.mp4`;
        const releaseUrl  = await global.githubReleaseUpload(uploadPath, filename);
        global.logInfo?.(`[vd] GitHub Release upload OK: ${releaseUrl?.slice(0, 80)}`);

        if (releaseUrl) {
          await api.sendVideo({
            videoUrl:     releaseUrl,
            thumbnailUrl: thumbnailZaloUrl || "",
            msg:          caption || "",
            width:        meta.width    || 576,
            height:       meta.height   || 1024,
            duration:     meta.duration * 1000,
            ttl:          500_000,
          }, event.threadId, event.type);
          global.logInfo?.("[vd] sendVideo (Release) thành công.");
          sentAsVideo = true;
        }
      } catch (e) {
        global.logWarn?.(`[vd] Release upload/sendVideo thất bại: ${e.message}`);
      }
    }

    // Bước 5: Fallback → sendMessage + attachments (file local)
    if (!sentAsVideo) {
      await api.sendMessage(
        { msg: caption || "", attachments: [uploadPath], ttl: 500_000 },
        event.threadId, event.type
      );
      global.logInfo?.("[vd] fallback sendMessage attachment thành công.");
    }

  } finally {
    cleanup(rawPath, h264Path, thumbPath);
  }
}

module.exports = {
  config: {
    name:            "vd",
    aliases:         ["video", "randvd", "playvd"],
    version:         "3.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Xem video ngẫu nhiên từ listapi",
    commandCategory: "Giải Trí",
    usages: [
      ".vd              — Xem danh sách listapi có sẵn",
      ".vd <tên>        — Gửi 1 video ngẫu nhiên từ listapi/<tên>",
      ".vd <tên> <số>   — Gửi n video liên tiếp (tối đa 10)",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ api, event, args, send }) => {
    // ── Không có args → Hiển thị danh sách listapi ───────────────────────────
    if (!args.length) {
      const files = getListapiFiles();
      if (!files.length) {
        return send(
          "📂 Chưa có listapi nào.\n" +
          "Dùng .api tt <tên> <từ khóa> <số> để tải video từ TikTok về."
        );
      }
      const lines = ["📋 DANH SÁCH LISTAPI", "━━━━━━━━━━━━━━━━"];
      for (const name of files) {
        const list = global.cawr.tt.loadList(name);
        lines.push(`• ${name} — ${list.length} video`);
      }
      lines.push("━━━━━━━━━━━━━━━━");
      lines.push("💬 Dùng: .vd <tên> để xem video");
      return send(lines.join("\n"));
    }

    // ── Parse tên và số lượng ─────────────────────────────────────────────────
    const tipName = args[0];
    let count = 1;
    if (args[1]) {
      const parsed = parseInt(args[1], 10);
      if (!isNaN(parsed) && parsed >= 1) count = Math.min(parsed, 10);
    }

    // ── Kiểm tra listapi có tồn tại không ────────────────────────────────────
    const list = global.cawr.tt.loadList(tipName);
    if (!list.length) {
      const files = getListapiFiles();
      let msg = `❌ Listapi "${tipName}" chưa có video.`;
      if (files.length) msg += `\n📋 Có sẵn: ${files.join(", ")}`;
      else msg += "\nDùng .api tt <tên> <từ khóa> <số> để tải về trước.";
      return send(msg);
    }

    // ── Thông báo nếu gửi nhiều video ────────────────────────────────────────
    if (count > 1) {
      await send(`🎬 Đang gửi ${count} video từ "${tipName}"... (${list.length} video có sẵn)`);
    }

    // ── Gửi từng video ────────────────────────────────────────────────────────
    const picks = pickRandN(list, count);
    let sentOk  = 0;

    for (const srcUrl of picks) {
      try {
        const caption = count === 1 ? `🎬 ${tipName}` : "";
        await sendOneVideo(api, event, srcUrl, caption);
        sentOk++;
      } catch (err) {
        global.logWarn?.(`[vd] Lỗi gửi video: ${err?.message} | ${srcUrl}`);
        await send(`❌ Gửi video thất bại: ${err?.message || "Lỗi không xác định"}`);
      }
    }

    if (count > 1) {
      await send(`✅ Đã gửi ${sentOk}/${count} video từ "${tipName}"`);
    }
  },
};

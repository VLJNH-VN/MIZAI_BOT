/**
 * utils/bot/processGaiData.js
 * Xử lý danh sách URL video từ gai.json → lấy metadata + thumbnail → lưu vào VideoCosplay.json.
 * Export hàm để dùng cả từ CLI (getdata.js) lẫn lệnh bot.
 */

const fs   = require("fs");
const path = require("path");
const axios = require("axios");
const { execSync } = require("child_process");

const ROOT_DIR       = path.join(__dirname, "../../");
const inputJsonPath  = path.join(ROOT_DIR, "includes", "data", "gai.json");
const outputJsonPath = path.join(ROOT_DIR, "includes", "data", "VideoCosplay.json");
const cacheDir       = path.join(ROOT_DIR, "includes", "cache", "videos");
const thumbDir       = path.join(ROOT_DIR, "includes", "cache", "thumbs");

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ── Download file về disk ─────────────────────────────────────────────────────
async function downloadFile(url, filePath) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    maxContentLength: 200 * 1024 * 1024,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  fs.writeFileSync(filePath, Buffer.from(response.data));
  return response.data;
}

// ── Lấy metadata video bằng ffprobe ──────────────────────────────────────────
function getVideoMetadata(filePath) {
  const out = execSync(
    `ffprobe -v error -show_format -show_streams -of json "${filePath}"`,
    { timeout: 15000, stdio: "pipe" }
  ).toString();
  const data        = JSON.parse(out);
  const videoStream = data.streams.find(s => s.codec_type === "video");
  if (!videoStream) throw new Error("Không tìm thấy video stream.");
  return {
    width:    videoStream.width  || 0,
    height:   videoStream.height || 0,
    duration: Math.round(parseFloat(data.format.duration || 0)),
  };
}

// ── Tạo thumbnail từ video ────────────────────────────────────────────────────
function createThumbnail(videoPath, thumbNameWithBinExt, outDir) {
  const baseName   = path.parse(thumbNameWithBinExt).name;
  const tempThumb  = path.join(outDir, `${baseName}.jpg`);
  const finalThumb = path.join(outDir, thumbNameWithBinExt);
  execSync(
    `ffmpeg -y -i "${videoPath}" -ss 00:00:01 -vframes 1 -vf scale=320:-1 -q:v 5 "${tempThumb}"`,
    { timeout: 15000, stdio: "pipe" }
  );
  fs.renameSync(tempThumb, finalThumb);
  return finalThumb;
}

// ── Xử lý một video ───────────────────────────────────────────────────────────
async function processOneVideo(url, index, total, onLog) {
  const label        = `[${index + 1}/${total}]`;
  const videoFileName = `video_${index}_${Date.now()}.mp4`;
  const tmpPath      = path.join(cacheDir, videoFileName);

  try {
    onLog?.(`${label} Đang tải: ${url}`);
    const videoBuffer = await downloadFile(url, tmpPath);

    const sizeMB = (videoBuffer.length / 1024 / 1024).toFixed(2);
    onLog?.(`${label} Size: ${sizeMB} MB — đang lấy metadata...`);

    const start            = Date.now();
    const meta             = getVideoMetadata(tmpPath);
    const thumbBaseName    = path.parse(videoFileName).name;
    const thumbNameWithBin = `${thumbBaseName}.bin`;
    createThumbnail(tmpPath, thumbNameWithBin, thumbDir);

    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    onLog?.(`${label} ✅ ${meta.width}x${meta.height} | ${meta.duration}s | ${elapsed}s xử lý`);

    return { url, width: meta.width, height: meta.height, duration: meta.duration, thumbnail: thumbNameWithBin };
  } catch (err) {
    onLog?.(`${label} ❌ Lỗi: ${err.message}`);
    return null;
  } finally {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
  }
}

/**
 * Xử lý toàn bộ danh sách link trong gai.json chưa có trong VideoCosplay.json.
 *
 * @param {object}   [opts]
 * @param {number}   [opts.sleepMs=0]      - Thời gian nghỉ giữa mỗi video (ms). 0 = không nghỉ.
 * @param {function} [opts.onLog]          - Callback nhận log string, mặc định console.log.
 * @param {function} [opts.onProgress]     - Callback({ done, total, success, fail }) sau mỗi video.
 * @returns {Promise<{ success: number, fail: number, total: number, saved: number }>}
 */
async function processGaiData({ sleepMs = 0, onLog, onProgress } = {}) {
  const log = onLog || ((msg) => console.log(msg));

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(thumbDir,  { recursive: true });

  if (!fs.existsSync(inputJsonPath)) {
    throw new Error(`Không tìm thấy file: ${inputJsonPath}`);
  }

  const rawList = JSON.parse(fs.readFileSync(inputJsonPath, "utf8"));
  const urlList = rawList.map(item => (typeof item === "string" ? item : item.url)).filter(Boolean);

  let existingData = [];
  try {
    existingData = JSON.parse(fs.readFileSync(outputJsonPath, "utf8"));
    log(`📦 Đã có ${existingData.length} video đã xử lý trước đó.`);
  } catch {
    log("📭 Chưa có file kết quả, sẽ tạo mới.");
  }

  const doneUrls    = new Set(existingData.map(v => v.url));
  const pendingUrls = urlList.filter(u => !doneUrls.has(u));

  if (pendingUrls.length === 0) {
    log("✅ Không có link mới nào cần xử lý.");
    return { success: 0, fail: 0, total: 0, saved: existingData.length };
  }

  log(`🎬 Cần xử lý: ${pendingUrls.length} link mới`);

  let successCount = 0;
  let failCount    = 0;

  for (let i = 0; i < pendingUrls.length; i++) {
    const url       = pendingUrls[i];
    const videoData = await processOneVideo(url, i, pendingUrls.length, log);

    if (videoData) {
      existingData.push(videoData);
      fs.writeFileSync(outputJsonPath, JSON.stringify(existingData, null, 2));
      successCount++;
    } else {
      failCount++;
    }

    onProgress?.({ done: i + 1, total: pendingUrls.length, success: successCount, fail: failCount });

    if (sleepMs > 0 && i < pendingUrls.length - 1) {
      log(`⏸️ Nghỉ ${sleepMs / 1000}s trước link tiếp theo...`);
      await sleep(sleepMs);
    }
  }

  log(`\n✅ Hoàn tất! Thành công: ${successCount} | Lỗi: ${failCount} | Tổng kho: ${existingData.length}`);
  return { success: successCount, fail: failCount, total: pendingUrls.length, saved: existingData.length };
}

module.exports = { processGaiData };

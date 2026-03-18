/**
 * getdata.js
 * Script xử lý danh sách URL video từ JSON → lấy metadata + thumbnail → lưu ra file kết quả.
 * Convert từ GwenDev_ZaloChat (ESM) → CommonJS, tích hợp vào project MiZai.
 *
 * Chạy: node getdata.js
 */

const fs   = require("fs");
const path = require("path");
const axios = require("axios");
const { execSync } = require("child_process");

const inputJsonPath  = path.join(__dirname, "includes", "data", "gai.json");
const outputJsonPath = path.join(__dirname, "includes", "data", "VideoCosplay.json");
const cacheDir       = path.join(__dirname, "includes", "cache", "videos");
const thumbDir       = path.join(__dirname, "includes", "cache", "thumbs");

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ── Download file về disk ──────────────────────────────────────────────────────
async function downloadFile(url, filePath) {
    const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 30000,
        maxContentLength: 200 * 1024 * 1024,
    });
    fs.writeFileSync(filePath, Buffer.from(response.data));
    return response.data;
}

// ── Lấy metadata video (width, height, duration) bằng ffprobe ─────────────────
function getVideoMetadata(filePath) {
    const out = execSync(
        `ffprobe -v error -show_format -show_streams -of json "${filePath}"`,
        { timeout: 15000 }
    ).toString();
    const data        = JSON.parse(out);
    const videoStream = data.streams.find(s => s.codec_type === "video");
    if (!videoStream) throw new Error("Không tìm thấy video stream trong file.");
    return {
        width:    videoStream.width  || 0,
        height:   videoStream.height || 0,
        duration: Math.round(parseFloat(data.format.duration || 0))
    };
}

// ── Tạo thumbnail từ video (lưu dưới dạng .bin) ───────────────────────────────
function createThumbnail(videoPath, thumbNameWithBinExt, outDir) {
    const baseName    = path.parse(thumbNameWithBinExt).name;
    const tempThumb   = path.join(outDir, `${baseName}.jpg`);
    const finalThumb  = path.join(outDir, thumbNameWithBinExt);

    execSync(
        `ffmpeg -y -i "${videoPath}" -ss 00:00:01 -vframes 1 -vf scale=320:-1 -q:v 5 "${tempThumb}"`,
        { timeout: 15000 }
    );
    fs.renameSync(tempThumb, finalThumb);
    return finalThumb;
}

// ── Xử lý một video ───────────────────────────────────────────────────────────
async function processVideo(url, index, total) {
    const percent      = Math.round(((index + 1) / total) * 100);
    const label        = `[${index + 1}/${total}] (${percent}%)`;
    const videoFileName = `video_${index}_${Date.now()}.mp4`;
    const tmpPath      = path.join(cacheDir, videoFileName);

    try {
        console.log(`[GET] - ${label} Download: ${url}`);
        const videoBuffer = await downloadFile(url, tmpPath);

        const sizeMB = (videoBuffer.length / 1024 / 1024).toFixed(2);
        console.log(`[GET] - ${label} Size File: ${sizeMB} MB`);

        const start             = Date.now();
        const meta              = getVideoMetadata(tmpPath);
        const thumbBaseName     = path.parse(videoFileName).name;
        const thumbNameWithBin  = `${thumbBaseName}.bin`;
        createThumbnail(tmpPath, thumbNameWithBin, thumbDir);

        const elapsed = ((Date.now() - start) / 1000).toFixed(2);
        console.log(`⋆──────────────────⋆\n${label} Metadata: ${meta.width}x${meta.height}, Duration: ${meta.duration}s, Thumbnail: ${thumbNameWithBin}, Time Ex: ${elapsed}s`);

        return {
            url,
            width:     meta.width,
            height:    meta.height,
            duration:  meta.duration,
            thumbnail: thumbNameWithBin,
        };
    } catch (err) {
        console.warn(`${label} Lỗi: ${err.message}`);
        return null;
    } finally {
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    try {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.mkdirSync(thumbDir,  { recursive: true });

        if (!fs.existsSync(inputJsonPath)) {
            console.error(`[GET] Không tìm thấy file input: ${inputJsonPath}`);
            console.error(`[GET] Hãy tạo file "${inputJsonPath}" chứa mảng URL video.`);
            process.exit(1);
        }

        const urlList = JSON.parse(fs.readFileSync(inputJsonPath, "utf8"));

        let existingData = [];
        try {
            existingData = JSON.parse(fs.readFileSync(outputJsonPath, "utf8"));
            console.log(`[GET] - Có ${existingData.length} Link Đã Qua Convert Từ File Cũ. Bỏ Qua`);
        } catch {
            console.log("[GET] - Không Có Link Ex Sẵn. Để Gwen Tạo Mới Nè.");
        }

        const doneUrls   = new Set(existingData.map(v => v.url));
        const pendingUrls = urlList.filter(url => !doneUrls.has(url));

        if (pendingUrls.length === 0) {
            console.log("[GET] - Không Có Link Nào Mới ><");
            return;
        }

        console.log(`[GET] - Chuẩn Bị Xử Lý: ${pendingUrls.length} Link Mới\n`);

        for (let i = 0; i < pendingUrls.length; i++) {
            const url       = pendingUrls[i];
            const videoData = await processVideo(url, i, pendingUrls.length);
            if (videoData) {
                existingData.push(videoData);
                fs.writeFileSync(outputJsonPath, JSON.stringify(existingData, null, 2));
            }

            if (i < pendingUrls.length - 1) {
                console.log(`[GET] - Tạm Ngưng 5 Phút Tránh Block 429...`);
                await sleep(300000);
            }
        }

        console.log(`\n[SAVE] Tổng: ${existingData.length} video | Lưu tại: ${outputJsonPath}`);
    } catch (err) {
        console.error("Lỗi nè, xem lại đi:", err);
    }
}

main();

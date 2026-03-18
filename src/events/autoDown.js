/**
 * src/events/autoDown.js
 * Tự động tải media từ link chia sẻ trong chat Zalo.
 * API: yt-dlp-hwys.onrender.com
 */

const axios  = require("axios");
const path   = require("path");
const fs     = require("fs");
const { execSync } = require("child_process");
const { ThreadType } = require("zca-js");
const { sendVideo, sendVoice, tempDir } = require("../../utils/media/media");

const SETTINGS_FILE = path.join(process.cwd(), "includes", "data", "auto.json");

// ─── API endpoints ─────────────────────────────────────────────────────────────
const API_MEDIA = "https://yt-dlp-hwys.onrender.com/api/media";

// ─── Link hỗ trợ ──────────────────────────────────────────────────────────────
const SUPPORTED_LINKS = [
    /tiktok\.com/, /douyin\.com/, /capcut\.com/, /threads\.com/, /threads\.net/,
    /instagram\.com/, /facebook\.com/, /espn\.com/, /pinterest\.com/, /imdb\.com/,
    /imgur\.com/, /ifunny\.co/, /izlesene\.com/, /reddit\.com/, /youtube\.com/,
    /youtu\.be/, /twitter\.com/, /x\.com/, /vimeo\.com/, /snapchat\.com/,
    /bilibili\.com/, /dailymotion\.com/, /sharechat\.com/, /likee\.video/,
    /linkedin\.com/, /tumblr\.com/, /hipi\.co\.in/, /telegram\.org/,
    /getstickerpack\.com/, /bitchute\.com/, /febspot\.com/, /9gag\.com/,
    /ok\.ru/, /rumble\.com/, /streamable\.com/, /ted\.com/, /sohu\.com/,
    /xiaohongshu\.com/, /ixigua\.com/, /weibo\.com/, /vk\.com/, /vk\.ru/,
    /soundcloud\.com/, /mixcloud\.com/, /spotify\.com/, /zingmp3\.vn/, /bandcamp\.com/
];

const AUDIO_SOURCES = new Set([
    "soundcloud", "spotify", "mixcloud", "zingmp3", "bandcamp", "audiomack"
]);

// ─── AutoDown bật/tắt theo nhóm ───────────────────────────────────────────────
function isAutoDownEnabled(threadId) {
    try {
        if (!fs.existsSync(SETTINGS_FILE)) return true;
        const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
        if (data[threadId]?.autodown !== undefined) return data[threadId].autodown !== false;
        if (data["__global"]?.autodown !== undefined) return data["__global"].autodown !== false;
        return true;
    } catch { return true; }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
async function downloadFile(url, filePath) {
    const res = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 120000,
        maxContentLength: 500 * 1024 * 1024,
        headers: { "User-Agent": "Mozilla/5.0" }
    });
    fs.writeFileSync(filePath, Buffer.from(res.data));
}

function getVideoMetadata(filePath) {
    try {
        const out = execSync(
            `ffprobe -v error -show_format -show_streams -of json "${filePath}"`,
            { timeout: 15000 }
        ).toString();
        const data = JSON.parse(out);
        const vs = data.streams?.find(s => s.codec_type === "video");
        return {
            width:    vs?.width    || 720,
            height:   vs?.height   || 1280,
            duration: Math.round(parseFloat(data.format?.duration || 0))
        };
    } catch { return { width: 720, height: 1280, duration: 0 }; }
}

function convertToAac(inputPath, outputPath) {
    execSync(`ffmpeg -y -i "${inputPath}" -acodec aac "${outputPath}"`, { timeout: 60000 });
}

function cleanupFiles(files, delay = 8000) {
    setTimeout(() => {
        files.forEach(file => {
            try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
        });
    }, delay);
}

// ─── Lấy media info từ API ────────────────────────────────────────────────────
async function getMediaInfo(url) {
    const res  = await axios.get(`${API_MEDIA}?url=${encodeURIComponent(url)}`, { timeout: 90000 });
    const raw  = res.data;
    if (!raw || typeof raw !== "object") throw new Error("API không trả về dữ liệu hợp lệ");

    const medias = [];
    if (raw.download_url)       medias.push({ type: "video", url: raw.download_url });
    if (raw.download_audio_url) medias.push({ type: "audio", url: raw.download_audio_url });

    if (medias.length === 0) throw new Error("API không trả về media hợp lệ");

    return {
        title:     raw.title     || "",
        author:    raw.uploader  || raw.channel || "Unknown",
        source:    (raw.platform || "").toLowerCase(),
        thumbnail: raw.thumbnail || "",
        duration:  raw.duration  || 0,
        medias
    };
}

// ─── Gửi audio ────────────────────────────────────────────────────────────────
async function handleAudio(api, audioUrl, thumbnail, caption, threadId, threadType, cacheDir) {
    const tempPath = path.join(cacheDir, `ad_audio_${Date.now()}`);
    const aacPath  = `${tempPath}.aac`;
    const attachments = [];

    try {
        await downloadFile(audioUrl, tempPath);
        convertToAac(tempPath, aacPath);

        if (thumbnail) {
            try {
                const imgPath = path.join(cacheDir, `ad_thumb_${Date.now()}.jpg`);
                await downloadFile(thumbnail, imgPath);
                attachments.push(imgPath);
            } catch {}
        }

        await api.sendMessage({ msg: caption, attachments, ttl: 500_000 }, threadId, threadType);
        await sendVoice(api, aacPath, threadId, threadType);
    } finally {
        cleanupFiles([tempPath, aacPath, ...attachments]);
    }
}

// ─── Gửi video ────────────────────────────────────────────────────────────────
async function handleVideo(api, videoUrl, thumbnail, caption, threadId, threadType, cacheDir, duration) {
    const tmpPath = path.join(cacheDir, `ad_vid_${Date.now()}.mp4`);

    try {
        await downloadFile(videoUrl, tmpPath);
        const meta = getVideoMetadata(tmpPath);

        await sendVideo(api, tmpPath, threadId, threadType, {
            msg: caption,
            thumbnailUrl: thumbnail || "",
            width: meta.width,
            height: meta.height,
            duration: (duration || meta.duration) * 1000
        });
    } catch (err) {
        logWarn(`[AutoDown] Gửi video lỗi, thử gửi trực tiếp: ${err.message}`);
        try {
            await api.sendVideo({
                videoUrl,
                thumbnailUrl: thumbnail || "",
                msg: caption,
                width: 720, height: 1280,
                duration: (duration || 0) * 1000,
                ttl: 500_000
            }, threadId, threadType);
        } catch (err2) {
            logWarn(`[AutoDown] Gửi trực tiếp cũng thất bại: ${err2.message}`);
        }
    } finally {
        cleanupFiles([tmpPath], 0);
    }
}

// ─── Gửi ảnh slideshow (TikTok images) ───────────────────────────────────────
async function handleImages(api, medias, caption, threadId, threadType, cacheDir) {
    const imagePaths = [];

    try {
        for (const m of medias.filter(m => m.type === "image").slice(0, 10)) {
            const imgPath = path.join(cacheDir, `ad_img_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
            await downloadFile(m.url, imgPath);
            imagePaths.push(imgPath);
        }

        if (!imagePaths.length) return;

        await api.sendMessage({ msg: caption, attachments: imagePaths, ttl: 500_000 }, threadId, threadType);
    } finally {
        cleanupFiles(imagePaths);
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function startAutoDown(api) {

    api.listener.on("message", async (msg) => {
        const threadId   = msg.threadId;
        const threadType = msg.type;

        const content  = typeof msg.data?.content === "string" ? msg.data.content.trim() : "";
        const href     = typeof msg.data?.content?.href === "string" ? msg.data.content.href.trim() : "";
        const title    = typeof msg.data?.content?.title === "string" ? msg.data.content.title.trim() : "";
        const bodyText = typeof msg.message?.body === "string" ? msg.message.body.trim() : "";
        const body     = content || bodyText || href || title;

        if (!body || !/^https?:\/\/\S+/.test(body)) return;
        if (!SUPPORTED_LINKS.some(rx => rx.test(body))) return;
        if (!isAutoDownEnabled(threadId)) return;

        logInfo(`[AutoDown] Link: ${body}`);

        try {
            const data = await getMediaInfo(body);

            const mediaTitle = data.title?.trim() || "Downloaded Content";
            const author     = data.author || data.unique_id || "Unknown";
            const source     = (data.source || "").toLowerCase();
            const thumbnail  = data.thumbnail || "";
            const duration   = data.duration  || 0;
            const platform   = source.toUpperCase() || "MEDIA";

            fs.mkdirSync(tempDir, { recursive: true });

            const caption = `/-li 𝐀𝐮𝐭𝐨𝐃𝐨𝐰𝐧: ${platform}\n📄 ${mediaTitle}\n👤 ${author}`;

            // ── Audio platforms ──────────────────────────────────────────────
            if (AUDIO_SOURCES.has(source)) {
                const audio = data.medias.find(m => m.type === "audio");
                if (!audio?.url) { logWarn("[AutoDown] Không có audio URL."); return; }
                await handleAudio(api, audio.url, thumbnail, caption, threadId, threadType, tempDir);
                return;
            }

            // ── TikTok / Douyin (có thể là slideshow ảnh) ───────────────────
            if (source === "tiktok" || source === "douyin" || /(?:vm\.)?tiktok\.com|douyin\.com/.test(body)) {
                const hasVideo = data.medias.some(m => m.type === "video");

                if (!hasVideo) {
                    await handleImages(api, data.medias, caption, threadId, threadType, tempDir);
                } else {
                    const video = data.medias.find(m => m.type === "video");
                    if (video?.url) await handleVideo(api, video.url, thumbnail, caption, threadId, threadType, tempDir, duration);
                }
                return;
            }

            // ── Video platforms (YouTube, Facebook, Instagram, ...) ──────────
            const video = data.medias.find(m => m.type === "video");
            if (video?.url) {
                await handleVideo(api, video.url, thumbnail, caption, threadId, threadType, tempDir, duration);
                return;
            }

            // ── Fallback: audio nếu không có video ───────────────────────────
            const audio = data.medias.find(m => m.type === "audio");
            if (audio?.url) {
                await handleAudio(api, audio.url, thumbnail, caption, threadId, threadType, tempDir);
                return;
            }

            // ── Fallback: ảnh ─────────────────────────────────────────────────
            const images = data.medias.filter(m => m.type === "image");
            if (images.length) {
                await handleImages(api, data.medias, caption, threadId, threadType, tempDir);
                return;
            }

            logWarn("[AutoDown] Không tìm được media phù hợp trong kết quả API.");

        } catch (err) {
            logWarn(`[AutoDown] Lỗi: ${err.message}`);
        }
    });
}

module.exports = { startAutoDown };

/**
 * includes/auto/autoDown.js
 * Tự động tải media từ link chia sẻ trong chat Zalo.
 * Sử dụng API: https://yt-dlp-hwys.onrender.com
 */

const axios  = require("axios");
const path   = require("path");
const fs     = require("fs");
const { execSync } = require("child_process");
const { ThreadType } = require("zca-js");
const { sendVideo, sendVoice, tempDir } = require("../../utils/media/upload");

const SETTINGS_FILE = path.join(process.cwd(), "includes", "data", "settings.json");
const YTDLP_API     = "https://yt-dlp-hwys.onrender.com";

// ============== LINK ==============//
const SUPPORTED_LINKS = [
    /tiktok\.com/, /douyin\.com/, /capcut\.com/, /threads\.com/, /threads\.net/,
    /instagram\.com/, /facebook\.com/, /espn\.com/, /pinterest\.com/, /imdb\.com/,
    /imgur\.com/, /ifunny\.co/, /izlesene\.com/, /reddit\.com/, /youtube\.com/,
    /youtu\.be/, /twitter\.com/, /x\.com/, /vimeo\.com/, /snapchat\.com/,
    /bilibili\.com/, /dailymotion\.com/, /sharechat\.com/, /likee\.video/,
    /linkedin\.com/, /tumblr\.com/, /hipi\.co\.in/, /telegram\.org/,
    /getstickerpack\.com/, /bitchute\.com/, /febspot\.com/, /9gag\.com/,
    /ok\.ru/, /rumble\.com/, /streamable\.com/, /ted\.com/, /sohu\.com/,
    /xiaohongshu\.com/, /ixigua\.com/, /weibo\.com/,
    /vk\.com/, /vk\.ru/, /soundcloud\.com/,
    /mixcloud\.com/, /spotify\.com/, /zingmp3\.vn/, /bandcamp\.com/
];

const AUDIO_ONLY_PLATFORMS = new Set([
    "soundcloud", "spotify", "mixcloud", "zingmp3", "bandcamp", "audiomack"
]);

// ============== CHECK ON ==============//
function isAutoDownEnabled(threadId) {
    try {
        if (!fs.existsSync(SETTINGS_FILE)) return true;
        const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
        if (data[threadId] && data[threadId].autodown !== undefined) {
            return data[threadId].autodown !== false;
        }
        if (data["__global"] && data["__global"].autodown !== undefined) {
            return data["__global"].autodown !== false;
        }
        return true;
    } catch {
        return true;
    }
}

// ============== HELPERS ==============//
async function downloadFile(url, filePath) {
    const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 120000,
        maxContentLength: 500 * 1024 * 1024,
        headers: { "User-Agent": "Mozilla/5.0" }
    });
    fs.writeFileSync(filePath, Buffer.from(response.data));
}

function getVideoMetadata(filePath) {
    try {
        const out = execSync(
            `ffprobe -v error -show_format -show_streams -of json "${filePath}"`,
            { timeout: 15000 }
        ).toString();
        const data = JSON.parse(out);
        const videoStream = data.streams.find(s => s.codec_type === "video");
        return {
            width: videoStream?.width || 720,
            height: videoStream?.height || 1280,
            duration: Math.round(parseFloat(data.format?.duration || 0))
        };
    } catch {
        return { width: 720, height: 1280, duration: 0 };
    }
}

function convertToAac(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        try {
            execSync(`ffmpeg -y -i "${inputPath}" -acodec aac "${outputPath}"`, { timeout: 60000 });
            resolve();
        } catch (e) { reject(e); }
    });
}

function cleanupFiles(files, delay = 8000) {
    setTimeout(() => {
        files.forEach(file => {
            try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
        });
    }, delay);
}

// ============== YT-DLP API ==============//
async function getMediaInfo(url) {
    const apiUrl = `${YTDLP_API}/api/media?url=${encodeURIComponent(url)}`;
    const res = await axios.get(apiUrl, { timeout: 60000 });
    const data = res.data;
    if (data?.error) throw new Error(data.details || data.error);
    return data;
}

// ============== START ==============//
function startAutoDown(api) {
    logInfo("[AutoDown] Đã khởi động. (Powered by yt-dlp API)");

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

        logInfo(`[AutoDown] Phát hiện link: ${body}`);

        try {
            let finalUrl = body;
            try {
                const headRes = await axios.get(body, {
                    maxRedirects: 10,
                    timeout: 15000,
                    validateStatus: () => true,
                });
                if (headRes.request?.res?.responseUrl) finalUrl = headRes.request.res.responseUrl;
                else if (headRes.request?.responseURL) finalUrl = headRes.request.responseURL;
            } catch {}

            logInfo(`[AutoDown] URL thật: ${finalUrl}`);

            const data = await getMediaInfo(finalUrl);

            const mediaTitle = data.title?.trim() || "Downloaded Content";
            const author     = data.uploader || "Unknown";
            const platform   = (data.platform || "Unknown").toUpperCase();
            const thumbnail  = data.thumbnail || "";
            const duration   = data.duration || 0;

            fs.mkdirSync(tempDir, { recursive: true });

            const platformLower = (data.platform || "").toLowerCase();
            const isAudioOnly   = AUDIO_ONLY_PLATFORMS.has(platformLower);

            const caption = `/-li 𝐀𝐮𝐭𝐨𝐃𝐨𝐰𝐧: 𝐏𝐥𝐚𝐭𝐟𝐨𝐫𝐦: ${platform}\n📄 ${mediaTitle}\n👤 ${author}`;

            if (isAudioOnly) {
                // ── Xử lý audio (SoundCloud, Spotify, ...) ──────────────────
                const audioDownloadUrl = data.download_audio_url;
                if (!audioDownloadUrl) {
                    logWarn("[AutoDown] Không có audio URL.");
                    return;
                }

                const tempPath = path.join(tempDir, `audio_${Date.now()}`);
                const aacPath  = `${tempPath}.aac`;
                const attachments = [];

                try {
                    await downloadFile(audioDownloadUrl, tempPath);
                    await convertToAac(tempPath, aacPath);

                    if (thumbnail) {
                        try {
                            const imgPath = path.join(tempDir, `thumb_${Date.now()}.jpg`);
                            await downloadFile(thumbnail, imgPath);
                            attachments.push(imgPath);
                        } catch {}
                    }

                    await api.sendMessage({
                        msg: caption,
                        attachments,
                        ttl: 500_000
                    }, threadId, threadType);

                    await sendVoice(api, aacPath, threadId, threadType);
                } catch (err) {
                    logWarn(`[AutoDown] Lỗi audio: ${err.message}`);
                } finally {
                    cleanupFiles([tempPath, aacPath, ...attachments]);
                }

            } else {
                // ── Xử lý video ─────────────────────────────────────────────
                const videoDownloadUrl = data.download_url;
                if (!videoDownloadUrl) {
                    logWarn("[AutoDown] Không có video URL.");
                    return;
                }

                const tmpPath = path.join(tempDir, `vid_${Date.now()}.mp4`);
                let width = 720, height = 1280;

                try {
                    await downloadFile(videoDownloadUrl, tmpPath);
                    const meta = getVideoMetadata(tmpPath);
                    width = meta.width; height = meta.height;

                    await sendVideo(api, tmpPath, threadId, threadType, {
                        msg: caption,
                        thumbnailUrl: thumbnail,
                        width, height,
                        duration: duration * 1000
                    });
                } catch (err) {
                    logWarn(`[AutoDown] Lỗi video: ${err.message}`);

                    // Thử gửi qua videoUrl trực tiếp nếu tải file thất bại
                    try {
                        await api.sendVideo({
                            videoUrl: videoDownloadUrl,
                            thumbnailUrl: thumbnail,
                            msg: caption,
                            width, height,
                            duration: duration * 1000,
                            ttl: 500_000
                        }, threadId, threadType);
                    } catch (err2) {
                        logWarn(`[AutoDown] Gửi trực tiếp cũng thất bại: ${err2.message}`);
                    }
                } finally {
                    cleanupFiles([tmpPath], 0);
                }
            }

        } catch (err) {
            logWarn(`[AutoDown] Lỗi xử lý: ${err.message}`);
        }
    });
}

module.exports = { startAutoDown };

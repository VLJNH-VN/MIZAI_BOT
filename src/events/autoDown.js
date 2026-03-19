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
const tempDir = path.join(process.cwd(), "includes", "cache");

const SETTINGS_FILE = path.join(process.cwd(), "includes", "data", "auto.json");

// ─── API endpoints ─────────────────────────────────────────────────────────────
// /api/media  → trả JSON: title, thumbnail, download_url (video), download_audio_url (audio)
// /api/download → stream file binary (được gọi qua URL trả về từ /api/media)
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
        headers: { "User-Agent": global.userAgent }
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
        const rawDur = parseFloat(data.format?.duration || 0);
        return {
            width:    vs?.width    || 720,
            height:   vs?.height   || 1280,
            duration: rawDur > 0 ? Math.max(1, Math.ceil(rawDur)) : 1
        };
    } catch { return { width: 720, height: 1280, duration: 1 }; }
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

// ─── Lấy media info từ /api/media (có retry) ─────────────────────────────────
// Trả về: title, author, source, thumbnail, duration, medias[]
// medias[].type = "video" | "audio" | "image"
// medias[].url  = URL download binary (trỏ đến /api/download)
async function getMediaInfo(url, retries = 2) {
    let lastErr;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await axios.get(`${API_MEDIA}?url=${encodeURIComponent(url)}`, { timeout: 90000 });
            const raw = res.data;
            if (!raw || typeof raw !== "object") throw new Error("API không trả về dữ liệu hợp lệ");

            const medias = [];
            if (raw.download_url)       medias.push({ type: "video", url: raw.download_url });
            if (raw.download_audio_url) medias.push({ type: "audio", url: raw.download_audio_url });

            // slideshow ảnh (TikTok image posts)
            if (Array.isArray(raw.images)) {
                raw.images.forEach(imgUrl => {
                    if (imgUrl) medias.push({ type: "image", url: imgUrl });
                });
            }

            if (medias.length === 0) throw new Error("API không trả về media hợp lệ");

            return {
                title:     raw.title     || "",
                author:    raw.uploader  || raw.channel || "Unknown",
                source:    (raw.platform || "").toLowerCase(),
                thumbnail: raw.thumbnail || "",
                duration:  raw.duration  || 0,
                medias
            };
        } catch (err) {
            lastErr = err;
            const status = err?.response?.status;
            if (status && status < 500) break;
            if (attempt < retries) {
                logWarn(`[AutoDown] Lần thử ${attempt} thất bại (${err.message}), thử lại...`);
                await new Promise(r => setTimeout(r, 3000 * attempt));
            }
        }
    }
    throw lastErr;
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

        const voiceUploaded = await api.uploadAttachment([aacPath], threadId, threadType);
        const voiceUrl = voiceUploaded?.[0]?.fileUrl;
        if (voiceUrl) {
          await api.sendVoice({ voiceUrl, ttl: 500_000 }, threadId, threadType);
        }
    } finally {
        cleanupFiles([tempPath, aacPath, ...attachments]);
    }
}

// ─── Convert video sang H.264 MP4 (tương thích Zalo) ─────────────────────────
// - map video trước audio (tránh lỗi stream order ngược)
// - pix_fmt yuv420p: tương thích rộng nhất
// - profile baseline / level 3.1: đảm bảo Zalo decode được
// - movflags +faststart: moov atom ở đầu (cần thiết cho streaming)
// - scale: đảm bảo width/height chia hết cho 2 (libx264 yêu cầu)
function convertToH264(inputPath, outputPath) {
    // Kiểm tra xem file có audio stream không
    let hasAudio = false;
    try {
        const probe = execSync(
            `ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "${inputPath}"`,
            { timeout: 10000, stdio: "pipe" }
        ).toString().trim();
        hasAudio = probe.length > 0;
    } catch {}

    const audioMap  = hasAudio ? `-map 0:a:0 -c:a aac -b:a 128k -ar 44100 ` : `-an `;
    execSync(
        `ffmpeg -y -i "${inputPath}" ` +
        `-map 0:v:0 ${audioMap}` +
        `-c:v libx264 -preset fast -crf 23 ` +
        `-profile:v baseline -level 3.1 ` +
        `-pix_fmt yuv420p ` +
        `-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" ` +
        `-movflags +faststart ` +
        `"${outputPath}"`,
        { timeout: 120000, stdio: "pipe" }
    );
}

// ─── Gửi video ────────────────────────────────────────────────────────────────
async function handleVideo(api, videoUrl, thumbnail, caption, threadId, threadType, cacheDir, duration) {
    const rawPath = path.join(cacheDir, `ad_raw_${Date.now()}.mp4`);
    const tmpPath = path.join(cacheDir, `ad_vid_${Date.now()}.mp4`);

    try {
        await downloadFile(videoUrl, rawPath);

        // Convert sang H.264
        let uploadPath = rawPath;
        try {
            convertToH264(rawPath, tmpPath);
            if (fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 0) {
                uploadPath = tmpPath;
            }
        } catch (convErr) {
            logWarn(`[AutoDown] Convert H.264 lỗi, dùng file gốc: ${convErr.message}`);
        }

        const meta     = getVideoMetadata(uploadPath);
        const fileSize = fs.statSync(uploadPath).size;

        // ── Bước 1: Thử gửi qua uploadAttachment + sendVideo ─────────────────
        try {
            const uploaded = await api.uploadAttachment([uploadPath], threadId, threadType);
            const vidUrl   = uploaded?.[0]?.fileUrl;
            if (!vidUrl) throw new Error("uploadAttachment không trả về fileUrl");
            await api.sendVideo({
                videoUrl:     vidUrl,
                thumbnailUrl: thumbnail || "",
                msg:          caption,
                width:        meta.width,
                height:       meta.height,
                duration:     Math.max(1000, (duration || meta.duration || 1) * 1000),
                ttl:          500_000,
            }, threadId, threadType);
            return;
        } catch (e1) {
            logWarn(`[AutoDown] uploadAttachment thất bại: ${e1.message}`);
        }

        // ── Bước 2: Thử sendMessage với attachments (cách đơn giản hơn) ──────
        try {
            await api.sendMessage(
                { msg: caption, attachments: [uploadPath], ttl: 500_000 },
                threadId, threadType
            );
            return;
        } catch (e2) {
            logWarn(`[AutoDown] sendMessage+attachment thất bại: ${e2.message}`);
        }

        // ── Bước 3: Thử GitHub upload lấy raw URL (chỉ nếu file < 24MB) ──────
        if (fileSize < 24 * 1024 * 1024 && global.githubUpload) {
            try {
                const ghUrl = await global.githubUpload(
                    uploadPath,
                    `videos/ad_${Date.now()}.mp4`
                );
                if (ghUrl) {
                    const rawUrl = ghUrl
                        .replace("https://github.com/", "https://raw.githubusercontent.com/")
                        .replace("/blob/", "/");
                    await api.sendVideo({
                        videoUrl:     rawUrl,
                        thumbnailUrl: thumbnail || "",
                        msg:          caption,
                        width:        meta.width,
                        height:       meta.height,
                        duration:     Math.max(1000, (duration || meta.duration || 1) * 1000),
                        ttl:          500_000,
                    }, threadId, threadType);
                    return;
                }
            } catch (e3) {
                logWarn(`[AutoDown] GitHub upload thất bại: ${e3.message}`);
            }
        }

        // ── Bước 4: Gửi URL gốc trực tiếp ────────────────────────────────────
        try {
            await api.sendVideo({
                videoUrl,
                thumbnailUrl: thumbnail || "",
                msg: caption,
                width: 720, height: 1280,
                duration: Math.max(1000, (duration || 1) * 1000),
                ttl: 500_000
            }, threadId, threadType);
            return;
        } catch (e4) {
            logWarn(`[AutoDown] sendVideo URL gốc thất bại: ${e4.message}`);
        }

        // ── Bước 5: Fallback cuối — gửi link text ────────────────────────────
        await api.sendMessage(
            { msg: `${caption}\n\n🔗 Link video:\n${videoUrl}` },
            threadId, threadType
        );

    } finally {
        cleanupFiles([rawPath, tmpPath], 0);
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

        // ── Bỏ qua tin nhắn do chính bot gửi (tránh vòng lặp) ──────────────
        const botId    = global.botId ? String(global.botId) : null;
        const senderId = msg.data?.uidFrom ? String(msg.data.uidFrom) : null;
        if (botId && senderId && senderId === botId) return;

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
            const author     = data.author || "Unknown";
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
            const status = err?.response?.status;
            logWarn(`[AutoDown] Lỗi: ${err.message}`);
            try {
                let msg;
                if (status === 500 || status === 502 || status === 503) {
                    msg = `⚠️ AutoDown: Không thể tải media từ link này (máy chủ phản hồi lỗi ${status}). Vui lòng thử lại sau.`;
                } else if (status === 404) {
                    msg = `⚠️ AutoDown: Không tìm thấy media tại link này.`;
                } else {
                    msg = `⚠️ AutoDown: Không thể tải media — ${err.message}`;
                }
                await api.sendMessage({ msg, ttl: 300_000 }, threadId, threadType);
            } catch {}
        }
    });
}

module.exports = { startAutoDown };

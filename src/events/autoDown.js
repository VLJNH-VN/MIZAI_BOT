/**
 * src/events/autoDown.js
 * Tự động tải media từ link chia sẻ trong chat Zalo.
 *
 * API: https://yt-dlp-hwys.onrender.com
 *   GET /api/media?url=<url>
 *     → JSON: { title, uploader, platform, thumbnail, duration, webpage_url,
 *               formats[], download_audio_url }
 *       formats[].format_id: "no_watermark" | "watermark" | "audio" | ...
 *       formats[].quality:   "video+audio" | "audio" | "image"
 *
 *   GET /api/download?url=<webpage_url>&format=<format_id>
 *     → stream file binary (video/mp4, audio/mpeg, image/jpeg, ...)
 *
 * NOTE: download_url trong response /api/media bị lỗi (trả audio thay vì video).
 *       Phải tự build URL download từ webpage_url + format_id.
 */

const axios        = require("axios");
const path         = require("path");
const fs           = require("fs");
const { execSync } = require("child_process");
const tempDir      = path.join(process.cwd(), "includes", "cache");
const SETTINGS_FILE = path.join(process.cwd(), "includes", "data", "auto.json");

const API_BASE = "https://yt-dlp-hwys.onrender.com";

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

const AUDIO_ONLY_SOURCES = new Set([
    "soundcloud", "spotify", "mixcloud", "zingmp3", "bandcamp", "audiomack"
]);

// ─── Settings ─────────────────────────────────────────────────────────────────
function isAutoDownEnabled(threadId) {
    try {
        if (!fs.existsSync(SETTINGS_FILE)) return true;
        const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
        if (data[threadId]?.autodown !== undefined) return data[threadId].autodown !== false;
        if (data["__global"]?.autodown !== undefined) return data["__global"].autodown !== false;
        return true;
    } catch { return true; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function downloadFile(url, filePath) {
    const res = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 120000,
        maxContentLength: 500 * 1024 * 1024,
        headers: { "User-Agent": global.userAgent || "Mozilla/5.0" }
    });
    fs.writeFileSync(filePath, Buffer.from(res.data));
    return res.headers["content-type"] || "";
}

function probeStreams(filePath) {
    try {
        const out = execSync(
            `ffprobe -v error -show_format -show_streams -of json "${filePath}"`,
            { timeout: 15000, stdio: "pipe" }
        ).toString();
        const data = JSON.parse(out);
        const hasVideo = data.streams?.some(s => s.codec_type === "video") || false;
        const hasAudio = data.streams?.some(s => s.codec_type === "audio") || false;
        const vs = data.streams?.find(s => s.codec_type === "video");
        const dur = parseFloat(data.format?.duration || 0);
        return {
            hasVideo, hasAudio,
            width:    vs?.width    || 720,
            height:   vs?.height   || 1280,
            duration: dur > 0 ? Math.max(1, Math.ceil(dur)) : 1
        };
    } catch {
        return { hasVideo: false, hasAudio: false, width: 720, height: 1280, duration: 1 };
    }
}

function convertToH264(inputPath, outputPath) {
    const info = probeStreams(inputPath);
    const audioArgs = info.hasAudio
        ? `-map 0:a:0 -c:a aac -b:a 128k -ar 44100`
        : `-an`;
    execSync(
        `ffmpeg -y -i "${inputPath}" ` +
        `-map 0:v:0 ${audioArgs} ` +
        `-c:v libx264 -preset fast -crf 23 ` +
        `-profile:v baseline -level 3.1 ` +
        `-pix_fmt yuv420p ` +
        `-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" ` +
        `-movflags +faststart ` +
        `"${outputPath}"`,
        { timeout: 180000, stdio: "pipe" }
    );
}

function convertToAac(inputPath, outputPath) {
    execSync(`ffmpeg -y -i "${inputPath}" -vn -c:a aac -b:a 128k "${outputPath}"`,
        { timeout: 60000, stdio: "pipe" });
}

function cleanup(...files) {
    setTimeout(() => {
        files.forEach(f => {
            try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
        });
    }, 8000);
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function fetchMediaInfo(url, retries = 2) {
    let lastErr;
    for (let i = 1; i <= retries; i++) {
        try {
            const res = await axios.get(
                `${API_BASE}/api/media?url=${encodeURIComponent(url)}`,
                { timeout: 90000 }
            );
            const d = res.data;
            if (!d || typeof d !== "object") throw new Error("Dữ liệu API không hợp lệ");
            return d;
        } catch (err) {
            lastErr = err;
            const status = err?.response?.status;
            if (status && status < 500) break;
            if (i < retries) {
                logWarn(`[AutoDown] Thử lại lần ${i} (${err.message})...`);
                await new Promise(r => setTimeout(r, 4000 * i));
            }
        }
    }
    throw lastErr;
}

function buildDownloadUrl(webpageUrl, formatId) {
    return `${API_BASE}/api/download?url=${encodeURIComponent(webpageUrl)}&format=${encodeURIComponent(formatId)}`;
}

// ─── Gửi VIDEO ────────────────────────────────────────────────────────────────
async function sendVideo(api, videoDownloadUrl, info, caption, threadId, threadType) {
    const rawPath = path.join(tempDir, `ad_raw_${Date.now()}.mp4`);
    const h264Path = path.join(tempDir, `ad_h264_${Date.now()}.mp4`);

    try {
        logInfo(`[AutoDown] Tải video...`);
        await downloadFile(videoDownloadUrl, rawPath);

        const raw = probeStreams(rawPath);
        if (!raw.hasVideo) {
            logWarn("[AutoDown] File tải về không có stream video, chuyển sang audio.");
            await sendAudio(api, videoDownloadUrl, info, caption, threadId, threadType);
            return;
        }

        logInfo(`[AutoDown] Convert H.264...`);
        let uploadPath = rawPath;
        try {
            convertToH264(rawPath, h264Path);
            if (fs.existsSync(h264Path) && fs.statSync(h264Path).size > 0) {
                uploadPath = h264Path;
            }
        } catch (convErr) {
            logWarn(`[AutoDown] Convert H.264 lỗi, dùng file gốc: ${convErr.message}`);
        }

        const meta = probeStreams(uploadPath);
        const dur  = Math.max(1000, (info.duration || meta.duration || 1) * 1000);

        // Bước 1: uploadAttachment + sendVideo
        try {
            const uploaded = await api.uploadAttachment([uploadPath], threadId, threadType);
            const vidUrl = uploaded?.[0]?.fileUrl;
            if (!vidUrl) throw new Error("Không có fileUrl");
            await api.sendVideo({
                videoUrl:     vidUrl,
                thumbnailUrl: info.thumbnail || "",
                msg:          caption,
                width:        meta.width,
                height:       meta.height,
                duration:     dur,
                ttl:          500_000,
            }, threadId, threadType);
            return;
        } catch (e1) {
            logWarn(`[AutoDown] sendVideo step1 thất bại: ${e1.message}`);
        }

        // Bước 2: sendMessage + attachment
        try {
            await api.sendMessage(
                { msg: caption, attachments: [uploadPath], ttl: 500_000 },
                threadId, threadType
            );
            return;
        } catch (e2) {
            logWarn(`[AutoDown] sendVideo step2 thất bại: ${e2.message}`);
        }

        // Bước 3: Gửi link text fallback
        await api.sendMessage(
            { msg: `${caption}\n\n🔗 ${videoDownloadUrl}`, ttl: 300_000 },
            threadId, threadType
        );

    } finally {
        cleanup(rawPath, h264Path);
    }
}

// ─── Gửi AUDIO ────────────────────────────────────────────────────────────────
async function sendAudio(api, audioDownloadUrl, info, caption, threadId, threadType) {
    const rawPath = path.join(tempDir, `ad_aud_${Date.now()}`);
    const aacPath = `${rawPath}.aac`;
    const attachments = [];

    try {
        logInfo(`[AutoDown] Tải audio...`);
        await downloadFile(audioDownloadUrl, rawPath);
        convertToAac(rawPath, aacPath);

        // Gửi thumbnail kèm caption
        if (info.thumbnail) {
            try {
                const imgPath = path.join(tempDir, `ad_thumb_${Date.now()}.jpg`);
                await downloadFile(info.thumbnail, imgPath);
                attachments.push(imgPath);
            } catch {}
        }
        await api.sendMessage({ msg: caption, attachments, ttl: 500_000 }, threadId, threadType);

        // Gửi voice
        const uploaded = await api.uploadAttachment([aacPath], threadId, threadType);
        const voiceUrl = uploaded?.[0]?.fileUrl;
        if (voiceUrl) {
            await api.sendVoice({ voiceUrl, ttl: 500_000 }, threadId, threadType);
        }
    } finally {
        cleanup(rawPath, aacPath, ...attachments);
    }
}

// ─── Gửi ẢNH (slideshow) ──────────────────────────────────────────────────────
async function sendImages(api, imageUrls, caption, threadId, threadType) {
    const paths = [];
    try {
        for (const url of imageUrls.slice(0, 10)) {
            const p = path.join(tempDir, `ad_img_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
            await downloadFile(url, p);
            paths.push(p);
        }
        if (!paths.length) return;
        await api.sendMessage({ msg: caption, attachments: paths, ttl: 500_000 }, threadId, threadType);
    } finally {
        cleanup(...paths);
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function startAutoDown(api) {
    api.listener.on("message", async (msg) => {
        const threadId   = msg.threadId;
        const threadType = msg.type;

        // Bỏ qua tin của chính bot
        const botId    = global.botId ? String(global.botId) : null;
        const senderId = msg.data?.uidFrom ? String(msg.data.uidFrom) : null;
        if (botId && senderId && senderId === botId) return;

        const content  = typeof msg.data?.content === "string" ? msg.data.content.trim() : "";
        const href     = typeof msg.data?.content?.href === "string" ? msg.data.content.href.trim() : "";
        const bodyText = typeof msg.message?.body === "string" ? msg.message.body.trim() : "";
        const body     = content || bodyText || href;

        if (!body || !/^https?:\/\/\S+/.test(body)) return;
        if (!SUPPORTED_LINKS.some(rx => rx.test(body))) return;
        if (!isAutoDownEnabled(threadId)) return;

        logInfo(`[AutoDown] Link: ${body}`);

        try {
            fs.mkdirSync(tempDir, { recursive: true });

            const d = await fetchMediaInfo(body);

            const title     = d.title?.trim()   || "Media";
            const author    = d.uploader        || d.channel || "Unknown";
            const platform  = (d.platform       || "MEDIA").toUpperCase();
            const thumbnail = d.thumbnail       || "";
            const duration  = d.duration        || 0;
            const pageUrl   = d.webpage_url     || body;
            const formats   = Array.isArray(d.formats) ? d.formats : [];

            const caption = `/-li 𝐀𝐮𝐭𝐨𝐃𝐨𝐰𝐧: ${platform}\n📄 ${title}\n👤 ${author}`;

            const hasVideoFmt = formats.some(f => f.quality === "video+audio" || (f.vcodec && f.vcodec !== "none" && f.vcodec !== null));
            const hasAudioFmt = formats.some(f => f.quality === "audio" || f.format_id === "audio");
            const hasImageFmt = formats.some(f => f.quality === "image" || f.ext === "jpg" || f.ext === "png");

            const source = (d.platform || "").toLowerCase();

            // ── Audio-only platforms ──────────────────────────────────────────
            if (AUDIO_ONLY_SOURCES.has(source)) {
                const audioUrl = d.download_audio_url || buildDownloadUrl(pageUrl, "audio");
                await sendAudio(api, audioUrl, { thumbnail, duration }, caption, threadId, threadType);
                return;
            }

            // ── Slideshow ảnh (TikTok photo posts) ───────────────────────────
            if (hasImageFmt && !hasVideoFmt) {
                const imageUrls = formats
                    .filter(f => f.quality === "image" || f.ext === "jpg" || f.ext === "png")
                    .map(f => f.url || f.download_url)
                    .filter(Boolean);

                if (Array.isArray(d.images) && d.images.length) {
                    await sendImages(api, d.images, caption, threadId, threadType);
                } else if (imageUrls.length) {
                    await sendImages(api, imageUrls, caption, threadId, threadType);
                } else {
                    await api.sendMessage({ msg: `${caption}\n⚠️ Không tải được ảnh.`, ttl: 300_000 }, threadId, threadType);
                }
                return;
            }

            // ── Video ─────────────────────────────────────────────────────────
            if (hasVideoFmt) {
                // Ưu tiên format no_watermark, fallback về format đầu tiên có video
                const videoFmt = formats.find(f => f.format_id === "no_watermark")
                    || formats.find(f => f.quality === "video+audio")
                    || formats.find(f => f.vcodec && f.vcodec !== "none" && f.vcodec !== null);

                const videoUrl = buildDownloadUrl(pageUrl, videoFmt?.format_id || "bestvideo+bestaudio/best");
                await sendVideo(api, videoUrl, { thumbnail, duration }, caption, threadId, threadType);
                return;
            }

            // ── Fallback audio ────────────────────────────────────────────────
            if (hasAudioFmt) {
                const audioUrl = d.download_audio_url || buildDownloadUrl(pageUrl, "audio");
                await sendAudio(api, audioUrl, { thumbnail, duration }, caption, threadId, threadType);
                return;
            }

            logWarn("[AutoDown] Không tìm thấy format phù hợp.");
            await api.sendMessage(
                { msg: `⚠️ AutoDown: Không tìm được media phù hợp từ link này.`, ttl: 300_000 },
                threadId, threadType
            );

        } catch (err) {
            const status = err?.response?.status;
            logWarn(`[AutoDown] Lỗi: ${err.message}`);
            try {
                let errMsg;
                if (status === 500 || status === 502 || status === 503) {
                    errMsg = `⚠️ AutoDown: Máy chủ tải media đang lỗi (${status}). Vui lòng thử lại sau.`;
                } else if (status === 404) {
                    errMsg = `⚠️ AutoDown: Không tìm thấy media tại link này.`;
                } else {
                    errMsg = `⚠️ AutoDown: Không thể tải media — ${err.message}`;
                }
                await api.sendMessage({ msg: errMsg, ttl: 300_000 }, threadId, threadType);
            } catch {}
        }
    });
}

module.exports = { startAutoDown };

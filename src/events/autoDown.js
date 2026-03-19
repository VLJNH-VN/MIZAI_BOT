/**
 * src/events/autoDown.js
 * Tự động tải media từ link chia sẻ trong chat Zalo.
 *
 * - TikTok / Douyin / CapCut → dùng @tobyg74/tiktok-api-dl (trực tiếp, không qua yt-dlp)
 * - Tất cả platform khác    → https://yt-dlp-hwys.onrender.com/api/media
 *     GET /api/media?url=<url>  → JSON: { title, uploader, platform, thumbnail,
 *                                          duration, webpage_url, formats[], download_audio_url }
 *     GET /api/download?url=<webpage_url>&format=<format_id> → stream binary
 */

const axios          = require("axios");
const path           = require("path");
const fs             = require("fs");
const { execSync }   = require("child_process");
const { Downloader } = require("@tobyg74/tiktok-api-dl");

const tempDir       = path.join(process.cwd(), "includes", "cache");
const SETTINGS_FILE = path.join(process.cwd(), "includes", "data", "auto.json");
const API_BASE      = "https://yt-dlp-hwys.onrender.com";

const AUDIO_ONLY_SOURCES = new Set([
    "soundcloud", "spotify", "mixcloud", "zingmp3", "bandcamp", "audiomack"
]);

// ─── TikTok URL detection ──────────────────────────────────────────────────────
function isTikTokUrl(url) {
    return /(?:vm\.|vt\.|www\.)?tiktok\.com|douyin\.com|capcut\.com/.test(url);
}

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

// ─── File helpers ──────────────────────────────────────────────────────────────
async function downloadFile(url, filePath) {
    const res = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 300000,
        maxContentLength: 500 * 1024 * 1024,
        headers: { "User-Agent": global.userAgent || "Mozilla/5.0" }
    });
    fs.writeFileSync(filePath, Buffer.from(res.data));
    return res.headers["content-type"] || "";
}

function probeStreams(filePath) {
    try {
        const out  = execSync(
            `ffprobe -v error -show_format -show_streams -of json "${filePath}"`,
            { timeout: 30000, stdio: "pipe" }
        ).toString();
        const data = JSON.parse(out);
        const hasVideo = data.streams?.some(s => s.codec_type === "video") || false;
        const hasAudio = data.streams?.some(s => s.codec_type === "audio") || false;
        const vs  = data.streams?.find(s => s.codec_type === "video");
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
    const audioArgs = info.hasAudio ? `-map 0:a:0 -c:a aac -b:a 128k -ar 44100` : `-an`;
    execSync(
        `ffmpeg -y -i "${inputPath}" -map 0:v:0 ${audioArgs} ` +
        `-c:v libx264 -preset fast -crf 23 -profile:v baseline -level 3.1 ` +
        `-pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -movflags +faststart "${outputPath}"`,
        { timeout: 300000, stdio: "pipe" }
    );
}

function convertToAac(inputPath, outputPath) {
    execSync(`ffmpeg -y -i "${inputPath}" -vn -c:a aac -b:a 128k "${outputPath}"`,
        { timeout: 120000, stdio: "pipe" });
}

function cleanup(...files) {
    setTimeout(() => {
        files.forEach(f => {
            try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
        });
    }, 8000);
}

// ─── Gửi VIDEO ────────────────────────────────────────────────────────────────
async function sendVideo(api, videoUrl, info, caption, threadId, threadType) {
    const rawPath  = path.join(tempDir, `ad_raw_${Date.now()}.mp4`);
    const h264Path = path.join(tempDir, `ad_h264_${Date.now()}.mp4`);
    try {
        await downloadFile(videoUrl, rawPath);

        const raw = probeStreams(rawPath);
        if (!raw.hasVideo) {
            logWarn("[AutoDown] File không có stream video → chuyển sang audio.");
            await sendAudio(api, videoUrl, info, caption, threadId, threadType);
            return;
        }

        let uploadPath = rawPath;
        try {
            convertToH264(rawPath, h264Path);
            if (fs.existsSync(h264Path) && fs.statSync(h264Path).size > 0)
                uploadPath = h264Path;
        } catch (e) {
            logWarn(`[AutoDown] Convert H.264 lỗi, dùng file gốc: ${e.message}`);
        }

        const meta = probeStreams(uploadPath);
        const dur  = Math.max(1000, (info.duration || meta.duration || 1) * 1000);

        try {
            const uploaded = await api.uploadAttachment([uploadPath], threadId, threadType);
            const vidUrl   = uploaded?.[0]?.fileUrl;
            if (!vidUrl) throw new Error("Không có fileUrl");
            await api.sendVideo({
                videoUrl: vidUrl, thumbnailUrl: info.thumbnail || "",
                msg: caption, width: meta.width, height: meta.height,
                duration: dur, ttl: 500_000,
            }, threadId, threadType);
            return;
        } catch (e1) {
            logWarn(`[AutoDown] sendVideo step1 thất bại: ${e1.message}`);
        }

        try {
            await api.sendMessage({ msg: caption, attachments: [uploadPath], ttl: 500_000 }, threadId, threadType);
            return;
        } catch (e2) {
            logWarn(`[AutoDown] sendVideo step2 thất bại: ${e2.message}`);
        }

        await api.sendMessage({ msg: `${caption}\n\n🔗 ${videoUrl}`, ttl: 300_000 }, threadId, threadType);
    } finally {
        cleanup(rawPath, h264Path);
    }
}

// ─── Gửi AUDIO ────────────────────────────────────────────────────────────────
async function sendAudio(api, audioUrl, info, caption, threadId, threadType) {
    const rawPath  = path.join(tempDir, `ad_aud_${Date.now()}`);
    const aacPath  = `${rawPath}.aac`;
    const thumbs   = [];
    try {
        await downloadFile(audioUrl, rawPath);
        convertToAac(rawPath, aacPath);

        if (info.thumbnail) {
            try {
                const tp = path.join(tempDir, `ad_thumb_${Date.now()}.jpg`);
                await downloadFile(info.thumbnail, tp);
                thumbs.push(tp);
            } catch {}
        }
        await api.sendMessage({ msg: caption, attachments: thumbs, ttl: 500_000 }, threadId, threadType);

        const uploaded = await api.uploadAttachment([aacPath], threadId, threadType);
        const voiceUrl = uploaded?.[0]?.fileUrl;
        if (voiceUrl) await api.sendVoice({ voiceUrl, ttl: 500_000 }, threadId, threadType);
    } finally {
        cleanup(rawPath, aacPath, ...thumbs);
    }
}

// ─── Gửi ẢNH slideshow ────────────────────────────────────────────────────────
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

// ─── Handler: TikTok (qua @tobyg74/tiktok-api-dl) ────────────────────────────
async function handleTikTok(api, url, threadId, threadType) {
    logInfo(`[AutoDown] TikTok: ${url}`);
    const res = await Downloader(url, { version: "v3" });

    if (res.status !== "success" || !res.result) {
        throw new Error(`TikTok Downloader thất bại: ${res.message || "unknown"}`);
    }

    const r       = res.result;
    const title   = r.desc?.trim()            || "TikTok";
    const author  = r.author?.nickname        || "Unknown";
    const caption = `/-li 𝐀𝐮𝐭𝐨𝐃𝐨𝐰𝐧: TIKTOK\n📄 ${title}\n👤 ${author}`;

    // Slideshow ảnh
    if (r.type === "image" && Array.isArray(r.images) && r.images.length) {
        await sendImages(api, r.images, caption, threadId, threadType);
        return;
    }

    // Video — ưu tiên HD không watermark, fallback SD
    const videoUrl = r.videoHD || r.videoSD || r.videoNoWatermark;
    if (videoUrl) {
        await sendVideo(api, videoUrl, { thumbnail: r.cover || "", duration: 0 }, caption, threadId, threadType);
        return;
    }

    throw new Error("TikTok: Không tìm thấy URL video/ảnh");
}

// ─── Handler: Các platform khác (qua yt-dlp API) ─────────────────────────────
async function fetchMediaInfo(url, retries = 3) {
    let lastErr;
    for (let i = 1; i <= retries; i++) {
        try {
            const res = await axios.get(`${API_BASE}/api/media?url=${encodeURIComponent(url)}`, { timeout: 180000 });
            const d   = res.data;
            if (!d || typeof d !== "object") throw new Error("Dữ liệu API không hợp lệ");
            return d;
        } catch (err) {
            lastErr = err;
            const status = err?.response?.status;
            if (status && status < 500) break;
            if (i < retries) {
                logWarn(`[AutoDown] Thử lại lần ${i} (${err.message})...`);
                await new Promise(r => setTimeout(r, 6000 * i));
            }
        }
    }
    throw lastErr;
}

function buildDownloadUrl(webpageUrl, formatId) {
    return `${API_BASE}/api/download?url=${encodeURIComponent(webpageUrl)}&format=${encodeURIComponent(formatId)}`;
}

async function handleOther(api, url, threadId, threadType) {
    logInfo(`[AutoDown] yt-dlp: ${url}`);
    const d = await fetchMediaInfo(url);

    const title     = d.title?.trim() || "Media";
    const author    = d.uploader || d.channel || "Unknown";
    const platform  = (d.platform || "MEDIA").toUpperCase();
    const thumbnail = d.thumbnail || "";
    const duration  = d.duration  || 0;
    const pageUrl   = d.webpage_url || url;
    const formats   = Array.isArray(d.formats) ? d.formats : [];
    const source    = (d.platform || "").toLowerCase();
    const caption   = `/-li 𝐀𝐮𝐭𝐨𝐃𝐨𝐰𝐧: ${platform}\n📄 ${title}\n👤 ${author}`;

    const hasVideoFmt = formats.some(f => f.quality === "video+audio" || (f.vcodec && f.vcodec !== "none" && f.vcodec !== null));
    const hasAudioFmt = formats.some(f => f.quality === "audio" || f.format_id === "audio");
    const hasImageFmt = formats.some(f => f.quality === "image" || f.ext === "jpg" || f.ext === "png");

    if (AUDIO_ONLY_SOURCES.has(source)) {
        const audioUrl = d.download_audio_url || buildDownloadUrl(pageUrl, "audio");
        await sendAudio(api, audioUrl, { thumbnail, duration }, caption, threadId, threadType);
        return;
    }

    if (hasImageFmt && !hasVideoFmt) {
        const imageUrls = Array.isArray(d.images) && d.images.length
            ? d.images
            : formats.filter(f => f.quality === "image" || f.ext === "jpg" || f.ext === "png")
                     .map(f => f.url || f.download_url).filter(Boolean);
        if (imageUrls.length) { await sendImages(api, imageUrls, caption, threadId, threadType); return; }
    }

    if (hasVideoFmt) {
        const videoFmt = formats.find(f => f.format_id === "no_watermark")
            || formats.find(f => f.quality === "video+audio")
            || formats.find(f => f.vcodec && f.vcodec !== "none" && f.vcodec !== null);
        const videoUrl = buildDownloadUrl(pageUrl, videoFmt?.format_id || "bestvideo+bestaudio/best");
        await sendVideo(api, videoUrl, { thumbnail, duration }, caption, threadId, threadType);
        return;
    }

    if (hasAudioFmt) {
        const audioUrl = d.download_audio_url || buildDownloadUrl(pageUrl, "audio");
        await sendAudio(api, audioUrl, { thumbnail, duration }, caption, threadId, threadType);
        return;
    }

    logWarn("[AutoDown] Không tìm thấy format phù hợp.");
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function startAutoDown(api) {
    api.listener.on("message", async (msg) => {
        const threadId   = msg.threadId;
        const threadType = msg.type;

        const botId    = global.botId ? String(global.botId) : null;
        const senderId = msg.data?.uidFrom ? String(msg.data.uidFrom) : null;
        if (botId && senderId && senderId === botId) return;

        const content  = typeof msg.data?.content === "string" ? msg.data.content.trim() : "";
        const href     = typeof msg.data?.content?.href === "string" ? msg.data.content.href.trim() : "";
        const bodyText = typeof msg.message?.body === "string" ? msg.message.body.trim() : "";
        const body     = content || bodyText || href;

        // Chỉ xử lý nếu là URL hợp lệ
        const urlMatch = body?.match(/https?:\/\/[^\s]+/);
        if (!urlMatch) return;
        const url = urlMatch[0];

        if (!isAutoDownEnabled(threadId)) return;

        logInfo(`[AutoDown] Link: ${url}`);

        try {
            fs.mkdirSync(tempDir, { recursive: true });

            if (isTikTokUrl(url)) {
                await handleTikTok(api, url, threadId, threadType);
            } else {
                await handleOther(api, url, threadId, threadType);
            }
        } catch (err) {
            const status = err?.response?.status;
            logWarn(`[AutoDown] Lỗi: ${err.message}`);
            // Chỉ báo lỗi với các platform thực sự có nội dung (tránh spam với link ngẫu nhiên)
            if (status || isTikTokUrl(url)) {
                try {
                    let errMsg;
                    if (status === 500 || status === 502 || status === 503) {
                        errMsg = `⚠️ AutoDown: Máy chủ lỗi (${status}), thử lại sau.`;
                    } else if (status === 404) {
                        errMsg = `⚠️ AutoDown: Không tìm thấy media tại link này.`;
                    } else {
                        errMsg = `⚠️ AutoDown: Không thể tải — ${err.message}`;
                    }
                    await api.sendMessage({ msg: errMsg, ttl: 300_000 }, threadId, threadType);
                } catch {}
            }
        }
    });
}

module.exports = { startAutoDown };

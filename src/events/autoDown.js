"use strict";
/**
 * src/events/autoDown.js — AutoDown
 * Tự động tải media khi phát hiện link trong chat Zalo.
 *
 *   TikTok / Douyin / CapCut → tikwm.com  (fallback: @tobyg74/tiktok-api-dl)
 *   Facebook (mọi dạng)      → resolve redirect → fown (yt-dlp)
 *   Tất cả platform khác     → fown.onrender.com  GET /api/media?url=
 */

const axios          = require("axios");
const path           = require("path");
const fs             = require("fs");
const { execSync }   = require("child_process");
const { Downloader } = require("@tobyg74/tiktok-api-dl");
const { extractBody }            = require("../../utils/bot/messageUtils");
const { uploadThumbnail, uploadAttachmentToZalo } = require("../../utils/media/zaloMedia");

const TEMP     = path.join(process.cwd(), "includes", "cache");
const FOWN     = "https://fown.onrender.com";
const UA       = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36";

// ─── Platform detection ────────────────────────────────────────────────────────

// Facebook: mọi subdomain (www/m/web/l/lm/touch) + fb.watch + fb.me
const FB_RX = /(?:(?:www|m|web|l|lm|touch)\.)?facebook\.com|fb\.watch(?:\/|$)|fb\.me(?:\/|$)/i;

// Các dạng FB cần follow redirect trước khi gửi yt-dlp
//   fb.watch, fb.me, facebook.com/share/<hash> (không có r/ hay v/ prefix)
const FB_RESOLVE_RX = /fb\.watch(?:\/|$)|fb\.me(?:\/|$)|facebook\.com\/share\/(?!r\/|v\/)[\w-]+/i;

const isTikTok  = u => /(?:vm\.|vt\.|www\.)?tiktok\.com|douyin\.com|capcut\.com/.test(u);
const isFB      = u => FB_RX.test(u);

// Toàn bộ platform hỗ trợ qua yt-dlp (TikTok/Douyin/CapCut xử lý riêng)
const SUPPORTED = [
    FB_RX,
    /instagram\.com/, /threads\.net/, /threads\.com/,
    /youtube\.com/,   /youtu\.be/,
    /twitter\.com/,   /x\.com/,
    /reddit\.com/,    /redd\.it/,
    /vimeo\.com/,     /dailymotion\.com/, /bilibili\.com/,
    /pinterest\.com/, /pin\.it/,
    /snapchat\.com/,  /tumblr\.com/,      /linkedin\.com/,
    /ok\.ru/,         /vk\.com/,          /vk\.ru/,
    /rumble\.com/,    /streamable\.com/,  /ted\.com/,
    /bitchute\.com/,  /9gag\.com/,        /imgur\.com/,
    /ifunny\.co/,     /izlesene\.com/,    /espn\.com/,
    /imdb\.com/,      /sharechat\.com/,   /likee\.video/,
    /hipi\.co\.in/,   /febspot\.com/,     /sohu\.com/,
    /xvideos\.com/,   /xnxx\.com/,        /xiaohongshu\.com/,
    /ixigua\.com/,    /weibo\.com/,       /sina\.com\.cn/,
    /soundcloud\.com/,/mixcloud\.com/,    /spotify\.com/,
    /zingmp3\.vn/,    /bandcamp\.com/,    /audiomack\.com/,
];

const AUDIO_ONLY = new Set(["soundcloud","spotify","mixcloud","zingmp3","bandcamp","audiomack"]);

// ─── Helpers ───────────────────────────────────────────────────────────────────

const uid  = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const tmp  = (name) => path.join(TEMP, name);

async function dlFile(url, dest) {
    const r = await axios.get(url, {
        responseType: "arraybuffer", timeout: 300_000,
        maxContentLength: 500 * 1024 * 1024,
        headers: { "User-Agent": global.userAgent || UA },
    });
    fs.writeFileSync(dest, Buffer.from(r.data));
    return r.headers["content-type"] || "";
}

function probe(file) {
    try {
        const d = JSON.parse(execSync(
            `ffprobe -v error -show_format -show_streams -of json "${file}"`,
            { timeout: 30000, stdio: "pipe" }
        ).toString());
        const vs  = d.streams?.find(s => s.codec_type === "video");
        const dur = parseFloat(d.format?.duration || 0);
        return {
            hasVideo: !!vs,
            hasAudio: d.streams?.some(s => s.codec_type === "audio") || false,
            width:    vs?.width  || 720,
            height:   vs?.height || 1280,
            duration: dur > 0 ? Math.max(1, Math.ceil(dur)) : 1,
        };
    } catch {
        return { hasVideo: false, hasAudio: false, width: 720, height: 1280, duration: 1 };
    }
}

function toH264(src, dest) {
    const info = probe(src);
    execSync(
        `ffmpeg -y -i "${src}" -map 0:v:0 ` +
        (info.hasAudio ? `-map 0:a:0 -c:a aac -b:a 128k -ar 44100` : `-an`) +
        ` -c:v libx264 -preset fast -crf 23 -profile:v baseline -level 3.1` +
        ` -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -movflags +faststart "${dest}"`,
        { timeout: 300_000, stdio: "pipe" }
    );
}

function toAac(src, dest) {
    execSync(`ffmpeg -y -i "${src}" -vn -c:a aac -b:a 128k "${dest}"`,
        { timeout: 120_000, stdio: "pipe" });
}

function del(...files) {
    setTimeout(() => {
        files.forEach(f => { try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {} });
    }, 10_000);
}

// Dọn cache cũ mỗi 5 phút
const CACHE_EXTS = new Set([".mp4",".mp3",".aac",".jpg",".jpeg",".png",".webp",".tmp",".bin"]);
setInterval(() => {
    try {
        if (!fs.existsSync(TEMP)) return;
        const now = Date.now();
        fs.readdirSync(TEMP).forEach(f => {
            if (!CACHE_EXTS.has(path.extname(f).toLowerCase())) return;
            const full = path.join(TEMP, f);
            try { if (now - fs.statSync(full).mtimeMs > 5 * 60_000) fs.unlinkSync(full); } catch {}
        });
    } catch {}
}, 5 * 60_000);

// ─── Gửi video ─────────────────────────────────────────────────────────────────
async function sendVideo(api, videoUrl, info, caption, threadId, threadType) {
    const id      = uid();
    const raw     = tmp(`ad_raw_${id}.mp4`);
    const h264    = tmp(`ad_h264_${id}.mp4`);
    try {
        await dlFile(videoUrl, raw);
        const p0 = probe(raw);
        if (!p0.hasVideo) {
            logWarn("[AutoDown] Không có stream video → fallback audio.");
            return await sendAudio(api, videoUrl, info, caption, threadId, threadType);
        }

        let upload = raw;
        try {
            toH264(raw, h264);
            if (fs.existsSync(h264) && fs.statSync(h264).size > 0) upload = h264;
        } catch (e) { logWarn(`[AutoDown] H264 convert lỗi: ${e.message}`); }

        const meta = probe(upload);
        const size = fs.statSync(upload).size;

        let thumbUrl = "";
        try { thumbUrl = await uploadThumbnail(api, upload, threadId, threadType) || ""; } catch {}

        // Bước 1: GitHub upload < 50MB → sendVideo
        if (typeof global.githubUpload === "function" && size < 50 * 1024 * 1024) {
            try {
                const ghUrl = await global.githubUpload(upload, `autodown/vid_${id}.mp4`);
                if (ghUrl) {
                    await api.sendVideo({
                        videoUrl: ghUrl, thumbnailUrl: thumbUrl || info.thumbnail || "",
                        msg: caption, width: meta.width || info.width || 720,
                        height: meta.height || info.height || 1280,
                        duration: meta.duration * 1000, fileSize: size, ttl: 500_000,
                    }, threadId, threadType);
                    return logInfo("[AutoDown] sendVideo (GitHub) OK.");
                }
            } catch (e) { logWarn(`[AutoDown] GitHub sendVideo lỗi: ${e.message}`); }
        }

        // Bước 2: sendMessage attachment
        try {
            await api.sendMessage({ msg: caption, attachments: [upload], ttl: 500_000 }, threadId, threadType);
            return logInfo("[AutoDown] sendVideo (attachment) OK.");
        } catch (e) { logWarn(`[AutoDown] attachment lỗi: ${e.message}`); }

        // Bước 3: gửi link text
        await api.sendMessage({ msg: `${caption}\n\n🔗 ${videoUrl}`, ttl: 300_000 }, threadId, threadType);
    } finally { del(raw, h264); }
}

// ─── Gửi audio ─────────────────────────────────────────────────────────────────
async function sendAudio(api, audioUrl, info, caption, threadId, threadType) {
    const id   = uid();
    const raw  = tmp(`ad_aud_${id}`);
    const aac  = `${raw}.aac`;
    const imgs = [];
    try {
        await dlFile(audioUrl, raw);
        toAac(raw, aac);

        if (info.thumbnail) {
            try {
                const tp = tmp(`ad_thumb_${id}.jpg`);
                await dlFile(info.thumbnail, tp);
                imgs.push(tp);
            } catch {}
        }
        if (caption || imgs.length)
            await api.sendMessage({ msg: caption, attachments: imgs.length ? imgs : undefined, ttl: 500_000 }, threadId, threadType);

        // Bước 1: upload AAC → sendVoice
        try {
            const voiceUrl = await uploadAttachmentToZalo(api, aac, threadId, threadType);
            if (voiceUrl) {
                await api.sendVoice({ voiceUrl, ttl: 900_000 }, threadId, threadType);
                return logInfo("[AutoDown] sendVoice (upload) OK.");
            }
        } catch (e) { logWarn(`[AutoDown] sendVoice upload lỗi: ${e.message}`); }

        // Bước 2: GitHub → sendVoice
        if (typeof global.githubUpload === "function" && fs.statSync(aac).size < 50 * 1024 * 1024) {
            try {
                const ghUrl = await global.githubUpload(aac, `autodown/aud_${id}.aac`);
                if (ghUrl) {
                    await api.sendVoice({ voiceUrl: ghUrl, ttl: 500_000 }, threadId, threadType);
                    return logInfo("[AutoDown] sendVoice (GitHub) OK.");
                }
            } catch (e) { logWarn(`[AutoDown] sendVoice GitHub lỗi: ${e.message}`); }
        }

        // Bước 3: attachment
        await api.sendMessage({ msg: caption, attachments: [aac], ttl: 500_000 }, threadId, threadType);
    } finally { del(raw, aac, ...imgs); }
}

// ─── Gửi ảnh slideshow ─────────────────────────────────────────────────────────
async function sendImages(api, urls, caption, threadId, threadType) {
    const paths = [];
    try {
        for (const u of urls.slice(0, 10)) {
            const p = tmp(`ad_img_${uid()}.jpg`);
            try { await dlFile(u, p); paths.push(p); } catch (e) { logWarn(`[AutoDown] Bỏ ảnh: ${e.message}`); }
        }
        if (!paths.length) return;
        await api.sendMessage({ msg: caption, attachments: paths, ttl: 500_000 }, threadId, threadType);
    } finally { del(...paths); }
}

// ─── TikTok handler ────────────────────────────────────────────────────────────
async function handleTikTok(api, url, threadId, threadType) {
    logDebug(`[AutoDown] TikTok: ${url}`);

    // Thử tikwm trước (nhanh, không watermark, có likes)
    try {
        const r = await axios.post("https://www.tikwm.com/api/",
            new URLSearchParams({ url }).toString(),
            { timeout: 30_000, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        if (r.data?.code !== 0) throw new Error(`code ${r.data?.code}`);
        const d = r.data.data;
        const cap = `/-li AUTODOWN: TIKTOK\n📄 ${d.title?.trim() || "TikTok"}\n` +
            `👤 ${d.author?.nickname || ""}${d.author?.unique_id ? ` (@${d.author.unique_id})` : ""}\n` +
            `❤️ ${Number(d.digg_count || 0).toLocaleString("vi-VN")} lượt thích`;
        if (Array.isArray(d.images) && d.images.length)
            return await sendImages(api, d.images, cap, threadId, threadType);
        if (d.play || d.wmplay)
            return await sendVideo(api, d.play || d.wmplay,
                { thumbnail: d.cover || "", duration: d.duration || 0, width: d.width || 576, height: d.height || 1024 },
                cap, threadId, threadType);
        throw new Error("Không có media");
    } catch (e) { logWarn(`[AutoDown] tikwm thất bại: ${e.message}`); }

    // Fallback: @tobyg74/tiktok-api-dl
    const res = await Downloader(url, { version: "v3" });
    if (res.status !== "success" || !res.result)
        throw new Error(`TikTok fallback thất bại: ${res.message || "unknown"}`);
    const r   = res.result;
    const cap = `/-li AutoDown: TIKTOK\n📄 ${r.desc?.trim() || "TikTok"}\n👤 ${r.author?.nickname || ""}`;
    if (r.type === "image" && Array.isArray(r.images) && r.images.length)
        return await sendImages(api, r.images, cap, threadId, threadType);
    const vurl = r.videoSD || r.videoNoWatermark || r.videoHD || r.video?.noWatermark || r.video?.watermark;
    if (vurl) return await sendVideo(api, vurl, {}, cap, threadId, threadType);
    throw new Error("TikTok: Không tìm thấy URL");
}

// ─── Facebook handler — resolve short/share link → fown ───────────────────────
async function handleFacebook(api, url, threadId, threadType) {
    logDebug(`[AutoDown] Facebook: ${url}`);
    let resolved = url;
    if (FB_RESOLVE_RX.test(url)) {
        try {
            const r = await axios.get(url, {
                timeout: 12_000, maxRedirects: 10,
                headers: { "User-Agent": UA, "Accept-Language": "vi-VN,vi;q=0.9" },
                validateStatus: () => true,
            });
            const final = r?.request?.res?.responseUrl || url;
            if (typeof final === "string" && final.startsWith("http") && final !== url) {
                logDebug(`[AutoDown] FB resolve: ${url} → ${final}`);
                resolved = final;
            }
        } catch (e) { logWarn(`[AutoDown] FB resolve lỗi: ${e.message}`); }
    }
    await handleOther(api, resolved, threadId, threadType);
}

// ─── fown (yt-dlp) handler ─────────────────────────────────────────────────────
async function fetchInfo(url, retries = 3) {
    let last;
    for (let i = 1; i <= retries; i++) {
        try {
            const r = await axios.get(`${FOWN}/api/media?url=${encodeURIComponent(url)}`, { timeout: 180_000 });
            const d = r.data;
            if (!d || typeof d !== "object") throw new Error("API trả về không hợp lệ");
            if (d.error) throw new Error(d.details ? String(d.details).slice(0, 200) : String(d.error));
            return d;
        } catch (e) {
            last = e;
            if (e?.response?.status < 500) break;
            if (i < retries) {
                logWarn(`[AutoDown] Retry ${i} (${e.message})...`);
                await new Promise(r => setTimeout(r, 6000 * i));
            }
        }
    }
    throw last;
}

const dlUrl = (pageUrl, fmt) =>
    `${FOWN}/api/download?url=${encodeURIComponent(pageUrl)}&format=${encodeURIComponent(fmt)}`;

async function handleOther(api, url, threadId, threadType) {
    logDebug(`[AutoDown] fown: ${url}`);
    const d = await fetchInfo(url);

    const title    = d.title?.trim() || "Media";
    const author   = d.uploader || d.channel || "Unknown";
    const platform = (d.platform || "MEDIA").toUpperCase();
    const thumb    = d.thumbnail || "";
    const dur      = d.duration  || 0;
    const pageUrl  = d.webpage_url || url;
    const fmts     = Array.isArray(d.formats) ? d.formats : [];
    const source   = (d.platform || "").toLowerCase();
    const caption  = `/-li 𝐀𝐮𝐭𝐨𝐃𝐨𝐰𝐧: ${platform}\n📄 ${title}\n👤 ${author}`;

    const hasVid = fmts.some(f => f.quality === "video+audio" || (f.vcodec && f.vcodec !== "none"));
    const hasAud = fmts.some(f => f.quality === "audio" || (f.acodec && f.acodec !== "none" && !f.vcodec));
    const hasImg = fmts.some(f => f.quality === "image" || f.ext === "jpg" || f.ext === "png");

    // Audio-only platform
    if (AUDIO_ONLY.has(source)) {
        if (d.download_audio_url) {
            try {
                await api.sendMessage({ msg: caption, ttl: 300_000 }, threadId, threadType);
                await api.sendVoice({ voiceUrl: d.download_audio_url, ttl: 500_000 }, threadId, threadType);
                return logInfo("[AutoDown] sendVoice (GitHub Releases) OK.");
            } catch (e) { logWarn(`[AutoDown] sendVoice Releases lỗi: ${e.message}`); }
        }
        return await sendAudio(api, dlUrl(pageUrl, "audio"), { thumbnail: thumb, duration: dur }, caption, threadId, threadType);
    }

    // Ảnh slideshow
    if (hasImg && !hasVid) {
        const imgUrls = (Array.isArray(d.images) && d.images.length)
            ? d.images
            : fmts.filter(f => f.quality === "image" || f.ext === "jpg" || f.ext === "png")
                  .map(f => f.url || f.download_url).filter(Boolean);
        if (imgUrls.length) return await sendImages(api, imgUrls, caption, threadId, threadType);
    }

    // Video — ưu tiên download_url từ fown (GitHub Releases, không cần download local)
    if (hasVid || d.download_url) {
        const resFmt = fmts
            .filter(f => f.resolution && f.resolution !== "audio only")
            .sort((a, b) => {
                const [aw, ah] = (a.resolution || "0x0").split("x").map(Number);
                const [bw, bh] = (b.resolution || "0x0").split("x").map(Number);
                return bw * bh - aw * ah;
            })[0];
        const [w, h] = resFmt?.resolution ? resFmt.resolution.split("x").map(Number) : [0, 0];

        if (d.download_url) {
            try {
                // Upload thumbnail → Zalo CDN
                let thumbZalo = "";
                if (thumb) {
                    try {
                        const tp = tmp(`ad_otherthumb_${uid()}.bin`);
                        await dlFile(thumb, tp);
                        thumbZalo = await uploadAttachmentToZalo(api, tp, threadId, threadType) || "";
                        try { fs.unlinkSync(tp); } catch {}
                    } catch {}
                }
                await api.sendVideo({
                    videoUrl: d.download_url, thumbnailUrl: thumbZalo || thumb || "",
                    msg: caption, width: w, height: h, duration: dur * 1000, ttl: 500_000,
                }, threadId, threadType);
                return logInfo("[AutoDown] sendVideo (GitHub Releases) OK.");
            } catch (e) { logWarn(`[AutoDown] sendVideo Releases lỗi: ${e.message}`); }
        }

        // Fallback: proxy download → local convert
        const vidFmt = fmts.find(f => f.format_id === "no_watermark")
            || fmts.find(f => f.quality === "video+audio")
            || fmts.find(f => f.vcodec && f.vcodec !== "none");
        return await sendVideo(api,
            dlUrl(pageUrl, vidFmt?.format_id || "bestvideo+bestaudio/best"),
            { thumbnail: thumb, duration: dur, width: w, height: h },
            caption, threadId, threadType);
    }

    // Audio fallback
    if (hasAud) {
        return await sendAudio(api,
            d.download_audio_url || dlUrl(pageUrl, "audio"),
            { thumbnail: thumb, duration: dur }, caption, threadId, threadType);
    }

    logWarn("[AutoDown] Không tìm thấy format phù hợp.");
}

// ─── Lấy URL từ message ────────────────────────────────────────────────────────
function extractUrl(msg) {
    const raw     = msg.data || {};
    const body    = extractBody(raw);
    const content = raw.content;
    let cardUrl   = "";
    if (content && typeof content === "object")
        cardUrl = typeof (content.href || content.url || content.link) === "string"
            ? (content.href || content.url || content.link) : "";
    const text  = [body, cardUrl].filter(Boolean).join(" ");
    const match = text.match(/https?:\/\/[^\s"')>]+/);
    return match ? match[0].replace(/[.,;!?）]+$/, "") : null;
}

// ─── AutoDown settings ─────────────────────────────────────────────────────────
async function autoDownEnabled(threadId) {
    try {
        const { getSetting } = require("../../includes/database/group/groupSettings");
        return await getSetting(String(threadId), "autodown", true);
    } catch { return true; }
}

// ─── Main listener ─────────────────────────────────────────────────────────────
function startAutoDown(api) {
    api.listener.on("message", async (msg) => {
        const threadId   = msg.threadId;
        const threadType = msg.type;

        // Bỏ qua tin nhắn của chính bot
        const botId = global.botId ? String(global.botId) : null;
        if (botId && String(msg.data?.uidFrom) === botId) return;

        const url = extractUrl(msg);
        if (!url) return;

        const isTT = isTikTok(url);
        if (!isTT && !SUPPORTED.some(rx => rx.test(url))) return;
        if (!(await autoDownEnabled(threadId))) return;

        logDebug(`[AutoDown] Link: ${url}`);
        try {
            fs.mkdirSync(TEMP, { recursive: true });
            if (isTT)        await handleTikTok(api, url, threadId, threadType);
            else if (isFB(url)) await handleFacebook(api, url, threadId, threadType);
            else             await handleOther(api, url, threadId, threadType);
        } catch (err) {
            logWarn(`[AutoDown] Lỗi: ${err.message}`);
            const st = err?.response?.status;
            let msg_;
            if (st === 404)           msg_ = "⚠️ AutoDown: Không tìm thấy media tại link này.";
            else if (st >= 500)       msg_ = `⚠️ AutoDown: Máy chủ lỗi (${st}), thử lại sau.`;
            else                      msg_ = `⚠️ AutoDown: Không thể tải — ${err.message}`;
            try { await api.sendMessage({ msg: msg_, ttl: 300_000 }, threadId, threadType); } catch {}
        }
    });
}

module.exports = { startAutoDown };

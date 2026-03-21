/**
 * src/events/autoSend.js
 * Tự động gửi tin nhắn định kỳ theo lịch cấu hình trong autoSend.json
 */

const fs   = require("fs");
const path = require("path");
const axios = require("axios");
const { execSync }  = require("child_process");
const { ThreadType } = require("zca-js");

const TEMP_DIR = path.join(process.cwd(), "includes", "cache");

async function downloadToTemp(url, uid) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  const tmpPath = path.join(TEMP_DIR, `as_${uid}.mp4`);
  const res = await axios.get(url, {
    responseType:     "arraybuffer",
    timeout:          120000,
    maxContentLength: 200 * 1024 * 1024,
    headers: { "User-Agent": global.userAgent || "Mozilla/5.0" },
  });
  fs.writeFileSync(tmpPath, Buffer.from(res.data));
  if (fs.statSync(tmpPath).size === 0) throw new Error("File rỗng");
  return tmpPath;
}

function cleanup(filePath) {
  setTimeout(() => {
    try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
  }, 15000);
}

const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm"]);
const VIDEO_DIR  = path.join(process.cwd(), "includes", "cache", "videos");

function getVideoMeta(filePath) {
  try {
    const out  = execSync(`ffprobe -v error -show_format -show_streams -of json "${filePath}"`, { timeout: 15000 }).toString();
    const data = JSON.parse(out);
    const vs   = data.streams?.find(s => s.codec_type === "video");
    const dur  = parseFloat(data.format?.duration || 0);
    return { width: vs?.width || 720, height: vs?.height || 1280, duration: dur > 0 ? Math.max(1, Math.ceil(dur)) : 1 };
  } catch { return { width: 720, height: 1280, duration: 1 }; }
}

function pickRandomVideo() {
  try {
    if (!fs.existsSync(VIDEO_DIR)) return null;
    const files = fs.readdirSync(VIDEO_DIR).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return VIDEO_EXTS.has(ext) && fs.statSync(path.join(VIDEO_DIR, f)).size > 0;
    });
    if (!files.length) return null;
    return path.join(VIDEO_DIR, files[Math.floor(Math.random() * files.length)]);
  } catch { return null; }
}

const CONFIG_FILE = path.join(process.cwd(), "includes", "data", "autoSend.json");
const GROUPS_FILE = path.join(process.cwd(), "includes", "database", "groupsCache.json");

const INTERVAL_MS = 60 * 1000;
let lastCheckedMinute = "";

function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      const sample = [{
        time: "08:00",
        content: "Chào buổi sáng! ☀️ Bot đang hoạt động bình thường.",
        threadIds: [],
        enabled: false
      }];
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(sample, null, 2));
      return sample;
    }
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch { return []; }
}

function readKnownGroups() {
  try {
    if (!fs.existsSync(GROUPS_FILE)) return [];
    return Object.keys(JSON.parse(fs.readFileSync(GROUPS_FILE, "utf-8")));
  } catch { return []; }
}

function currentHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
}

function startAutoSend(api) {

  setInterval(async () => {
    const nowTime = currentHHMM();
    if (nowTime === lastCheckedMinute) return;
    lastCheckedMinute = nowTime;

    const configs  = readConfig();
    const matching = configs.filter(c => c.enabled !== false && c.time === nowTime);
    if (!matching.length) return;

    const knownGroups = readKnownGroups();

    for (const cfg of matching) {
      const targets = Array.isArray(cfg.threadIds) && cfg.threadIds.length > 0
        ? cfg.threadIds
        : knownGroups;

      for (const threadId of targets) {
        try {
          // ── Gửi text ─────────────────────────────────────────────────────
          if (cfg.content) {
            await api.sendMessage(
              { msg: cfg.content, ttl: 600_000 },
              threadId,
              ThreadType.Group
            );
          }

          // ── Ưu tiên 1: Video từ listapi (tải về → upload Zalo → sendVideo) ──
          // Config ví dụ: { "listapi": "gaixinh" }
          if (cfg.listapi && global.cawr?.tt) {
            const ghUrl = global.cawr.tt.pickRandom(cfg.listapi);
            if (ghUrl) {
              let tmpPath = null;
              try {
                const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                tmpPath = await downloadToTemp(ghUrl, uid);
                const uploaded = await api.uploadAttachment([tmpPath], threadId, ThreadType.Group);
                const fileUrl  = uploaded?.[0]?.fileUrl;
                if (!fileUrl) throw new Error("uploadAttachment không trả về fileUrl");
                await api.sendVideo({
                  videoUrl:     fileUrl,
                  thumbnailUrl: "",
                  msg:          "",
                  width:        576,
                  height:       1024,
                  duration:     10000,
                  ttl:          500_000,
                }, threadId, ThreadType.Group);
                continue; // đã gửi video → bỏ qua local video
              } catch (vErr) {
                global.logWarn?.(`[AutoSend] Gửi listapi video thất bại: ${vErr?.message}`);
              } finally {
                if (tmpPath) cleanup(tmpPath);
              }
            }
          }

          // ── Ưu tiên 2: Video local từ cache/videos ────────────────────────
          const videoPath = pickRandomVideo();
          if (videoPath) {
            const meta     = getVideoMeta(videoPath);
            const uploaded = await api.uploadAttachment([videoPath], threadId, ThreadType.Group);
            const fileUrl  = uploaded?.[0]?.fileUrl;
            if (fileUrl) {
              await api.sendVideo({
                videoUrl:     fileUrl,
                thumbnailUrl: "",
                msg:          "",
                width:        meta.width    || 1280,
                height:       meta.height   || 720,
                duration:     Math.max(1000, (meta.duration || 1) * 1000),
                ttl:          500_000,
              }, threadId, ThreadType.Group);
            }
          }
        } catch (err) {
          global.logWarn?.(`[AutoSend] Gửi thất bại tới ${threadId}: ${err?.message}`);
        }
      }
    }
  }, INTERVAL_MS);
}

module.exports = { startAutoSend };

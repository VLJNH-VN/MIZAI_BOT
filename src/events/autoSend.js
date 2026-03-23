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

const CONFIG_FILE = path.join(process.cwd(), "includes", "data", "config", "autoSend.json");
const { getAllGroupIds } = require("../../includes/database/group/groupSettings");

const VALID_JOKE_CATS  = new Set(["Programming", "Misc", "Dark", "Pun", "Spooky", "Christmas"]);
const VALID_JOKE_LANGS = new Set(["en", "de", "cs", "es", "fr", "pt"]);
const VALID_JOKE_FLAGS = new Set(["nsfw", "religious", "political", "racist", "sexist", "explicit"]);
const CATEGORY_EMOJI   = {
  Programming: "💻", Misc: "🎲", Dark: "🌑", Pun: "😄", Spooky: "👻", Christmas: "🎄",
};

function buildJokeUrl(category, lang, flags) {
  // category có thể là "Any", "Programming", hoặc "Programming,Misc" (nhiều loại)
  const cats = String(category || "Any").split(",")
    .map(c => c.trim())
    .filter(c => VALID_JOKE_CATS.has(c));
  const cat = cats.length > 0 ? cats.join(",") : "Any";

  const l = VALID_JOKE_LANGS.has(lang) ? lang : "en";

  const params = new URLSearchParams();
  params.set("lang", l);

  if (flags && flags.length) {
    // flags là mảng hoặc string như "nsfw,racist"
    const flagArr = (Array.isArray(flags) ? flags : String(flags).split(","))
      .map(f => f.trim()).filter(f => VALID_JOKE_FLAGS.has(f));
    if (flagArr.length) {
      params.set("blacklistFlags", flagArr.join(","));
    } else {
      params.set("safe-mode", "");
    }
  } else {
    params.set("safe-mode", "");
  }

  // Xây URL và xử lý safe-mode (không có value)
  let qs = params.toString().replace("safe-mode=", "safe-mode");
  return `https://v2.jokeapi.dev/joke/${cat}?${qs}`;
}

async function fetchJoke(category = "Any", lang = "en", flags = null) {
  try {
    const url  = buildJokeUrl(category, lang, flags);
    const res  = await axios.get(url, { timeout: 10000 });
    const data = res.data;
    if (data.error) return null;

    let jokeText;
    if (data.type === "twopart") {
      if (!data.setup || !data.delivery) return null;
      jokeText = `${data.setup}\n\n— ${data.delivery}`;
    } else {
      if (!data.joke) return null;
      jokeText = data.joke;
    }

    const emoji = CATEGORY_EMOJI[data.category] || "😂";
    return `${emoji} Joke ngẫu nhiên\n━━━━━━━━━━━━━━━\n${jokeText}\n━━━━━━━━━━━━━━━\n📂 ${data.category}`;
  } catch { return null; }
}

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

async function readKnownGroups() {
  return getAllGroupIds();
}

function currentHHMM() {
  const now = new Date();
  // Chuyển sang múi giờ Việt Nam (UTC+7)
  const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return `${String(vnTime.getUTCHours()).padStart(2,"0")}:${String(vnTime.getUTCMinutes()).padStart(2,"0")}`;
}

function startAutoSend(api) {

  setInterval(async () => {
    const nowTime = currentHHMM();
    if (nowTime === lastCheckedMinute) return;
    lastCheckedMinute = nowTime;

    const configs  = readConfig();
    const matching = configs.filter(c => c.enabled !== false && c.time === nowTime);
    if (!matching.length) return;

    const knownGroups = await readKnownGroups();

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

          // ── Gửi Joke từ JokeAPI ───────────────────────────────────────────
          if (cfg.joke) {
            const jokeText = await fetchJoke(
              cfg.jokeCategory || "Any",
              cfg.jokeLang     || "en",
              cfg.jokeFlags    || null
            );
            if (jokeText) {
              await api.sendMessage(
                { msg: jokeText, ttl: 600_000 },
                threadId,
                ThreadType.Group
              );
            } else {
              global.logWarn?.(`[AutoSend] Không lấy được joke cho lịch ${cfg.time}`);
            }
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
                const videoUrl = await global.zaloUploadAttachment(api, tmpPath, threadId, ThreadType.Group);
                if (!videoUrl) throw new Error("zaloUploadAttachment không trả về URL");
                const tmpSize = fs.statSync(tmpPath).size;
                await api.sendVideo({
                  videoUrl,
                  thumbnailUrl: "",
                  msg:          "",
                  width:        576,
                  height:       1024,
                  duration:     10000,
                  fileSize:     tmpSize,
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
            const meta    = getVideoMeta(videoPath);
            const vidSize = fs.statSync(videoPath).size;
            const videoUrl = await global.zaloUploadAttachment(api, videoPath, threadId, ThreadType.Group);
            if (videoUrl) {
              await api.sendVideo({
                videoUrl,
                thumbnailUrl: "",
                msg:          "",
                width:        meta.width    || 1280,
                height:       meta.height   || 720,
                duration:     Math.max(1000, (meta.duration || 1) * 1000),
                fileSize:     vidSize,
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

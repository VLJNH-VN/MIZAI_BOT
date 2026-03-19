/**
 * src/events/autoSend.js
 * Tự động gửi tin nhắn định kỳ theo lịch cấu hình trong autoSend.json
 */

const fs   = require("fs");
const path = require("path");
const { ThreadType } = require("zca-js");
const { sendVideo, getVideoMeta, VIDEO_DIR } = require("../../utils/media/media");

const CONFIG_FILE = path.join(process.cwd(), "includes", "data", "autoSend.json");
const GROUPS_FILE = path.join(process.cwd(), "includes", "database", "groupsCache.json");

const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm"]);

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
          await api.sendMessage(
            { msg: cfg.content, ttl: 600_000 },
            threadId,
            ThreadType.Group
          );

          const videoPath = pickRandomVideo();
          if (videoPath) {
            const meta = getVideoMeta(videoPath);
            await sendVideo(api, videoPath, threadId, ThreadType.Group, {
              width:    meta.width    || 1280,
              height:   meta.height   || 720,
              duration: meta.duration || 0,
              msg:      "",
            });
          }
        } catch (err) {
          logWarn(`[AutoSend] Gửi thất bại tới ${threadId}: ${err?.message}`);
        }
      }
    }
  }, INTERVAL_MS);
}

module.exports = { startAutoSend };

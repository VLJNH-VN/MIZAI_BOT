/**
 * includes/auto/autoSend.js
 * Tự động gửi tin nhắn định kỳ theo lịch cấu hình trong autoSend.json
 *
 * Cấu hình (includes/data/autoSend.json):
 * [
 *   {
 *     "time": "08:00",           // Giờ:phút (24h format)
 *     "content": "Good morning!",
 *     "threadIds": ["group_id_1", "group_id_2"],  // nếu rỗng = gửi tất cả nhóm đã biết
 *     "enabled": true
 *   }
 * ]
 */

const fs   = require("fs");
const path = require("path");
const { ThreadType } = require("zca-js");

const CONFIG_FILE = path.join(process.cwd(), "includes", "data", "autoSend.json");
const GROUPS_FILE = path.join(process.cwd(), "includes", "database", "groupsCache.json");

const INTERVAL_MS = 60 * 1000;
let lastCheckedMinute = "";

function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      const sample = [
        {
          time: "08:00",
          content: "Chào buổi sáng! ☀️ Bot đang hoạt động bình thường.",
          threadIds: [],
          enabled: false
        }
      ];
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(sample, null, 2));
      return sample;
    }
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch { return []; }
}

function readKnownGroups() {
  try {
    if (!fs.existsSync(GROUPS_FILE)) return [];
    const cache = JSON.parse(fs.readFileSync(GROUPS_FILE, "utf-8"));
    return Object.keys(cache);
  } catch { return []; }
}

function currentHHMM() {
  const now = new Date();
  const h   = String(now.getHours()).padStart(2, "0");
  const m   = String(now.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function startAutoSend(api) {
  logInfo("[AutoSend] Đã khởi động.");

  setInterval(async () => {
    const nowTime = currentHHMM();
    if (nowTime === lastCheckedMinute) return;
    lastCheckedMinute = nowTime;

    const configs = readConfig();
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
        } catch (err) {
          logWarn(`[AutoSend] Gửi thất bại tới ${threadId}: ${err?.message}`);
        }
      }
    }
  }, INTERVAL_MS);
}

module.exports = { startAutoSend };

/**
 * Lưu và đọc timestamp lần cuối bot online
 * Dùng để xác định tin nhắn nào bị bỏ lỡ khi bot offline
 */

const fs = require("fs");
const path = require("path");

const LAST_SEEN_PATH = path.join(__dirname, "../../includes/data/lastSeen.json");

function saveLastSeen() {
  try {
    const data = { ts: Date.now() };
    fs.writeFileSync(LAST_SEEN_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    logWarn(`[lastSeen] Không thể lưu timestamp: ${err?.message}`);
  }
}

function loadLastSeen() {
  try {
    if (!fs.existsSync(LAST_SEEN_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(LAST_SEEN_PATH, "utf-8"));
    return typeof raw.ts === "number" ? raw.ts : null;
  } catch {
    return null;
  }
}

module.exports = { saveLastSeen, loadLastSeen };

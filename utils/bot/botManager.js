const fs = require("fs");
const path = require("path");

// ── File helpers (nội bộ) ─────────────────────────────────────────────────────

function readJsonFile(filePath, fallback = null) {
  try {
    if (fs.existsSync(filePath))
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {}
  return fallback;
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ── Admin ─────────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, "../../config.json");

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function getBotAdminIds() {
  const cfg = readConfig();
  const ownerId = cfg?.ownerId ? String(cfg.ownerId) : "";
  const extra = Array.isArray(cfg?.adminBotIds) ? cfg.adminBotIds : [];
  return new Set([ownerId, ...extra].filter(Boolean).map(String));
}

function isBotAdmin(userId) {
  if (!userId) return false;
  return getBotAdminIds().has(String(userId));
}

async function isGroupAdmin({ api, groupId, userId }) {
  try {
    if (!api || !groupId || !userId) return false;
    const res = await api.getGroupInfo(String(groupId));
    const info = res?.gridInfoMap?.[String(groupId)];
    if (!info) return false;
    const adminIds = Array.isArray(info.adminIds) ? info.adminIds.map(String) : [];
    const creatorId = info.creatorId ? String(info.creatorId) : "";
    return adminIds.includes(String(userId)) || (!!creatorId && creatorId === String(userId));
  } catch {
    return false;
  }
}

// ── Anti Manager (SQLite-backed in-memory cache) ───────────────────────────────
const {
  getGroupAnti,
  setGroupAnti,
  isAntiUndoEnabled,
  getAllAntiGroupIds,
} = require("../../includes/database/antiManager");

// ── AntiOut tracking (in-memory — không cần persist) ─────────────────────────
const _antiOutStore = new Map();

function recordJoin(groupId, userId) {
  const key = `${groupId}:${userId}`;
  if (!_antiOutStore.has(key)) _antiOutStore.set(key, { joinCount: 0, lastJoin: 0 });
  const rec = _antiOutStore.get(key);
  rec.joinCount += 1;
  rec.lastJoin = Date.now();
  return rec.joinCount;
}

function resetJoinCount(groupId, userId) {
  const key = `${groupId}:${userId}`;
  if (_antiOutStore.has(key)) _antiOutStore.get(key).joinCount = 0;
}

function getJoinCount(groupId, userId) {
  return _antiOutStore.get(`${groupId}:${userId}`)?.joinCount ?? 0;
}

// ── Spam tracking (in-memory) ─────────────────────────────────────────────────
const spamStore = new Map();

function recordMessage(groupId, userId) {
  const key = `${groupId}:${userId}`;
  const now = Date.now();
  if (!spamStore.has(key)) spamStore.set(key, []);
  const times = spamStore.get(key);
  times.push(now);
  const cutoff = now - 30000;
  const cleaned = times.filter(t => t >= cutoff);
  spamStore.set(key, cleaned);
  return cleaned;
}

function clearSpam(groupId, userId) {
  const key = `${groupId}:${userId}`;
  spamStore.delete(key);
}

// ── Group Settings (rank on/off) — in-memory cache + async SQLite ────────────
const GROUP_SETTINGS_FILE = path.join(__dirname, "../../includes/data/groupSettings.json");

// In-memory cache: Map<groupId, { key: value, ... }>
const _settingsCache = new Map();

// Khởi tạo từ file cũ (sync, một lần duy nhất) — backward-compatible migration
(function _initSettingsCache() {
  try {
    const raw = readJsonFile(GROUP_SETTINGS_FILE, {});
    for (const [gid, cfg] of Object.entries(raw)) {
      if (cfg && typeof cfg === "object") _settingsCache.set(String(gid), { ...cfg });
    }
  } catch {}
})();

// Async write sang SQLite (không block)
async function _persistSetting(groupId, key, value) {
  try {
    const { setSetting } = require("../../includes/database/groupSettings");
    await setSetting(String(groupId), key, value);
  } catch {}
}

function getGroupSetting(groupId, key, defaultVal = true) {
  const gid = String(groupId);
  const cfg = _settingsCache.get(gid);
  if (!cfg) return defaultVal;
  return cfg[key] === undefined ? defaultVal : cfg[key];
}

function setGroupSetting(groupId, key, value) {
  const gid = String(groupId);
  if (!_settingsCache.has(gid)) _settingsCache.set(gid, {});
  _settingsCache.get(gid)[key] = value;
  _persistSetting(gid, key, value).catch(() => {});
}

module.exports = {
  getBotAdminIds,
  isBotAdmin,
  isGroupAdmin,
  getGroupAnti,
  setGroupAnti,
  getAllAntiGroupIds,
  recordJoin,
  resetJoinCount,
  getJoinCount,
  recordMessage,
  clearSpam,
  isAntiUndoEnabled,
  getGroupSetting,
  setGroupSetting,
};

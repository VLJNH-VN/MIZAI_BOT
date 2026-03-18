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

// ── Anti Manager ──────────────────────────────────────────────────────────────

const ANTI_FILE     = path.join(__dirname, "../../includes/data/anti.json");
const ANTI_OUT_FILE = path.join(__dirname, "../../includes/data/antiOut.json");

function readAnti() {
  return readJsonFile(ANTI_FILE, {});
}

function saveAnti(data) {
  writeJsonFile(ANTI_FILE, data);
}

function getGroupAnti(groupId) {
  const data = readAnti();
  if (!data[groupId]) data[groupId] = {};
  const g = data[groupId];
  return {
    antiLink:          g.antiLink          ?? false,
    antiSpam:          g.antiSpam          ?? false,
    antiNsfw:          g.antiNsfw          ?? false,
    antiFake:          g.antiFake          ?? false,
    antiOut:           g.antiOut           ?? false,
    antiUndo:          g.antiUndo          ?? false,
    antiBot:           g.antiBot           ?? false,
    antiLinkWhitelist: g.antiLinkWhitelist ?? [],
    antiSpamThreshold: g.antiSpamThreshold ?? 5,
    antiSpamWindow:    g.antiSpamWindow    ?? 5,
    antiOutMaxRejoins: g.antiOutMaxRejoins ?? 3,
  };
}

function setGroupAnti(groupId, key, value) {
  const data = readAnti();
  if (!data[groupId]) data[groupId] = {};
  data[groupId][key] = value;
  saveAnti(data);
}

function readAntiOut() {
  return readJsonFile(ANTI_OUT_FILE, {});
}

function saveAntiOut(data) {
  writeJsonFile(ANTI_OUT_FILE, data);
}

function recordJoin(groupId, userId) {
  const data = readAntiOut();
  if (!data[groupId]) data[groupId] = {};
  if (!data[groupId][userId]) data[groupId][userId] = { joinCount: 0, lastJoin: 0 };
  data[groupId][userId].joinCount += 1;
  data[groupId][userId].lastJoin = Date.now();
  saveAntiOut(data);
  return data[groupId][userId].joinCount;
}

function resetJoinCount(groupId, userId) {
  const data = readAntiOut();
  if (data[groupId] && data[groupId][userId]) {
    data[groupId][userId].joinCount = 0;
    saveAntiOut(data);
  }
}

function getJoinCount(groupId, userId) {
  const data = readAntiOut();
  return data[groupId]?.[userId]?.joinCount ?? 0;
}

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

// ── Group Settings (rank on/off, v.v.) ───────────────────────────────────────

const GROUP_SETTINGS_FILE = path.join(__dirname, "../../includes/data/groupSettings.json");

function readGroupSettings() {
  return readJsonFile(GROUP_SETTINGS_FILE, {});
}

function saveGroupSettings(data) {
  writeJsonFile(GROUP_SETTINGS_FILE, data);
}

function getGroupSetting(groupId, key, defaultVal = true) {
  const data = readGroupSettings();
  if (!data[groupId]) return defaultVal;
  const val = data[groupId][key];
  return val === undefined ? defaultVal : val;
}

function setGroupSetting(groupId, key, value) {
  const data = readGroupSettings();
  if (!data[groupId]) data[groupId] = {};
  data[groupId][key] = value;
  saveGroupSettings(data);
}

module.exports = {
  getBotAdminIds,
  isBotAdmin,
  isGroupAdmin,
  getGroupAnti,
  setGroupAnti,
  recordJoin,
  resetJoinCount,
  getJoinCount,
  recordMessage,
  clearSpam,
  isAntiUndoEnabled: (groupId) => getGroupAnti(groupId).antiUndo,
  getGroupSetting,
  setGroupSetting,
};

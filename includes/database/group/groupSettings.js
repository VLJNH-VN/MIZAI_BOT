/**
 * includes/database/groupSettings.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Controller cho per-group settings (theo kiến trúc AURABOT's Thread model):
 *   prefix   TEXT    — prefix riêng từng nhóm (default: global prefix)
 *   rankup   INTEGER — bật/tắt thông báo lên cấp (0/1)
 *   settings TEXT    — JSON string cho các cài đặt tuỳ ý
 *
 * API (expose qua global.Threads):
 *   getPrefix(threadId)                     → Promise<string>
 *   setPrefix(threadId, prefix)             → Promise<void>
 *   getRankup(threadId)                     → Promise<boolean>
 *   setRankup(threadId, value)              → Promise<void>
 *   getSettings(threadId)                   → Promise<object>
 *   getSetting(threadId, key, default?)     → Promise<any>
 *   setSetting(threadId, key, value)        → Promise<void>
 *   setSettings(threadId, obj)              → Promise<void>
 *   getData(threadId, name?)                → Promise<object>  row đầy đủ
 */

const { getDb, run, get, all } = require("../core/sqlite");

// Cache prefix trong bộ nhớ để tránh hit DB mỗi tin nhắn
const _prefixCache     = new Map();
const PREFIX_CACHE_TTL = 5 * 60 * 1000;
const PREFIX_CACHE_MAX = 50;

function _prefixCacheSet(id, entry) {
  if (_prefixCache.size >= PREFIX_CACHE_MAX && !_prefixCache.has(id)) {
    _prefixCache.delete(_prefixCache.keys().next().value);
  }
  _prefixCache.set(id, entry);
}

function _defaultPrefix() {
  return global.prefix || global.config?.prefix || ".";
}

// Đảm bảo row nhóm tồn tại (upsert tối giản)
async function _ensureGroup(db, threadId) {
  const now = Date.now();
  await run(db,
    `INSERT INTO groups (group_id, name, first_seen, updated_at)
     VALUES (?, '', ?, ?)
     ON CONFLICT(group_id) DO NOTHING`,
    [String(threadId), now, now]
  ).catch(() => {});
}

// ── Prefix ────────────────────────────────────────────────────────────────────

async function getPrefix(threadId) {
  const id = String(threadId);
  const cached = _prefixCache.get(id);
  if (cached && Date.now() - cached.ts < PREFIX_CACHE_TTL) return cached.value;

  const db = await getDb();
  const row = await get(db, "SELECT prefix FROM groups WHERE group_id = ?", [id]);
  const value = (row?.prefix && row.prefix.trim()) ? row.prefix : _defaultPrefix();
  _prefixCacheSet(id, { value, ts: Date.now() });
  return value;
}

async function setPrefix(threadId, prefix) {
  const id  = String(threadId);
  const val = (prefix || _defaultPrefix()).trim();
  const db  = await getDb();
  await _ensureGroup(db, id);
  await run(db,
    "UPDATE groups SET prefix = ?, updated_at = ? WHERE group_id = ?",
    [val, Date.now(), id]
  );
  _prefixCacheSet(id, { value: val, ts: Date.now() });
}

// ── Rankup ────────────────────────────────────────────────────────────────────

async function getRankup(threadId) {
  const db  = await getDb();
  const row = await get(db, "SELECT rankup FROM groups WHERE group_id = ?", [String(threadId)]);
  return row ? Boolean(row.rankup) : false;
}

async function setRankup(threadId, value) {
  const db = await getDb();
  await _ensureGroup(db, String(threadId));
  await run(db,
    "UPDATE groups SET rankup = ?, updated_at = ? WHERE group_id = ?",
    [value ? 1 : 0, Date.now(), String(threadId)]
  );
}

// ── Settings (JSON) ───────────────────────────────────────────────────────────

async function getSettings(threadId) {
  const db  = await getDb();
  const row = await get(db, "SELECT settings FROM groups WHERE group_id = ?", [String(threadId)]);
  if (!row?.settings) return {};
  try { return JSON.parse(row.settings); } catch { return {}; }
}

async function getSetting(threadId, key, defaultVal = null) {
  const settings = await getSettings(threadId);
  return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : defaultVal;
}

async function setSettings(threadId, obj) {
  const db = await getDb();
  await _ensureGroup(db, String(threadId));
  await run(db,
    "UPDATE groups SET settings = ?, updated_at = ? WHERE group_id = ?",
    [JSON.stringify(obj ?? {}), Date.now(), String(threadId)]
  );
}

async function setSetting(threadId, key, value) {
  const settings = await getSettings(threadId);
  settings[key] = value;
  await setSettings(threadId, settings);
}

// ── Data tổng hợp (như AURABOT's Threads.getData) ────────────────────────────

async function getData(threadId, name) {
  const id = String(threadId);
  const db = await getDb();
  await _ensureGroup(db, id);
  if (name) {
    await run(db,
      "UPDATE groups SET name = COALESCE(?, name), updated_at = ? WHERE group_id = ?",
      [name, Date.now(), id]
    ).catch(() => {});
  }
  const row = await get(db, "SELECT * FROM groups WHERE group_id = ?", [id]);
  if (!row) return null;
  return {
    ...row,
    prefix:   (row.prefix && row.prefix.trim()) ? row.prefix : _defaultPrefix(),
    rankup:   Boolean(row.rankup),
    settings: (() => { try { return row.settings ? JSON.parse(row.settings) : {}; } catch { return {}; } })()
  };
}

// ── Lấy tất cả group_id từ SQLite ────────────────────────────────────────────

async function getAllGroupIds() {
  try {
    const db   = await getDb();
    const rows = await all(db, "SELECT group_id FROM groups");
    return rows.map(r => r.group_id).filter(Boolean);
  } catch { return []; }
}

// ── Xoá cache prefix (dùng khi đổi global prefix) ────────────────────────────
function clearPrefixCache(threadId) {
  if (threadId) _prefixCache.delete(String(threadId));
  else _prefixCache.clear();
}

module.exports = {
  getPrefix,
  setPrefix,
  getRankup,
  setRankup,
  getAllGroupIds,
  getSettings,
  getSetting,
  setSettings,
  setSetting,
  getData,
  clearPrefixCache
};

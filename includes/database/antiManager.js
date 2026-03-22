/**
 * includes/database/antiManager.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Quản lý anti-settings cho từng nhóm với in-memory cache + SQLite backing.
 *
 * CHIẾN LƯỢC:
 *   - Load sync từ anti.json khi module được require (backward-compatible)
 *   - Mọi read đều từ in-memory Map → O(1), không có disk I/O
 *   - Write cập nhật cache ngay + async write vào SQLite nền
 *
 * EXPORT (API giữ nguyên sync — không break callers):
 *   getGroupAnti(groupId)                → object (sync)
 *   setGroupAnti(groupId, key, value)    → void (async SQLite write nền)
 *   isAntiUndoEnabled(groupId)           → bool (sync)
 */

const fs   = require("fs");
const path = require("path");

const ANTI_FILE = path.join(__dirname, "../data/config/anti.json");

const DEFAULT_ANTI = {
  antiLink:          false,
  antiSpam:          false,
  antiNsfw:          false,
  antiFake:          false,
  antiOut:           false,
  antiUndo:          false,
  antiBot:           false,
  antiBotUids:       [],
  antiLinkWhitelist: [],
  antiSpamThreshold: 5,
  antiSpamWindow:    5,
  antiOutMaxRejoins: 3,
};

// ── In-memory cache ───────────────────────────────────────────────────────────
// Map<groupId, antiConfigObject>
const _cache = new Map();

function _defaultConfig() {
  return { ...DEFAULT_ANTI, antiBotUids: [], antiLinkWhitelist: [] };
}

function _mergeConfig(raw) {
  const d = _defaultConfig();
  if (!raw || typeof raw !== "object") return d;
  return {
    antiLink:          raw.antiLink          ?? d.antiLink,
    antiSpam:          raw.antiSpam          ?? d.antiSpam,
    antiNsfw:          raw.antiNsfw          ?? d.antiNsfw,
    antiFake:          raw.antiFake          ?? d.antiFake,
    antiOut:           raw.antiOut           ?? d.antiOut,
    antiUndo:          raw.antiUndo          ?? d.antiUndo,
    antiBot:           raw.antiBot           ?? d.antiBot,
    antiBotUids:       Array.isArray(raw.antiBotUids)       ? raw.antiBotUids.map(String)       : [],
    antiLinkWhitelist: Array.isArray(raw.antiLinkWhitelist) ? raw.antiLinkWhitelist               : [],
    antiSpamThreshold: raw.antiSpamThreshold ?? d.antiSpamThreshold,
    antiSpamWindow:    raw.antiSpamWindow    ?? d.antiSpamWindow,
    antiOutMaxRejoins: raw.antiOutMaxRejoins ?? d.antiOutMaxRejoins,
  };
}

// ── Load từ JSON khi module được require (sync) ───────────────────────────────
(function _initFromJson() {
  try {
    if (fs.existsSync(ANTI_FILE)) {
      const raw = JSON.parse(fs.readFileSync(ANTI_FILE, "utf-8"));
      for (const [gid, cfg] of Object.entries(raw)) {
        _cache.set(String(gid), _mergeConfig(cfg));
      }
    }
  } catch {}
})();

// ── Async SQLite migrate ──────────────────────────────────────────────────────
let _migrated = false;

async function _migrateToSqlite() {
  if (_migrated) return;
  _migrated = true;
  try {
    const { getDb, run, all } = require("./sqlite");
    const db = await getDb();

    const dbRows = await all(db, "SELECT group_id FROM group_anti").catch(() => []);
    const dbSet  = new Set(dbRows.map(r => r.group_id));

    for (const [gid, cfg] of _cache) {
      if (!dbSet.has(gid)) {
        await run(db,
          `INSERT OR IGNORE INTO group_anti (group_id, cfg_json, updated_at) VALUES (?, ?, ?)`,
          [gid, JSON.stringify(cfg), Date.now()]
        ).catch(() => {});
      }
    }

    const allRows = await all(db, "SELECT group_id, cfg_json FROM group_anti").catch(() => []);
    for (const row of allRows) {
      try { _cache.set(row.group_id, _mergeConfig(JSON.parse(row.cfg_json))); } catch {}
    }

  } catch (err) {
    if (typeof logError === "function") logError(`[AntiManager] Migrate SQLite lỗi: ${err?.message}`);
  }
}

setTimeout(() => _migrateToSqlite().catch(() => {}), 3500);

// ── Async write helper ────────────────────────────────────────────────────────
async function _dbSave(groupId, cfg) {
  try {
    const { getDb, run } = require("./sqlite");
    const db = await getDb();
    await run(db,
      `INSERT INTO group_anti (group_id, cfg_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(group_id) DO UPDATE SET cfg_json=excluded.cfg_json, updated_at=excluded.updated_at`,
      [String(groupId), JSON.stringify(cfg), Date.now()]
    );
  } catch {}
}

// ── Public API ────────────────────────────────────────────────────────────────

function getGroupAnti(groupId) {
  const gid = String(groupId);
  if (!_cache.has(gid)) _cache.set(gid, _defaultConfig());
  return _cache.get(gid);
}

function setGroupAnti(groupId, key, value) {
  const gid = String(groupId);
  if (!_cache.has(gid)) _cache.set(gid, _defaultConfig());
  const cfg = _cache.get(gid);
  cfg[key] = value;
  _dbSave(gid, cfg).catch(() => {});
}

function isAntiUndoEnabled(groupId) {
  return getGroupAnti(groupId).antiUndo;
}

function getAllAntiGroupIds() {
  return Array.from(_cache.keys());
}

module.exports = { getGroupAnti, setGroupAnti, isAntiUndoEnabled, getAllAntiGroupIds };

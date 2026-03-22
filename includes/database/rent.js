/**
 * includes/database/rent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Quản lý thuê bot (rent_groups) và key thuê (rent_keys) với SQLite.
 *
 * CHIẾN LƯỢC:
 *   - Đọc từ JSON file khi module load (sync, backward-compatible)
 *   - Ghi async vào SQLite ở nền
 *   - Mọi đọc đều từ in-memory Map → O(1), không có disk I/O
 *
 * EXPORT (sync-readable):
 *   getRentInfo(groupId)                → {group_id, owner_id, time_start, time_end} | null
 *   setRentInfo(groupId, info)          → void (async SQLite write nền)
 *   removeRentInfo(groupId)             → void
 *   listRentInfo()                      → Array<info>
 *   addKey(keyStr, days)                → void
 *   useKey(keyStr)                      → void
 *   isKeyUsed(keyStr)                   → bool
 *   isKeyExists(keyStr)                 → bool
 *   listUnusedKeys()                    → string[]
 *   listUsedKeys()                      → string[]
 *   isRentExpired(groupId)              → bool
 *   parseDateVN(str)                    → Date
 *   addDays(dateStr, days)              → string
 *   todayStr()                          → string "DD/MM/YYYY"
 */

const fs   = require("fs");
const path = require("path");

const THUEBOT_PATH = path.join(__dirname, "../data/runtime/thuebot.json");
const RENTKEY_PATH = path.join(__dirname, "../data/runtime/rentKey.json");

// ── In-memory stores ──────────────────────────────────────────────────────────
const _rentCache  = new Map();
const _usedKeys   = new Set();
const _unusedKeys = new Set();

// ── Khởi tạo từ JSON (sync, chạy ngay khi require) ───────────────────────────
(function _initFromJson() {
  try {
    if (fs.existsSync(THUEBOT_PATH)) {
      const arr = JSON.parse(fs.readFileSync(THUEBOT_PATH, "utf-8"));
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item?.t_id) {
            _rentCache.set(String(item.t_id), {
              group_id:   String(item.t_id),
              owner_id:   String(item.id   || ""),
              time_start: String(item.time_start || ""),
              time_end:   String(item.time_end   || ""),
            });
          }
        }
      }
    }
  } catch {}

  try {
    if (fs.existsSync(RENTKEY_PATH)) {
      const raw = JSON.parse(fs.readFileSync(RENTKEY_PATH, "utf-8"));
      if (Array.isArray(raw.used_keys))   raw.used_keys.forEach(k => _usedKeys.add(String(k)));
      if (Array.isArray(raw.unUsed_keys)) raw.unUsed_keys.forEach(k => _unusedKeys.add(String(k)));
    }
  } catch {}
})();

// ── Async SQLite migrate (chạy sau khi DB sẵn sàng) ──────────────────────────
let _migrated = false;

async function _migrateToSqlite() {
  if (_migrated) return;
  _migrated = true;
  try {
    const { getDb, run, all } = require("./sqlite");
    const db = await getDb();

    const dbRentRows = await all(db, "SELECT group_id FROM rent_groups").catch(() => []);
    const dbRentSet  = new Set(dbRentRows.map(r => r.group_id));

    for (const [gid, info] of _rentCache) {
      if (!dbRentSet.has(gid)) {
        await run(db,
          `INSERT OR IGNORE INTO rent_groups (group_id, owner_id, time_start, time_end, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [gid, info.owner_id, info.time_start, info.time_end, Date.now(), Date.now()]
        ).catch(() => {});
      }
    }

    const dbKeyRows = await all(db, "SELECT key_str, is_used FROM rent_keys").catch(() => []);
    const dbKeySet  = new Set(dbKeyRows.map(r => r.key_str));

    for (const k of _usedKeys) {
      if (!dbKeySet.has(k)) {
        const days = _parseDaysFromKey(k);
        await run(db,
          `INSERT OR IGNORE INTO rent_keys (key_str, days, is_used, created_at) VALUES (?, ?, 1, ?)`,
          [k, days, Date.now()]
        ).catch(() => {});
      }
    }
    for (const k of _unusedKeys) {
      if (!dbKeySet.has(k)) {
        const days = _parseDaysFromKey(k);
        await run(db,
          `INSERT OR IGNORE INTO rent_keys (key_str, days, is_used, created_at) VALUES (?, ?, 0, ?)`,
          [k, days, Date.now()]
        ).catch(() => {});
      }
    }

    const allDbRent = await all(db, "SELECT * FROM rent_groups").catch(() => []);
    for (const row of allDbRent) {
      _rentCache.set(row.group_id, {
        group_id:   row.group_id,
        owner_id:   row.owner_id   || "",
        time_start: row.time_start || "",
        time_end:   row.time_end   || "",
      });
    }
    const allDbKeys = await all(db, "SELECT key_str, is_used FROM rent_keys").catch(() => []);
    for (const row of allDbKeys) {
      if (row.is_used) { _usedKeys.add(row.key_str); _unusedKeys.delete(row.key_str); }
      else             { _unusedKeys.add(row.key_str); _usedKeys.delete(row.key_str); }
    }

  } catch (err) {
    if (typeof logError === "function") logError(`[Rent] Migrate SQLite lỗi: ${err?.message}`);
  }
}

setTimeout(() => _migrateToSqlite().catch(() => {}), 3000);

// ── Async write helper ────────────────────────────────────────────────────────
async function _dbUpsertRent(info) {
  try {
    const { getDb, run } = require("./sqlite");
    const db = await getDb();
    await run(db,
      `INSERT INTO rent_groups (group_id, owner_id, time_start, time_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(group_id) DO UPDATE SET
         owner_id=excluded.owner_id, time_start=excluded.time_start,
         time_end=excluded.time_end, updated_at=excluded.updated_at`,
      [info.group_id, info.owner_id, info.time_start, info.time_end, Date.now(), Date.now()]
    );
  } catch {}
}

async function _dbDeleteRent(groupId) {
  try {
    const { getDb, run } = require("./sqlite");
    const db = await getDb();
    await run(db, "DELETE FROM rent_groups WHERE group_id = ?", [groupId]);
  } catch {}
}

async function _dbUpsertKey(keyStr, isUsed) {
  try {
    const { getDb, run } = require("./sqlite");
    const db = await getDb();
    const days = _parseDaysFromKey(keyStr);
    await run(db,
      `INSERT INTO rent_keys (key_str, days, is_used, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key_str) DO UPDATE SET is_used=excluded.is_used`,
      [keyStr, days, isUsed ? 1 : 0, Date.now()]
    );
  } catch {}
}

// ── Helpers ngày tháng ────────────────────────────────────────────────────────

function todayStr() {
  const d  = new Date(Date.now() + 7 * 3600 * 1000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

function parseDateVN(str) {
  const [dd, mm, yyyy] = (str || "").split("/").map(Number);
  return new Date(Date.UTC(yyyy, mm - 1, dd));
}

function addDays(dateStr, days) {
  const d  = parseDateVN(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

function isRentExpired(groupId) {
  const info = _rentCache.get(String(groupId));
  if (!info) return true;
  return parseDateVN(info.time_end).getTime() <= Date.now() + 7 * 3600 * 1000;
}

function _parseDaysFromKey(keyStr) {
  const parts = String(keyStr).split("_");
  const days  = parseInt(parts[parts.length - 2], 10);
  return isNaN(days) ? 30 : days;
}

// ── Public API (sync reads) ───────────────────────────────────────────────────

function getRentInfo(groupId) {
  return _rentCache.get(String(groupId)) || null;
}

function setRentInfo(groupId, info) {
  const data = { group_id: String(groupId), owner_id: info.owner_id || "", time_start: info.time_start || "", time_end: info.time_end || "" };
  _rentCache.set(String(groupId), data);
  _dbUpsertRent(data).catch(() => {});
}

function removeRentInfo(groupId) {
  _rentCache.delete(String(groupId));
  _dbDeleteRent(String(groupId)).catch(() => {});
}

function listRentInfo() {
  return Array.from(_rentCache.values());
}

function addKey(keyStr, days) {
  _unusedKeys.add(String(keyStr));
  _dbUpsertKey(String(keyStr), false).catch(() => {});
}

function useKey(keyStr) {
  _unusedKeys.delete(String(keyStr));
  _usedKeys.add(String(keyStr));
  _dbUpsertKey(String(keyStr), true).catch(() => {});
}

function isKeyUsed(keyStr)   { return _usedKeys.has(String(keyStr)); }
function isKeyExists(keyStr) { return _usedKeys.has(String(keyStr)) || _unusedKeys.has(String(keyStr)); }
function listUnusedKeys()    { return Array.from(_unusedKeys); }
function listUsedKeys()      { return Array.from(_usedKeys); }

module.exports = {
  getRentInfo, setRentInfo, removeRentInfo, listRentInfo,
  addKey, useKey, isKeyUsed, isKeyExists, listUnusedKeys, listUsedKeys,
  isRentExpired, parseDateVN, addDays, todayStr,
};

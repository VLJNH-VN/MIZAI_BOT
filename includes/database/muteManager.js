/**
 * includes/database/muteManager.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Quản lý mute người dùng theo nhóm với in-memory cache + SQLite backing.
 *
 * CHIẾN LƯỢC:
 *   - Load sync từ muted.json khi module được require
 *   - isMuted() đọc từ cache → O(1), không có disk I/O
 *   - muteUser/unmuteUser cập nhật cache ngay + async write SQLite nền
 *   - Tự dọn dẹp expired entries định kỳ mỗi 5 phút
 *
 * EXPORT:
 *   isMuted(groupId, userId)                            → bool (sync)
 *   muteUser(groupId, userId, name, expireAt)           → void
 *   unmuteUser(groupId, userId)                         → void
 *   getMutedList(groupId)                               → Array<{userId, name, expireAt, mutedAt}>
 */

const fs   = require("fs");
const path = require("path");

const MUTE_FILE = path.join(__dirname, "../data/muted.json");

// ── In-memory cache ───────────────────────────────────────────────────────────
// Map<"groupId:userId", {name, mutedAt, expireAt}>
const _cache = new Map();

function _key(groupId, userId) { return `${groupId}:${userId}`; }

// ── Load từ JSON khi module được require (sync) ───────────────────────────────
(function _initFromJson() {
  try {
    if (fs.existsSync(MUTE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(MUTE_FILE, "utf-8"));
      const now = Date.now();
      for (const [k, v] of Object.entries(raw)) {
        if (v.expireAt && v.expireAt <= now) continue;
        _cache.set(k, { name: v.name || k.split(":")[1] || "", mutedAt: v.mutedAt || now, expireAt: v.expireAt || 0 });
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
    const db  = await getDb();
    const now = Date.now();

    const dbRows = await all(db, "SELECT group_id, user_id FROM group_muted").catch(() => []);
    const dbSet  = new Set(dbRows.map(r => `${r.group_id}:${r.user_id}`));

    for (const [k, v] of _cache) {
      if (v.expireAt && v.expireAt <= now) continue;
      if (!dbSet.has(k)) {
        const [gid, uid] = k.split(":");
        await run(db,
          `INSERT OR IGNORE INTO group_muted (group_id, user_id, name, muted_at, expire_at) VALUES (?, ?, ?, ?, ?)`,
          [gid, uid, v.name || "", v.mutedAt || now, v.expireAt || 0]
        ).catch(() => {});
      }
    }

    const allRows = await all(db, "SELECT * FROM group_muted WHERE expire_at = 0 OR expire_at > ?", [now]).catch(() => []);
    _cache.clear();
    for (const row of allRows) {
      _cache.set(_key(row.group_id, row.user_id), {
        name:     row.name    || "",
        mutedAt:  row.muted_at || now,
        expireAt: row.expire_at || 0,
      });
    }

  } catch (err) {
    if (typeof logError === "function") logError(`[MuteManager] Migrate SQLite lỗi: ${err?.message}`);
  }
}

setTimeout(() => _migrateToSqlite().catch(() => {}), 4000);

// ── Dọn dẹp expired định kỳ ──────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _cache) {
    if (v.expireAt && v.expireAt <= now) {
      _cache.delete(k);
      const [gid, uid] = k.split(":");
      _dbDelete(gid, uid).catch(() => {});
    }
  }
}, 5 * 60 * 1000);

// ── Async write helpers ───────────────────────────────────────────────────────
async function _dbUpsert(groupId, userId, name, mutedAt, expireAt) {
  try {
    const { getDb, run } = require("./sqlite");
    const db = await getDb();
    await run(db,
      `INSERT INTO group_muted (group_id, user_id, name, muted_at, expire_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(group_id, user_id) DO UPDATE SET name=excluded.name, muted_at=excluded.muted_at, expire_at=excluded.expire_at`,
      [String(groupId), String(userId), name || "", mutedAt, expireAt || 0]
    );
  } catch {}
}

async function _dbDelete(groupId, userId) {
  try {
    const { getDb, run } = require("./sqlite");
    const db = await getDb();
    await run(db, "DELETE FROM group_muted WHERE group_id = ? AND user_id = ?", [String(groupId), String(userId)]);
  } catch {}
}

// ── Public API ────────────────────────────────────────────────────────────────

function isMuted(groupId, userId) {
  const k   = _key(String(groupId), String(userId));
  const rec = _cache.get(k);
  if (!rec) return false;
  if (rec.expireAt && Date.now() > rec.expireAt) {
    _cache.delete(k);
    _dbDelete(String(groupId), String(userId)).catch(() => {});
    return false;
  }
  return true;
}

function muteUser(groupId, userId, name, expireAt) {
  const gid     = String(groupId);
  const uid     = String(userId);
  const now     = Date.now();
  const rec     = { name: name || uid, mutedAt: now, expireAt: expireAt || 0 };
  _cache.set(_key(gid, uid), rec);
  _dbUpsert(gid, uid, rec.name, now, expireAt || 0).catch(() => {});
}

function unmuteUser(groupId, userId) {
  const gid = String(groupId);
  const uid = String(userId);
  _cache.delete(_key(gid, uid));
  _dbDelete(gid, uid).catch(() => {});
}

function getMutedList(groupId) {
  const gid    = String(groupId);
  const now    = Date.now();
  const result = [];
  for (const [k, v] of _cache) {
    if (!k.startsWith(`${gid}:`)) continue;
    if (v.expireAt && v.expireAt <= now) continue;
    const uid = k.slice(gid.length + 1);
    result.push({ userId: uid, name: v.name, mutedAt: v.mutedAt, expireAt: v.expireAt });
  }
  return result;
}

module.exports = { isMuted, muteUser, unmuteUser, getMutedList };

/**
 * includes/database/dataManager.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Module quản lý dữ liệu nhóm & người dùng — lưu vào SQLite.
 *
 * EXPORT:
 *   ── USER ──
 *   saveUser(userId, { name, profile })       — upsert user, tăng msg_count
 *   getUser(userId)                            — đọc 1 user
 *   getAllUsers({ limit, orderBy })            — đọc toàn bộ user
 *   searchUsers(keyword)                       — tìm theo tên
 *   getUserStats()                             — thống kê user
 *
 *   ── GROUP ──
 *   saveGroup(groupId, { name, info, memVerList, pendingApprove }) — upsert group
 *   getGroup(groupId)                          — đọc 1 group
 *   getAllGroups({ limit, orderBy })           — đọc toàn bộ group
 *   searchGroups(keyword)                      — tìm theo tên
 *   getGroupStats()                            — thống kê group
 *
 *   ── AUTO SAVE ──
 *   autoSaveFromEvent(api, event)              — lưu user + group từ 1 event
 *
 *   ── SNAPSHOT ──
 *   saveSnapshot()                             — xuất includes/data/{users,groups}.json
 *
 *   ── STATS ──
 *   getStats()                                 — thống kê tổng hợp
 *
 * GLOBAL (sau khi global.js load):
 *   global.db.saveUser(...)
 *   global.db.saveGroup(...)
 *   global.db.getUser(...)
 *   global.db.getGroup(...)
 *   global.db.getStats()
 *   ...
 */

const fs   = require("fs");
const path = require("path");
const { getDb, run, get, all } = require("./sqlite");

const DATA_DIR         = path.join(__dirname, "..", "data");
const USERS_SNAPSHOT   = path.join(DATA_DIR, "users.json");
const GROUPS_SNAPSHOT  = path.join(DATA_DIR, "groups.json");

function safeJson(obj) {
  try { return JSON.stringify(obj ?? null); } catch { return "null"; }
}
function parseJson(str) {
  try { return str ? JSON.parse(str) : null; } catch { return null; }
}
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ══════════════════════════════════════════════════════════════════════════════
//  USER
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Lưu / cập nhật user vào SQLite.
 * Mỗi lần gọi sẽ tăng msg_count lên 1 (trừ khi { increment: false }).
 */
async function saveUser(userId, { name, profile } = {}, { increment = true } = {}) {
  if (!userId) return;
  const db  = await getDb();
  const uid = String(userId);
  const now = Date.now();

  // Kiểm tra xem user đã tồn tại chưa
  const existing = await get(db, "SELECT msg_count, first_seen FROM users WHERE user_id = ?", [uid]);

  const firstSeen  = existing?.first_seen || now;
  const msgCount   = (existing?.msg_count || 0) + (increment ? 1 : 0);

  await run(
    db,
    `INSERT INTO users (user_id, name, profile_json, first_seen, msg_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       name         = COALESCE(excluded.name, name),
       profile_json = COALESCE(excluded.profile_json, profile_json),
       first_seen   = CASE WHEN first_seen = 0 THEN excluded.first_seen ELSE first_seen END,
       msg_count    = excluded.msg_count,
       updated_at   = excluded.updated_at`,
    [uid, name ?? null, safeJson(profile), firstSeen, msgCount, now]
  );
}

/** Đọc 1 user từ SQLite */
async function getUser(userId) {
  const db  = await getDb();
  const row = await get(db, "SELECT * FROM users WHERE user_id = ?", [String(userId)]);
  if (!row) return null;
  return {
    userId    : row.user_id,
    name      : row.name,
    profile   : parseJson(row.profile_json),
    firstSeen : row.first_seen,
    msgCount  : row.msg_count,
    updatedAt : row.updated_at
  };
}

/**
 * Đọc toàn bộ user từ SQLite.
 * @param {object} opts
 * @param {number} [opts.limit=0]           — 0 = không giới hạn
 * @param {string} [opts.orderBy='msg_count DESC']
 */
async function getAllUsers({ limit = 0, orderBy = "msg_count DESC" } = {}) {
  const db   = await getDb();
  const sql  = `SELECT * FROM users ORDER BY ${orderBy}${limit > 0 ? ` LIMIT ${limit}` : ""}`;
  const rows = await all(db, sql);
  return rows.map(r => ({
    userId    : r.user_id,
    name      : r.name,
    profile   : parseJson(r.profile_json),
    firstSeen : r.first_seen,
    msgCount  : r.msg_count,
    updatedAt : r.updated_at
  }));
}

/** Tìm user theo tên (không phân biệt hoa thường) */
async function searchUsers(keyword) {
  if (!keyword) return getAllUsers();
  const db   = await getDb();
  const rows = await all(db, "SELECT * FROM users WHERE name LIKE ? ORDER BY msg_count DESC", [`%${keyword}%`]);
  return rows.map(r => ({
    userId    : r.user_id,
    name      : r.name,
    firstSeen : r.first_seen,
    msgCount  : r.msg_count,
    updatedAt : r.updated_at
  }));
}

/** Thống kê user */
async function getUserStats() {
  const db = await getDb();
  const row = await get(db, `
    SELECT
      COUNT(*)          AS total,
      SUM(msg_count)    AS totalMessages,
      MAX(msg_count)    AS maxMessages,
      MIN(first_seen)   AS oldestSeen
    FROM users
  `);
  return {
    total         : row?.total         || 0,
    totalMessages : row?.totalMessages || 0,
    maxMessages   : row?.maxMessages   || 0,
    oldestSeen    : row?.oldestSeen    || null
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  GROUP
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Lưu / cập nhật group vào SQLite.
 */
async function saveGroup(groupId, { name, info, memVerList, pendingApprove } = {}) {
  if (!groupId) return;
  const db  = await getDb();
  const gid = String(groupId);
  const now = Date.now();

  const existing    = await get(db, "SELECT first_seen FROM groups WHERE group_id = ?", [gid]);
  const firstSeen   = existing?.first_seen || now;
  const memberCount = Array.isArray(memVerList) ? memVerList.length
                    : (info?.totalMember || info?.memVerList?.length || 0);

  await run(
    db,
    `INSERT INTO groups
       (group_id, name, info_json, mem_ver_list_json, pending_approve_json, member_count, first_seen, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(group_id) DO UPDATE SET
       name                 = COALESCE(excluded.name, name),
       info_json            = COALESCE(excluded.info_json, info_json),
       mem_ver_list_json    = COALESCE(excluded.mem_ver_list_json, mem_ver_list_json),
       pending_approve_json = COALESCE(excluded.pending_approve_json, pending_approve_json),
       member_count         = excluded.member_count,
       first_seen           = CASE WHEN first_seen = 0 THEN excluded.first_seen ELSE first_seen END,
       updated_at           = excluded.updated_at`,
    [
      gid,
      name ?? null,
      safeJson(info),
      safeJson(memVerList ?? null),
      safeJson(pendingApprove ?? null),
      memberCount,
      firstSeen,
      now
    ]
  );
}

/** Đọc 1 group từ SQLite */
async function getGroup(groupId) {
  const db  = await getDb();
  const row = await get(db, "SELECT * FROM groups WHERE group_id = ?", [String(groupId)]);
  if (!row) return null;
  return {
    groupId        : row.group_id,
    name           : row.name,
    info           : parseJson(row.info_json),
    memVerList     : parseJson(row.mem_ver_list_json),
    pendingApprove : parseJson(row.pending_approve_json),
    memberCount    : row.member_count,
    firstSeen      : row.first_seen,
    updatedAt      : row.updated_at
  };
}

/**
 * Đọc toàn bộ group từ SQLite.
 * @param {object} opts
 * @param {number} [opts.limit=0]
 * @param {string} [opts.orderBy='member_count DESC']
 */
async function getAllGroups({ limit = 0, orderBy = "member_count DESC" } = {}) {
  const db   = await getDb();
  const sql  = `SELECT * FROM groups ORDER BY ${orderBy}${limit > 0 ? ` LIMIT ${limit}` : ""}`;
  const rows = await all(db, sql);
  return rows.map(r => ({
    groupId        : r.group_id,
    name           : r.name,
    info           : parseJson(r.info_json),
    memVerList     : parseJson(r.mem_ver_list_json),
    memberCount    : r.member_count,
    firstSeen      : r.first_seen,
    updatedAt      : r.updated_at
  }));
}

/** Tìm group theo tên */
async function searchGroups(keyword) {
  if (!keyword) return getAllGroups();
  const db   = await getDb();
  const rows = await all(db, "SELECT * FROM groups WHERE name LIKE ? ORDER BY member_count DESC", [`%${keyword}%`]);
  return rows.map(r => ({
    groupId     : r.group_id,
    name        : r.name,
    memberCount : r.member_count,
    firstSeen   : r.first_seen,
    updatedAt   : r.updated_at
  }));
}

/** Thống kê group */
async function getGroupStats() {
  const db  = await getDb();
  const row = await get(db, `
    SELECT
      COUNT(*)          AS total,
      SUM(member_count) AS totalMembers,
      MAX(member_count) AS maxMembers,
      MIN(first_seen)   AS oldestSeen
    FROM groups
  `);
  return {
    total        : row?.total        || 0,
    totalMembers : row?.totalMembers || 0,
    maxMembers   : row?.maxMembers   || 0,
    oldestSeen   : row?.oldestSeen   || null
  };
}

// TTL: bao lâu thì gọi lại API để refresh (giống infoCache)
const USER_TTL_MS  = 7 * 24 * 60 * 60 * 1000; // 7 ngày
const GROUP_TTL_MS = 24 * 60 * 60 * 1000;      // 1 ngày

// ══════════════════════════════════════════════════════════════════════════════
//  AUTO SAVE FROM EVENT
//  Thay thế hoàn toàn warmupFromEvent (infoCache.js).
//  Gọi MỘT LẦN trong handleMessage() — chạy nền, không block pipeline.
//
//  Làm 3 việc trên mỗi tin nhắn:
//    1. Tăng msg_count của user
//    2. Nếu user chưa có tên hoặc stale (>7 ngày) → gọi api.getUserInfo
//    3. Nếu group chưa có hoặc stale (>1 ngày)    → gọi api.getGroupInfo
// ══════════════════════════════════════════════════════════════════════════════

async function autoSaveFromEvent(api, event) {
  const raw      = event?.data || {};
  const userId   = raw?.uidFrom ? String(raw.uidFrom) : null;
  const threadId = event?.threadId ? String(event.threadId) : null;
  const isGroup  = Number(event?.type) === 1; // ThreadType.Group
  const now      = Date.now();

  const tasks = [];

  // ── 1. Lưu user + refresh nếu cần ─────────────────────────────────────────
  if (userId && userId !== String(global.botId)) {
    tasks.push((async () => {
      try {
        // Tên lấy từ event (nhanh, không tốn API)
        const eventName = raw?.dName || raw?.displayName || raw?.senderName || null;

        // Lưu ngay với tên từ event, tăng msg_count
        await saveUser(userId, { name: eventName });

        // Kiểm tra xem có cần gọi API không
        const existing  = await getUser(userId);
        const hasFresh  = existing?.name && existing.updatedAt && (now - existing.updatedAt < USER_TTL_MS);

        if (!hasFresh && api && typeof api.getUserInfo === "function") {
          const res     = await api.getUserInfo(userId);
          const profile = res?.changed_profiles?.[userId] || null;
          const name    = profile?.displayName || profile?.zaloName || profile?.username || null;
          if (name || profile) {
            await saveUser(userId, { name, profile }, { increment: false });
          }
        }
      } catch {}
    })());
  }

  // ── 2. Lưu group + refresh nếu cần ────────────────────────────────────────
  if (isGroup && threadId) {
    tasks.push((async () => {
      try {
        const existing  = await getGroup(threadId);
        const hasFresh  = existing && existing.updatedAt && (now - existing.updatedAt < GROUP_TTL_MS);

        if (!hasFresh && api && typeof api.getGroupInfo === "function") {
          const res  = await api.getGroupInfo(threadId);
          const info = res?.gridInfoMap?.[threadId] || null;
          if (info) {
            await saveGroup(threadId, {
              name           : info.name || null,
              info,
              memVerList     : info.memVerList,
              pendingApprove : info.pendingApprove
            });
          }
        } else if (!existing) {
          // Chưa có record → tạo mới với data tối thiểu
          await saveGroup(threadId, {});
        }
      } catch {}
    })());
  }

  if (tasks.length) await Promise.allSettled(tasks);
}

// ══════════════════════════════════════════════════════════════════════════════
//  SNAPSHOT
// ══════════════════════════════════════════════════════════════════════════════

/** Xuất snapshot JSON cho cả users và groups */
async function saveSnapshot() {
  try {
    ensureDataDir();
    const [users, groups] = await Promise.all([getAllUsers(), getAllGroups()]);
    const now = new Date().toISOString();

    fs.writeFileSync(USERS_SNAPSHOT, JSON.stringify(
      { generatedAt: now, total: users.length, users }, null, 2
    ), "utf-8");

    fs.writeFileSync(GROUPS_SNAPSHOT, JSON.stringify(
      { generatedAt: now, total: groups.length, groups }, null, 2
    ), "utf-8");

    logInfo(`[dataManager] Snapshot: ${users.length} users | ${groups.length} groups`);
  } catch (err) {
    logError(`[dataManager] Lỗi lưu snapshot: ${err?.message}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  TỔNG HỢP THỐNG KÊ
// ══════════════════════════════════════════════════════════════════════════════

async function getStats() {
  const [uStats, gStats] = await Promise.all([getUserStats(), getGroupStats()]);
  return {
    users  : uStats,
    groups : gStats
  };
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // User
  saveUser,
  getUser,
  getAllUsers,
  searchUsers,
  getUserStats,
  // Group
  saveGroup,
  getGroup,
  getAllGroups,
  searchGroups,
  getGroupStats,
  // Auto
  autoSaveFromEvent,
  // Snapshot + Stats
  saveSnapshot,
  getStats
};

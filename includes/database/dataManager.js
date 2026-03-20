/**
 * includes/database/dataManager.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Module quản lý dữ liệu nhóm & người dùng — lưu vào SQLite.
 *
 * PHÂN BIỆT 2 loại timestamp:
 *   updated_at  — lần cuối bản ghi thay đổi bất kỳ (kể cả tăng msg_count)
 *   profile_at  — lần cuối GỌI API để fetch profile/info (dùng để check TTL)
 *
 * Nhờ vậy TTL check dùng profile_at, không bị ảnh hưởng bởi msg_count.
 */

const fs   = require("fs");
const path = require("path");
const { getDb, run, get, all } = require("./sqlite");

const DATA_DIR        = path.join(__dirname, "..", "data");
const USERS_SNAPSHOT  = path.join(DATA_DIR, "users.json");
const GROUPS_SNAPSHOT = path.join(DATA_DIR, "groups.json");

const USER_TTL_MS  = 7 * 24 * 60 * 60 * 1000; // 7 ngày
const GROUP_TTL_MS = 24 * 60 * 60 * 1000;      // 1 ngày

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
 * Tăng msg_count, lưu name nếu có. KHÔNG thay đổi profile_at.
 * profile_at chỉ được cập nhật khi gọi API thực sự (saveUserProfile).
 */
async function saveUser(userId, { name } = {}) {
  if (!userId) return;
  const db  = await getDb();
  const uid = String(userId);
  const now = Date.now();

  const row      = await get(db, "SELECT first_seen, msg_count FROM users WHERE user_id = ?", [uid]);
  const firstSeen = (row?.first_seen && row.first_seen > 0) ? row.first_seen : now;
  const msgCount  = (row?.msg_count || 0) + 1;

  await run(db,
    `INSERT INTO users (user_id, name, first_seen, msg_count, profile_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       name       = COALESCE(excluded.name, name),
       first_seen = CASE WHEN first_seen = 0 THEN excluded.first_seen ELSE first_seen END,
       msg_count  = excluded.msg_count,
       updated_at = excluded.updated_at`,
    [uid, name ?? null, firstSeen, msgCount, now]
  );
}

/**
 * Lưu profile đầy đủ từ API (name, profile_json) + cập nhật profile_at = now.
 * Không tăng msg_count.
 */
async function saveUserProfile(userId, { name, profile }) {
  if (!userId) return;
  const db  = await getDb();
  const uid = String(userId);
  const now = Date.now();

  const row       = await get(db, "SELECT first_seen, msg_count FROM users WHERE user_id = ?", [uid]);
  const firstSeen = (row?.first_seen && row.first_seen > 0) ? row.first_seen : now;
  const msgCount  = row?.msg_count || 0;

  await run(db,
    `INSERT INTO users (user_id, name, profile_json, first_seen, msg_count, profile_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       name         = COALESCE(excluded.name, name),
       profile_json = COALESCE(excluded.profile_json, profile_json),
       first_seen   = CASE WHEN first_seen = 0 THEN excluded.first_seen ELSE first_seen END,
       msg_count    = excluded.msg_count,
       profile_at   = excluded.profile_at,
       updated_at   = excluded.updated_at`,
    [uid, name ?? null, safeJson(profile), firstSeen, msgCount, now, now]
  );
}

/** Đọc 1 user */
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
    profileAt : row.profile_at,
    updatedAt : row.updated_at
  };
}

/** Đọc tất cả user */
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
    profileAt : r.profile_at,
    updatedAt : r.updated_at
  }));
}

/** Tìm user theo tên */
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

async function getUserStats() {
  const db  = await getDb();
  const row = await get(db, "SELECT COUNT(*) AS total, SUM(msg_count) AS totalMessages, MAX(msg_count) AS maxMessages, MIN(first_seen) AS oldestSeen FROM users");
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
 * Lưu/cập nhật group với đầy đủ info từ API. Cập nhật profile_at = now.
 */
async function saveGroup(groupId, { name, info, memVerList, pendingApprove } = {}) {
  if (!groupId) return;
  const db  = await getDb();
  const gid = String(groupId);
  const now = Date.now();

  const row         = await get(db, "SELECT first_seen FROM groups WHERE group_id = ?", [gid]);
  const firstSeen   = (row?.first_seen && row.first_seen > 0) ? row.first_seen : now;
  const memberCount = Array.isArray(memVerList) ? memVerList.length
                    : (info?.totalMember || info?.memVerList?.length || 0);

  await run(db,
    `INSERT INTO groups
       (group_id, name, info_json, mem_ver_list_json, pending_approve_json, member_count, first_seen, profile_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(group_id) DO UPDATE SET
       name                 = COALESCE(excluded.name, name),
       info_json            = COALESCE(excluded.info_json, info_json),
       mem_ver_list_json    = COALESCE(excluded.mem_ver_list_json, mem_ver_list_json),
       pending_approve_json = COALESCE(excluded.pending_approve_json, pending_approve_json),
       member_count         = CASE WHEN excluded.member_count > 0 THEN excluded.member_count ELSE member_count END,
       first_seen           = CASE WHEN first_seen = 0 THEN excluded.first_seen ELSE first_seen END,
       profile_at           = excluded.profile_at,
       updated_at           = excluded.updated_at`,
    [gid, name ?? null, safeJson(info), safeJson(memVerList ?? null), safeJson(pendingApprove ?? null), memberCount, firstSeen, now, now]
  );
}

/**
 * Đảm bảo group tồn tại trong DB (tạo mới với data rỗng nếu chưa có).
 * Không overwrite data cũ nếu đã có.
 */
async function ensureGroup(groupId) {
  if (!groupId) return;
  const db  = await getDb();
  const gid = String(groupId);
  const now = Date.now();
  await run(db,
    `INSERT OR IGNORE INTO groups (group_id, first_seen, profile_at, updated_at)
     VALUES (?, ?, 0, ?)`,
    [gid, now, now]
  );
}

/** Đọc 1 group */
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
    profileAt      : row.profile_at,
    updatedAt      : row.updated_at
  };
}

/** Đọc tất cả group */
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
    profileAt      : r.profile_at,
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

async function getGroupStats() {
  const db  = await getDb();
  const row = await get(db, "SELECT COUNT(*) AS total, SUM(member_count) AS totalMembers, MAX(member_count) AS maxMembers, MIN(first_seen) AS oldestSeen FROM groups");
  return {
    total        : row?.total        || 0,
    totalMembers : row?.totalMembers || 0,
    maxMembers   : row?.maxMembers   || 0,
    oldestSeen   : row?.oldestSeen   || null
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  AUTO SAVE FROM EVENT
//  Gọi 1 lần trong handleMessage() — chạy nền, không block pipeline.
//
//  Logic:
//    1. Đọc existing TRƯỚC → kiểm tra profile_at (TTL) → quyết định có gọi API không
//    2. Luôn tăng msg_count (saveUser)
//    3. Gọi API chỉ khi profile_at stale → lưu profile đầy đủ (saveUserProfile / saveGroup)
// ══════════════════════════════════════════════════════════════════════════════

async function autoSaveFromEvent(api, event) {
  const raw      = event?.data || {};
  const userId   = raw?.uidFrom ? String(raw.uidFrom) : null;
  const threadId = event?.threadId ? String(event.threadId) : null;
  const isGroup  = Number(event?.type) === 1;
  const now      = Date.now();

  const tasks = [];

  // ── USER ───────────────────────────────────────────────────────────────────
  if (userId && userId !== String(global.botId)) {
    tasks.push((async () => {
      try {
        // Đọc existing TRƯỚC khi save
        const existing  = await getUser(userId);
        const profileAt = existing?.profileAt || 0;
        const needApi   = !profileAt || (now - profileAt > USER_TTL_MS);

        // Tên lấy từ event (nếu có)
        const eventName = raw?.dName || raw?.displayName || raw?.senderName || null;

        // Luôn tăng msg_count
        await saveUser(userId, { name: eventName || existing?.name || null });

        // Gọi API nếu profile stale
        if (needApi && api && typeof api.getUserInfo === "function") {
          const res     = await api.getUserInfo(userId);
          const profile = res?.changed_profiles?.[userId] || null;
          const name    = profile?.displayName || profile?.zaloName || profile?.username || null;
          await saveUserProfile(userId, { name, profile });
        }
      } catch {}
    })());
  }

  // ── GROUP ──────────────────────────────────────────────────────────────────
  if (isGroup && threadId) {
    tasks.push((async () => {
      try {
        // Đọc existing TRƯỚC khi save
        const existing  = await getGroup(threadId);
        const profileAt = existing?.profileAt || 0;
        const needApi   = !profileAt || (now - profileAt > GROUP_TTL_MS);

        if (!existing) {
          // Nhóm chưa có → tạo placeholder
          await ensureGroup(threadId);
        }

        // Gọi API nếu info stale
        if (needApi && api && typeof api.getGroupInfo === "function") {
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
        }
      } catch {}
    })());
  }

  if (tasks.length) await Promise.allSettled(tasks);
}

// ══════════════════════════════════════════════════════════════════════════════
//  SNAPSHOT
// ══════════════════════════════════════════════════════════════════════════════

async function saveSnapshot() {
  try {
    ensureDataDir();
    const [users, groups] = await Promise.all([getAllUsers(), getAllGroups()]);
    const now = new Date().toISOString();
    fs.writeFileSync(USERS_SNAPSHOT,  JSON.stringify({ generatedAt: now, total: users.length,  users  }, null, 2), "utf-8");
    fs.writeFileSync(GROUPS_SNAPSHOT, JSON.stringify({ generatedAt: now, total: groups.length, groups }, null, 2), "utf-8");
    logInfo(`[dataManager] Snapshot: ${users.length} users | ${groups.length} groups`);
  } catch (err) {
    logError(`[dataManager] Lỗi lưu snapshot: ${err?.message}`);
  }
}

async function getStats() {
  const [uStats, gStats] = await Promise.all([getUserStats(), getGroupStats()]);
  return { users: uStats, groups: gStats };
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  saveUser,
  saveUserProfile,
  getUser,
  getAllUsers,
  searchUsers,
  getUserStats,
  saveGroup,
  ensureGroup,
  getGroup,
  getAllGroups,
  searchGroups,
  getGroupStats,
  autoSaveFromEvent,
  saveSnapshot,
  getStats
};

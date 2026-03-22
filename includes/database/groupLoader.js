/**
 * includes/database/groupLoader.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Load toàn bộ data nhóm từ Zalo API → lưu vào SQLite (qua dataManager).
 *
 * EXPORT:
 *   loadAllGroups(api)          — Fetch tất cả nhóm từ API, lưu vào DB
 *   syncGroupToDb(api, groupId) — Fetch + lưu 1 nhóm
 *   getAllGroupsFromDb()         — Đọc toàn bộ nhóm từ SQLite
 *   getGroupData(groupId)       — Đọc 1 nhóm từ SQLite
 *   getGroupIds()               — Danh sách group_id từ SQLite groups table
 *   saveGroupsSnapshot()        — Xuất snapshot JSON ra includes/data/groups.json
 */

// Dùng dataManager thay vì viết SQL trực tiếp — tránh duplicate logic
const { saveGroup, getGroup, getAllGroups, saveSnapshot } = require("./dataManager");
const { getAllGroupIds } = require("./groupSettings");

const BATCH_SIZE     = 5;
const RETRY_DELAY_MS = 1500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Cache tracking ─────────────────────────────────────────────────────────────

/** Đọc danh sách group ID từ SQLite groups table */
async function getGroupIds() {
  return getAllGroupIds();
}

/** Đảm bảo nhóm tồn tại trong bảng groups (SQLite) */
async function trackGroup(groupId) {
  try {
    const { getDb, run } = require("./sqlite");
    const db  = await getDb();
    const now = Date.now();
    await run(db,
      `INSERT INTO groups (group_id, name, first_seen, updated_at) VALUES (?, '', ?, ?)
       ON CONFLICT(group_id) DO NOTHING`,
      [String(groupId), now, now]
    );
  } catch {}
}

// ── Core ───────────────────────────────────────────────────────────────────────

/**
 * Fetch thông tin 1 nhóm từ Zalo API và lưu vào SQLite qua dataManager.
 */
async function syncGroupToDb(api, groupId) {
  try {
    const res  = await api.getGroupInfo(String(groupId));
    const info = res?.gridInfoMap?.[String(groupId)] || null;

    if (!info) {
      logWarn(`[groupLoader] Không lấy được info nhóm ${groupId}`);
      return null;
    }

    const name           = (info.name && String(info.name).trim()) || null;
    const memVerList     = Array.isArray(info.memVerList) ? info.memVerList : null;
    const pendingApprove = info.pendingApprove ?? null;
    const memberCount    = memVerList ? memVerList.length : (info.totalMember || 0);

    await saveGroup(groupId, { name, info, memVerList, pendingApprove });
    await trackGroup(groupId);

    return { groupId: String(groupId), name, memberCount };
  } catch (err) {
    logError(`[DataBase] Lỗi fetch nhóm ${groupId}: ${err?.message}`);
    return null;
  }
}

/**
 * Load toàn bộ nhóm từ SQLite groups table → Zalo API → SQLite.
 */
async function loadAllGroups(api) {
  const ids = await getGroupIds();

  if (ids.length === 0) {
    logInfo("[DataBase] Chưa có nhóm nào trong SQLite để load.");
    return { ok: 0, fail: 0, total: 0, groups: [] };
  }

  logInfo(`[DataBase] Bắt đầu load ${ids.length} nhóm...`);

  let ok = 0, fail = 0;
  const loaded = [];

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch   = ids.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(gid => syncGroupToDb(api, gid)));

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) { ok++; loaded.push(r.value); }
      else fail++;
    }

    if (i + BATCH_SIZE < ids.length) await sleep(RETRY_DELAY_MS);
  }

  logInfo(`[DataBase] Hoàn tất: ✅ ${ok} nhóm | ❌ ${fail} lỗi`);
  await saveGroupsSnapshot();
  return { ok, fail, total: ids.length, groups: loaded };
}

// ── Read helpers ───────────────────────────────────────────────────────────────

async function getAllGroupsFromDb() { return getAllGroups(); }
async function getGroupData(groupId) { return getGroup(groupId); }

// ── Snapshot ───────────────────────────────────────────────────────────────────

async function saveGroupsSnapshot() { return saveSnapshot(); }

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  loadAllGroups,
  syncGroupToDb,
  getAllGroupsFromDb,
  getGroupData,
  getGroupIds,
  saveGroupsSnapshot
};

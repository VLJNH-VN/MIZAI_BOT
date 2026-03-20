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
 *   getGroupIds()               — Danh sách group_id từ groupsCache.json
 *   saveGroupsSnapshot()        — Xuất snapshot JSON ra includes/data/groups.json
 */

const fs   = require("fs");
const path = require("path");

// Dùng dataManager thay vì viết SQL trực tiếp — tránh duplicate logic
const { saveGroup, getGroup, getAllGroups, saveSnapshot } = require("./dataManager");

const GROUPS_CACHE_PATH = path.join(__dirname, "groupsCache.json");
const BATCH_SIZE        = 5;
const RETRY_DELAY_MS    = 1500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Cache tracking ─────────────────────────────────────────────────────────────

/** Đọc danh sách group ID từ groupsCache.json */
function getGroupIds() {
  try {
    if (!fs.existsSync(GROUPS_CACHE_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(GROUPS_CACHE_PATH, "utf-8"));
    return Object.keys(raw).filter(Boolean);
  } catch {
    return [];
  }
}

/** Thêm nhóm vào groupsCache.json nếu chưa có */
function trackGroup(groupId) {
  try {
    let cache = {};
    if (fs.existsSync(GROUPS_CACHE_PATH)) {
      try { cache = JSON.parse(fs.readFileSync(GROUPS_CACHE_PATH, "utf-8")); } catch {}
    }
    if (!cache[groupId]) {
      cache[groupId] = { addedAt: Date.now() };
      fs.writeFileSync(GROUPS_CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
    }
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
    trackGroup(groupId);

    return { groupId: String(groupId), name, memberCount };
  } catch (err) {
    logError(`[DataBase] Lỗi fetch nhóm ${groupId}: ${err?.message}`);
    return null;
  }
}

/**
 * Load toàn bộ nhóm từ groupsCache.json → Zalo API → SQLite.
 */
async function loadAllGroups(api) {
  const ids = getGroupIds();

  if (ids.length === 0) {
    logInfo("[DataBase] groupsCache.json trống, chưa có nhóm nào để load.");
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

/**
 * includes/database/groupLoader.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Load toàn bộ data nhóm từ Zalo API → lưu vào SQLite + snapshot JSON.
 *
 * CÁC HÀM EXPORT:
 *   loadAllGroups(api)            — Fetch tất cả nhóm từ API, lưu vào DB
 *   syncGroupToDb(api, groupId)   — Fetch + lưu 1 nhóm cụ thể
 *   getAllGroupsFromDb()           — Đọc toàn bộ nhóm từ SQLite
 *   getGroupData(groupId)         — Đọc 1 nhóm từ SQLite
 *   getGroupIds()                 — Danh sách group_id từ groupsCache.json
 *   saveGroupsSnapshot()          — Xuất snapshot JSON ra includes/data/groups.json
 */

const fs   = require("fs");
const path = require("path");
const { getDb, run, get, all } = require("./sqlite");

const GROUPS_CACHE_PATH = path.join(__dirname, "groupsCache.json");
const SNAPSHOT_PATH     = path.join(__dirname, "..", "data", "groups.json");
const BATCH_SIZE        = 5;   // số nhóm fetch song song cùng lúc
const RETRY_DELAY_MS    = 1500;

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeJson(obj) {
  try { return JSON.stringify(obj ?? null); } catch { return "null"; }
}

function parseJson(str) {
  try { return str ? JSON.parse(str) : null; } catch { return null; }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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

/** Ghi / cập nhật groupsCache.json khi phát hiện nhóm mới */
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

// ── DB helpers ────────────────────────────────────────────────────────────────

/** Upsert 1 nhóm vào SQLite */
async function upsertGroupRow({ groupId, name, info, memVerList, pendingApprove, memberCount }) {
  const db = await getDb();
  const ts = Date.now();
  await run(
    db,
    `INSERT INTO groups
       (group_id, name, info_json, mem_ver_list_json, pending_approve_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(group_id) DO UPDATE SET
       name                 = excluded.name,
       info_json            = excluded.info_json,
       mem_ver_list_json    = excluded.mem_ver_list_json,
       pending_approve_json = excluded.pending_approve_json,
       updated_at           = excluded.updated_at`,
    [
      String(groupId),
      name ?? null,
      safeJson(info),
      safeJson(memVerList ?? null),
      safeJson(pendingApprove ?? null),
      ts
    ]
  );
}

// ── Core fetch ────────────────────────────────────────────────────────────────

/**
 * Fetch thông tin 1 nhóm từ Zalo API và lưu vào SQLite.
 * @returns {object|null} dữ liệu nhóm đã lưu
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
    const memberCount    = Array.isArray(memVerList) ? memVerList.length : null;

    await upsertGroupRow({ groupId, name, info, memVerList, pendingApprove, memberCount });
    trackGroup(groupId);

    return { groupId: String(groupId), name, memberCount, info };
  } catch (err) {
    logError(`[groupLoader] Lỗi fetch nhóm ${groupId}: ${err?.message}`);
    return null;
  }
}

// ── Batch loader ──────────────────────────────────────────────────────────────

/**
 * Load toàn bộ nhóm từ groupsCache.json → Zalo API → SQLite.
 * Xử lý theo batch để tránh rate-limit.
 *
 * @param {object} api   — Zalo API instance
 * @returns {object}     — { ok, fail, total, groups }
 */
async function loadAllGroups(api) {
  const ids = getGroupIds();

  if (ids.length === 0) {
    logInfo("[groupLoader] groupsCache.json trống, chưa có nhóm nào để load.");
    return { ok: 0, fail: 0, total: 0, groups: [] };
  }

  logInfo(`[groupLoader] Bắt đầu load ${ids.length} nhóm...`);

  let ok = 0, fail = 0;
  const loaded = [];

  // Xử lý theo batch
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(gid => syncGroupToDb(api, gid))
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        ok++;
        loaded.push(r.value);
      } else {
        fail++;
      }
    }

    // Nghỉ giữa các batch để tránh spam API
    if (i + BATCH_SIZE < ids.length) await sleep(RETRY_DELAY_MS);
  }

  logInfo(`[groupLoader] Hoàn tất: ✅ ${ok} nhóm | ❌ ${fail} lỗi`);

  // Xuất snapshot JSON
  await saveGroupsSnapshot();

  return { ok, fail, total: ids.length, groups: loaded };
}

// ── Read from DB ──────────────────────────────────────────────────────────────

/** Đọc toàn bộ nhóm từ SQLite */
async function getAllGroupsFromDb() {
  const db   = await getDb();
  const rows = await all(db, "SELECT * FROM groups ORDER BY updated_at DESC");
  return rows.map(r => ({
    groupId      : r.group_id,
    name         : r.name,
    info         : parseJson(r.info_json),
    memVerList   : parseJson(r.mem_ver_list_json),
    pendingApprove: parseJson(r.pending_approve_json),
    updatedAt    : r.updated_at
  }));
}

/** Đọc 1 nhóm từ SQLite theo groupId */
async function getGroupData(groupId) {
  const db  = await getDb();
  const row = await get(db, "SELECT * FROM groups WHERE group_id = ?", [String(groupId)]);
  if (!row) return null;
  return {
    groupId      : row.group_id,
    name         : row.name,
    info         : parseJson(row.info_json),
    memVerList   : parseJson(row.mem_ver_list_json),
    pendingApprove: parseJson(row.pending_approve_json),
    updatedAt    : row.updated_at
  };
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

/**
 * Xuất snapshot toàn bộ data nhóm ra includes/data/groups.json.
 * File này dễ đọc, dùng để debug hoặc làm nguồn dữ liệu phụ.
 */
async function saveGroupsSnapshot() {
  try {
    const groups  = await getAllGroupsFromDb();
    const dir     = path.dirname(SNAPSHOT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const snapshot = {
      generatedAt : new Date().toISOString(),
      total       : groups.length,
      groups
    };

    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), "utf-8");
    logInfo(`[groupLoader] Snapshot đã lưu: includes/data/groups.json (${groups.length} nhóm)`);
  } catch (err) {
    logError(`[groupLoader] Lỗi lưu snapshot: ${err?.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  loadAllGroups,
  syncGroupToDb,
  getAllGroupsFromDb,
  getGroupData,
  getGroupIds,
  saveGroupsSnapshot
};

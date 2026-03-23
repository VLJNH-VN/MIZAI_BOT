const { getDb, run, get } = require("../core/sqlite");

const USER_TTL_MS  = 7 * 24 * 60 * 60 * 1000; // 7 ngày
const GROUP_TTL_MS = 24 * 60 * 60 * 1000;      // 1 ngày

function safeJson(obj) {
  try { return JSON.stringify(obj ?? null); } catch { return "null"; }
}

function parseJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function pickUserName(profile) {
  if (!profile || typeof profile !== "object") return null;
  return (
    (profile.displayName && String(profile.displayName).trim()) ||
    (profile.zaloName    && String(profile.zaloName).trim())    ||
    (profile.username    && String(profile.username).trim())    ||
    null
  );
}

function pickGroupName(groupInfo) {
  if (!groupInfo || typeof groupInfo !== "object") return null;
  return (groupInfo.name && String(groupInfo.name).trim()) || null;
}

async function getCachedUser(userId) {
  const db = await getDb();
  return get(db, "SELECT user_id, name, profile_json, updated_at FROM users WHERE user_id = ?", [String(userId)]);
}

// Upsert user — KHÔNG đụng vào first_seen và msg_count (quản lý bởi dataManager)
async function upsertUser({ userId, name, profile }) {
  const db  = await getDb();
  const ts  = Date.now();
  const uid = String(userId);
  await run(
    db,
    `INSERT INTO users (user_id, name, profile_json, first_seen, msg_count, updated_at)
     VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       name         = COALESCE(excluded.name, name),
       profile_json = COALESCE(excluded.profile_json, profile_json),
       first_seen   = CASE WHEN first_seen = 0 THEN excluded.first_seen ELSE first_seen END,
       updated_at   = excluded.updated_at`,
    [uid, name ?? null, safeJson(profile), ts, ts]
  );
}

async function getCachedGroup(groupId) {
  const db = await getDb();
  return get(db, "SELECT group_id, name, info_json, updated_at FROM groups WHERE group_id = ?", [String(groupId)]);
}

// Upsert group — KHÔNG đụng vào first_seen và member_count (quản lý bởi dataManager)
async function upsertGroup({ groupId, name, info, memVerList, pendingApprove }) {
  const db  = await getDb();
  const ts  = Date.now();
  const gid = String(groupId);
  const memberCount = Array.isArray(memVerList) ? memVerList.length : (info?.totalMember || 0);
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
    [gid, name ?? null, safeJson(info), safeJson(memVerList ?? null), safeJson(pendingApprove ?? null), memberCount, ts, ts]
  );
}

async function refreshUserInfo(api, userId) {
  if (!api || typeof api.getUserInfo !== "function") return null;
  const res     = await api.getUserInfo(String(userId));
  const changed = res?.changed_profiles || {};
  const profile = changed[String(userId)] || null;
  const name    = pickUserName(profile);
  await upsertUser({ userId, name, profile });
  return { userId: String(userId), name, profile, raw: res };
}

async function refreshGroupInfo(api, groupId) {
  if (!api || typeof api.getGroupInfo !== "function") return null;
  const res          = await api.getGroupInfo(String(groupId));
  const info         = res?.gridInfoMap?.[String(groupId)] || null;
  const name         = pickGroupName(info);
  const memVerList   = info?.memVerList;
  const pendingApprove = info?.pendingApprove;
  await upsertGroup({
    groupId,
    name,
    info,
    memVerList     : Array.isArray(memVerList) ? memVerList : null,
    pendingApprove : pendingApprove ?? null
  });
  return { groupId: String(groupId), name, info, raw: res };
}

async function resolveSenderName({ api, userId, fallbackName }) {
  const uid = String(userId);
  if (fallbackName && String(fallbackName).trim()) return String(fallbackName).trim();
  const cached  = await getCachedUser(uid);
  const isFresh = cached?.updated_at && Date.now() - Number(cached.updated_at) < USER_TTL_MS;
  if (cached?.name && isFresh) return cached.name;
  try {
    const refreshed = await refreshUserInfo(api, uid);
    if (refreshed?.name) return refreshed.name;
  } catch {}
  return cached?.name || `User ${uid}`;
}

async function resolveGroupName({ api, groupId, fallbackName }) {
  const gid = String(groupId);
  if (fallbackName && String(fallbackName).trim()) return String(fallbackName).trim();
  const cached  = await getCachedGroup(gid);
  const isFresh = cached?.updated_at && Date.now() - Number(cached.updated_at) < GROUP_TTL_MS;
  if (cached?.name && isFresh) return cached.name;
  try {
    const refreshed = await refreshGroupInfo(api, gid);
    if (refreshed?.name) return refreshed.name;
  } catch {}
  return cached?.name || `Thread ${gid}`;
}

// warmupFromEvent đã được thay bởi dataManager.autoSaveFromEvent trong message.js
// Giữ lại để không break các nơi khác có thể import nó
async function warmupFromEvent({ api, event }) {
  // no-op — xem dataManager.autoSaveFromEvent
}

module.exports = {
  resolveSenderName,
  resolveGroupName,
  refreshUserInfo,
  refreshGroupInfo,
  warmupFromEvent,
  _parseJson: parseJson
};

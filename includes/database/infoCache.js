const { getDb, run, get } = require("./sqlite");

const USER_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const GROUP_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

function safeJson(obj) {
  try {
    return JSON.stringify(obj ?? null);
  } catch {
    return "null";
  }
}

function parseJson(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function pickUserName(profile) {
  if (!profile || typeof profile !== "object") return null;
  return (
    (profile.displayName && String(profile.displayName).trim()) ||
    (profile.zaloName && String(profile.zaloName).trim()) ||
    (profile.username && String(profile.username).trim()) ||
    null
  );
}

function pickGroupName(groupInfo) {
  if (!groupInfo || typeof groupInfo !== "object") return null;
  return (groupInfo.name && String(groupInfo.name).trim()) || null;
}

async function getCachedUser(userId) {
  const db = await getDb();
  return get(db, "SELECT user_id, name, profile_json, updated_at FROM users WHERE user_id = ?", [
    String(userId)
  ]);
}

async function upsertUser({ userId, name, profile }) {
  const db = await getDb();
  const ts = Date.now();
  await run(
    db,
    `
    INSERT INTO users (user_id, name, profile_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      name = excluded.name,
      profile_json = excluded.profile_json,
      updated_at = excluded.updated_at;
  `.trim(),
    [String(userId), name ?? null, safeJson(profile), ts]
  );
}

async function getCachedGroup(groupId) {
  const db = await getDb();
  return get(db, "SELECT group_id, name, info_json, updated_at FROM groups WHERE group_id = ?", [
    String(groupId)
  ]);
}

async function upsertGroup({ groupId, name, info, memVerList, pendingApprove }) {
  const db = await getDb();
  const ts = Date.now();
  await run(
    db,
    `
    INSERT INTO groups (group_id, name, info_json, mem_ver_list_json, pending_approve_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_id) DO UPDATE SET
      name = excluded.name,
      info_json = excluded.info_json,
      mem_ver_list_json = excluded.mem_ver_list_json,
      pending_approve_json = excluded.pending_approve_json,
      updated_at = excluded.updated_at;
  `.trim(),
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

async function refreshUserInfo(api, userId) {
  if (!api || typeof api.getUserInfo !== "function") return null;
  const res = await api.getUserInfo(String(userId));
  const changed = res?.changed_profiles || {};
  const profile = changed[String(userId)] || null;
  const name = pickUserName(profile);
  await upsertUser({ userId, name, profile });
  return { userId: String(userId), name, profile, raw: res };
}

async function refreshGroupInfo(api, groupId) {
  if (!api || typeof api.getGroupInfo !== "function") return null;
  const res = await api.getGroupInfo(String(groupId));
  const info = res?.gridInfoMap?.[String(groupId)] || null;
  const name = pickGroupName(info);

  // The response shape includes these "extra" fields (per docs)
  const memVerList = info?.memVerList;
  const pendingApprove = info?.pendingApprove;

  await upsertGroup({
    groupId,
    name,
    info,
    memVerList: Array.isArray(memVerList) ? memVerList : null,
    pendingApprove: pendingApprove ?? null
  });

  return { groupId: String(groupId), name, info, raw: res };
}

async function resolveSenderName({ api, userId, fallbackName }) {
  const uid = String(userId);
  if (fallbackName && String(fallbackName).trim()) return String(fallbackName).trim();

  const cached = await getCachedUser(uid);
  const isFresh = cached?.updated_at && Date.now() - Number(cached.updated_at) < USER_TTL_MS;
  if (cached?.name && isFresh) return cached.name;

  try {
    const refreshed = await refreshUserInfo(api, uid);
    if (refreshed?.name) return refreshed.name;
  } catch {
    // ignore and fallback below
  }

  // fallback from cache even if stale, else ID
  return cached?.name || `User ${uid}`;
}

async function resolveGroupName({ api, groupId, fallbackName }) {
  const gid = String(groupId);
  if (fallbackName && String(fallbackName).trim()) return String(fallbackName).trim();

  const cached = await getCachedGroup(gid);
  const isFresh = cached?.updated_at && Date.now() - Number(cached.updated_at) < GROUP_TTL_MS;
  if (cached?.name && isFresh) return cached.name;

  try {
    const refreshed = await refreshGroupInfo(api, gid);
    if (refreshed?.name) return refreshed.name;
  } catch {
    // ignore and fallback below
  }

  return cached?.name || `Thread ${gid}`;
}

/**
 * Optional warm-up on every incoming message. Uses TTL to avoid spamming API.
 */
async function warmupFromEvent({ api, event }) {
  const raw = event?.data || {};
  const userId = raw?.uidFrom ? String(raw.uidFrom) : null;
  const threadId = event?.threadId ? String(event.threadId) : null;
  const isGroup = Number(event?.type) === 1; // ThreadType.Group

  const tasks = [];
  if (userId) {
    tasks.push(
      (async () => {
        const cached = await getCachedUser(userId);
        const fresh = cached?.updated_at && Date.now() - Number(cached.updated_at) < USER_TTL_MS;
        if (!fresh) await refreshUserInfo(api, userId);
      })()
    );
  }
  if (isGroup && threadId) {
    tasks.push(
      (async () => {
        const cached = await getCachedGroup(threadId);
        const fresh = cached?.updated_at && Date.now() - Number(cached.updated_at) < GROUP_TTL_MS;
        if (!fresh) await refreshGroupInfo(api, threadId);
      })()
    );
  }

  if (tasks.length) await Promise.allSettled(tasks);
}

module.exports = {
  resolveSenderName,
  resolveGroupName,
  refreshUserInfo,
  refreshGroupInfo,
  warmupFromEvent,
  // exposed for debugging
  _parseJson: parseJson
};


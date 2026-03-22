/**
 * includes/database/messageLog.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Lưu lịch sử tin nhắn vào SQLite (persistent — tồn tại sau restart).
 *
 * EXPORT:
 *   logMessage(event)                   — lưu 1 tin nhắn từ event
 *   getUserMessages(userId, opts)        — lấy tin nhắn của 1 user
 *   getThreadMessages(threadId, opts)    — lấy tin nhắn trong 1 thread/nhóm
 *   searchMessages(keyword, opts)        — tìm kiếm nội dung tin nhắn
 *   getMessageStats()                    — thống kê tổng
 *   deleteOldMessages(daysOld)           — xoá tin nhắn cũ (dọn dẹp)
 *
 * Lưu ý: chỉ lưu tin nhắn có nội dung text hoặc có đính kèm.
 *         Tin nhắn của bot sẽ bị bỏ qua.
 */

const { getDb, run, get, all } = require("../core/sqlite");

const MAX_CONTENT_LEN = 2000; // cắt nội dung nếu quá dài

function safeJson(obj) {
  try { return obj ? JSON.stringify(obj) : null; } catch { return null; }
}
function parseJson(str) {
  try { return str ? JSON.parse(str) : null; } catch { return null; }
}
function truncate(str, max) {
  if (!str || typeof str !== "string") return null;
  return str.length > max ? str.slice(0, max) + "…" : str;
}

// Lấy nội dung text từ raw event data
function extractContent(raw) {
  if (!raw) return null;
  if (raw.content && typeof raw.content === "string") return raw.content;
  if (raw.content?.title)   return raw.content.title;
  if (raw.content?.body)    return raw.content.body;
  if (raw.content?.message) return raw.content.message;
  if (raw.body && typeof raw.body === "string") return raw.body;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lưu 1 tin nhắn từ event vào SQLite.
 * Gọi trong handleMessage() — không block pipeline.
 */
async function logMessage(event) {
  try {
    const raw      = event?.data;
    if (!raw) return;

    const userId   = raw.uidFrom ? String(raw.uidFrom) : null;
    if (!userId) return;

    // Bỏ qua tin nhắn của bot
    if (global.botId && userId === String(global.botId)) return;

    const threadId  = event.threadId ? String(event.threadId) : null;
    if (!threadId) return;

    const content  = truncate(extractContent(raw), MAX_CONTENT_LEN);
    const attach   = Array.isArray(raw.attach) && raw.attach.length > 0 ? raw.attach : null;

    // Bỏ qua nếu không có nội dung lẫn đính kèm
    if (!content && !attach) return;

    const msgId    = raw.msgId    ? String(raw.msgId)    : null;
    const cliMsgId = raw.cliMsgId ? String(raw.cliMsgId) : null;
    const msgType  = raw.msgType  ? String(raw.msgType)  : null;
    const isGroup  = Number(event.type) === 1 ? 1 : 0;
    const ts       = raw.ts || raw.msgTs || Date.now();
    const savedAt  = Date.now();

    const db = await getDb();
    await run(db,
      `INSERT INTO messages
         (msg_id, cli_msg_id, user_id, thread_id, is_group, content, msg_type, attach_json, ts, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [msgId, cliMsgId, userId, threadId, isGroup, content, msgType, safeJson(attach), ts, savedAt]
    );
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lấy tin nhắn của 1 user (trong 1 thread cụ thể, hoặc toàn bộ).
 * @param {string} userId
 * @param {object} opts
 * @param {string}  [opts.threadId]     — lọc theo thread (tuỳ chọn)
 * @param {number}  [opts.limit=50]
 * @param {number}  [opts.offset=0]
 * @param {boolean} [opts.newestFirst=true]
 */
async function getUserMessages(userId, { threadId, limit = 50, offset = 0, newestFirst = true } = {}) {
  if (!userId) return [];
  const db    = await getDb();
  const order = newestFirst ? "DESC" : "ASC";

  let sql, params;
  if (threadId) {
    sql    = `SELECT * FROM messages WHERE user_id = ? AND thread_id = ? ORDER BY ts ${order} LIMIT ? OFFSET ?`;
    params = [String(userId), String(threadId), limit, offset];
  } else {
    sql    = `SELECT * FROM messages WHERE user_id = ? ORDER BY ts ${order} LIMIT ? OFFSET ?`;
    params = [String(userId), limit, offset];
  }

  const rows = await all(db, sql, params);
  return rows.map(mapRow);
}

/**
 * Lấy tin nhắn trong 1 thread/nhóm (mới nhất trước).
 */
async function getThreadMessages(threadId, { limit = 50, offset = 0, userId, newestFirst = true } = {}) {
  if (!threadId) return [];
  const db    = await getDb();
  const order = newestFirst ? "DESC" : "ASC";

  let sql, params;
  if (userId) {
    sql    = `SELECT * FROM messages WHERE thread_id = ? AND user_id = ? ORDER BY ts ${order} LIMIT ? OFFSET ?`;
    params = [String(threadId), String(userId), limit, offset];
  } else {
    sql    = `SELECT * FROM messages WHERE thread_id = ? ORDER BY ts ${order} LIMIT ? OFFSET ?`;
    params = [String(threadId), limit, offset];
  }

  const rows = await all(db, sql, params);
  return rows.map(mapRow);
}

/**
 * Tìm kiếm tin nhắn theo nội dung (LIKE).
 */
async function searchMessages(keyword, { threadId, userId, limit = 30 } = {}) {
  if (!keyword) return [];
  const db = await getDb();

  const clauses = ["content LIKE ?"];
  const params  = [`%${keyword}%`];

  if (threadId) { clauses.push("thread_id = ?"); params.push(String(threadId)); }
  if (userId)   { clauses.push("user_id = ?");   params.push(String(userId)); }

  params.push(limit);
  const sql  = `SELECT * FROM messages WHERE ${clauses.join(" AND ")} ORDER BY ts DESC LIMIT ?`;
  const rows = await all(db, sql, params);
  return rows.map(mapRow);
}

/**
 * Thống kê tổng: tổng tin nhắn, số user, số thread, tin nhắn mới nhất.
 */
async function getMessageStats() {
  const db  = await getDb();
  const row = await get(db, `
    SELECT
      COUNT(*)          AS total,
      COUNT(DISTINCT user_id)   AS uniqueUsers,
      COUNT(DISTINCT thread_id) AS uniqueThreads,
      MAX(ts)           AS lastTs,
      MIN(ts)           AS firstTs
    FROM messages
  `);
  return {
    total         : row?.total         || 0,
    uniqueUsers   : row?.uniqueUsers   || 0,
    uniqueThreads : row?.uniqueThreads || 0,
    lastTs        : row?.lastTs        || null,
    firstTs       : row?.firstTs       || null
  };
}

/**
 * Xoá tin nhắn cũ hơn X ngày (dọn dẹp định kỳ).
 * @param {number} daysOld — xoá tin nhắn cũ hơn số ngày này
 */
async function deleteOldMessages(daysOld = 30) {
  const db        = await getDb();
  const cutoff    = Date.now() - daysOld * 24 * 60 * 60 * 1000;
  const { changes } = await run(db, "DELETE FROM messages WHERE ts < ?", [cutoff]);
  return changes || 0;
}

/**
 * Lấy top user gửi nhiều tin nhất trong 1 thread.
 */
async function getTopSenders(threadId, { limit = 10, since } = {}) {
  const db     = await getDb();
  const params = [String(threadId)];
  let sinceClause = "";
  if (since) { sinceClause = "AND ts >= ?"; params.push(since); }
  params.push(limit);

  const rows = await all(db,
    `SELECT user_id, COUNT(*) AS cnt FROM messages
     WHERE thread_id = ? ${sinceClause}
     GROUP BY user_id ORDER BY cnt DESC LIMIT ?`,
    params
  );
  return rows.map(r => ({ userId: r.user_id, count: r.cnt }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapRow(r) {
  return {
    id       : r.id,
    msgId    : r.msg_id,
    cliMsgId : r.cli_msg_id,
    userId   : r.user_id,
    threadId : r.thread_id,
    isGroup  : r.is_group === 1,
    content  : r.content,
    msgType  : r.msg_type,
    attach   : parseJson(r.attach_json),
    ts       : r.ts,
    savedAt  : r.saved_at
  };
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  logMessage,
  getUserMessages,
  getThreadMessages,
  searchMessages,
  getMessageStats,
  deleteOldMessages,
  getTopSenders
};

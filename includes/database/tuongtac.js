"use strict";

/**
 * includes/database/tuongtac.js
 * Thao tác SQLite cho tương tác người dùng.
 * Thay thế: includes/data/tuongtac.json
 */

const fs   = require("fs");
const path = require("path");
const { getDb, run, get, all } = require("./sqlite");

const DATA_FILE = path.join(process.cwd(), "includes", "data", "tuongtac.json");

async function _migrate(db) {
  const count = await get(db, "SELECT COUNT(*) AS n FROM tuongtac");
  if (count && count.n > 0) return;
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    for (const [gid, users] of Object.entries(data)) {
      for (const [uid, u] of Object.entries(users)) {
        await run(db,
          `INSERT OR IGNORE INTO tuongtac (group_id, user_id, name, day, week, month, total)
           VALUES (?,?,?,?,?,?,?)`,
          [gid, uid, u.name || "", u.day || 0, u.week || 0, u.month || 0, u.total || 0]
        );
      }
    }
    if (typeof logInfo === "function") logInfo("[TuongTac] Migration JSON → SQLite hoàn tất.");
  } catch {}
}

let _initPromise = null;
async function _db() {
  if (!_initPromise) {
    _initPromise = (async () => {
      const db = await getDb();
      await _migrate(db);
      return db;
    })();
  }
  return _initPromise;
}

async function recordMessage(groupId, userId, name) {
  const db = await _db();
  await run(db,
    `INSERT INTO tuongtac (group_id, user_id, name, day, week, month, total)
     VALUES (?,?,?,1,1,1,1)
     ON CONFLICT(group_id, user_id) DO UPDATE SET
       name  = excluded.name,
       day   = day  + 1,
       week  = week + 1,
       month = month+ 1,
       total = total+ 1`,
    [String(groupId), String(userId), name || ""]
  );
}

async function resetPeriod(period) {
  const db = await _db();
  const allowed = ["day", "week", "month"];
  if (!allowed.includes(period)) return;
  await run(db, `UPDATE tuongtac SET ${period} = 0`);
  if (typeof logInfo === "function") logInfo(`[TuongTac] Đã reset ${period}`);
}

async function getTopForGroup(groupId, period = "day", limit = 10) {
  const db   = await _db();
  const col  = ["day", "week", "month", "total"].includes(period) ? period : "day";
  const rows = await all(db,
    `SELECT user_id AS uid, name, ${col} AS count FROM tuongtac
     WHERE group_id=? AND ${col} > 0
     ORDER BY ${col} DESC LIMIT ?`,
    [String(groupId), limit]
  );
  return rows;
}

async function getAllGroups() {
  const db   = await _db();
  const rows = await all(db, "SELECT DISTINCT group_id FROM tuongtac");
  return rows.map(r => r.group_id);
}

module.exports = { recordMessage, resetPeriod, getTopForGroup, getAllGroups };

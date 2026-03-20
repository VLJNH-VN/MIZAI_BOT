/**
 * includes/database/userController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Controller người dùng theo kiến trúc AURABOT's Users model:
 *   uid, name, gender, money, exp
 * Tích hợp với bảng users (profile) + users_money (economy) hiện có.
 *
 * API (expose qua global.Users):
 *   getData(uid, name?, gender?)  → Promise<object>   upsert + trả dữ liệu
 *   getInfo(uid)                  → Promise<object|null>
 *   setGender(uid, gender)        → Promise<void>
 *   getGender(uid)                → Promise<string>
 *   addMoney(uid, amount)         → Promise<number>   số dư mới
 *   decreaseMoney(uid, amount)    → Promise<boolean>  false nếu không đủ
 *   addExp(uid, amount)           → Promise<number>   exp mới
 *   getTopMoney(limit?)           → Promise<array>
 *   getTopExp(limit?)             → Promise<array>
 */

const { getDb, run, get, all } = require("./sqlite");

async function _ensureUser(db, uid, name, gender) {
  const now = Date.now();
  await run(db,
    `INSERT INTO users (user_id, name, gender, first_seen, msg_count, profile_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, ?)
     ON CONFLICT(user_id) DO NOTHING`,
    [String(uid), name || "Người dùng", gender || "Unknown", now, now]
  ).catch(() => {});

  await run(db,
    `INSERT INTO users_money (user_id, name, money, exp, daily_last, updated_at)
     VALUES (?, ?, 100000, 0, 0, ?)
     ON CONFLICT(user_id) DO NOTHING`,
    [String(uid), name || "", now]
  ).catch(() => {});
}

async function getData(uid, name, gender) {
  const id = String(uid);
  const db = await getDb();
  await _ensureUser(db, id, name, gender);

  const updates = [];
  const params  = [];
  if (name)   { updates.push("name = ?");   params.push(name); }
  if (gender) { updates.push("gender = ?"); params.push(gender); }
  if (updates.length) {
    params.push(Date.now(), id);
    await run(db,
      `UPDATE users SET ${updates.join(", ")}, updated_at = ? WHERE user_id = ?`,
      params
    ).catch(() => {});
  }

  const uRow = await get(db, "SELECT * FROM users WHERE user_id = ?", [id]);
  const mRow = await get(db, "SELECT money, exp, daily_last FROM users_money WHERE user_id = ?", [id]);

  return {
    uid:        uRow?.user_id || id,
    name:       uRow?.name    || name || "Người dùng",
    gender:     uRow?.gender  || "Unknown",
    money:      mRow?.money   ?? 100000,
    exp:        mRow?.exp     ?? 0,
    daily_last: mRow?.daily_last ?? 0,
    msg_count:  uRow?.msg_count  ?? 0,
    first_seen: uRow?.first_seen ?? 0
  };
}

async function getInfo(uid) {
  const db  = await getDb();
  const uRow = await get(db, "SELECT * FROM users WHERE user_id = ?", [String(uid)]);
  if (!uRow) return null;
  const mRow = await get(db, "SELECT money, exp FROM users_money WHERE user_id = ?", [String(uid)]);
  return {
    uid:       uRow.user_id,
    name:      uRow.name,
    gender:    uRow.gender || "Unknown",
    money:     mRow?.money ?? 100000,
    exp:       mRow?.exp   ?? 0,
    msg_count: uRow.msg_count  ?? 0,
    first_seen:uRow.first_seen ?? 0
  };
}

async function setGender(uid, gender) {
  const db = await getDb();
  await _ensureUser(db, String(uid));
  await run(db,
    "UPDATE users SET gender = ?, updated_at = ? WHERE user_id = ?",
    [gender || "Unknown", Date.now(), String(uid)]
  );
}

async function getGender(uid) {
  const db  = await getDb();
  const row = await get(db, "SELECT gender FROM users WHERE user_id = ?", [String(uid)]);
  return row?.gender || "Unknown";
}

async function addMoney(uid, amount) {
  const db  = await getDb();
  await _ensureUser(db, String(uid));
  await run(db,
    "UPDATE users_money SET money = money + ?, updated_at = ? WHERE user_id = ?",
    [amount, Date.now(), String(uid)]
  );
  const row = await get(db, "SELECT money FROM users_money WHERE user_id = ?", [String(uid)]);
  return row?.money ?? 0;
}

async function decreaseMoney(uid, amount) {
  const db  = await getDb();
  await _ensureUser(db, String(uid));
  const row = await get(db, "SELECT money FROM users_money WHERE user_id = ?", [String(uid)]);
  const cur = row?.money ?? 0;
  if (cur < amount) return false;
  await run(db,
    "UPDATE users_money SET money = money - ?, updated_at = ? WHERE user_id = ?",
    [amount, Date.now(), String(uid)]
  );
  return true;
}

async function addExp(uid, amount) {
  const db  = await getDb();
  await _ensureUser(db, String(uid));
  await run(db,
    "UPDATE users_money SET exp = exp + ?, updated_at = ? WHERE user_id = ?",
    [amount, Date.now(), String(uid)]
  );
  const row = await get(db, "SELECT exp FROM users_money WHERE user_id = ?", [String(uid)]);
  return row?.exp ?? 0;
}

async function getTopMoney(limit = 10) {
  const db = await getDb();
  return all(db,
    `SELECT u.user_id AS uid, u.name, u.gender, m.money, m.exp
     FROM users u JOIN users_money m ON u.user_id = m.user_id
     ORDER BY m.money DESC LIMIT ?`,
    [limit]
  );
}

async function getTopExp(limit = 10) {
  const db = await getDb();
  return all(db,
    `SELECT u.user_id AS uid, u.name, u.gender, m.money, m.exp
     FROM users u JOIN users_money m ON u.user_id = m.user_id
     ORDER BY m.exp DESC LIMIT ?`,
    [limit]
  );
}

module.exports = {
  getData,
  getInfo,
  setGender,
  getGender,
  addMoney,
  decreaseMoney,
  addExp,
  getTopMoney,
  getTopExp
};

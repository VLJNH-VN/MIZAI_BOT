const { getDb, run, get, all } = require("./sqlite");
const fs = require("fs");
const path = require("path");

const RENT_KEY_PATH = path.join(__dirname, "../../modules/data/RentKey.json");

function ensureRentKeyFile() {
  const dir = path.dirname(RENT_KEY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(RENT_KEY_PATH)) {
    fs.writeFileSync(RENT_KEY_PATH, JSON.stringify({ used_keys: [], unUsed_keys: [] }, null, 2), "utf-8");
  }
}

function readRentKeys() {
  ensureRentKeyFile();
  try {
    const j = JSON.parse(fs.readFileSync(RENT_KEY_PATH, "utf-8"));
    if (!j.used_keys) j.used_keys = [];
    if (!j.unUsed_keys) j.unUsed_keys = [];
    return j;
  } catch {
    return { used_keys: [], unUsed_keys: [] };
  }
}

function writeRentKeys(data) {
  ensureRentKeyFile();
  fs.writeFileSync(RENT_KEY_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function formatDate(date) {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function parseDate(str) {
  const parts = str.split("/");
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime())) return null;
  return date;
}

function addDays(dateStr, days) {
  const date = parseDate(dateStr);
  if (!date) throw new Error(`Ngày không hợp lệ: ${dateStr}`);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

function isExpired(dateStr) {
  const date = parseDate(dateStr);
  if (!date) return true;
  return date < new Date();
}

function todayStr() {
  return formatDate(new Date());
}

async function getRent(threadId) {
  const db = await getDb();
  return get(db, "SELECT * FROM rent WHERE thread_id = ?", [String(threadId)]);
}

async function getAllRent() {
  const db = await getDb();
  return all(db, "SELECT * FROM rent ORDER BY id ASC", []);
}

async function addRent(threadId, ownerId, days) {
  const db = await getDb();
  const now = Date.now();
  const today = todayStr();
  const endDate = addDays(today, days);

  const existing = await get(db, "SELECT * FROM rent WHERE thread_id = ?", [String(threadId)]);
  if (existing) {
    const newEnd = addDays(existing.time_end, days);
    await run(db,
      "UPDATE rent SET time_end = ?, updated_at = ? WHERE thread_id = ?",
      [newEnd, now, String(threadId)]
    );
    return { isNew: false, time_start: existing.time_start, time_end: newEnd };
  } else {
    await run(db,
      "INSERT INTO rent (thread_id, owner_id, time_start, time_end, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      [String(threadId), String(ownerId), today, endDate, now, now]
    );
    return { isNew: true, time_start: today, time_end: endDate };
  }
}

async function extendRent(threadId, days) {
  const db = await getDb();
  const existing = await get(db, "SELECT * FROM rent WHERE thread_id = ?", [String(threadId)]);
  if (!existing) return null;
  const newEnd = addDays(existing.time_end, days);
  await run(db,
    "UPDATE rent SET time_end = ?, updated_at = ? WHERE thread_id = ?",
    [newEnd, Date.now(), String(threadId)]
  );
  return { time_start: existing.time_start, time_end: newEnd };
}

async function setRentEnd(threadId, endDate) {
  const db = await getDb();
  await run(db,
    "UPDATE rent SET time_end = ?, updated_at = ? WHERE thread_id = ?",
    [endDate, Date.now(), String(threadId)]
  );
}

async function deleteRent(threadId) {
  const db = await getDb();
  const existing = await get(db, "SELECT * FROM rent WHERE thread_id = ?", [String(threadId)]);
  if (!existing) return false;
  await run(db, "DELETE FROM rent WHERE thread_id = ?", [String(threadId)]);
  return true;
}

async function activateKey(key, threadId, ownerId) {
  const j = readRentKeys();
  if (j.used_keys.includes(key)) return { ok: false, reason: "used" };
  if (!j.unUsed_keys.includes(key)) return { ok: false, reason: "invalid" };

  const parts = key.split("_");
  const days = parseInt(parts[1]) || 30;

  const db = await getDb();
  const now = Date.now();
  const today = todayStr();
  const existing = await get(db, "SELECT * FROM rent WHERE thread_id = ?", [String(threadId)]);
  let endDate;

  if (existing) {
    endDate = addDays(existing.time_end, days);
    await run(db, "UPDATE rent SET time_end = ?, updated_at = ? WHERE thread_id = ?",
      [endDate, now, String(threadId)]);
  } else {
    endDate = addDays(today, days);
    await run(db, "INSERT INTO rent (thread_id, owner_id, time_start, time_end, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      [String(threadId), String(ownerId), today, endDate, now, now]);
  }

  j.unUsed_keys = j.unUsed_keys.filter(k => k !== key);
  j.used_keys.push(key);
  writeRentKeys(j);

  return { ok: true, isNew: !existing, time_start: existing ? existing.time_start : today, time_end: endDate };
}

function generateKey(prefix, days) {
  const j = readRentKeys();
  const suffix = Math.random().toString(36).substring(2, 9);
  let key = `${prefix}_${days}_${suffix}`;
  while (j.used_keys.includes(key) || j.unUsed_keys.includes(key)) {
    const s2 = Math.random().toString(36).substring(2, 9);
    key = `${prefix}_${days}_${s2}`;
  }
  j.unUsed_keys.push(key);
  writeRentKeys(j);
  return key;
}

module.exports = {
  getRent,
  getAllRent,
  addRent,
  extendRent,
  setRentEnd,
  deleteRent,
  activateKey,
  generateKey,
  isExpired,
  todayStr,
  addDays,
  formatDate,
  parseDate,
  readRentKeys,
};

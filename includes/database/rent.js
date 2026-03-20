const { getDb, run, get, all } = require("./sqlite");
const fs   = require("fs");
const path = require("path");

const RENT_KEY_PATH = path.join(__dirname, "../data/RentKey.json");

// ── File helpers ───────────────────────────────────────────────────────────────

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
    if (!j.used_keys)   j.used_keys   = [];
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

// ── Date helpers ───────────────────────────────────────────────────────────────

function formatDate(date) {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function parseDate(str) {
  if (!str || typeof str !== "string") return null;
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

function daysUntilExpiry(dateStr) {
  const date = parseDate(dateStr);
  if (!date) return -1;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = date.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function todayStr() {
  return formatDate(new Date());
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

async function getRent(threadId) {
  const db = await getDb();
  return get(db, "SELECT * FROM rent WHERE thread_id = ?", [String(threadId)]);
}

async function getAllRent() {
  const db = await getDb();
  return all(db, "SELECT * FROM rent ORDER BY id ASC", []);
}

async function getExpiringGroups(withinDays = 3) {
  const allRent = await getAllRent();
  return allRent.filter(r => {
    const d = daysUntilExpiry(r.time_end);
    return d >= 0 && d <= withinDays;
  });
}

async function getStats() {
  const allRent = await getAllRent();
  const keys    = readRentKeys();
  let active = 0, expired = 0, expiringSoon = 0;
  for (const r of allRent) {
    const d = daysUntilExpiry(r.time_end);
    if (d < 0)      expired++;
    else            active++;
    if (d >= 0 && d <= 3) expiringSoon++;
  }
  return {
    total:        allRent.length,
    active,
    expired,
    expiringSoon,
    unusedKeys:   keys.unUsed_keys.length,
    usedKeys:     keys.used_keys.length,
  };
}

async function addRent(threadId, ownerId, days) {
  const db    = await getDb();
  const now   = Date.now();
  const today = todayStr();

  const existing = await get(db, "SELECT * FROM rent WHERE thread_id = ?", [String(threadId)]);
  if (existing) {
    const base   = isExpired(existing.time_end) ? today : existing.time_end;
    const newEnd = addDays(base, days);
    await run(db,
      "UPDATE rent SET time_end = ?, updated_at = ? WHERE thread_id = ?",
      [newEnd, now, String(threadId)]
    );
    return { isNew: false, time_start: existing.time_start, time_end: newEnd };
  } else {
    const endDate = addDays(today, days);
    await run(db,
      "INSERT INTO rent (thread_id, owner_id, time_start, time_end, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      [String(threadId), String(ownerId), today, endDate, now, now]
    );
    return { isNew: true, time_start: today, time_end: endDate };
  }
}

async function extendRent(threadId, days) {
  const db       = await getDb();
  const existing = await get(db, "SELECT * FROM rent WHERE thread_id = ?", [String(threadId)]);
  if (!existing) return null;
  const base   = isExpired(existing.time_end) ? todayStr() : existing.time_end;
  const newEnd = addDays(base, days);
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
  const db       = await getDb();
  const existing = await get(db, "SELECT * FROM rent WHERE thread_id = ?", [String(threadId)]);
  if (!existing) return false;
  await run(db, "DELETE FROM rent WHERE thread_id = ?", [String(threadId)]);
  return true;
}

// ── Key management ────────────────────────────────────────────────────────────

function generateKey(prefix, days) {
  const j      = readRentKeys();
  const suffix = Math.random().toString(36).substring(2, 9).toUpperCase();
  let key = `${prefix}_${days}D_${suffix}`;
  while (j.used_keys.includes(key) || j.unUsed_keys.includes(key)) {
    const s2 = Math.random().toString(36).substring(2, 9).toUpperCase();
    key = `${prefix}_${days}D_${s2}`;
  }
  jq.unUsed_keys.push(key);
  writeRentKeys(j);
  return key;
}

function generateKeys(prefix, days, count) {
  const keys = [];
  for (let i = 0; i < count; i++) {
    keys.push(generateKey(prefix, days));
  }
  return keys;
}

function listKeys(type = "all") {
  const j = readRentKeys();
  if (type === "unused") return j.unUsed_keys;
  if (type === "used")   return j.used_keys;
  return { unused: j.unUsed_keys, used: j.used_keys };
}

function deleteKey(key) {
  const j = readRentKeys();
  const inUnused = j.unUsed_keys.includes(key);
  const inUsed   = j.used_keys.includes(key);
  if (!inUnused && !inUsed) return false;
  j.unUsed_keys = j.unUsed_keys.filter(k => k !== key);
  j.used_keys   = j.used_keys.filter(k => k !== key);
  writeRentKeys(j);
  return true;
}

async function activateKey(key, threadId, ownerId) {
  const j = readRentKeys();
  if (j.used_keys.includes(key))   return { ok: false, reason: "used" };
  if (!j.unUsed_keys.includes(key)) return { ok: false, reason: "invalid" };

  const parts = key.split("_");
  const dayStr = parts.find(p => /^\d+D$/i.test(p)) || parts[1] || "30D";
  const days   = parseInt(dayStr) || 30;

  const db    = await getDb();
  const now   = Date.now();
  const today = todayStr();
  const existing = await get(db, "SELECT * FROM rent WHERE thread_id = ?", [String(threadId)]);
  let endDate;

  if (existing) {
    const base = isExpired(existing.time_end) ? today : existing.time_end;
    endDate    = addDays(base, days);
    await run(db, "UPDATE rent SET time_end = ?, updated_at = ? WHERE thread_id = ?",
      [endDate, now, String(threadId)]);
  } else {
    endDate = addDays(today, days);
    await run(db,
      "INSERT INTO rent (thread_id, owner_id, time_start, time_end, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      [String(threadId), String(ownerId), today, endDate, now, now]
    );
  }

  j.unUsed_keys = j.unUsed_keys.filter(k => k !== key);
  j.used_keys.push(key);
  writeRentKeys(j);

  return {
    ok: true, isNew: !existing,
    time_start: existing ? existing.time_start : today,
    time_end: endDate, days
  };
}

// ── Cache ─────────────────────────────────────────────────────────────────────

const _rentStatusCache = new Map();
const RENT_CACHE_TTL   = 2 * 60 * 1000;

async function isGroupRented(threadId) {
  const key    = String(threadId);
  const now    = Date.now();
  const cached = _rentStatusCache.get(key);
  if (cached && cached.ts + RENT_CACHE_TTL > now) return cached.ok;
  try {
    const info = await getRent(key);
    const ok   = !!info && !isExpired(info.time_end);
    _rentStatusCache.set(key, { ok, ts: now });
    return ok;
  } catch {
    return false;
  }
}

function clearRentCache(threadId) {
  if (threadId) _rentStatusCache.delete(String(threadId));
  else          _rentStatusCache.clear();
}

module.exports = {
  getRent, getAllRent, getExpiringGroups, getStats,
  addRent, extendRent, setRentEnd, deleteRent,
  activateKey, generateKey, generateKeys,
  listKeys, deleteKey,
  isExpired, daysUntilExpiry, todayStr, addDays, formatDate, parseDate,
  readRentKeys, isGroupRented, clearRentCache,
};

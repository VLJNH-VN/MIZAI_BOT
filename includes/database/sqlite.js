const fs   = require("fs");
const path = require("path");

let _mode     = null; // "sqlite3" | "better-sqlite3" | "sqljs"
let _db3      = null;
let _bsql     = null;
let _sqljsDb  = null;
let _dbPromise = null;

function getDbPath() {
  const dataDir = path.join(__dirname, "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "mizai.sqlite");
}

// ════════════════════════════════════════
//  sqlite3 (async)
// ════════════════════════════════════════
function runSqlite3(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err); else resolve(this);
    });
  });
}
function getSqlite3(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
}
function allSqlite3(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err); else resolve(rows);
    });
  });
}

// ════════════════════════════════════════
//  better-sqlite3 (sync → wrapped async)
// ════════════════════════════════════════
function runBetter(db, sql, params = []) {
  try {
    const info = db.prepare(sql).run(...params);
    return Promise.resolve({ lastID: info.lastInsertRowid, changes: info.changes });
  } catch (e) { return Promise.reject(e); }
}
function getBetter(db, sql, params = []) {
  try { return Promise.resolve(db.prepare(sql).get(...params)); }
  catch (e) { return Promise.reject(e); }
}
function allBetter(db, sql, params = []) {
  try { return Promise.resolve(db.prepare(sql).all(...params)); }
  catch (e) { return Promise.reject(e); }
}

// ════════════════════════════════════════
//  sql.js (pure JS / WebAssembly)
// ════════════════════════════════════════
const _sqlJsSaveInterval = 5000; // ms
let   _sqlJsSaveTimer    = null;

function _sqlJsSave(db, dbPath) {
  try {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (_) {}
}

async function openSqlJs(dbPath) {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  let db;
  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }
  // Tự lưu định kỳ
  _sqlJsSaveTimer = setInterval(() => _sqlJsSave(db, dbPath), _sqlJsSaveInterval);
  process.on("exit", () => { clearInterval(_sqlJsSaveTimer); _sqlJsSave(db, dbPath); });
  process.on("SIGINT", () => { _sqlJsSave(db, dbPath); process.exit(0); });
  _sqljsDb = db;
  return db;
}

function runSqlJs(db, sql, params = []) {
  try {
    db.run(sql, params);
    const lastId = db.exec("SELECT last_insert_rowid()");
    const lastID = lastId[0]?.values[0][0] ?? 0;
    return Promise.resolve({ lastID, changes: 0 });
  } catch (e) { return Promise.reject(e); }
}
function getSqlJs(db, sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const row = stmt.step() ? stmt.getAsObject() : undefined;
    stmt.free();
    return Promise.resolve(row);
  } catch (e) { return Promise.reject(e); }
}
function allSqlJs(db, sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return Promise.resolve(rows);
  } catch (e) { return Promise.reject(e); }
}

// ════════════════════════════════════════
//  Public API
// ════════════════════════════════════════
function run(db, sql, params = []) {
  if (_mode === "better-sqlite3") return runBetter(db, sql, params);
  if (_mode === "sqljs")          return runSqlJs(db, sql, params);
  return runSqlite3(db, sql, params);
}
function get(db, sql, params = []) {
  if (_mode === "better-sqlite3") return getBetter(db, sql, params);
  if (_mode === "sqljs")          return getSqlJs(db, sql, params);
  return getSqlite3(db, sql, params);
}
function all(db, sql, params = []) {
  if (_mode === "better-sqlite3") return allBetter(db, sql, params);
  if (_mode === "sqljs")          return allSqlJs(db, sql, params);
  return allSqlite3(db, sql, params);
}

// ════════════════════════════════════════
//  Mở database (tự chọn engine)
// ════════════════════════════════════════
async function openDb() {
  const dbPath = getDbPath();

  // 1. sqlite3
  try {
    if (!_db3) _db3 = require("sqlite3").verbose();
    _mode = "sqlite3";
    return await new Promise((resolve, reject) => {
      const db = new _db3.Database(dbPath, err => err ? reject(err) : resolve(db));
    });
  } catch (_) {}

  // 2. better-sqlite3
  try {
    if (!_bsql) _bsql = require("better-sqlite3");
    _mode = "better-sqlite3";
    return _bsql(dbPath);
  } catch (_) {}

  // 3. sql.js (pure JS — luôn hoạt động)
  try {
    _mode = "sqljs";
    return await openSqlJs(dbPath);
  } catch (e) {}

  throw new Error("[sqlite] Không tìm thấy engine nào! Chạy: npm install sql.js");
}

// ════════════════════════════════════════
//  Schema
// ════════════════════════════════════════
async function initSchema(db) {
  await run(db, "PRAGMA journal_mode = WAL;").catch(() => {});
  await run(db, "PRAGMA synchronous = NORMAL;").catch(() => {});
  await run(db, "PRAGMA busy_timeout = 5000;").catch(() => {});
  await run(db, "PRAGMA foreign_keys = ON;").catch(() => {});

  await run(db, `CREATE TABLE IF NOT EXISTS users (
    user_id      TEXT PRIMARY KEY,
    name         TEXT,
    profile_json TEXT,
    first_seen   INTEGER DEFAULT 0,
    msg_count    INTEGER DEFAULT 0,
    profile_at   INTEGER DEFAULT 0,
    updated_at   INTEGER
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS groups (
    group_id             TEXT PRIMARY KEY,
    name                 TEXT,
    info_json            TEXT,
    mem_ver_list_json    TEXT,
    pending_approve_json TEXT,
    member_count         INTEGER DEFAULT 0,
    first_seen           INTEGER DEFAULT 0,
    profile_at           INTEGER DEFAULT 0,
    updated_at           INTEGER
  )`);

  // Migration: thêm cột mới nếu chưa có (tương thích DB cũ)
  const userCols  = (await all(db, "PRAGMA table_info(users)")).map(c => c.name);
  const groupCols = (await all(db, "PRAGMA table_info(groups)")).map(c => c.name);
  if (!userCols.includes("first_seen"))    await run(db, "ALTER TABLE users  ADD COLUMN first_seen  INTEGER DEFAULT 0").catch(() => {});
  if (!userCols.includes("msg_count"))     await run(db, "ALTER TABLE users  ADD COLUMN msg_count   INTEGER DEFAULT 0").catch(() => {});
  if (!userCols.includes("profile_at"))    await run(db, "ALTER TABLE users  ADD COLUMN profile_at  INTEGER DEFAULT 0").catch(() => {});
  if (!groupCols.includes("member_count")) await run(db, "ALTER TABLE groups ADD COLUMN member_count INTEGER DEFAULT 0").catch(() => {});
  if (!groupCols.includes("first_seen"))   await run(db, "ALTER TABLE groups ADD COLUMN first_seen  INTEGER DEFAULT 0").catch(() => {});
  if (!groupCols.includes("profile_at"))   await run(db, "ALTER TABLE groups ADD COLUMN profile_at  INTEGER DEFAULT 0").catch(() => {});

  await run(db, "CREATE INDEX IF NOT EXISTS idx_users_updated_at  ON users(updated_at);").catch(() => {});
  await run(db, "CREATE INDEX IF NOT EXISTS idx_groups_updated_at ON groups(updated_at);").catch(() => {});
  await run(db, "CREATE INDEX IF NOT EXISTS idx_users_msg_count   ON users(msg_count);").catch(() => {});

  await run(db, `CREATE TABLE IF NOT EXISTS users_money (
    user_id TEXT PRIMARY KEY, name TEXT DEFAULT '',
    money INTEGER DEFAULT 100000, exp INTEGER DEFAULT 0,
    daily_last INTEGER DEFAULT 0, updated_at INTEGER
  )`);

  const cols = (await all(db, "PRAGMA table_info(users_money)")).map(c => c.name);
  if (!cols.includes("exp"))        await run(db, "ALTER TABLE users_money ADD COLUMN exp INTEGER DEFAULT 0").catch(() => {});
  if (!cols.includes("daily_last")) await run(db, "ALTER TABLE users_money ADD COLUMN daily_last INTEGER DEFAULT 0").catch(() => {});
  if (!cols.includes("name"))       await run(db, "ALTER TABLE users_money ADD COLUMN name TEXT DEFAULT ''").catch(() => {});

  await run(db, `CREATE TABLE IF NOT EXISTS rent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT UNIQUE NOT NULL,
    owner_id  TEXT NOT NULL,
    time_start TEXT NOT NULL,
    time_end   TEXT NOT NULL,
    created_at INTEGER,
    updated_at INTEGER
  )`);
}

// ════════════════════════════════════════
//  Singleton
// ════════════════════════════════════════
async function getDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = (async () => {
    const db = await openDb();
    await initSchema(db);
    const label = `[SQLite] Engine: ${_mode}`;
    if (typeof logInfo === "function") logInfo(label); else console.log(label);
    return db;
  })();
  return _dbPromise;
}

module.exports = { getDb, run, get, all, getDbPath };

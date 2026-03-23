const fs   = require("fs");
const path = require("path");

let _mode      = null;
let _db        = null;
let _dbPromise = null;

function getDbPath() {
  const dataDir = path.join(__dirname, "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "mizai.sqlite");
}

// ── better-sqlite3 (sync, fastest) ───────────────────────────────────────────

function run(db, sql, params = []) {
  if (_mode === "sqljs") return _sqljsRun(db, sql, params);
  try {
    const info = db.prepare(sql).run(...params);
    return Promise.resolve({ lastID: info.lastInsertRowid, changes: info.changes });
  } catch (e) { return Promise.reject(e); }
}

function get(db, sql, params = []) {
  if (_mode === "sqljs") return _sqljsGet(db, sql, params);
  try { return Promise.resolve(db.prepare(sql).get(...params)); }
  catch (e) { return Promise.reject(e); }
}

function all(db, sql, params = []) {
  if (_mode === "sqljs") return _sqljsAll(db, sql, params);
  try { return Promise.resolve(db.prepare(sql).all(...params)); }
  catch (e) { return Promise.reject(e); }
}

// ── sql.js fallback (pure JS/WASM, no native bindings) ───────────────────────

const SQLJS_SAVE_INTERVAL = 10_000;
let _sqljsSaveTimer = null;

function _sqljsSave(db, dbPath) {
  try { fs.writeFileSync(dbPath, Buffer.from(db.export())); } catch (_) {}
}

async function _openSqlJs(dbPath) {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  const db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();
  _sqljsSaveTimer = setInterval(() => _sqljsSave(db, dbPath), SQLJS_SAVE_INTERVAL);
  if (_sqljsSaveTimer.unref) _sqljsSaveTimer.unref();
  process.on("exit", () => { clearInterval(_sqljsSaveTimer); _sqljsSave(db, dbPath); });
  return db;
}

function _sqljsRun(db, sql, params = []) {
  try {
    db.run(sql, params);
    const r = db.exec("SELECT last_insert_rowid()");
    return Promise.resolve({ lastID: r[0]?.values[0][0] ?? 0, changes: 0 });
  } catch (e) { return Promise.reject(e); }
}

function _sqljsGet(db, sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const row = stmt.step() ? stmt.getAsObject() : undefined;
    stmt.free();
    return Promise.resolve(row);
  } catch (e) { return Promise.reject(e); }
}

function _sqljsAll(db, sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return Promise.resolve(rows);
  } catch (e) { return Promise.reject(e); }
}

// ── Schema ────────────────────────────────────────────────────────────────────

async function _execMany(db, statements) {
  for (const sql of statements) {
    await run(db, sql).catch(() => {});
  }
}

async function initSchema(db) {
  if (_mode === "better-sqlite3") {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    db.pragma("cache_size = -4096");
    db.pragma("temp_store = MEMORY");
    db.pragma("mmap_size = 67108864");
  } else {
    await _execMany(db, [
      "PRAGMA journal_mode = WAL",
      "PRAGMA synchronous = NORMAL",
      "PRAGMA busy_timeout = 5000",
      "PRAGMA foreign_keys = ON",
    ]);
  }

  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY, name TEXT, profile_json TEXT,
      first_seen INTEGER DEFAULT 0, msg_count INTEGER DEFAULT 0,
      profile_at INTEGER DEFAULT 0, updated_at INTEGER,
      gender TEXT DEFAULT 'Unknown'
    )`,
    `CREATE TABLE IF NOT EXISTS groups (
      group_id TEXT PRIMARY KEY, name TEXT, info_json TEXT,
      mem_ver_list_json TEXT, pending_approve_json TEXT,
      member_count INTEGER DEFAULT 0, first_seen INTEGER DEFAULT 0,
      profile_at INTEGER DEFAULT 0, updated_at INTEGER,
      prefix TEXT DEFAULT '.', rankup INTEGER DEFAULT 0, settings TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, msg_id TEXT, cli_msg_id TEXT,
      user_id TEXT, thread_id TEXT, is_group INTEGER DEFAULT 0,
      content TEXT, msg_type TEXT, attach_json TEXT, ts INTEGER, saved_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS users_money (
      user_id TEXT PRIMARY KEY, name TEXT DEFAULT '',
      money INTEGER DEFAULT 100000, exp INTEGER DEFAULT 0,
      daily_last INTEGER DEFAULT 0, updated_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS tx_game_money (user_id TEXT PRIMARY KEY, balance INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS tx_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT, phien INTEGER UNIQUE,
      result TEXT, dice1 INTEGER, dice2 INTEGER, dice3 INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS tx_config (key TEXT PRIMARY KEY, value TEXT)`,
    `CREATE TABLE IF NOT EXISTS tx_bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, phien INTEGER,
      choice TEXT, bet_amount INTEGER DEFAULT 0, win_amount INTEGER DEFAULT 0,
      ket_qua TEXT DEFAULT '', time INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS tx_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT,
      time INTEGER, amount INTEGER, balance_before INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS tx_enabled_groups (group_id TEXT PRIMARY KEY)`,
    `CREATE TABLE IF NOT EXISTS tuongtac (
      group_id TEXT, user_id TEXT, name TEXT,
      day INTEGER DEFAULT 0, week INTEGER DEFAULT 0,
      month INTEGER DEFAULT 0, total INTEGER DEFAULT 0,
      PRIMARY KEY (group_id, user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS ai_user_memory (
      user_id TEXT PRIMARY KEY, name TEXT,
      notes_json TEXT DEFAULT '[]', last_seen TEXT DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS ai_diary (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, entry TEXT)`,
    `CREATE TABLE IF NOT EXISTS ai_global_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, note TEXT)`,
    `CREATE TABLE IF NOT EXISTS ai_state (key TEXT PRIMARY KEY, value TEXT)`,
    `CREATE TABLE IF NOT EXISTS ai_enabled_groups (group_id TEXT PRIMARY KEY, enabled INTEGER DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS group_anti (
      group_id TEXT PRIMARY KEY, cfg_json TEXT NOT NULL DEFAULT '{}', updated_at INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS group_muted (
      group_id TEXT, user_id TEXT, name TEXT DEFAULT '',
      muted_at INTEGER DEFAULT 0, expire_at INTEGER DEFAULT 0,
      PRIMARY KEY (group_id, user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS rent_groups (
      group_id TEXT PRIMARY KEY, owner_id TEXT DEFAULT '',
      time_start TEXT DEFAULT '', time_end TEXT DEFAULT '',
      created_at INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS rent_keys (
      key_str TEXT PRIMARY KEY, days INTEGER DEFAULT 30,
      is_used INTEGER DEFAULT 0, created_at INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS cooldowns (
      cmd_name TEXT, user_id TEXT, last_used INTEGER DEFAULT 0,
      PRIMARY KEY (cmd_name, user_id)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_users_updated_at   ON users(updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_groups_updated_at  ON groups(updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_users_msg_count    ON users(msg_count)",
    "CREATE INDEX IF NOT EXISTS idx_messages_user_id   ON messages(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id)",
    "CREATE INDEX IF NOT EXISTS idx_messages_ts        ON messages(ts)",
    "CREATE INDEX IF NOT EXISTS idx_tx_bets_phien      ON tx_bets(phien)",
    "CREATE INDEX IF NOT EXISTS idx_tx_bets_user       ON tx_bets(user_id, phien)",
    "CREATE INDEX IF NOT EXISTS idx_tx_trans_user      ON tx_transactions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tuongtac_group     ON tuongtac(group_id)",
    "CREATE INDEX IF NOT EXISTS idx_group_muted_gid    ON group_muted(group_id)",
  ];
  await _execMany(db, tables);

  // Migrations
  const migrate = async (table, col, def) => {
    const cols = (await all(db, `PRAGMA table_info(${table})`)).map(c => c.name);
    if (!cols.includes(col))
      await run(db, `ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).catch(() => {});
  };
  await migrate("users",       "first_seen",   "INTEGER DEFAULT 0");
  await migrate("users",       "msg_count",    "INTEGER DEFAULT 0");
  await migrate("users",       "profile_at",   "INTEGER DEFAULT 0");
  await migrate("users",       "gender",       "TEXT DEFAULT 'Unknown'");
  await migrate("groups",      "member_count", "INTEGER DEFAULT 0");
  await migrate("groups",      "first_seen",   "INTEGER DEFAULT 0");
  await migrate("groups",      "profile_at",   "INTEGER DEFAULT 0");
  await migrate("groups",      "prefix",       "TEXT DEFAULT '.'");
  await migrate("groups",      "rankup",       "INTEGER DEFAULT 0");
  await migrate("groups",      "settings",     "TEXT");
  await migrate("users_money", "exp",          "INTEGER DEFAULT 0");
  await migrate("users_money", "daily_last",   "INTEGER DEFAULT 0");
  await migrate("users_money", "name",         "TEXT DEFAULT ''");
}

// ── Singleton ─────────────────────────────────────────────────────────────────

async function getDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = (async () => {
    const dbPath = getDbPath();

    // 1. Try better-sqlite3 (native, fastest)
    try {
      const BetterSqlite = require("better-sqlite3");
      _db   = new BetterSqlite(dbPath);
      _mode = "better-sqlite3";
    } catch (_) {
      // 2. Fallback: sql.js (pure JS/WASM — always works, no native bindings)
      _db   = await _openSqlJs(dbPath);
      _mode = "sqljs";
    }

    await initSchema(_db);
    const label = `[SQLite] Engine: ${_mode}`;
    if (typeof logInfo === "function") logInfo(label); else console.log(label);
    return _db;
  })();
  return _dbPromise;
}

module.exports = { getDb, run, get, all, getDbPath };

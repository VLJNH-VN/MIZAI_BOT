"use strict";

/**
 * includes/database/taixiu.js
 * Tất cả thao tác SQLite cho game Tài Xỉu.
 * Thay thế: money.json, phien.json, txConfig.json,
 *            betHistory/*.json, lichsuGD/*.json, fileCheck.json
 */

const fs   = require("fs");
const path = require("path");
const { getDb, run, get, all } = require("./sqlite");

// ── Migrate dữ liệu từ JSON cũ (chỉ chạy 1 lần) ──────────────────────────────
const TX_DIR   = path.join(process.cwd(), "includes", "data", "game", "taixiu");
const BET_DIR  = path.join(TX_DIR, "betHistory");
const LSGD_DIR = path.join(TX_DIR, "lichsuGD");

function _readJson(f, fallback) {
  try { return JSON.parse(fs.readFileSync(f, "utf-8")); } catch { return fallback; }
}

async function _migrate(db) {
  const migrated = await get(db, "SELECT value FROM tx_config WHERE key='migrated'");
  if (migrated) return;

  // money.json → tx_game_money
  const moneyFile = path.join(TX_DIR, "money.json");
  if (fs.existsSync(moneyFile)) {
    const rows = _readJson(moneyFile, []);
    for (const r of rows) {
      if (!r.senderID) continue;
      await run(db,
        "INSERT OR IGNORE INTO tx_game_money (user_id, balance) VALUES (?,?)",
        [String(r.senderID), r.input || 0]
      );
    }
  }

  // phien.json → tx_rounds
  const phienFile = path.join(TX_DIR, "phien.json");
  if (fs.existsSync(phienFile)) {
    const rows = _readJson(phienFile, []);
    for (const r of rows) {
      await run(db,
        "INSERT OR IGNORE INTO tx_rounds (phien, result, dice1, dice2, dice3) VALUES (?,?,?,?,?)",
        [r.phien, r.result, r.dice1, r.dice2, r.dice3]
      );
    }
  }

  // txConfig.json → tx_config
  const cfgFile = path.join(TX_DIR, "txConfig.json");
  if (fs.existsSync(cfgFile)) {
    const cfg = _readJson(cfgFile, {});
    for (const [k, v] of Object.entries(cfg)) {
      await run(db,
        "INSERT OR IGNORE INTO tx_config (key, value) VALUES (?,?)",
        [k, JSON.stringify(v)]
      );
    }
  }

  // fileCheck.json → tx_enabled_groups
  const checkFile = path.join(TX_DIR, "fileCheck.json");
  if (fs.existsSync(checkFile)) {
    const groups = _readJson(checkFile, []);
    for (const gid of groups) {
      await run(db,
        "INSERT OR IGNORE INTO tx_enabled_groups (group_id) VALUES (?)",
        [String(gid)]
      );
    }
  }

  // betHistory/*.json → tx_bets
  if (fs.existsSync(BET_DIR)) {
    for (const file of fs.readdirSync(BET_DIR)) {
      const bets = _readJson(path.join(BET_DIR, file), []);
      for (const b of bets) {
        await run(db,
          "INSERT OR IGNORE INTO tx_bets (user_id, phien, choice, bet_amount, win_amount, ket_qua, time) VALUES (?,?,?,?,?,?,?)",
          [String(b.senderID), b.phien, b.choice, b.betAmount || 0, b.winAmount || 0, b.ket_qua || "", b.time || 0]
        );
      }
    }
  }

  // lichsuGD/*.json → tx_transactions
  if (fs.existsSync(LSGD_DIR)) {
    for (const file of fs.readdirSync(LSGD_DIR)) {
      const txs = _readJson(path.join(LSGD_DIR, file), []);
      for (const t of txs) {
        await run(db,
          "INSERT OR IGNORE INTO tx_transactions (user_id, time, amount, balance_before) VALUES (?,?,?,?)",
          [String(t.senderID), t.time || 0, t.input || 0, t.historic_input || 0]
        );
      }
    }
  }

  await run(db, "INSERT OR REPLACE INTO tx_config (key, value) VALUES ('migrated', '1')");
  if (typeof logInfo === "function") logInfo("[Taixiu] Migration JSON → SQLite hoàn tất.");
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

// ══════════════════════════════════════════════════════════════════════════════
//  tx_game_money
// ══════════════════════════════════════════════════════════════════════════════
async function getGameMoney(userId) {
  const db  = await _db();
  const row = await get(db, "SELECT balance FROM tx_game_money WHERE user_id=?", [String(userId)]);
  return row ? row.balance : 0;
}

async function setGameMoney(userId, balance) {
  const db = await _db();
  await run(db,
    "INSERT INTO tx_game_money (user_id, balance) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance",
    [String(userId), balance]
  );
}

async function adjustGameMoney(userId, delta) {
  const db  = await _db();
  await run(db,
    "INSERT INTO tx_game_money (user_id, balance) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET balance = balance + ?",
    [String(userId), Math.max(0, delta), delta]
  );
  const row = await get(db, "SELECT balance FROM tx_game_money WHERE user_id=?", [String(userId)]);
  return row ? row.balance : 0;
}

async function getAllGameMoney() {
  const db = await _db();
  return all(db, "SELECT user_id, balance FROM tx_game_money ORDER BY balance DESC");
}

async function deleteGameMoney(userId) {
  const db = await _db();
  await run(db, "DELETE FROM tx_game_money WHERE user_id=?", [String(userId)]);
}

async function resetAllGameMoney() {
  const db = await _db();
  await run(db, "DELETE FROM tx_game_money");
}

// ══════════════════════════════════════════════════════════════════════════════
//  tx_rounds
// ══════════════════════════════════════════════════════════════════════════════
async function getCurrentPhien() {
  const db  = await _db();
  const row = await get(db, "SELECT MAX(phien) AS p FROM tx_rounds");
  return (row && row.p != null) ? row.p : 1;
}

async function addRound(phien, result, dice1, dice2, dice3) {
  const db = await _db();
  await run(db,
    "INSERT OR IGNORE INTO tx_rounds (phien, result, dice1, dice2, dice3) VALUES (?,?,?,?,?)",
    [phien, result, dice1, dice2, dice3]
  );
}

async function getLastRounds(limit = 10) {
  const db = await _db();
  return all(db,
    "SELECT phien, result, dice1, dice2, dice3 FROM tx_rounds ORDER BY phien DESC LIMIT ?",
    [limit]
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  tx_config
// ══════════════════════════════════════════════════════════════════════════════
const _CONFIG_DEFAULTS = {
  cauMode:      false,
  cauResult:    null,
  cauCount:     0,
  nhaMode:      false,
  nhaPhien:     0,
  autoAdminWin: true,
};

async function getConfig(key, defaultVal) {
  const db  = await _db();
  const row = await get(db, "SELECT value FROM tx_config WHERE key=?", [key]);
  if (!row) return defaultVal !== undefined ? defaultVal : _CONFIG_DEFAULTS[key];
  try { return JSON.parse(row.value); } catch { return row.value; }
}

async function setConfig(key, value) {
  const db = await _db();
  await run(db,
    "INSERT INTO tx_config (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [key, JSON.stringify(value)]
  );
}

async function getAllConfig() {
  const db   = await _db();
  const rows = await all(db, "SELECT key, value FROM tx_config WHERE key != 'migrated'");
  const cfg  = { ..._CONFIG_DEFAULTS };
  for (const r of rows) {
    try { cfg[r.key] = JSON.parse(r.value); } catch { cfg[r.key] = r.value; }
  }
  return cfg;
}

async function saveAllConfig(cfg) {
  for (const [k, v] of Object.entries(cfg)) {
    if (k === "migrated") continue;
    await setConfig(k, v);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  tx_bets
// ══════════════════════════════════════════════════════════════════════════════
async function addBet(userId, phien, choice, betAmount, time) {
  const db = await _db();
  const res = await run(db,
    "INSERT INTO tx_bets (user_id, phien, choice, bet_amount, time) VALUES (?,?,?,?,?)",
    [String(userId), phien, choice, betAmount, time || Date.now()]
  );
  return res.lastID;
}

async function getUserBetForPhien(userId, phien) {
  const db = await _db();
  return get(db,
    "SELECT * FROM tx_bets WHERE user_id=? AND phien=?",
    [String(userId), phien]
  );
}

async function addToBetAmount(betId, delta) {
  const db = await _db();
  await run(db, "UPDATE tx_bets SET bet_amount = bet_amount + ? WHERE id=?", [delta, betId]);
}

async function getBetsForPhien(phien) {
  const db = await _db();
  return all(db, "SELECT * FROM tx_bets WHERE phien=?", [phien]);
}

async function updateBetResult(betId, winAmount, ketQua) {
  const db = await _db();
  await run(db,
    "UPDATE tx_bets SET win_amount=?, ket_qua=? WHERE id=?",
    [winAmount, ketQua, betId]
  );
}

async function getUserBetHistory(userId, limit = 20) {
  const db = await _db();
  return all(db,
    "SELECT * FROM tx_bets WHERE user_id=? ORDER BY time DESC LIMIT ?",
    [String(userId), limit]
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  tx_transactions
// ══════════════════════════════════════════════════════════════════════════════
async function addTransaction(userId, amount, balanceBefore, time) {
  const db = await _db();
  await run(db,
    "INSERT INTO tx_transactions (user_id, time, amount, balance_before) VALUES (?,?,?,?)",
    [String(userId), time || Date.now(), amount, balanceBefore]
  );
}

async function getTransactions(userId, limit = 5) {
  const db = await _db();
  return all(db,
    "SELECT * FROM tx_transactions WHERE user_id=? ORDER BY time DESC LIMIT ?",
    [String(userId), limit]
  );
}

async function deleteTransactions(userId) {
  const db = await _db();
  if (userId) {
    await run(db, "DELETE FROM tx_transactions WHERE user_id=?", [String(userId)]);
  } else {
    await run(db, "DELETE FROM tx_transactions");
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  tx_enabled_groups
// ══════════════════════════════════════════════════════════════════════════════
async function isGroupEnabled(groupId) {
  const db  = await _db();
  const row = await get(db, "SELECT 1 FROM tx_enabled_groups WHERE group_id=?", [String(groupId)]);
  return !!row;
}

async function enableGroup(groupId) {
  const db = await _db();
  await run(db, "INSERT OR IGNORE INTO tx_enabled_groups (group_id) VALUES (?)", [String(groupId)]);
}

async function disableGroup(groupId) {
  const db = await _db();
  await run(db, "DELETE FROM tx_enabled_groups WHERE group_id=?", [String(groupId)]);
}

async function getEnabledGroups() {
  const db   = await _db();
  const rows = await all(db, "SELECT group_id FROM tx_enabled_groups");
  return rows.map(r => r.group_id);
}

module.exports = {
  getGameMoney, setGameMoney, adjustGameMoney, getAllGameMoney,
  deleteGameMoney, resetAllGameMoney,
  getCurrentPhien, addRound, getLastRounds,
  getConfig, setConfig, getAllConfig, saveAllConfig,
  addBet, getUserBetForPhien, addToBetAmount, getBetsForPhien,
  updateBetResult, getUserBetHistory,
  addTransaction, getTransactions, deleteTransactions,
  isGroupEnabled, enableGroup, disableGroup, getEnabledGroups,
};

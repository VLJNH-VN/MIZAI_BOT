const { getDb, run, get, all } = require("./sqlite");

const DAILY_BASE = 50000;
const DAILY_BONUS_MAX = 50000;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

async function ensureUser(db, userId, name = "") {
  const row = await get(db, "SELECT user_id FROM users_money WHERE user_id = ?", [userId]);
  if (!row) {
    await run(db,
      "INSERT INTO users_money (user_id, name, money, exp, daily_last, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [userId, name || "", 100000, 0, 0, Date.now()]
    );
  } else if (name) {
    await run(db, "UPDATE users_money SET name = ? WHERE user_id = ?", [name, userId]);
  }
}

async function getUserMoney(userId, name = "") {
  const db = await getDb();
  await ensureUser(db, userId, name);
  const row = await get(db, "SELECT money FROM users_money WHERE user_id = ?", [userId]);
  return row ? row.money : 100000;
}

async function getUserData(userId) {
  const db = await getDb();
  await ensureUser(db, userId);
  return get(db, "SELECT * FROM users_money WHERE user_id = ?", [userId]);
}

async function updateUserMoney(userId, amount, type = "set", name = "") {
  const db = await getDb();
  await ensureUser(db, userId, name);
  const currentMoney = await getUserMoney(userId);

  let newMoney;
  if (type === "add") {
    newMoney = currentMoney + amount;
  } else if (type === "sub") {
    newMoney = currentMoney - amount;
  } else {
    newMoney = amount;
  }

  if (newMoney < 0) return false;

  await run(db,
    "UPDATE users_money SET money = ?, updated_at = ? WHERE user_id = ?",
    [newMoney, Date.now(), userId]
  );

  return newMoney;
}

async function hasEnoughMoney(userId, amount) {
  const money = await getUserMoney(userId);
  return money >= amount;
}

/**
 * Chuyển tiền an toàn — sử dụng transaction để đảm bảo atomic:
 * Hoặc cả hai tài khoản được cập nhật, hoặc không ai được cập nhật.
 * Tránh tình trạng tiền bị mất nếu một lệnh UPDATE thất bại.
 */
async function transferMoney(fromId, toId, amount, fromName = "", toName = "") {
  if (amount <= 0) return { success: false, reason: "Số tiền không hợp lệ" };
  if (String(fromId) === String(toId)) return { success: false, reason: "Không thể chuyển cho chính mình" };

  const db = await getDb();
  await ensureUser(db, fromId, fromName);
  await ensureUser(db, toId, toName);

  const fromRow = await get(db, "SELECT money FROM users_money WHERE user_id = ?", [String(fromId)]);
  const fromMoney = fromRow ? fromRow.money : 0;
  if (fromMoney < amount) return { success: false, reason: "Không đủ tiền" };

  const now = Date.now();

  try {
    // Mở transaction để đảm bảo atomic
    await run(db, "BEGIN IMMEDIATE");

    try {
      await run(db,
        "UPDATE users_money SET money = money - ?, updated_at = ? WHERE user_id = ? AND money >= ?",
        [amount, now, String(fromId), amount]
      );
      await run(db,
        "UPDATE users_money SET money = money + ?, updated_at = ? WHERE user_id = ?",
        [amount, now, String(toId)]
      );
      await run(db, "COMMIT");
    } catch (innerErr) {
      await run(db, "ROLLBACK").catch(() => {});
      throw innerErr;
    }
  } catch (err) {
    return { success: false, reason: `Lỗi database: ${err?.message || err}` };
  }

  const fromNew = fromMoney - amount;
  const toRow = await get(db, "SELECT money FROM users_money WHERE user_id = ?", [String(toId)]);
  const toNew = toRow ? toRow.money : 0;

  return { success: true, fromNew, toNew };
}

async function claimDaily(userId, name = "") {
  const db = await getDb();
  await ensureUser(db, userId, name);
  const row = await get(db, "SELECT money, exp, daily_last FROM users_money WHERE user_id = ?", [userId]);

  const now = Date.now();
  const lastClaim = row?.daily_last || 0;
  const diff = now - lastClaim;

  if (diff < DAILY_COOLDOWN_MS) {
    const remaining = DAILY_COOLDOWN_MS - diff;
    return { success: false, remaining };
  }

  const bonus = Math.floor(Math.random() * DAILY_BONUS_MAX);
  const reward = DAILY_BASE + bonus;
  const newMoney = (row?.money || 100000) + reward;
  const newExp = (row?.exp || 0) + 10;

  await run(db,
    "UPDATE users_money SET money = ?, exp = ?, daily_last = ?, updated_at = ? WHERE user_id = ?",
    [newMoney, newExp, now, now, userId]
  );

  return { success: true, reward, newMoney, newExp };
}

async function addExp(userId, amount) {
  const db = await getDb();
  await ensureUser(db, userId);
  await run(db, "UPDATE users_money SET exp = exp + ?, updated_at = ? WHERE user_id = ?",
    [amount, Date.now(), userId]);
}

async function getTopUsers(limit = 10) {
  const db = await getDb();
  return all(db,
    "SELECT user_id, name, money, exp FROM users_money ORDER BY money DESC LIMIT ?",
    [limit]
  );
}

function formatMoney(amount) {
  return Number(amount).toLocaleString("vi-VN") + " VNĐ";
}

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${m}m ${s}s`;
}

function getLevel(exp) {
  return Math.floor(Math.sqrt(exp / 10)) + 1;
}

module.exports = {
  getUserMoney,
  getUserData,
  updateUserMoney,
  hasEnoughMoney,
  transferMoney,
  claimDaily,
  addExp,
  getTopUsers,
  formatMoney,
  formatTime,
  getLevel
};

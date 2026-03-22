/**
 * includes/database/cooldown.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Persistent cooldown — lưu thời điểm dùng lệnh vào SQLite.
 * Cooldown không bị mất khi restart bot.
 *
 * EXPORT:
 *   checkAndSet(cmdName, userId, cooldownSec) → Promise<{ok: bool, waitSec: int}>
 *   resetCooldown(cmdName, userId)            → Promise<void>
 *   cleanupExpired()                          → Promise<void>
 */

const { getDb, run, get } = require("./sqlite");

/**
 * Kiểm tra cooldown + đặt lại nếu ok.
 * @returns {{ ok: boolean, waitSec: number }}
 */
async function checkAndSet(cmdName, userId, cooldownSec) {
  if (!Number.isFinite(cooldownSec) || cooldownSec <= 0) return { ok: true, waitSec: 0 };

  try {
    const db  = await getDb();
    const now = Date.now();
    const row = await get(db, "SELECT last_used FROM cooldowns WHERE cmd_name = ? AND user_id = ?", [cmdName, String(userId)]);

    const last    = row?.last_used || 0;
    const elapsed = now - last;
    const waitMs  = cooldownSec * 1000 - elapsed;

    if (waitMs > 0) {
      return { ok: false, waitSec: Math.ceil(waitMs / 1000) };
    }

    await run(db,
      `INSERT INTO cooldowns (cmd_name, user_id, last_used) VALUES (?, ?, ?)
       ON CONFLICT(cmd_name, user_id) DO UPDATE SET last_used = excluded.last_used`,
      [cmdName, String(userId), now]
    );

    return { ok: true, waitSec: 0 };
  } catch {
    return { ok: true, waitSec: 0 };
  }
}

async function resetCooldown(cmdName, userId) {
  try {
    const db = await getDb();
    await run(db, "DELETE FROM cooldowns WHERE cmd_name = ? AND user_id = ?", [cmdName, String(userId)]);
  } catch {}
}

async function cleanupExpired(maxAgeMs = 24 * 3600 * 1000) {
  try {
    const db      = await getDb();
    const cutoff  = Date.now() - maxAgeMs;
    await run(db, "DELETE FROM cooldowns WHERE last_used < ?", [cutoff]);
  } catch {}
}

module.exports = { checkAndSet, resetCooldown, cleanupExpired };

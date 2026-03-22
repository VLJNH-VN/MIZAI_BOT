"use strict";

/**
 * includes/database/aiMemory.js
 * Thao tác SQLite cho AI memory, state và bot group settings.
 * Thay thế: mizai_memory.json, mizai_state.json, goibot.json
 */

const fs   = require("fs");
const path = require("path");
const { getDb, run, get, all } = require("./sqlite");

const MEMORY_FILE  = path.join(process.cwd(), "includes", "data", "runtime", "mizai_memory.json");
const STATE_FILE   = path.join(process.cwd(), "includes", "data", "runtime", "mizai_state.json");
const GOIBOT_FILE  = path.join(process.cwd(), "includes", "data", "runtime", "goibot.json");

const MEMORY_MAX_DIARY  = 30;
const MEMORY_MAX_NOTES  = 10;
const MEMORY_MAX_GLOBAL = 20;

async function _migrate(db) {
  const memCount = await get(db, "SELECT COUNT(*) AS n FROM ai_user_memory");
  const stateRow = await get(db, "SELECT value FROM ai_state WHERE key='mood'");

  if ((!memCount || memCount.n === 0) && fs.existsSync(MEMORY_FILE)) {
    try {
      const mem = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
      for (const [uid, u] of Object.entries(mem.users || {})) {
        await run(db,
          "INSERT OR IGNORE INTO ai_user_memory (user_id, name, notes_json, last_seen) VALUES (?,?,?,?)",
          [uid, u.name || "", JSON.stringify(u.notes || []), u.lastSeen || ""]
        );
      }
      for (const d of (mem.diary || [])) {
        await run(db,
          "INSERT INTO ai_diary (date, entry) VALUES (?,?)",
          [d.date, d.entry]
        );
      }
      for (const n of (mem.globalNotes || [])) {
        await run(db,
          "INSERT INTO ai_global_notes (date, note) VALUES (?,?)",
          [n.date, n.note]
        );
      }
    } catch {}
  }

  if (!stateRow && fs.existsSync(STATE_FILE)) {
    try {
      const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      for (const [k, v] of Object.entries(s)) {
        await run(db,
          "INSERT OR IGNORE INTO ai_state (key, value) VALUES (?,?)",
          [k, JSON.stringify(v)]
        );
      }
    } catch {}
  }

  const gbCount = await get(db, "SELECT COUNT(*) AS n FROM ai_enabled_groups");
  if ((!gbCount || gbCount.n === 0) && fs.existsSync(GOIBOT_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(GOIBOT_FILE, "utf-8"));
      for (const [gid, enabled] of Object.entries(data)) {
        await run(db,
          "INSERT OR IGNORE INTO ai_enabled_groups (group_id, enabled) VALUES (?,?)",
          [gid, enabled ? 1 : 0]
        );
      }
    } catch {}
  }

  if (typeof logInfo === "function") logInfo("[AiMemory] Migration JSON → SQLite hoàn tất.");
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
//  User Memory
// ══════════════════════════════════════════════════════════════════════════════
async function getUserMemory(userId) {
  const db  = await _db();
  const row = await get(db, "SELECT * FROM ai_user_memory WHERE user_id=?", [String(userId)]);
  if (!row) return null;
  return {
    name:     row.name,
    notes:    JSON.parse(row.notes_json || "[]"),
    lastSeen: row.last_seen,
  };
}

async function saveUserNote(userId, userName, note) {
  const db  = await _db();
  const row = await get(db, "SELECT notes_json FROM ai_user_memory WHERE user_id=?", [String(userId)]);
  let notes = row ? JSON.parse(row.notes_json || "[]") : [];
  if (note) {
    notes.unshift(note);
    if (notes.length > MEMORY_MAX_NOTES) notes = notes.slice(0, MEMORY_MAX_NOTES);
  }
  const lastSeen = new Date().toISOString();
  await run(db,
    `INSERT INTO ai_user_memory (user_id, name, notes_json, last_seen)
     VALUES (?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET
       name       = excluded.name,
       notes_json = excluded.notes_json,
       last_seen  = excluded.last_seen`,
    [String(userId), userName || "", JSON.stringify(notes), lastSeen]
  );
}

async function buildMemoryContext(userId) {
  const db   = await _db();
  const user = await getUserMemory(userId);
  const lines = [];

  if (user) {
    lines.push(`[USER_MEMORY] Mizai nhớ về ${user.name || userId}:`);
    if (user.notes?.length) {
      lines.push("- Ghi chú: " + user.notes.slice(0, 5).join(" | "));
    }
    if (user.lastSeen) lines.push(`- Gặp lần cuối: ${user.lastSeen}`);
  }

  const diary = await all(db, "SELECT entry FROM ai_diary ORDER BY id DESC LIMIT 3");
  if (diary.length) lines.push("[MIZAI_DIARY] " + diary.map(d => d.entry).join(" | "));

  const globalNotes = await all(db, "SELECT note FROM ai_global_notes ORDER BY id DESC LIMIT 3");
  if (globalNotes.length) lines.push("[MIZAI_NOTES] " + globalNotes.map(n => n.note).join(" | "));

  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════════════════
//  Diary
// ══════════════════════════════════════════════════════════════════════════════
async function saveDiaryEntry(entry) {
  const db = await _db();
  await run(db, "INSERT INTO ai_diary (date, entry) VALUES (?,?)",
    [new Date().toISOString(), entry]);
  const count = await get(db, "SELECT COUNT(*) AS n FROM ai_diary");
  if (count && count.n > MEMORY_MAX_DIARY) {
    await run(db,
      "DELETE FROM ai_diary WHERE id IN (SELECT id FROM ai_diary ORDER BY id ASC LIMIT ?)",
      [count.n - MEMORY_MAX_DIARY]
    );
  }
}

async function getRecentDiary(limit = 3) {
  const db = await _db();
  return all(db, "SELECT date, entry FROM ai_diary ORDER BY id DESC LIMIT ?", [limit]);
}

// ══════════════════════════════════════════════════════════════════════════════
//  Global Notes
// ══════════════════════════════════════════════════════════════════════════════
async function saveGlobalNote(note) {
  const db = await _db();
  await run(db, "INSERT INTO ai_global_notes (date, note) VALUES (?,?)",
    [new Date().toISOString(), note]);
  const count = await get(db, "SELECT COUNT(*) AS n FROM ai_global_notes");
  if (count && count.n > MEMORY_MAX_GLOBAL) {
    await run(db,
      "DELETE FROM ai_global_notes WHERE id IN (SELECT id FROM ai_global_notes ORDER BY id ASC LIMIT ?)",
      [count.n - MEMORY_MAX_GLOBAL]
    );
  }
}

async function getRecentGlobalNotes(limit = 3) {
  const db = await _db();
  return all(db, "SELECT date, note FROM ai_global_notes ORDER BY id DESC LIMIT ?", [limit]);
}

// ══════════════════════════════════════════════════════════════════════════════
//  AI State (mood, energy, ...)
// ══════════════════════════════════════════════════════════════════════════════
const DEFAULT_STATE = {
  mood        : "bình thường",
  energy      : 70,
  moodScore   : 50,
  episode     : null,
  lastUpdated : null,
};

async function loadState() {
  const db   = await _db();
  const rows = await all(db, "SELECT key, value FROM ai_state");
  const s    = { ...DEFAULT_STATE };
  for (const r of rows) {
    try { s[r.key] = JSON.parse(r.value); } catch { s[r.key] = r.value; }
  }
  return s;
}

async function saveState(state) {
  const db = await _db();
  for (const [k, v] of Object.entries(state)) {
    await run(db,
      "INSERT INTO ai_state (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [k, JSON.stringify(v)]
    );
  }
}

const VALID_MOODS = [
  "vui", "rất vui", "phấn khích", "hạnh phúc",
  "buồn", "rất buồn", "thất vọng",
  "bình thường", "mơ màng", "lơ đãng",
  "mệt", "rất mệt", "kiệt sức",
  "lo lắng", "hoảng sợ", "căng thẳng",
  "tức giận", "bực bội", "khó chịu",
  "cô đơn", "nhớ nhà",
  "hứng khởi", "sáng tạo",
];

async function getMoodContext() {
  const s = await loadState();
  const episodeStr = s.episode ? ` | đang trải qua: ${s.episode}` : "";
  return `[MIZAI_STATE] Tâm trạng hiện tại: ${s.mood} | Năng lượng: ${s.energy}/100 | Mood score: ${s.moodScore}/100${episodeStr}`;
}

async function updateMoodState({ mood, energy, episode, moodScore }) {
  const s = await loadState();
  if (mood      !== undefined && VALID_MOODS.includes(mood)) s.mood  = mood;
  if (energy    !== undefined) s.energy    = Math.min(100, Math.max(0, Number(energy)    || s.energy));
  if (moodScore !== undefined) s.moodScore = Math.min(100, Math.max(0, Number(moodScore) || s.moodScore));
  if (episode   !== undefined) s.episode   = episode || null;
  s.lastUpdated = new Date().toISOString();
  await saveState(s);
}

async function decayEnergy() {
  const s   = await loadState();
  const now = Date.now();
  const last = s.lastUpdated ? new Date(s.lastUpdated).getTime() : now;
  const hoursElapsed = (now - last) / 3600000;
  if (hoursElapsed > 1) {
    s.energy = Math.max(10, s.energy - Math.floor(hoursElapsed * 3));
    s.lastUpdated = new Date().toISOString();
    await saveState(s);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  AI Enabled Groups (goibot.json)
// ══════════════════════════════════════════════════════════════════════════════
async function isEnabled(groupId) {
  const db  = await _db();
  const row = await get(db,
    "SELECT enabled FROM ai_enabled_groups WHERE group_id=?",
    [String(groupId)]
  );
  return row ? row.enabled === 1 : true;
}

async function setEnabled(groupId, enabled) {
  const db = await _db();
  await run(db,
    `INSERT INTO ai_enabled_groups (group_id, enabled) VALUES (?,?)
     ON CONFLICT(group_id) DO UPDATE SET enabled=excluded.enabled`,
    [String(groupId), enabled ? 1 : 0]
  );
}

module.exports = {
  getUserMemory, saveUserNote, buildMemoryContext,
  saveDiaryEntry, getRecentDiary,
  saveGlobalNote, getRecentGlobalNotes,
  loadState, saveState, getMoodContext, updateMoodState, decayEnergy,
  isEnabled, setEnabled,
  VALID_MOODS, DEFAULT_STATE,
};

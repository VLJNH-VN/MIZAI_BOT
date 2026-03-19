"use strict";

const fs   = require("fs");
const path = require("path");
const axios = require("axios");

// ── File Helper (nội bộ) ──────────────────────────────────────────────────────

function readJsonFile(filePath, fallback = null) {
  try {
    if (fs.existsSync(filePath))
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {}
  return fallback;
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ── Cache Cleaner ─────────────────────────────────────────────────────────────

const DEFAULT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_TOTAL_FILES = 200;

const CACHE_DIRS = [
  path.join(process.cwd(), "includes", "cache"),
];

const CACHE_DIR = CACHE_DIRS[0];

function ensureDirSync(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  } catch (e) {
    logError(`cacheCleaner.ensureDirSync error: ${e?.message || e}`);
  }
}

async function cleanupDir(dirPath, maxAgeMs, maxTotalFiles) {
  try {
    ensureDirSync(dirPath);
    const now = Date.now();

    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const files = [];

    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const filePath = path.join(dirPath, ent.name);
      try {
        const stat = await fs.promises.stat(filePath);
        files.push({ name: ent.name, path: filePath, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {}
    }

    if (!files.length) return 0;

    files.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const toDelete = new Set();

    for (const f of files) {
      if (now - f.mtimeMs > maxAgeMs) toDelete.add(f);
    }

    const remaining = files.filter((f) => !toDelete.has(f));
    if (remaining.length > maxTotalFiles) {
      remaining.slice(maxTotalFiles).forEach((f) => toDelete.add(f));
    }

    if (!toDelete.size) return 0;

    for (const f of toDelete) {
      try {
        await fs.promises.unlink(f.path);
      } catch (e) {
        logError(`cacheCleaner.unlink error: ${e?.message || e}`, { file: f.path });
      }
    }

    return toDelete.size;
  } catch (e) {
    logError(`cacheCleaner.cleanupDir error [${dirPath}]: ${e?.message || e}`);
    return 0;
  }
}

async function cleanupCacheDir(options = {}) {
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : DEFAULT_MAX_AGE_MS;
  const maxTotalFiles = Number.isFinite(options.maxTotalFiles) ? options.maxTotalFiles : DEFAULT_MAX_TOTAL_FILES;

  let totalDeleted = 0;
  for (const dir of CACHE_DIRS) {
    const deleted = await cleanupDir(dir, maxAgeMs, maxTotalFiles);
    totalDeleted += deleted;
  }

  if (totalDeleted > 0) {
    logInfo(`cacheCleaner: đã xóa ${totalDeleted} file cache trên ${CACHE_DIRS.length} thư mục.`);
  }
}

function scheduleCacheCleanup(intervalMs = 60 * 60 * 1000, options = {}) {
  try {
    cleanupCacheDir(options);
    setInterval(() => cleanupCacheDir(options), intervalMs).unref?.();
    logInfo(`cacheCleaner: auto dọn cache mỗi ${Math.round(intervalMs / 60000)} phút.`);
  } catch (e) {
    logError(`cacheCleaner.scheduleCacheCleanup error: ${e?.message || e}`);
  }
}

// ── Key Manager ───────────────────────────────────────────────────────────────

const KEY_FILE = path.join(process.cwd(), "includes", "data", "key.json");
const GROQ_CHECK_URL = "https://api.groq.com/openai/v1/chat/completions";

let autoCheckEnabled = true;

function loadKeyData() {
  try {
    const config = global.config || {};
    if (!fs.existsSync(KEY_FILE)) {
      const def = { keys: config.groqKeys || [], autoCheck: true, live: [], dead: [], no_balance: [] };
      fs.writeFileSync(KEY_FILE, JSON.stringify(def, null, 2), "utf-8");
      return def;
    }
    const raw = JSON.parse(fs.readFileSync(KEY_FILE, "utf-8"));
    if (!Array.isArray(raw.keys))       raw.keys       = config.groqKeys || [];
    if (typeof raw.autoCheck !== "boolean") raw.autoCheck = true;
    if (!Array.isArray(raw.live))       raw.live       = [];
    if (!Array.isArray(raw.dead))       raw.dead       = [];
    if (!Array.isArray(raw.no_balance)) raw.no_balance = [];
    return raw;
  } catch {
    return { keys: [], autoCheck: true, live: [], dead: [], no_balance: [] };
  }
}

function saveKeyData(data) {
  fs.writeFileSync(KEY_FILE, JSON.stringify(data, null, 2), "utf-8");
}

async function checkGroqKey(key) {
  try {
    await axios.post(GROQ_CHECK_URL, {
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 5
    }, {
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      timeout: 12000
    });
    return { key, status: "live" };
  } catch (err) {
    if (err?.response?.status === 402) return { key, status: "no_balance", note: "no balance" };
    return { key, status: "dead", error: err?.response?.data?.error?.message || err.message };
  }
}

async function checkAllKeys() {
  if (!autoCheckEnabled) return;
  const data = loadKeyData();
  if (!data.autoCheck || !data.keys.length) return;

  const live = [], dead = [], noBalance = [];

  for (const key of data.keys) {
    const result = await checkGroqKey(key);
    if (result.status === "live")            live.push(key);
    else if (result.status === "no_balance") noBalance.push(key);
    else                                     dead.push(key);
  }

  data.live = live;
  data.dead = dead;
  data.no_balance = noBalance;
  saveKeyData(data);
}

function scheduleKeyCheck(intervalMs = 5 * 60 * 1000) {
  checkAllKeys();
  setInterval(checkAllKeys, intervalMs).unref?.();
}

function setAutoCheck(enabled) {
  autoCheckEnabled = enabled;
  logInfo(`[KEY] Auto check: ${enabled ? "BẬT" : "TẮT"}`);
}

module.exports = {
  scheduleCacheCleanup,
  cleanupCacheDir,
  CACHE_DIR,
  CACHE_DIRS,
  checkGroqKey,
  scheduleKeyCheck,
  setAutoCheck,
  readJsonFile,
  writeJsonFile,
};

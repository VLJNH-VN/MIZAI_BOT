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

async function _optimizeDb() {
  try {
    const { getDb } = require("../../includes/database/core/sqlite");
    const db = await getDb();
    if (db && typeof db.pragma === "function") {
      db.pragma("optimize");
      db.pragma("wal_checkpoint(PASSIVE)");
    }
  } catch (_) {}
}

function scheduleCacheCleanup(intervalMs = 60 * 60 * 1000, options = {}) {
  try {
    cleanupCacheDir(options);
    setInterval(() => {
      cleanupCacheDir(options);
      _optimizeDb();
    }, intervalMs).unref?.();
    logInfo(`cacheCleaner: auto dọn cache mỗi ${Math.round(intervalMs / 60000)} phút.`);
  } catch (e) {
    logError(`cacheCleaner.scheduleCacheCleanup error: ${e?.message || e}`);
  }
}

// ── Key Manager ───────────────────────────────────────────────────────────────

const KEY_FILE       = path.join(process.cwd(), "includes", "data", "key.json");
const CONFIG_FILE    = path.join(process.cwd(), "config.json");
const GROQ_CHECK_URL = "https://api.groq.com/openai/v1/chat/completions";

let autoCheckEnabled = true;
let _checkRunning    = false;

function loadKeyData() {
  try {
    const config = global.config || {};
    if (!fs.existsSync(KEY_FILE)) {
      const def = {
        keys: config.groqKeys || [], autoCheck: true, live: [], dead: [], no_balance: [],
        geminiKeys: [], geminiLive: [], geminiDead: [],
      };
      fs.writeFileSync(KEY_FILE, JSON.stringify(def, null, 2), "utf-8");
      return def;
    }
    const raw = JSON.parse(fs.readFileSync(KEY_FILE, "utf-8"));
    if (!Array.isArray(raw.keys))        raw.keys        = config.groqKeys || [];
    if (!Array.isArray(raw.geminiKeys))  raw.geminiKeys  = [];
    if (!Array.isArray(raw.geminiLive))  raw.geminiLive  = [];
    if (!Array.isArray(raw.geminiDead))  raw.geminiDead  = [];
    if (typeof raw.autoCheck !== "boolean") raw.autoCheck = true;
    if (!Array.isArray(raw.live))        raw.live        = [];
    if (!Array.isArray(raw.dead))        raw.dead        = [];
    if (!Array.isArray(raw.no_balance))  raw.no_balance  = [];
    return raw;
  } catch {
    return {
      keys: [], autoCheck: true, live: [], dead: [], no_balance: [],
      geminiKeys: [], geminiLive: [], geminiDead: [],
    };
  }
}

function saveKeyData(data) {
  fs.writeFileSync(KEY_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function syncActiveGeminiKey(data) {
  const deadSet   = new Set(Array.isArray(data.geminiDead) ? data.geminiDead : []);
  const liveKeys  = (data.geminiKeys || []).filter(k => !deadSet.has(k));
  const activeKey = liveKeys[0] || "";
  if (activeKey) {
    if (global.config) global.config.geminiKey = activeKey;
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
      cfg.geminiKey = activeKey;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
    } catch {}
  }
  return activeKey;
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

async function checkGeminiKey(key) {
  try {
    const { GoogleGenAI } = require("@google/genai");
    const ai = new GoogleGenAI({ apiKey: key });
    await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: "Hi" }] }],
      config: { maxOutputTokens: 5 },
    });
    return { key, status: "live" };
  } catch (err) {
    const status = err?.status || err?.response?.status || 0;
    const msg    = err?.message || "";
    const is429  = status === 429 || msg.includes("RESOURCE_EXHAUSTED");
    if (is429) {
      const m = msg.toLowerCase();
      const quotaOut = m.includes("daily") || m.includes("monthly") ||
        m.includes("billing") || m.includes("exceeded your quota") || m.includes("quota exceeded");
      if (quotaOut) return { key, status: "no_balance" };
      return { key, status: "rate_limit" };
    }
    if (status === 401 || msg.includes("API_KEY_INVALID") || msg.includes("invalid api key"))
      return { key, status: "dead" };
    return { key, status: "dead" };
  }
}

async function checkAllKeys() {
  if (!autoCheckEnabled || _checkRunning) return;
  const data = loadKeyData();
  if (!data.autoCheck) return;

  const hasGroq   = data.keys.length > 0;
  const hasGemini = data.geminiKeys.length > 0;
  if (!hasGroq && !hasGemini) return;

  _checkRunning = true;
  try {
    // ── Groq ────────────────────────────────────────────────────────────────────
    if (hasGroq) {
      const live = [], dead = [], noBalance = [];
      for (const key of data.keys) {
        const r = await checkGroqKey(key);
        if (r.status === "live")            live.push(key);
        else if (r.status === "no_balance") noBalance.push(key);
        else                                dead.push(key);
      }
      data.live       = live;
      data.dead       = dead;
      data.no_balance = noBalance;
    }

    // ── Gemini ──────────────────────────────────────────────────────────────────
    if (hasGemini) {
      const gLive = [], gDead = [];
      for (const key of data.geminiKeys) {
        const r = await checkGeminiKey(key);
        if (r.status === "live" || r.status === "rate_limit") gLive.push(key);
        else                                                   gDead.push(key);
      }
      data.geminiLive = gLive;
      data.geminiDead = gDead;
      syncActiveGeminiKey(data);
    }

    saveKeyData(data);
    logInfo(`[KEY] Auto check xong — Groq live: ${data.live.length}/${data.keys.length} | Gemini live: ${data.geminiLive.length}/${data.geminiKeys.length}`);
  } catch (err) {
    logError?.(`[KEY] checkAllKeys lỗi: ${err?.message}`);
  } finally {
    _checkRunning = false;
  }
}

function scheduleKeyCheck(intervalMs = 30 * 60 * 1000) {
  setTimeout(checkAllKeys, 10_000).unref?.();
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
  checkGeminiKey,
  scheduleKeyCheck,
  setAutoCheck,
  readJsonFile,
  writeJsonFile,
};

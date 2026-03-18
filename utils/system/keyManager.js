const fs = require("fs");
const path = require("path");
const axios = require("axios");

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

  logInfo("[KEY] Bắt đầu check Groq key...");
  const live = [], dead = [], noBalance = [];

  for (const key of data.keys) {
    const result = await checkGroqKey(key);
    if (result.status === "live")       live.push(key);
    else if (result.status === "no_balance") noBalance.push(key);
    else                                dead.push(key);
    logInfo(`[KEY] ${key.slice(0, 8)}... => ${result.status}${result.note ? ` (${result.note})` : ""}`);
  }

  data.live = live;
  data.dead = dead;
  data.no_balance = noBalance;
  saveKeyData(data);
  logInfo(`[KEY] Kết quả: ${live.length} live, ${noBalance.length} hết credit, ${dead.length} dead`);
}

function scheduleKeyCheck(intervalMs = 5 * 60 * 1000) {
  checkAllKeys();
  setInterval(checkAllKeys, intervalMs).unref?.();
}

function setAutoCheck(enabled) {
  autoCheckEnabled = enabled;
  logInfo(`[KEY] Auto check: ${enabled ? "BẬT" : "TẮT"}`);
}

module.exports = { checkGroqKey, scheduleKeyCheck, setAutoCheck };

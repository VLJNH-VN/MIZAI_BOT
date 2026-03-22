/**
 * src/events/goibotThrottle.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Quản lý anti-spam và cooldown cho Mizai AI (goibot).
 *
 * EXPORT:
 *   isUserProcessing(userKey)         → bool
 *   setUserProcessing(userKey, val)   → void
 *   getUserLastCall(userKey)          → number (timestamp)
 *   setUserLastCall(userKey, ts)      → void
 *   getLastAutoReply(threadId)        → number (timestamp)
 *   setLastAutoReply(threadId, ts)    → void
 *   isAutoReplied(bodyLower)          → bool
 *   USER_AI_COOLDOWN_MS               = 8000
 *   AUTO_REPLY_COOLDOWN_MS            = 8 phút
 *   AUTO_REPLY_CHANCE                 = 0.18
 *   AUTO_REPLY_MIN_LEN                = 8
 */

const fs   = require("fs");
const path = require("path");

// ── Cooldown constants ─────────────────────────────────────────────────────────
const USER_AI_COOLDOWN_MS    = 8000;
const AUTO_REPLY_COOLDOWN_MS = 8 * 60 * 1000; // 8 phút giữa 2 lần tự nhắn
const AUTO_REPLY_CHANCE      = 0.18;           // 18% xác suất xem xét
const AUTO_REPLY_MIN_LEN     = 8;              // tin nhắn ít nhất 8 ký tự mới xét

// ── State (in-memory) ──────────────────────────────────────────────────────────
const _isProcessing  = {};
const _lastAiCall    = {};
const _lastAutoReply = {};

// ── Accessor functions ─────────────────────────────────────────────────────────

function isUserProcessing(userKey)      { return !!_isProcessing[userKey]; }
function setUserProcessing(userKey, v)  { _isProcessing[userKey] = v; }
function getUserLastCall(userKey)       { return _lastAiCall[userKey] || 0; }
function setUserLastCall(userKey, ts)   { _lastAiCall[userKey] = ts; }
function getLastAutoReply(threadId)     { return _lastAutoReply[threadId] || 0; }
function setLastAutoReply(threadId, ts) { _lastAutoReply[threadId] = ts; }

// ── AutoReply keyword check ────────────────────────────────────────────────────
const AUTOREPLY_DATA_PATH = path.join(process.cwd(), "includes", "data", "autoreply.json");

function loadAutoReplyKeywords() {
  try {
    const rules = JSON.parse(fs.readFileSync(AUTOREPLY_DATA_PATH, "utf-8"));
    return Array.isArray(rules) ? rules.map(r => String(r.keyword).toLowerCase()) : [];
  } catch { return []; }
}

function isAutoReplied(bodyLower) {
  const keywords = loadAutoReplyKeywords();
  return keywords.some(kw => bodyLower.includes(kw));
}

module.exports = {
  isUserProcessing,
  setUserProcessing,
  getUserLastCall,
  setUserLastCall,
  getLastAutoReply,
  setLastAutoReply,
  isAutoReplied,
  USER_AI_COOLDOWN_MS,
  AUTO_REPLY_COOLDOWN_MS,
  AUTO_REPLY_CHANCE,
  AUTO_REPLY_MIN_LEN,
};

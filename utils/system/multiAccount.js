"use strict";

const fs   = require("fs");
const path = require("path");
const { createZaloClientFromCookiePath } = require("./client");
const { handleMessage }    = require("../../src/events/message");
const { handleReaction }   = require("../../includes/handlers/handleReaction");
const { handleGroupEvent } = require("../../includes/handlers/handleGroupEvent");
const { handleUndo }       = require("../../includes/handlers/handleUndo");

const ACCOUNTS_DIR   = path.join(process.cwd(), "accounts");
const ACTIVE_MARKER  = ".active";   // accounts/acc1.json.active = enabled

global.extraApis = global.extraApis || [];

// ── Kiểm tra tài khoản có được bật không ─────────────────────────────────────
function isActive(cookiePath) {
  return fs.existsSync(cookiePath + ACTIVE_MARKER);
}

// ── Bật / tắt tài khoản ───────────────────────────────────────────────────────
function enableAccount(cookiePath) {
  fs.writeFileSync(cookiePath + ACTIVE_MARKER, "", "utf-8");
}

function disableAccount(cookiePath) {
  const marker = cookiePath + ACTIVE_MARKER;
  if (fs.existsSync(marker)) fs.unlinkSync(marker);
}

// ── Kết nối 1 tài khoản phụ ──────────────────────────────────────────────────
async function connectExtraAccount(cookiePath) {
  try {
    const api = await createZaloClientFromCookiePath(cookiePath);
    const accountName = path.basename(cookiePath, ".json");

    api.listener.on("message",     (event)    => handleMessage({ api, event, commands: global.commands, prefix: global.prefix }).catch(() => {}));
    api.listener.on("reaction",    (reaction) => handleReaction({ api, reaction, commands: global.commands }).catch(() => {}));
    api.listener.on("undo",        (undo)     => handleUndo({ api, undo, commands: global.commands }).catch(() => {}));
    api.listener.on("group_event", (data)     => handleGroupEvent({ api, data }).catch(() => {}));
    api.listener.on("disconnected", () => {
      logWarn(`[MultiAccount] Tài khoản "${accountName}" bị ngắt kết nối.`);
      global.extraApis = global.extraApis.filter(a => a !== api);
    });

    api.listener.start({ retryOnClose: true });
    global.extraApis.push(api);

    logInfo(`[MultiAccount] ✅ Đã kết nối tài khoản phụ: ${accountName}`);
    return api;
  } catch (err) {
    const accountName = path.basename(cookiePath, ".json");
    logWarn(`[MultiAccount] ❌ Không thể kết nối "${accountName}": ${err?.message || err}`);
    return null;
  }
}

// ── Khởi động tất cả tài khoản được bật ──────────────────────────────────────
async function startExtraAccounts() {
  if (!fs.existsSync(ACCOUNTS_DIR)) return;

  const files = fs.readdirSync(ACCOUNTS_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => path.join(ACCOUNTS_DIR, f));

  const active = files.filter(isActive);
  if (!active.length) return;

  logInfo(`[MultiAccount] Khởi động ${active.length} tài khoản phụ...`);
  await Promise.all(active.map(connectExtraAccount));
}

// ── Ngắt 1 tài khoản phụ theo tên ───────────────────────────────────────────
function disconnectExtraAccount(name) {
  const idx = global.extraApis.findIndex(a => {
    try { return String(a.getOwnId()).includes(name); } catch { return false; }
  });
  if (idx === -1) return false;
  try { global.extraApis[idx].listener.stop(); } catch {}
  global.extraApis.splice(idx, 1);
  return true;
}

module.exports = {
  startExtraAccounts,
  connectExtraAccount,
  disconnectExtraAccount,
  isActive,
  enableAccount,
  disableAccount,
  ACCOUNTS_DIR,
};

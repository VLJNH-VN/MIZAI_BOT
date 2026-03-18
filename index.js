const path = require("path");

// ── Globals (logger, axios, db, economy, imgur, admin, key manager) ───────────
global.config = require("./config.json");
require("./utils/system/global");

// ── Core modules ──────────────────────────────────────────────────────────────
const { setApi }               = require("./utils/system/global");
const { loadCommands, runOnLoad } = require("./utils/system/commandLoader");
const { scheduleCacheCleanup } = require("./utils/system/cacheCleaner");
const { scheduleKeyCheck }     = require("./utils/system/keyManager");
const { createZaloClient }     = require("./utils/system/zaloClient");
const { setupLifecycle }       = require("./utils/system/lifecycle");

// ── Events ────────────────────────────────────────────────────────────────────
const { handleMessage }    = require("./src/events/message");
const { handleReaction }   = require("./includes/handlers/handleReaction");
const { handleGroupEvent } = require("./includes/handlers/handleGroupEvent");
const { handleUndo }       = require("./includes/handlers/handleUndo");
const { startAutoSend }    = require("./src/events/autoSend");
const { startTuongTac }    = require("./src/events/tuongTac");
const { startAutoDown }    = require("./src/events/autoDown");
const { startGoibot }      = require("./src/events/goibot");

// ── Config validation ─────────────────────────────────────────────────────────
function validateConfig() {
  const cfg = global.config;
  const errors = [];
  if (!cfg.loginMethod) errors.push("Thiếu 'loginMethod' trong config.json");
  if (cfg.loginMethod === "cookie" && !cfg.cookiePath) errors.push("Thiếu 'cookiePath' khi loginMethod=cookie");
  if (errors.length) { logError(errors.join("\n")); return false; }
  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────
let _schedulersStarted = false;

async function main(isFirstRun = true) {
  if (!validateConfig()) process.exit(1);

  if (isFirstRun && !_schedulersStarted) {
    _schedulersStarted = true;
    scheduleCacheCleanup();
    scheduleKeyCheck();
  }

  const api = await createZaloClient();
  setApi(api);
  global.botId    = String(api.getOwnId());
  global.commands = loadCommands(path.join(__dirname, "src", "commands"));
  global.prefix   = global.config.prefix || ".";
  await runOnLoad(global.commands, api);

  api.listener.on("connected", () => {
    logInfo("[LISTENER] Bắt đầu nhận lệnh!");
    if (isFirstRun) {
      startAutoSend(api);
      startTuongTac(api);
      startAutoDown(api);
      startGoibot(api);
    }
  });

  api.listener.on("disconnected", (code, reason) => global.restartBot(`code:${code} | ${reason}`));
  api.listener.on("error",        (err)        => global.restartBot(`error:${err?.message}`));

  api.listener.on("message",     (event)    => handleMessage({ api, event, commands: global.commands, prefix: global.prefix }).catch((err) => logError(`Lỗi handleMessage: ${err?.message || err}`)));
  api.listener.on("reaction",    (reaction) => handleReaction({ api, reaction, commands: global.commands }).catch((err) => logError(`Lỗi handleReaction: ${err?.message || err}`)));
  api.listener.on("undo",        (undo)     => handleUndo({ api, undo, commands: global.commands }).catch((err) => logError(`Lỗi handleUndo: ${err?.message || err}`)));
  api.listener.on("group_event", (data)     => handleGroupEvent({ api, data }).catch((err) => logError(`Lỗi handleGroupEvent: ${err?.message || err}`)));

  api.listener.start({ retryOnClose: true });
  logInfo("Bot đã khởi động và đang lắng nghe tin nhắn...");
}

setupLifecycle(main);
main().catch((err) => logError(`Lỗi khởi động bot: ${err?.message || err}`));

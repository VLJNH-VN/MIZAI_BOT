let _isShuttingDown = false;
let _isRestarting = false;

async function gracefulShutdown(signal) {
  if (_isShuttingDown) return;
  _isShuttingDown = true;
  logWarn(`[BOT] Nhận tín hiệu ${signal}, đang tắt bot an toàn...`);
  try {
    if (global.api?.listener) global.api.listener.stop();
  } catch {}
  logInfo("[BOT] Đã dừng listener. Thoát.");
  process.exit(0);
}

async function restartBot(reason, delay = 10000, mainFn) {
  if (_isRestarting) return;
  _isRestarting = true;
  logWarn(`[BOT] Khởi động lại: ${reason || "Unknown"}. Chờ ${delay / 1000}s...`);
  setTimeout(async () => {
    try {
      logInfo("[BOT] Restarting bot...");
      if (global.api?.listener) { try { global.api.listener.stop(); } catch {} }
      await mainFn(false);
      _isRestarting = false;
    } catch (err) {
      logError(`[BOT] Lỗi khi restart: ${err.message}`);
      _isRestarting = false;
      setTimeout(() => restartBot("Retry after error", 10000, mainFn), 10000);
    }
  }, delay);
}

function setupLifecycle(mainFn) {
  global.restartBot = (reason, delay) => restartBot(reason, delay, mainFn);

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT",  () => gracefulShutdown("SIGINT"));
  process.on("uncaughtException",  (err)    => logError(`[UNCAUGHT EXCEPTION] ${err?.message || err}`, err));
  process.on("unhandledRejection", (reason) => logError(`[UNHANDLED REJECTION] ${reason?.message || reason}`, reason));
}

module.exports = { setupLifecycle };

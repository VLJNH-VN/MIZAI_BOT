"use strict";

const { spawn, execSync } = require("child_process");
const path = require("path");

const NODE_FLAGS = ["--max-old-space-size=384", "--gc-interval=100"];
const MAIN_FILE  = path.join(__dirname, "main.js");
const RESTART_DELAY_MS = 5000;

// ── Kiểm tra & rebuild better-sqlite3 ────────────────────────────────────────
(function checkNativeModules() {
  try {
    require("better-sqlite3");
  } catch {
    console.log("[LAUNCHER] better-sqlite3 chưa build. Đang rebuild...");
    try {
      execSync("npm rebuild better-sqlite3 --update-binary", {
        stdio: "inherit",
        cwd: __dirname,
      });
      console.log("[LAUNCHER] Rebuild better-sqlite3 thành công.");
    } catch {
      console.log("[LAUNCHER] Rebuild thất bại → sẽ dùng sql.js fallback.");
    }
  }
})();

// ── Launcher ──────────────────────────────────────────────────────────────────
let _restartCount = 0;
let _botProcess   = null;

function startBot() {
  _restartCount++;

  const label = _restartCount === 1
    ? "[LAUNCHER] Khởi động MIZAI_BOT..."
    : `[LAUNCHER] Khởi động lại lần ${_restartCount - 1}...`;
  console.log(label);

  _botProcess = spawn(process.execPath, [...NODE_FLAGS, MAIN_FILE], {
    stdio: "inherit",
    cwd:   __dirname,
    env:   process.env,
  });

  _botProcess.on("close", (code, signal) => {
    if (signal === "SIGTERM" || signal === "SIGINT") {
      console.log(`[LAUNCHER] Bot dừng bởi tín hiệu ${signal}. Không restart.`);
      process.exit(0);
    }
    console.log(`[LAUNCHER] Bot thoát (code: ${code ?? "?"}). Restart sau ${RESTART_DELAY_MS / 1000}s...`);
    setTimeout(startBot, RESTART_DELAY_MS);
  });

  _botProcess.on("error", (err) => {
    console.error(`[LAUNCHER] Lỗi spawn: ${err.message}. Restart sau ${RESTART_DELAY_MS / 1000}s...`);
    setTimeout(startBot, RESTART_DELAY_MS);
  });
}

// ── Dừng bot con khi launcher bị kill ────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n[LAUNCHER] Nhận ${signal}, đang dừng bot...`);
  if (_botProcess) _botProcess.kill(signal);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

startBot();

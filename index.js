"use strict";

const { spawn, execSync } = require("child_process");
const path = require("path");

const NODE_FLAGS = ["--max-old-space-size=200", "--gc-interval=200"];
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

// ── Patch zca-js: thêm retry cho checkSession (fix lỗi "Cannot get session") ─
(function patchZcaJs() {
  const fs = require("fs");

  function findProjectRoot(startDir) {
    let dir = startDir;
    for (let i = 0; i < 5; i++) {
      if (fs.existsSync(path.join(dir, "node_modules", "zca-js"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  const projectRoot = findProjectRoot(__dirname) || __dirname;
  const loginQRPath = path.join(projectRoot, "node_modules", "zca-js", "dist", "apis", "loginQR.js");
  const loginQRCjsPath = path.join(projectRoot, "node_modules", "zca-js", "dist", "cjs", "apis", "loginQR.cjs");

  function applyPatch(filePath, originalStr, patchedStr, endOriginal, endPatched) {
    try {
      if (!fs.existsSync(filePath)) return;
      let content = fs.readFileSync(filePath, "utf-8");
      if (content.includes("MAX_RETRIES")) return;
      if (!content.includes(originalStr)) return;
      content = content.replace(originalStr, patchedStr);
      content = content.replace(endOriginal, endPatched);
      fs.writeFileSync(filePath, content, "utf-8");
      console.log(`[LAUNCHER] Đã patch zca-js checkSession retry: ${path.basename(filePath)}`);
    } catch {}
  }

  const esmOrigStart = `async function checkSession(ctx) {\n    return await request(ctx, "https://id.zalo.me/account/checksession`;
  const esmPatchStart = `async function checkSession(ctx) {\n    const MAX_RETRIES = 5;\n    const RETRY_DELAY_MS = 2000;\n    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {\n    const result = await request(ctx, "https://id.zalo.me/account/checksession`;
  const esmOrigEnd = `    }).catch(logger(ctx).error);\n}\nasync function getUserInfo`;
  const esmPatchEnd = `    }).catch(logger(ctx).error);\n        if (result) return result;\n        if (attempt < MAX_RETRIES) {\n            logger(ctx).warn(\`[checkSession] Lần \${attempt} thất bại, thử lại sau \${RETRY_DELAY_MS / 1000}s...\`);\n            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));\n        }\n    }\n    return null;\n}\nasync function getUserInfo`;

  const cjsOrigStart = `async function checkSession(ctx) {\n    return await utils.request(ctx, "https://id.zalo.me/account/checksession`;
  const cjsPatchStart = `async function checkSession(ctx) {\n    const MAX_RETRIES = 5;\n    const RETRY_DELAY_MS = 2000;\n    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {\n    const result = await utils.request(ctx, "https://id.zalo.me/account/checksession`;
  const cjsOrigEnd = `    }).catch(utils.logger(ctx).error);\n}\nasync function getUserInfo`;
  const cjsPatchEnd = `    }).catch(utils.logger(ctx).error);\n        if (result) return result;\n        if (attempt < MAX_RETRIES) {\n            utils.logger(ctx).warn(\`[checkSession] Lần \${attempt} thất bại, thử lại sau \${RETRY_DELAY_MS / 1000}s...\`);\n            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));\n        }\n    }\n    return null;\n}\nasync function getUserInfo`;

  applyPatch(loginQRPath, esmOrigStart, esmPatchStart, esmOrigEnd, esmPatchEnd);
  applyPatch(loginQRCjsPath, cjsOrigStart, cjsPatchStart, cjsOrigEnd, cjsPatchEnd);
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

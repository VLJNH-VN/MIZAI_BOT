const fs = require("fs");
const path = require("path");

// Tìm đúng thư mục gốc dự án (có chứa node_modules)
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

const projectRoot = findProjectRoot(__dirname);
if (!projectRoot) {
  console.error("[patch-zca] Không tìm thấy node_modules/zca-js. Hãy chạy 'npm install' trước.");
  process.exit(1);
}
console.log(`[patch-zca] Thư mục gốc: ${projectRoot}`);

const esmFile = path.join(projectRoot, "node_modules", "zca-js", "dist", "apis", "loginQR.js");
const cjsFile = path.join(projectRoot, "node_modules", "zca-js", "dist", "cjs", "apis", "loginQR.cjs");

const ORIGINAL_ESM_START = `async function checkSession(ctx) {\n    return await request(ctx, "https://id.zalo.me/account/checksession`;
const PATCHED_ESM_START  = `async function checkSession(ctx) {\n    const MAX_RETRIES = 5;\n    const RETRY_DELAY_MS = 2000;\n    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {\n    const result = await request(ctx, "https://id.zalo.me/account/checksession`;
const ORIGINAL_ESM_END   = `    }).catch(logger(ctx).error);\n}\nasync function getUserInfo`;
const PATCHED_ESM_END    = `    }).catch(logger(ctx).error);\n        if (result) return result;\n        if (attempt < MAX_RETRIES) {\n            logger(ctx).warn(\`[checkSession] Lần \${attempt} thất bại, thử lại sau \${RETRY_DELAY_MS / 1000}s...\`);\n            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));\n        }\n    }\n    return null;\n}\nasync function getUserInfo`;

const ORIGINAL_CJS_START = `async function checkSession(ctx) {\n    return await utils.request(ctx, "https://id.zalo.me/account/checksession`;
const PATCHED_CJS_START  = `async function checkSession(ctx) {\n    const MAX_RETRIES = 5;\n    const RETRY_DELAY_MS = 2000;\n    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {\n    const result = await utils.request(ctx, "https://id.zalo.me/account/checksession`;
const ORIGINAL_CJS_END   = `    }).catch(utils.logger(ctx).error);\n}\nasync function getUserInfo`;
const PATCHED_CJS_END    = `    }).catch(utils.logger(ctx).error);\n        if (result) return result;\n        if (attempt < MAX_RETRIES) {\n            utils.logger(ctx).warn(\`[checkSession] Lần \${attempt} thất bại, thử lại sau \${RETRY_DELAY_MS / 1000}s...\`);\n            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));\n        }\n    }\n    return null;\n}\nasync function getUserInfo`;

function patchFile(filePath, origStart, patchStart, origEnd, patchEnd) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[patch-zca] Không tìm thấy: ${filePath}`);
    return false;
  }
  let content = fs.readFileSync(filePath, "utf-8");
  if (content.includes("MAX_RETRIES")) {
    console.log(`[patch-zca] ${path.basename(filePath)} đã được patch rồi.`);
    return true;
  }
  if (!content.includes(origStart)) {
    console.warn(`[patch-zca] ${path.basename(filePath)}: Không tìm thấy đoạn cần patch (version thay đổi?).`);
    return false;
  }
  content = content.replace(origStart, patchStart);
  content = content.replace(origEnd, patchEnd);
  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`[patch-zca] ✓ Đã patch: ${path.basename(filePath)}`);
  return true;
}

console.log("[patch-zca] Đang patch zca-js checkSession để thêm retry...");
const r1 = patchFile(esmFile, ORIGINAL_ESM_START, PATCHED_ESM_START, ORIGINAL_ESM_END, PATCHED_ESM_END);
const r2 = patchFile(cjsFile, ORIGINAL_CJS_START, PATCHED_CJS_START, ORIGINAL_CJS_END, PATCHED_CJS_END);

if (r1 && r2) {
  console.log("[patch-zca] ✓ Patch hoàn thành! checkSession sẽ retry 5 lần, mỗi lần cách 2s.");
} else {
  console.warn("[patch-zca] Một số file chưa được patch. Kiểm tra lại node_modules.");
  process.exitCode = 1;
}

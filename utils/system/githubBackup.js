"use strict";

const fs   = require("fs");
const path = require("path");

// ── Danh sách file cần backup (dùng global.config.repo & githubToken) ─────────
const BACKUP_FILES = [
  { local: path.join(process.cwd(), "includes", "data", "key.json"),                     remote: "backup/data/key.json" },
  { local: path.join(process.cwd(), "includes", "data", "runtime", "users.json"),        remote: "backup/data/users.json" },
  { local: path.join(process.cwd(), "includes", "data", "runtime", "groups.json"),       remote: "backup/data/groups.json" },
  { local: path.join(process.cwd(), "includes", "data", "runtime", "rentKey.json"),      remote: "backup/data/rentKey.json" },
  { local: path.join(process.cwd(), "includes", "data", "runtime", "thuebot.json"),      remote: "backup/data/thuebot.json" },
  { local: path.join(process.cwd(), "includes", "data", "game", "taixiu", "money.json"),    remote: "backup/data/taixiu/money.json" },
  { local: path.join(process.cwd(), "includes", "data", "game", "taixiu", "txConfig.json"), remote: "backup/data/taixiu/txConfig.json" },
  { local: path.join(process.cwd(), "includes", "database", "groupsCache.json"),         remote: "backup/database/groupsCache.json" },
  { local: path.join(process.cwd(), "config.json"),                                      remote: "backup/config.json" },
];

// ── Upload 1 file lên GitHub (dùng global.githubUpload có sẵn) ────────────────
async function uploadFile(localPath, remotePath) {
  if (!fs.existsSync(localPath)) return { skip: true };
  try {
    const url = await global.githubUpload(localPath, remotePath, {
      repo:    global.config?.repo,
      branch:  global.config?.branch || "main",
      message: `[Backup] ${path.basename(remotePath)}`,
    });
    return { ok: !!url };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Hàm backup chính ──────────────────────────────────────────────────────────
async function runBackup() {
  const token = global.config?.githubToken || process.env.GITHUB_TOKEN;
  if (!token || !global.config?.repo) {
    global.logWarn?.("[Backup] Chưa cấu hình githubToken (config.json hoặc biến môi trường GITHUB_TOKEN) hoặc repo — bỏ qua.");
    return { success: false, reason: "Chưa cấu hình githubToken / repo" };
  }

  const results = { ok: 0, skip: 0, fail: 0, details: [] };

  for (const { local, remote } of BACKUP_FILES) {
    const name = path.basename(local);
    try {
      const res = await uploadFile(local, remote);
      if (res.skip) {
        results.skip++;
        results.details.push(`⏭ ${name}`);
      } else if (res.ok) {
        results.ok++;
        results.details.push(`✅ ${name}`);
      } else {
        results.fail++;
        results.details.push(`❌ ${name}: ${res.error || "lỗi không xác định"}`);
      }
    } catch (err) {
      results.fail++;
      results.details.push(`❌ ${name}: ${err.message}`);
    }
  }

  const now = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  global.logInfo?.(`[Backup] ${now}: ✅${results.ok} ⏭${results.skip} ❌${results.fail} → ${global.config.repo}`);
  results.success = true;
  results.time    = now;
  return results;
}

// ── Lên lịch auto backup ──────────────────────────────────────────────────────
function scheduleBackup(intervalMs = 6 * 60 * 60 * 1000) {
  if ((!global.config?.githubToken && !process.env.GITHUB_TOKEN) || !global.config?.repo) {
    global.logWarn?.("[Backup] githubToken / repo chưa đặt → auto backup TẮT.");
    return;
  }
  setTimeout(() => runBackup(), 2 * 60 * 1000);
  setInterval(() => runBackup(), intervalMs).unref?.();
  const h = Math.round(intervalMs / 3600000);
  global.logInfo?.(`[Backup] Auto backup mỗi ${h}h → ${global.config.repo}`);
}

module.exports = { runBackup, scheduleBackup, BACKUP_FILES };

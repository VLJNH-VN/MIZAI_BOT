const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_TOTAL_FILES = 200;

// Danh sách các thư mục cache cần dọn dẹp định kỳ
const CACHE_DIRS = [
  path.join(process.cwd(), "includes", "cache"),
];

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

function scheduleCacheCleanup(intervalMs = 60 * 60 * 1000, options = {}) {
  try {
    cleanupCacheDir(options);
    setInterval(() => cleanupCacheDir(options), intervalMs).unref?.();
    logInfo(`cacheCleaner: auto dọn cache mỗi ${Math.round(intervalMs / 60000)} phút.`);
  } catch (e) {
    logError(`cacheCleaner.scheduleCacheCleanup error: ${e?.message || e}`);
  }
}

const CACHE_DIR = CACHE_DIRS[0];
module.exports = { cleanupCacheDir, scheduleCacheCleanup, CACHE_DIR, CACHE_DIRS };

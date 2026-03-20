#!/usr/bin/env node
/**
 * Backup toàn bộ lệnh ra file .zip
 * Usage: node scripts/backup-cmds.js
 */

const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const COMMANDS_DIR = path.join(__dirname, "../src/commands");
const BACKUP_DIR = path.join(__dirname, "../backups");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outFile = path.join(BACKUP_DIR, `commands-backup-${timestamp}.zip`);

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const output = fs.createWriteStream(outFile);
const archive = archiver("zip", { zlib: { level: 9 } });

output.on("close", () => {
  const kb = (archive.pointer() / 1024).toFixed(1);
  console.log(`✅ Backup thành công: backups/commands-backup-${timestamp}.zip (${kb} KB)`);
});

archive.on("error", (err) => {
  console.error("❌ Lỗi backup:", err.message);
  process.exit(1);
});

archive.pipe(output);
archive.directory(COMMANDS_DIR, "commands");
archive.finalize();

#!/usr/bin/env node
/**
 * Di chuyển lệnh sang danh mục khác
 * Usage: node scripts/move-cmd.js <tên-lệnh> <danh-mục-mới>
 * Ví dụ: node scripts/move-cmd.js ping info
 */

const fs = require("fs");
const path = require("path");

const CATEGORIES = ["admin", "economy", "media", "info", "fun", "ai", "utility"];
const COMMANDS_DIR = path.join(__dirname, "../src/commands");

const [, , cmdName, newCategory] = process.argv;

if (!cmdName || !newCategory) {
  console.error("❌ Cú pháp: node scripts/move-cmd.js <tên-lệnh> <danh-mục-mới>");
  console.error(`📁 Danh mục hợp lệ: ${CATEGORIES.join(", ")}`);
  process.exit(1);
}

if (!CATEGORIES.includes(newCategory)) {
  console.error(`❌ Danh mục không hợp lệ: ${newCategory}`);
  console.error(`📁 Danh mục hợp lệ: ${CATEGORIES.join(", ")}`);
  process.exit(1);
}

const fileName = `${cmdName.toLowerCase()}.js`;

// Tìm file trong tất cả danh mục
function findFile(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full);
      if (found) return found;
    } else if (entry.name === fileName) {
      return full;
    }
  }
  return null;
}

const srcPath = findFile(COMMANDS_DIR);
if (!srcPath) {
  console.error(`❌ Không tìm thấy lệnh: ${fileName}`);
  process.exit(1);
}

const destDir = path.join(COMMANDS_DIR, newCategory);
const destPath = path.join(destDir, fileName);

if (srcPath === destPath) {
  console.log(`✅ Lệnh ${cmdName} đã ở danh mục ${newCategory}`);
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.renameSync(srcPath, destPath);

const oldCat = path.basename(path.dirname(srcPath));
console.log(`✅ Đã di chuyển: ${oldCat}/${fileName} → ${newCategory}/${fileName}`);

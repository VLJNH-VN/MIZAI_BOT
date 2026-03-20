#!/usr/bin/env node
/**
 * Tạo file lệnh mới từ template
 * Usage: node scripts/new-cmd.js <tên-lệnh> <danh-mục>
 * Ví dụ: node scripts/new-cmd.js hello fun
 */

const fs = require("fs");
const path = require("path");

const CATEGORIES = ["admin", "economy", "media", "info", "fun", "ai", "utility"];
const COMMANDS_DIR = path.join(__dirname, "../src/commands");

const [, , cmdName, category] = process.argv;

if (!cmdName) {
  console.error("❌ Thiếu tên lệnh. Ví dụ: node scripts/new-cmd.js hello fun");
  process.exit(1);
}

const cat = category && CATEGORIES.includes(category) ? category : "utility";

const fileName = `${cmdName.toLowerCase()}.js`;
const outDir = path.join(COMMANDS_DIR, cat);
const outPath = path.join(outDir, fileName);

if (fs.existsSync(outPath)) {
  console.error(`❌ File đã tồn tại: src/commands/${cat}/${fileName}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const template = `module.exports = {
  config: {
    name: "${cmdName.toLowerCase()}",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "Your Name",
    description: "Mô tả lệnh ${cmdName}",
    commandCategory: "${cat}",
    usages: "${cmdName.toLowerCase()} [tham số]",
    cooldowns: 3,
    aliases: []
  },

  run: async ({ api, event, args, send }) => {
    await send("👋 Lệnh ${cmdName} đang chạy!\\nArgs: " + args.join(", "));
  }
};
`;

fs.writeFileSync(outPath, template, "utf-8");
console.log(`✅ Đã tạo lệnh mới: src/commands/${cat}/${fileName}`);

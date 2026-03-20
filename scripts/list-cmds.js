#!/usr/bin/env node
/**
 * Liệt kê tất cả lệnh theo danh mục
 * Usage: node scripts/list-cmds.js
 */

const fs = require("fs");
const path = require("path");

const COMMANDS_DIR = path.join(__dirname, "../src/commands");

function collectFiles(dir, base = "") {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...collectFiles(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith(".js")) {
      results.push({ rel, full: path.join(dir, entry.name) });
    }
  }
  return results;
}

const files = collectFiles(COMMANDS_DIR);
const byCategory = {};
let total = 0;

for (const { rel, full } of files) {
  try {
    const cmd = require(full);
    const cat = cmd?.config?.commandCategory || "unknown";
    const name = cmd?.config?.name || rel;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(name);
    total++;
  } catch {
    const cat = rel.split("/")[0] || "unknown";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(`[lỗi] ${rel}`);
    total++;
  }
}

console.log(`\n📋 Danh sách lệnh (${total} lệnh)\n${"─".repeat(40)}`);
for (const [cat, cmds] of Object.entries(byCategory).sort()) {
  console.log(`\n📁 ${cat.toUpperCase()} (${cmds.length} lệnh):`);
  cmds.sort().forEach(c => console.log(`   • ${c}`));
}
console.log(`\n${"─".repeat(40)}\nTổng: ${total} lệnh\n`);

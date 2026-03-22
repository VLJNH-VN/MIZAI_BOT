"use strict";

/**
 * src/commands/load.js
 * Load / unload / reload module lệnh
 * Credits: Niio-team (Vtuan) — converted MiZai
 */

const fs   = require("fs");
const path = require("path");
const { loadCommandFromFile } = require("../../utils/system/loader");
const { readConfig }          = require("../../utils/media/helpers");

const CMD_DIR = path.join(process.cwd(), "src", "commands");

function reloadAll(commands) {
  const files = fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".js") && f !== "example.js");
  let ok = 0, fail = 0;
  for (const file of files) {
    const filePath = path.join(CMD_DIR, file);
    try { delete require.cache[require.resolve(filePath)]; } catch {}
    const loaded = loadCommandFromFile(filePath);
    if (!loaded) { fail++; continue; }
    commands.set(loaded.name, loaded.command);
    for (const alias of loaded.aliases || []) {
      commands.set(alias, loaded.command);
    }
    ok++;
  }
  const cfg = readConfig();
  if (cfg.prefix) {
    global.prefix = cfg.prefix;
    global.config.prefix = cfg.prefix;
  }
  return { ok, fail, total: new Set([...commands.values()]).size };
}

module.exports = {
  config: {
    name:            "load",
    aliases:         ["reload"],
    version:         "2.2.0",
    hasPermssion:    2,
    credits:         "Niio-team (Vtuan) — converted MiZai",
    description:     "Load / unload / reload lệnh. Dùng 'reload' để reload toàn bộ nhanh.",
    commandCategory: "Quản Trị",
    usages: [
      "reload             — Reload tất cả lệnh + cập nhật config",
      "load all           — Reload tất cả lệnh + cập nhật config",
      "load <tên>         — Reload 1 lệnh",
      "load unload <tên>  — Gỡ bỏ 1 lệnh",
    ].join("\n"),
    cooldowns: 0,
  },

  run: async ({ args, send, commands, commandName }) => {
    const sub  = (args[0] || "").toLowerCase();
    const name = (args[1] || args[0] || "").toLowerCase().trim();

    // ── >reload (không có args) hoặc >load all ────────────────────────────────
    if (commandName === "reload" || sub === "all") {
      const { ok, fail, total } = reloadAll(commands);
      return send(
        `🔄 Reload hoàn tất!\n` +
        `✅ Thành công: ${ok} lệnh\n` +
        `❌ Thất bại: ${fail} lệnh\n` +
        `📋 Tổng: ${total} lệnh\n` +
        `⚙️ Prefix: ${global.prefix}`
      );
    }

    // ── unload ────────────────────────────────────────────────────────────────
    if (sub === "unload") {
      const target = (args[1] || "").toLowerCase().trim();
      if (!target) return send("❌ Nhập tên lệnh cần gỡ: load unload <tên>");
      if (!commands.has(target)) return send(`❌ Lệnh "${target}" không tồn tại.`);
      commands.delete(target);
      return send(`✅ Đã gỡ bỏ lệnh "${target}" thành công.`);
    }

    // ── reload 1 lệnh ─────────────────────────────────────────────────────────
    if (!name) return send(`❌ Nhập tên lệnh cần reload.\nDùng: reload | load <tên> | load all | load unload <tên>`);

    const filePath = path.join(CMD_DIR, `${name}.js`);
    if (!fs.existsSync(filePath)) return send(`❌ Không tìm thấy file: ${name}.js`);

    try { delete require.cache[require.resolve(filePath)]; } catch {}
    const loaded = loadCommandFromFile(filePath);
    if (!loaded) return send(`❌ Lệnh "${name}" không hợp lệ hoặc lỗi cú pháp.`);

    commands.set(loaded.name, loaded.command);
    for (const alias of loaded.aliases || []) {
      commands.set(alias, loaded.command);
    }
    return send(`✅ Đã reload lệnh "${loaded.name}" thành công.`);
  },
};

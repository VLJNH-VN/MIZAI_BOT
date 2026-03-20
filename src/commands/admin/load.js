"use strict";

/**
 * src/commands/load.js
 * Load / unload / reload module lệnh
 * Credits: Niio-team (Vtuan) — converted MiZai
 */

const fs   = require("fs");
const path = require("path");
const { loadCommandFromFile } = require("../../utils/system/loader");

const CMD_DIR = path.join(process.cwd(), "src", "commands");

module.exports = {
  config: {
    name:            "load",
    version:         "2.1.0",
    hasPermssion:    2,
    credits:         "Niio-team (Vtuan) — converted MiZai",
    description:     "Load / unload / reload lệnh",
    commandCategory: "Admin",
    usages: [
      "load <tên>         — Reload 1 lệnh",
      "load all           — Reload tất cả lệnh",
      "load unload <tên>  — Gỡ bỏ 1 lệnh",
    ].join("\n"),
    cooldowns: 0,
  },

  run: async ({ args, send, commands }) => {
    const sub  = (args[0] || "").toLowerCase();
    const name = (args[1] || args[0] || "").toLowerCase().trim();

    // ── unload ───────────────────────────────────────────────────────────────
    if (sub === "unload") {
      const target = (args[1] || "").toLowerCase().trim();
      if (!target) return send("❌ Nhập tên lệnh cần gỡ: load unload <tên>");
      if (!commands.has(target)) return send(`❌ Lệnh "${target}" không tồn tại.`);
      commands.delete(target);
      return send(`✅ Đã gỡ bỏ lệnh "${target}" thành công.`);
    }

    // ── reload all ───────────────────────────────────────────────────────────
    if (sub === "all") {
      const files = fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".js") && f !== "example.js");
      let ok = 0, fail = 0;
      for (const file of files) {
        const loaded = loadCommandFromFile(path.join(CMD_DIR, file));
        if (!loaded) { fail++; continue; }
        commands.set(loaded.name, loaded.command);
        for (const alias of loaded.aliases || []) {
          if (!commands.has(alias)) commands.set(alias, loaded.command);
        }
        ok++;
      }
      return send(`✅ Reload xong!\n📦 Thành công: ${ok}\n❌ Thất bại: ${fail}\n📋 Tổng lệnh: ${new Set([...commands.values()]).size}`);
    }

    // ── reload 1 lệnh ────────────────────────────────────────────────────────
    if (!name) return send(`❌ Nhập tên lệnh cần reload.\nDùng: load <tên> | load all | load unload <tên>`);

    const filePath = path.join(CMD_DIR, `${name}.js`);
    if (!fs.existsSync(filePath)) return send(`❌ Không tìm thấy file: ${name}.js`);

    const loaded = loadCommandFromFile(filePath);
    if (!loaded) return send(`❌ Lệnh "${name}" không hợp lệ hoặc lỗi cú pháp.`);

    commands.set(loaded.name, loaded.command);
    for (const alias of loaded.aliases || []) {
      if (!commands.has(alias)) commands.set(alias, loaded.command);
    }
    return send(`✅ Đã reload lệnh "${loaded.name}" thành công.`);
  },
};

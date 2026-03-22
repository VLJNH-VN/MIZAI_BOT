"use strict";

const fs   = require("fs");
const path = require("path");
const { loadCommandFromFile } = require("../../utils/system/loader");
const { readConfig }          = require("../../utils/media/helpers");

const CMD_DIR = path.join(process.cwd(), "src", "commands");

module.exports = {
  config: {
    name:            "reload",
    version:         "1.0.0",
    hasPermssion:    2,
    credits:         "MiZai",
    description:     "Reload toàn bộ lệnh và cập nhật config (prefix,...) mà không cần restart bot",
    commandCategory: "Quản Trị",
    usages:          "reload",
    cooldowns:       0,
  },

  run: async ({ send, commands }) => {
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

    const total = new Set([...commands.values()]).size;
    return send(
      `🔄 Reload hoàn tất!\n` +
      `✅ Thành công: ${ok} lệnh\n` +
      `❌ Thất bại: ${fail} lệnh\n` +
      `📋 Tổng: ${total} lệnh\n` +
      `⚙️ Prefix hiện tại: ${global.prefix}`
    );
  },
};

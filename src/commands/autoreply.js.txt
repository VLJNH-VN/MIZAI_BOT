"use strict";

const fs   = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "../../includes/data/autoreply.json");

function loadRules() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8")); }
  catch (_) { return []; }
}

function saveRules(rules) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(rules, null, 2), "utf-8");
}

module.exports = {
  config: {
    name:            "autoreply",
    aliases:         ["ar", "tudongtl"],
    version:         "2.0.0",
    hasPermssion:    2,
    credits:         "MIZAI",
    description:     "Quản lý tin nhắn tự động trả lời theo từ khóa",
    commandCategory: "Quản Trị",
    usages: [
      "autoreply list                      — Xem danh sách",
      "autoreply add <từ_khóa> | <trả lời> — Thêm auto reply",
      "autoreply del <id>                  — Xóa auto reply",
    ].join("\n"),
    cooldowns: 3,
  },

  run: async ({ args, send, prefix }) => {
    const sub = (args[0] || "").toLowerCase();

    if (!sub || sub === "list") {
      const rules = loadRules();
      if (!rules.length) return send("📭 Chưa có auto reply nào.");
      const lines = rules.map((r, i) =>
        `${i + 1}. [ID:${r.id}] 🎯 "${r.keyword}" → "${String(r.reply).slice(0, 40)}"`
      );
      return send(`🔁 DANH SÁCH AUTO REPLY (${rules.length}):\n${lines.join("\n")}`);
    }

    if (sub === "add") {
      const fullText = args.slice(1).join(" ");
      const sepIdx = fullText.indexOf("|");
      if (sepIdx === -1) return send(`⚠️ Cú pháp: ${prefix}autoreply add <từ khóa> | <trả lời>`);
      const keyword = fullText.slice(0, sepIdx).trim().toLowerCase();
      const reply   = fullText.slice(sepIdx + 1).trim();
      if (!keyword || !reply) return send("⚠️ Từ khóa và nội dung không được để trống.");
      const rules = loadRules();
      const id = Date.now();
      rules.push({ id, keyword, reply });
      saveRules(rules);
      return send(`✅ Đã thêm auto reply:\n🎯 Từ khóa: "${keyword}"\n💬 Trả lời: "${reply}"`);
    }

    if (sub === "del" || sub === "delete" || sub === "rm") {
      const idArg = args[1];
      if (!idArg) return send(`⚠️ Cú pháp: ${prefix}autoreply del <id>`);
      const rules   = loadRules();
      const before  = rules.length;
      const filtered = rules.filter(r => String(r.id) !== String(idArg));
      if (filtered.length === before) return send(`❌ Không tìm thấy ID: ${idArg}`);
      saveRules(filtered);
      return send(`✅ Đã xóa auto reply ID: ${idArg}`);
    }

    return send(`❌ Lệnh không hợp lệ. Dùng: ${prefix}autoreply để xem hướng dẫn.`);
  },
};

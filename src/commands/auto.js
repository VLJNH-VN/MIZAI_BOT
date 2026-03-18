const fs = require("fs");
const path = require("path");
const { ThreadType } = require("zca-js");

const SETTINGS_FILE = path.join(__dirname, "../../includes/data/settings.json");

function readSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify({}));
      return {};
    }
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
  } catch { return {}; }
}

function saveSettings(data) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

function getGroupSettings(groupId) {
  const data = readSettings();
  if (!data[groupId]) data[groupId] = {};
  const g = data[groupId];
  return {
    autodown: g.autodown !== false,
    autosend: g.autosend !== false,
  };
}

function setGroupSetting(groupId, key, value) {
  const data = readSettings();
  if (!data[groupId]) data[groupId] = {};
  data[groupId][key] = value;
  saveSettings(data);
}

function setAllGroupsSetting(key, value) {
  const data = readSettings();
  for (const gid of Object.keys(data)) {
    data[gid][key] = value;
  }
  data["__global"] = data["__global"] || {};
  data["__global"][key] = value;
  saveSettings(data);
}

function getEffectiveSetting(groupId, key) {
  const data = readSettings();
  if (data[groupId] && data[groupId][key] !== undefined) {
    return data[groupId][key];
  }
  if (data["__global"] && data["__global"][key] !== undefined) {
    return data["__global"][key];
  }
  return null;
}

const AUTO_FEATURES = {
  autodown: "Auto-Down (tự tải video/nhạc khi có link)",
  autosend: "Auto-Send (tự gửi tin nhắn định kỳ)",
};

module.exports = {
  config: {
    name: "auto",
    version: "2.0.0",
    hasPermssion: 1,
    credits: "GwenDev / MiZai",
    description: "Quản lý cài đặt tự động (autodown, autosend) cho nhóm",
    commandCategory: "Quản Trị",
    usages: [
      "auto list               — Xem cài đặt nhóm này",
      "auto <tính năng> on     — Bật cho nhóm này",
      "auto <tính năng> off    — Tắt cho nhóm này",
      "auto <tính năng> onall  — Bật cho tất cả nhóm (admin)",
      "auto <tính năng> offall — Tắt cho tất cả nhóm (admin)",
      "Tính năng: autodown, autosend",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ event, args, send, threadID, senderId }) => {
    if (event.type !== ThreadType.Group) {
      return send("⛔ Lệnh này chỉ dùng được trong nhóm.");
    }

    const sub = (args[0] || "").toLowerCase();
    const act = (args[1] || "").toLowerCase();

    // ── Hiển thị trạng thái ──────────────────────────────────────────────────
    if (!sub || sub === "list" || sub === "status") {
      const gs = getGroupSettings(threadID);
      const lines = [
        "⚙️ CÀI ĐẶT BOT — Nhóm này",
        "━━━━━━━━━━━━━━━━",
        `${gs.autodown ? "✅" : "❌"} Auto-Down`,
        `${gs.autosend ? "✅" : "❌"} Auto-Send`,
        "━━━━━━━━━━━━━━━━",
        "💡 Dùng: .auto <tính năng> on|off",
        "Tính năng: autodown, autosend",
        "ℹ️ Để quản lý anti, dùng lệnh .anti",
      ];
      return send(lines.join("\n"));
    }

    if (!act || !["on", "off", "onall", "offall"].includes(act)) {
      return send(
        "❓ Cú pháp: .auto <tính năng> <on|off|onall|offall>\n" +
        "Ví dụ: .auto autodown off"
      );
    }

    if (!AUTO_FEATURES[sub]) {
      return send(
        "❌ Tính năng không hợp lệ.\n" +
        "Tính năng: autodown, autosend\n" +
        "ℹ️ Để quản lý anti, dùng lệnh .anti"
      );
    }

    const isAdmin = global.isBotAdmin ? global.isBotAdmin(senderId) : false;
    if ((act === "onall" || act === "offall") && !isAdmin) {
      return send("⛔ Chỉ admin bot mới có thể thay đổi cài đặt toàn bộ nhóm.");
    }

    const val = act === "on" || act === "onall";

    if (act === "onall" || act === "offall") {
      setAllGroupsSetting(sub, val);
    } else {
      setGroupSetting(threadID, sub, val);
    }

    const emoji = val ? "✅" : "❌";
    const scope = (act === "onall" || act === "offall") ? "tất cả nhóm" : "nhóm này";
    return send(`${emoji} ${AUTO_FEATURES[sub]}\n→ Đã ${val ? "bật" : "tắt"} cho ${scope}.`);
  },

  getGroupSettings,
  getEffectiveSetting,
};

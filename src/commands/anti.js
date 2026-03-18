const fs = require("fs");
const path = require("path");
const { ThreadType } = require("zca-js");
const { getGroupAnti, setGroupAnti } = require("../../utils/bot/antiManager");

const ANTI_FILE = path.join(__dirname, "../../includes/data/anti.json");

const FEATURES = {
  link: { field: "antiLink", label: "Anti-Link",  icon: "🔗", desc: "xoá tin nhắn có link lạ" },
  spam: { field: "antiSpam", label: "Anti-Spam",  icon: "🚫", desc: "cảnh báo gửi quá nhanh" },
  nsfw: { field: "antiNsfw", label: "Anti-NSFW",  icon: "🔞", desc: "lọc từ ngữ không phù hợp" },
  fake: { field: "antiFake", label: "Anti-Fake",  icon: "🤖", desc: "phát hiện tài khoản ảo khi vào nhóm" },
  out:  { field: "antiOut",  label: "Anti-Out",   icon: "🚪", desc: "kick thành viên vào ra liên tục" },
  undo: { field: "antiUndo", label: "Anti-Undo",  icon: "↩️", desc: "cấm thu hồi tin nhắn" },
};

function getAllGroupIds() {
  try {
    if (!fs.existsSync(ANTI_FILE)) return [];
    return Object.keys(JSON.parse(fs.readFileSync(ANTI_FILE, "utf-8")));
  } catch { return []; }
}

module.exports = {
  config: {
    name: "anti",
    version: "3.0.0",
    hasPermssion: 1,
    credits: "MiZai",
    description: "Bật/tắt các tính năng bảo vệ nhóm (anti)",
    commandCategory: "Quản Trị",
    usages: [
      ".anti                        — Xem trạng thái",
      ".anti <tính năng> on|off     — Bật/tắt cho nhóm này",
      ".anti <tính năng> onall      — Bật cho tất cả nhóm (admin)",
      ".anti <tính năng> offall     — Tắt cho tất cả nhóm (admin)",
      "Tính năng: link, spam, nsfw, fake, out, undo",
    ].join("\n"),
    cooldowns: 3,
  },

  run: async ({ event, args, send, threadID, senderId }) => {
    if (event.type !== ThreadType.Group) {
      return send("⛔ Lệnh này chỉ dùng được trong nhóm.");
    }

    const sub    = (args[0] || "").toLowerCase();
    const toggle = (args[1] || "").toLowerCase();

    // ── Xem tổng trạng thái ───────────────────────────────────────────────
    if (!sub || sub === "status" || sub === "list") {
      const cfg = getGroupAnti(threadID);
      const lines = Object.entries(FEATURES).map(([key, { field, label, icon, desc }]) =>
        `${cfg[field] ? "✅" : "❌"} ${icon} ${label.padEnd(11)} (.anti ${key} on|off)`
      );
      return send(
        `🛡️ TRẠNG THÁI ANTI — Nhóm này\n` +
        `━━━━━━━━━━━━━━━━\n` +
        lines.join("\n") +
        `\n━━━━━━━━━━━━━━━━\n` +
        `💡 Dùng: .anti <tính năng> on|off|onall|offall`
      );
    }

    // ── Kiểm tra tính năng ────────────────────────────────────────────────
    const feature = FEATURES[sub];
    if (!feature) {
      return send(
        `❌ Tính năng không hợp lệ.\n` +
        `Các tính năng: ${Object.keys(FEATURES).join(", ")}\n` +
        `Ví dụ: .anti link on`
      );
    }

    const { field, label, icon, desc } = feature;

    // Không có toggle → hiển thị trạng thái tính năng đó
    if (!["on", "off", "onall", "offall"].includes(toggle)) {
      const cfg = getGroupAnti(threadID);
      return send(
        `${icon} ${label} — ${desc}\n` +
        `Trạng thái: ${cfg[field] ? "✅ ON" : "❌ OFF"}\n` +
        `Dùng: .anti ${sub} on | .anti ${sub} off`
      );
    }

    // ── Kiểm tra quyền admin bot cho onall/offall ─────────────────────────
    const isGlobal = toggle === "onall" || toggle === "offall";
    if (isGlobal) {
      const isAdmin = global.isBotAdmin ? global.isBotAdmin(senderId) : false;
      if (!isAdmin) return send("⛔ Chỉ admin bot mới có thể thay đổi cài đặt toàn bộ nhóm.");
      for (const gid of getAllGroupIds()) setGroupAnti(gid, field, toggle === "onall");
    } else {
      setGroupAnti(threadID, field, toggle === "on");
    }

    const val   = toggle === "on" || toggle === "onall";
    const scope = isGlobal ? "tất cả nhóm" : "nhóm này";
    return send(`${val ? "✅" : "❌"} ${label}\n→ Đã ${val ? "BẬT" : "TẮT"} cho ${scope}.`);
  },
};

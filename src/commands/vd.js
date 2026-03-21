"use strict";

/**
 * src/commands/vd.js
 * Xem video ngẫu nhiên từ listapi/<tên>.json (GitHub raw URL)
 *
 * Cách dùng:
 *   .vd              → Xem danh sách listapi có sẵn
 *   .vd <tên>        → Gửi 1 video ngẫu nhiên từ listapi/<tên>
 *   .vd <tên> <số>   → Gửi n video ngẫu nhiên liên tiếp (tối đa 10)
 */

const fs   = require("fs");
const path = require("path");

const LISTAPI_DIR = path.join(process.cwd(), "includes", "listapi");

// ── Lấy danh sách file listapi đang có ────────────────────────────────────────
function getListapiFiles() {
  if (!fs.existsSync(LISTAPI_DIR)) return [];
  return fs.readdirSync(LISTAPI_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => f.replace(".json", ""));
}

// ── Chọn ngẫu nhiên n phần tử không trùng từ mảng ────────────────────────────
function pickRandN(arr, n) {
  if (!arr.length) return [];
  const copy = [...arr];
  const picks = [];
  const count = Math.min(n, copy.length);
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    picks.push(copy.splice(idx, 1)[0]);
  }
  return picks;
}

module.exports = {
  config: {
    name:            "vd",
    aliases:         ["video", "randvd", "playvd"],
    version:         "1.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Xem video ngẫu nhiên từ listapi",
    commandCategory: "Giải Trí",
    usages: [
      ".vd              — Xem danh sách listapi có sẵn",
      ".vd <tên>        — Gửi 1 video ngẫu nhiên từ listapi/<tên>",
      ".vd <tên> <số>   — Gửi n video liên tiếp (tối đa 10)",
    ].join("\n"),
    cooldowns: 3,
  },

  run: async ({ api, event, args, send }) => {
    // ── Không có args → Hiển thị danh sách listapi ───────────────────────────
    if (!args.length) {
      const files = getListapiFiles();
      if (!files.length) {
        return send(
          "📂 Chưa có listapi nào.\n" +
          "Dùng .api tt <tên> <từ khóa> <số> để tải video từ TikTok về."
        );
      }
      const lines = ["📋 DANH SÁCH LISTAPI", "━━━━━━━━━━━━━━━━"];
      for (const name of files) {
        const list = global.cawr.tt.loadList(name);
        lines.push(`• ${name} — ${list.length} video`);
      }
      lines.push("━━━━━━━━━━━━━━━━");
      lines.push("💬 Dùng: .vd <tên> để xem video");
      return send(lines.join("\n"));
    }

    // ── Parse tên và số lượng ─────────────────────────────────────────────────
    const tipName = args[0];
    let count = 1;
    if (args[1]) {
      const parsed = parseInt(args[1], 10);
      if (!isNaN(parsed) && parsed >= 1) count = Math.min(parsed, 10);
    }

    // ── Kiểm tra listapi có tồn tại không ────────────────────────────────────
    const list = global.cawr.tt.loadList(tipName);
    if (!list.length) {
      const files = getListapiFiles();
      let msg = `❌ Listapi "${tipName}" chưa có video.`;
      if (files.length) msg += `\n📋 Có sẵn: ${files.join(", ")}`;
      else msg += "\nDùng .api tt <tên> <từ khóa> <số> để tải về trước.";
      return send(msg);
    }

    // ── Thông báo nếu gửi nhiều video ────────────────────────────────────────
    if (count > 1) {
      await send(`🎬 Đang gửi ${count} video từ "${tipName}"... (${list.length} video có sẵn)`);
    }

    // ── Gửi video ─────────────────────────────────────────────────────────────
    const picks = pickRandN(list, count);
    let sentOk = 0;

    for (const ghUrl of picks) {
      try {
        await api.sendVideo({
          videoUrl:     ghUrl,
          thumbnailUrl: "",
          msg:          count === 1 ? `🎬 ${tipName}` : "",
          width:        576,
          height:       1024,
          duration:     10000,
          ttl:          500_000,
        }, event.threadId, event.type);
        sentOk++;
      } catch (err) {
        global.logWarn?.(`[vd] sendVideo lỗi: ${err?.message} | url: ${ghUrl}`);
        // Thử fallback: gửi link text
        try {
          await send(`🔗 ${ghUrl}`);
          sentOk++;
        } catch (_) {}
      }
    }

    if (count > 1) {
      await send(`✅ Đã gửi ${sentOk}/${count} video từ "${tipName}"`);
    }
  },
};

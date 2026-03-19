const path = require("path");
const fs = require("fs");
const {
  getRent,
  getAllRent,
  addRent,
  extendRent,
  deleteRent,
  activateKey,
  generateKey,
  isExpired,
} = require("../../includes/database/rent");

const CONFIG_PATH = path.join(__dirname, "../../config.json");
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")); }
  catch { return {}; }
}

const PAGE_SIZE = 10;

function getBody(event) {
  const raw = event?.data ?? {};
  const c = raw.content;
  if (typeof c === "string") return c.trim();
  if (c && typeof c === "object") return (c.text || c.msg || "").trim();
  return "";
}

module.exports = {
  config: {
    name: "rent",
    version: "1.3.0",
    hasPermssion: 2,
    credits: "MiZai (port từ Niio-team)",
    description: "Quản lý thuê bot theo nhóm",
    commandCategory: "Quản Trị",
    usages: [
      "rent add [ngày]        — Thêm / gia hạn thuê nhóm hiện tại (mặc định 30 ngày)",
      "rent del [threadID]    — Xóa thông tin thuê (mặc định nhóm hiện tại)",
      "rent list [trang]      — Xem danh sách nhóm đã thuê (có thể reply để thao tác)",
      "rent reg [ngày]        — Tạo key thuê bot",
      "rent info [threadID]   — Thông tin thuê nhóm (mặc định nhóm hiện tại)",
      "rent key <key>         — Kích hoạt key thuê cho nhóm hiện tại",
      "rent giahan [id] [ngày]— Gia hạn thêm số ngày cho nhóm",
      "rent check [threadID]  — Kiểm tra trạng thái thuê của nhóm",
    ].join("\n"),
    cooldowns: 3,
  },

  run: async ({ api, event, args, send, threadID, senderId, registerReply }) => {
    const sub = (args[0] || "").toLowerCase().trim();

    if (!sub) {
      return send(
        `╔══ LỆNH RENT BOT ══╗\n` +
        `╚════════════════════╝\n` +
        `📋 Các lệnh con:\n` +
        `  rent add [ngày]       — Thêm / gia hạn thuê nhóm hiện tại\n` +
        `  rent del [threadID]   — Xóa thông tin thuê nhóm\n` +
        `  rent list [trang]     — Xem danh sách nhóm đã thuê\n` +
        `  rent reg [ngày]       — Tạo key thuê bot\n` +
        `  rent info [threadID]  — Thông tin thuê nhóm\n` +
        `  rent key <key>        — Kích hoạt key thuê\n` +
        `  rent giahan [id] [ngày] — Gia hạn thêm cho nhóm\n` +
        `  rent check [threadID] — Kiểm tra trạng thái thuê`
      );
    }

    // ── ADD ─────────────────────────────────────────────────────────────────
    if (sub === "add") {
      const days = parseInt(args[1], 10) || 30;
      try {
        const result = await addRent(threadID, senderId, days);
        if (result.isNew) {
          return send(
            `✅ Đã thêm thuê bot cho nhóm.\n` +
            `📅 Từ: ${result.time_start}\n` +
            `📅 Đến: ${result.time_end}\n` +
            `⏳ Thời hạn: ${days} ngày`
          );
        } else {
          return send(
            `✅ Đã gia hạn thuê bot cho nhóm.\n` +
            `📅 Từ: ${result.time_start}\n` +
            `📅 Đến mới: ${result.time_end}\n` +
            `➕ Thêm: ${days} ngày`
          );
        }
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── DEL ─────────────────────────────────────────────────────────────────
    if (sub === "del") {
      const tid = args[1] ? String(args[1]).trim() : threadID;
      try {
        const ok = await deleteRent(tid);
        if (ok) {
          return send(`✅ Đã xóa thông tin thuê bot cho nhóm ${tid}.`);
        } else {
          return send(`⚠️ Không tìm thấy thông tin thuê bot cho nhóm ${tid}.`);
        }
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── LIST ─────────────────────────────────────────────────────────────────
    if (sub === "list") {
      try {
        const page = parseInt(args[1], 10) || 1;
        const all = await getAllRent();
        if (all.length === 0) return send("📋 Chưa có nhóm nào thuê bot.");

        const totalPages = Math.ceil(all.length / PAGE_SIZE);
        const safePage = Math.max(1, Math.min(page, totalPages));
        const start = (safePage - 1) * PAGE_SIZE;
        const slice = all.slice(start, Math.min(start + PAGE_SIZE, all.length));

        const lines = slice.map((r, i) => {
          const status = isExpired(r.time_end) ? "❎ Hết hạn" : "✅ Còn hạn";
          return (
            `${start + i + 1}. ${r.thread_id}\n` +
            `   👤 Owner: ${r.owner_id}\n` +
            `   ${status} | ${r.time_start} → ${r.time_end}`
          );
        });

        const txt =
          `📋 DANH SÁCH THUÊ BOT [${safePage}/${totalPages}]\n` +
          `━━━━━━━━━━━━━━━━\n` +
          lines.join("\n\n") +
          `\n━━━━━━━━━━━━━━━━\n` +
          `Tổng: ${all.length} nhóm | Trang ${safePage}/${totalPages}\n` +
          `💡 Reply: <số thứ tự> xem chi tiết | del <stt> xóa | giahan <stt> [ngày] gia hạn | page <n> chuyển trang`;

        const sent = await send(txt);
        const msgId =
          sent?.message?.msgId ??
          (Array.isArray(sent?.attachment) ? sent.attachment[0]?.msgId : null);

        if (msgId && registerReply) {
          registerReply({
            messageId:   msgId,
            commandName: "rent",
            payload:     { case: "list", all, page: safePage, totalPages },
            ttl:         5 * 60 * 1000,
          });
        }
        return;
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── REG ──────────────────────────────────────────────────────────────────
    if (sub === "reg") {
      try {
        const days = parseInt(args[1], 10) || 30;
        const cfg = readConfig();
        const prefix = cfg.keyRent || "MiZai";
        const key = generateKey(prefix, days);
        return send(
          `🔑 Key thuê bot (${days} ngày):\n` +
          `${key}\n\n` +
          `💡 Dùng: rent key ${key}\nđể kích hoạt cho nhóm hiện tại.`
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── INFO ─────────────────────────────────────────────────────────────────
    if (sub === "info") {
      const tid = args[1] ? String(args[1]).trim() : threadID;
      try {
        const rentInfo = await getRent(tid);
        if (!rentInfo) {
          return send(
            `📋 Thông tin thuê bot nhóm ${tid}:\n` +
            `⚠️ Nhóm này chưa thuê bot.`
          );
        }
        const status = isExpired(rentInfo.time_end) ? "❎ Đã hết hạn" : "✅ Còn hạn";
        return send(
          `📋 Thông tin thuê bot:\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `🏘️ Nhóm: ${tid}\n` +
          `👤 Owner: ${rentInfo.owner_id}\n` +
          `📝 Tình trạng: ${status}\n` +
          `📅 Từ: ${rentInfo.time_start}\n` +
          `📅 Đến: ${rentInfo.time_end}`
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── CHECK ────────────────────────────────────────────────────────────────
    if (sub === "check") {
      const tid = args[1] ? String(args[1]).trim() : threadID;
      try {
        const rentInfo = await getRent(tid);
        if (!rentInfo) {
          return send(`⚠️ Nhóm ${tid} chưa thuê bot.`);
        }
        const expired = isExpired(rentInfo.time_end);
        if (expired) {
          return send(
            `❎ Nhóm ${tid} đã hết hạn thuê.\n` +
            `📅 Hết hạn từ: ${rentInfo.time_end}`
          );
        }
        return send(
          `✅ Nhóm ${tid} đang thuê bot.\n` +
          `📅 Hết hạn: ${rentInfo.time_end}`
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── KEY ──────────────────────────────────────────────────────────────────
    if (sub === "key") {
      const key = args[1] ? String(args[1]).trim() : "";
      if (!key) {
        return send(`❌ Thiếu key.\nDùng: rent key <key>`);
      }
      try {
        const result = await activateKey(key, threadID, senderId);
        if (!result.ok) {
          if (result.reason === "used")    return send(`❎ Key "${key}" đã được sử dụng!`);
          if (result.reason === "invalid") return send(`❎ Key "${key}" không tồn tại!`);
          return send(`❎ Key không hợp lệ.`);
        }
        if (result.isNew) {
          return send(
            `✅ Kích hoạt thuê bot thành công!\n` +
            `📅 Từ: ${result.time_start}\n` +
            `📅 Đến: ${result.time_end}`
          );
        } else {
          return send(
            `✅ Gia hạn thuê bot thành công!\n` +
            `📅 Đến mới: ${result.time_end}`
          );
        }
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── GIAHAN ───────────────────────────────────────────────────────────────
    if (sub === "extend" || sub === "giahan") {
      const arg1 = args[1] ? String(args[1]).trim() : "";
      const arg2 = args[2] ? parseInt(args[2], 10) : NaN;
      const arg1AsNum = parseInt(arg1, 10);

      let tid, days;
      if (arg1 && isNaN(arg1AsNum)) {
        tid  = arg1;
        days = isNaN(arg2) ? 30 : arg2;
      } else {
        tid  = threadID;
        days = isNaN(arg1AsNum) ? 30 : arg1AsNum;
      }

      try {
        const result = await extendRent(tid, days);
        if (!result) return send(`⚠️ Không tìm thấy thông tin thuê bot cho nhóm ${tid}.`);
        return send(
          `✅ Đã gia hạn thêm ${days} ngày cho nhóm ${tid}.\n` +
          `📅 Đến mới: ${result.time_end}`
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    return send(
      `❌ Lệnh con không hợp lệ: "${args[0]}"\n` +
      `💡 Dùng: rent để xem hướng dẫn.`
    );
  },

  // ── onReply: xử lý reply vào danh sách ─────────────────────────────────────
  onReply: async ({ api, event, data: replyData, send, registerReply }) => {
    const body = getBody(event);
    if (!body) return;

    const { case: $case, all = [], page = 1, totalPages = 1 } = replyData || {};

    if ($case !== "list") return;

    const parts  = body.split(/\s+/);
    const action = parts[0].toLowerCase();

    // ── page <n> — chuyển trang ──────────────────────────────────────────────
    if (action === "page") {
      const n = parseInt(parts[1], 10) || 1;
      const safePage   = Math.max(1, Math.min(n, totalPages));
      const start      = (safePage - 1) * PAGE_SIZE;
      const slice      = all.slice(start, Math.min(start + PAGE_SIZE, all.length));

      const lines = slice.map((r, i) => {
        const status = isExpired(r.time_end) ? "❎ Hết hạn" : "✅ Còn hạn";
        return (
          `${start + i + 1}. ${r.thread_id}\n` +
          `   👤 Owner: ${r.owner_id}\n` +
          `   ${status} | ${r.time_start} → ${r.time_end}`
        );
      });

      const txt =
        `📋 DANH SÁCH THUÊ BOT [${safePage}/${totalPages}]\n` +
        `━━━━━━━━━━━━━━━━\n` +
        lines.join("\n\n") +
        `\n━━━━━━━━━━━━━━━━\n` +
        `Tổng: ${all.length} nhóm | Trang ${safePage}/${totalPages}\n` +
        `💡 Reply: <số thứ tự> xem chi tiết | del <stt> xóa | giahan <stt> [ngày] gia hạn | page <n> chuyển trang`;

      const sent = await send(txt);
      const msgId =
        sent?.message?.msgId ??
        (Array.isArray(sent?.attachment) ? sent.attachment[0]?.msgId : null);
      if (msgId && registerReply) {
        registerReply({
          messageId:   msgId,
          commandName: "rent",
          payload:     { case: "list", all, page: safePage, totalPages },
          ttl:         5 * 60 * 1000,
        });
      }
      return;
    }

    // ── del <stt> — xóa theo số thứ tự ──────────────────────────────────────
    if (action === "del") {
      const stt = parseInt(parts[1], 10);
      if (isNaN(stt) || stt < 1 || stt > all.length) {
        return send(`❌ Số thứ tự không hợp lệ. Nhập từ 1 đến ${all.length}.`);
      }
      const target = all[stt - 1];
      try {
        await deleteRent(target.thread_id);
        return send(`✅ Đã xóa thuê bot nhóm #${stt}:\n${target.thread_id}`);
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── giahan <stt> [ngày] — gia hạn theo số thứ tự ────────────────────────
    if (action === "giahan" || action === "extend") {
      const stt  = parseInt(parts[1], 10);
      const days = parseInt(parts[2], 10) || 30;
      if (isNaN(stt) || stt < 1 || stt > all.length) {
        return send(`❌ Số thứ tự không hợp lệ. Nhập từ 1 đến ${all.length}.`);
      }
      const target = all[stt - 1];
      try {
        const result = await extendRent(target.thread_id, days);
        if (!result) return send(`⚠️ Không tìm thấy nhóm ${target.thread_id} trong DB.`);
        return send(
          `✅ Đã gia hạn thêm ${days} ngày cho nhóm #${stt}.\n` +
          `🏘️ Thread: ${target.thread_id}\n` +
          `📅 Đến mới: ${result.time_end}`
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── <số thứ tự> — xem chi tiết ──────────────────────────────────────────
    const num = parseInt(action, 10);
    if (!isNaN(num)) {
      if (num < 1 || num > all.length) {
        return send(`❌ Số thứ tự không hợp lệ. Nhập từ 1 đến ${all.length}.`);
      }
      const r      = all[num - 1];
      const status = isExpired(r.time_end) ? "❎ Đã hết hạn" : "✅ Còn hạn";
      return send(
        `📋 Chi tiết #${num}:\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `🏘️ Thread: ${r.thread_id}\n` +
        `👤 Owner: ${r.owner_id}\n` +
        `📝 Tình trạng: ${status}\n` +
        `📅 Từ: ${r.time_start}\n` +
        `📅 Đến: ${r.time_end}`
      );
    }

    return send(
      `❓ Không hiểu lệnh.\n` +
      `💡 Reply: <số thứ tự> | del <stt> | giahan <stt> [ngày] | page <n>`
    );
  },
};

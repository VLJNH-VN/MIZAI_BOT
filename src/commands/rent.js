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

module.exports = {
  config: {
    name: "rent",
    version: "1.1.0",
    hasPermssion: 2,
    credits: "MiZai (port từ Niio-team)",
    description: "Quản lý thuê bot theo nhóm",
    commandCategory: "Quản Trị",
    usages: [
      "rent add [ngày] — Thêm / gia hạn thuê cho nhóm hiện tại (mặc định 30 ngày)",
      "rent del        — Xóa thông tin thuê của nhóm hiện tại",
      "rent list [trang] — Xem danh sách nhóm đã thuê (phân trang)",
      "rent reg [ngày] — Tạo key thuê bot với số ngày tương ứng",
      "rent info       — Xem thông tin thuê bot nhóm hiện tại",
      "rent key <key>  — Kích hoạt key thuê cho nhóm hiện tại",
    ].join("\n"),
    cooldowns: 3,
  },

  run: async ({ api, event, args, send, threadID, senderId }) => {
    const sub = (args[0] || "").toLowerCase().trim();

    if (!sub) {
      return send(
        `╔══ LỆNH RENT BOT ══╗\n` +
        `╚════════════════════╝\n` +
        `📋 Các lệnh con:\n` +
        `  rent add [ngày]    — Thêm / gia hạn thuê nhóm hiện tại\n` +
        `  rent del           — Xóa thông tin thuê nhóm hiện tại\n` +
        `  rent list [trang]  — Xem danh sách nhóm đã thuê\n` +
        `  rent reg [ngày]    — Tạo key thuê bot\n` +
        `  rent info          — Thông tin thuê nhóm hiện tại\n` +
        `  rent key <key>     — Kích hoạt key thuê`
      );
    }

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

    if (sub === "del") {
      try {
        const ok = await deleteRent(threadID);
        if (ok) {
          return send(`✅ Đã xóa thông tin thuê bot cho nhóm ${threadID}.`);
        } else {
          return send(`⚠️ Không tìm thấy thông tin thuê bot cho nhóm này.`);
        }
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    if (sub === "list") {
      try {
        const page = parseInt(args[1], 10) || 1;
        const all = await getAllRent();
        if (all.length === 0) return send("📋 Chưa có nhóm nào thuê bot.");

        const totalPages = Math.ceil(all.length / PAGE_SIZE);
        const start = (page - 1) * PAGE_SIZE;
        const end = Math.min(start + PAGE_SIZE, all.length);
        const slice = all.slice(start, end);

        const lines = slice.map((r, i) => {
          const status = isExpired(r.time_end) ? "❎ Hết hạn" : "✅ Còn hạn";
          return (
            `${start + i + 1}. Thread: ${r.thread_id}\n` +
            `   👤 Owner: ${r.owner_id}\n` +
            `   📝 ${status}\n` +
            `   📅 Từ: ${r.time_start} → ${r.time_end}`
          );
        });

        return send(
          `📋 DANH SÁCH THUÊ BOT [${page}/${totalPages}]\n` +
          `━━━━━━━━━━━━━━━━\n` +
          lines.join("\n\n") +
          `\n━━━━━━━━━━━━━━━━\n` +
          `Tổng: ${all.length} nhóm | Trang ${page}/${totalPages}`
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

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

    if (sub === "info") {
      try {
        const rentInfo = await getRent(threadID);
        if (!rentInfo) {
          return send(
            `📋 Thông tin thuê bot nhóm ${threadID}:\n` +
            `⚠️ Nhóm này chưa thuê bot.`
          );
        }
        const status = isExpired(rentInfo.time_end) ? "❎ Đã hết hạn" : "✅ Còn hạn";
        return send(
          `📋 Thông tin thuê bot:\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `🏘️ Nhóm: ${threadID}\n` +
          `👤 Owner: ${rentInfo.owner_id}\n` +
          `📝 Tình trạng: ${status}\n` +
          `📅 Từ: ${rentInfo.time_start}\n` +
          `📅 Đến: ${rentInfo.time_end}`
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    if (sub === "key") {
      const key = args[1] ? String(args[1]).trim() : "";
      if (!key) {
        return send(`❌ Thiếu key.\nDùng: rent key <key>`);
      }
      try {
        const result = await activateKey(key, threadID, senderId);
        if (!result.ok) {
          if (result.reason === "used") return send(`❎ Key "${key}" đã được sử dụng!`);
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

    if (sub === "extend" || sub === "giahan") {
      const targetThread = args[1] ? String(args[1]).trim() : threadID;
      const days = parseInt(args[2] || args[1], 10) || 30;
      const useCurrentThread = !args[1] || isNaN(parseInt(args[1]));
      const tid = useCurrentThread ? threadID : targetThread;
      const d = useCurrentThread ? (parseInt(args[1], 10) || 30) : days;
      try {
        const result = await extendRent(tid, d);
        if (!result) return send(`⚠️ Không tìm thấy thông tin thuê bot cho nhóm ${tid}.`);
        return send(
          `✅ Đã gia hạn thêm ${d} ngày cho nhóm ${tid}.\n` +
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
};

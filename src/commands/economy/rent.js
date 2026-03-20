const {
  getRent, getAllRent, getExpiringGroups, getStats,
  addRent, extendRent, setRentEnd, deleteRent,
  activateKey, generateKey, generateKeys,
  listKeys, deleteKey,
  isExpired, daysUntilExpiry, parseDate,
  clearRentCache,
} = require('../../../includes/database/rent');
const { isBotAdmin, isGroupAdmin } = require('../../../utils/bot/botManager');
const { readConfig, writeConfig, fmtMoney } = require('../../../utils/helpers');

// ── Pricing tiers ─────────────────────────────────────────────────────────────

const PRICE_TIERS = [
  { label: "Tuần",   days: 7,   price: 50_000 },
  { label: "Tháng",  days: 30,  price: 150_000 },
  { label: "Quý",    days: 90,  price: 400_000 },
  { label: "Năm",    days: 365, price: 1_200_000 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const PAGE_SIZE = 8;

function getBody(event) {
  const raw = event?.data ?? {};
  const c   = raw.content;
  if (typeof c === "string") return c.trim();
  if (c && typeof c === "object") return (c.text || c.msg || "").trim();
  return "";
}

function fmtDays(d) {
  if (d < 0)  return "❎ Hết hạn";
  if (d === 0) return "⚠️ Hết hạn HÔM NAY";
  if (d === 1) return "⚠️ Còn 1 ngày";
  if (d <= 3)  return `⚠️ Còn ${d} ngày`;
  return `✅ Còn ${d} ngày`;
}

function statusBadge(timeEnd) {
  const d = daysUntilExpiry(timeEnd);
  if (d < 0)   return "❎ Hết hạn";
  if (d <= 3)  return `⚠️ Sắp hết (${d}n)`;
  return "✅ Còn hạn";
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name: "rent",
    version: "2.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Hệ thống thuê bot theo nhóm — quản lý key, gia hạn, thống kê",
    commandCategory: "economy",
    usages: [
      "rent              — Xem menu lệnh",
      "rent check        — Kiểm tra trạng thái thuê nhóm hiện tại (tất cả)",
      "rent price        — Xem bảng giá thuê bot (tất cả)",
      "rent key <key>    — Kích hoạt key thuê (admin nhóm)",
      "── ADMIN BOT ─────────────────────────────────",
      "rent on/off       — Bật/tắt chế độ kiểm tra thuê",
      "rent add [ngày]   — Thêm/gia hạn thuê nhóm hiện tại",
      "rent del [id]     — Xóa thông tin thuê",
      "rent setend <id> <dd/mm/yyyy> — Đặt ngày hết hạn cụ thể",
      "rent giahan [id] [ngày] — Gia hạn thêm cho nhóm",
      "rent info [id]    — Xem chi tiết thuê nhóm",
      "rent list [trang] — Danh sách nhóm thuê",
      "rent stats        — Thống kê tổng quan",
      "rent notify [ngày] — Nhắc nhóm sắp hết hạn (mặc định 3 ngày)",
      "rent reg [ngày]   — Tạo 1 key thuê",
      "rent batch <ngày> <số lượng> — Tạo nhiều key cùng lúc",
      "rent listkey [unused|used] — Xem danh sách key",
      "rent delkey <key> — Xóa key khỏi hệ thống",
    ].join("\n"),
    cooldowns: 3,
  },

  run: async ({ api, event, args, send, threadID, senderId, isGroup, registerReply }) => {
    const sub     = (args[0] || "").toLowerCase().trim();
    const isAdmin = isBotAdmin(senderId);

    // ── Help ────────────────────────────────────────────────────────────────────
    if (!sub) {
      const cfg    = readConfig();
      const mode   = cfg.rentMode ? "🟢 BẬT" : "🔴 TẮT";
      const rentOk = await getRent(threadID).catch(() => null);
      const status = rentOk ? statusBadge(rentOk.time_end) : "⛔ Chưa thuê";

      return send(
        `╔══════════════════════╗\n` +
        `║     🤖 THUÊ BOT      ║\n` +
        `╠══════════════════════╣\n` +
        `║ Chế độ thuê: ${mode}   ║\n` +
        `║ Nhóm này  : ${status}\n` +
        `╠══════════════════════╣\n` +
        `║ 📋 Lệnh dùng được   ║\n` +
        `╚══════════════════════╝\n` +
        `🔍 rent check     — Kiểm tra trạng thái\n` +
        `💰 rent price     — Bảng giá thuê bot\n` +
        `🔑 rent key <key> — Kích hoạt key\n` +
        (isAdmin
          ? `\n👑 Admin:\n` +
            `  rent on/off | rent add | rent del\n` +
            `  rent stats  | rent list | rent reg\n` +
            `  rent batch  | rent listkey | rent notify\n` +
            `  rent setend | rent giahan | rent delkey`
          : "")
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  LỆNH MỞ (tất cả đều dùng được)
    // ═══════════════════════════════════════════════════════════════════════════

    // ── check ──────────────────────────────────────────────────────────────────
    if (sub === "check") {
      const tid = args[1] ? String(args[1]).trim() : threadID;
      try {
        const info = await getRent(tid);
        if (!info) {
          return send(
            `📋 Trạng thái thuê bot\n━━━━━━━━━━━━━━━━\n` +
            `🏘️ Nhóm: ${tid}\n` +
            `⛔ Chưa thuê bot\n\n` +
            `💡 Liên hệ admin để mua key hoặc xem bảng giá: rent price`
          );
        }
        const d    = daysUntilExpiry(info.time_end);
        const stat = fmtDays(d);
        return send(
          `📋 Trạng thái thuê bot\n━━━━━━━━━━━━━━━━\n` +
          `🏘️ Nhóm  : ${tid}\n` +
          `👤 Owner : ${info.owner_id}\n` +
          `📅 Bắt đầu: ${info.time_start}\n` +
          `📅 Hết hạn: ${info.time_end}\n` +
          `⏳ ${stat}`
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── price ──────────────────────────────────────────────────────────────────
    if (sub === "price") {
      const lines = PRICE_TIERS.map((t, i) =>
        `${i + 1}. 📦 Gói ${t.label.padEnd(6)} — ${t.days} ngày — ${fmtMoney(t.price, true)}`
      );
      return send(
        `╔══════════════════════╗\n` +
        `║   💰 BẢNG GIÁ THUÊ  ║\n` +
        `╚══════════════════════╝\n` +
        lines.join("\n") +
        `\n━━━━━━━━━━━━━━━━\n` +
        `💡 Liên hệ admin để mua key thuê bot.\n` +
        `🔑 Kích hoạt: rent key <key>`
      );
    }

    // ── key ────────────────────────────────────────────────────────────────────
    if (sub === "key") {
      const key = args[1] ? String(args[1]).trim() : "";
      if (!key) return send(`❌ Thiếu key.\nDùng: rent key <key>`);

      // Chỉ admin nhóm hoặc admin bot mới được kích hoạt key
      if (!isAdmin) {
        const gAdmin = isGroup
          ? await isGroupAdmin({ api, groupId: threadID, userId: senderId }).catch(() => false)
          : false;
        if (!gAdmin) return send("⛔ Chỉ Quản Trị Viên nhóm mới được kích hoạt key.");
      }

      try {
        const result = await activateKey(key, threadID, senderId);
        if (!result.ok) {
          if (result.reason === "used")    return send(`❎ Key "${key}" đã được sử dụng!`);
          if (result.reason === "invalid") return send(`❎ Key "${key}" không hợp lệ!`);
          return send(`❎ Key không hợp lệ.`);
        }
        clearRentCache(threadID);
        return send(
          result.isNew
            ? `✅ Kích hoạt thành công!\n📦 ${result.days} ngày\n📅 Từ : ${result.time_start}\n📅 Đến: ${result.time_end}`
            : `✅ Gia hạn thành công!\n📦 +${result.days} ngày\n📅 Đến mới: ${result.time_end}`
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  LỆNH ADMIN BOT
    // ═══════════════════════════════════════════════════════════════════════════

    if (!isAdmin) {
      return send(
        `⛔ Lệnh "${sub}" chỉ dành cho Admin bot.\n` +
        `💡 Dùng: rent check | rent price | rent key`
      );
    }

    // ── on / off ───────────────────────────────────────────────────────────────
    if (sub === "on" || sub === "off") {
      const enable = sub === "on";
      const cfg    = readConfig();
      cfg.rentMode = enable;
      writeConfig(cfg);
      global.config.rentMode = enable;
      clearRentCache();
      return send(
        enable
          ? `✅ Đã BẬT chế độ kiểm tra thuê.\n⚠️ Các nhóm chưa thuê sẽ bị chặn lệnh.`
          : `✅ Đã TẮT chế độ kiểm tra thuê.\n💡 Tất cả nhóm đều dùng được bot.`
      );
    }

    // ── add ────────────────────────────────────────────────────────────────────
    if (sub === "add") {
      const days = parseInt(args[1], 10) || 30;
      try {
        const result = await addRent(threadID, senderId, days);
        clearRentCache(threadID);
        return send(
          result.isNew
            ? `✅ Đã thêm thuê bot cho nhóm.\n📅 Từ : ${result.time_start}\n📅 Đến: ${result.time_end}\n⏳ ${days} ngày`
            : `✅ Đã gia hạn thuê bot.\n📅 Từ : ${result.time_start}\n📅 Đến mới: ${result.time_end}\n➕ Thêm ${days} ngày`
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── del ────────────────────────────────────────────────────────────────────
    if (sub === "del") {
      const tid = args[1] ? String(args[1]).trim() : threadID;
      try {
        const ok = await deleteRent(tid);
        clearRentCache(tid);
        return send(ok ? `✅ Đã xóa thuê bot cho nhóm:\n${tid}` : `⚠️ Không tìm thấy nhóm ${tid}.`);
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── setend ─────────────────────────────────────────────────────────────────
    if (sub === "setend") {
      // rent setend [threadID] dd/mm/yyyy
      let tid, dateStr;
      if (args.length >= 3) {
        tid     = String(args[1]).trim();
        dateStr = String(args[2]).trim();
      } else {
        tid     = threadID;
        dateStr = String(args[1] || "").trim();
      }
      if (!dateStr || !parseDate(dateStr)) {
        return send(`❌ Ngày không hợp lệ.\nDùng: rent setend [threadID] dd/mm/yyyy`);
      }
      try {
        await setRentEnd(tid, dateStr);
        clearRentCache(tid);
        return send(`✅ Đã đặt hạn thuê nhóm ${tid}\n📅 Đến: ${dateStr}`);
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── giahan / extend ────────────────────────────────────────────────────────
    if (sub === "giahan" || sub === "extend") {
      const arg1      = args[1] ? String(args[1]).trim() : "";
      const arg2      = args[2] ? parseInt(args[2], 10) : NaN;
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
        if (!result) return send(`⚠️ Không tìm thấy nhóm ${tid}.`);
        clearRentCache(tid);
        return send(`✅ Đã gia hạn thêm ${days} ngày cho:\n🏘️ ${tid}\n📅 Đến mới: ${result.time_end}`);
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── info ───────────────────────────────────────────────────────────────────
    if (sub === "info") {
      const tid = args[1] ? String(args[1]).trim() : threadID;
      try {
        const info = await getRent(tid);
        if (!info) return send(`⚠️ Nhóm ${tid} chưa thuê bot.`);
        const d = daysUntilExpiry(info.time_end);
        return send(
          `📋 Chi tiết thuê bot\n━━━━━━━━━━━━━━━━\n` +
          `🏘️ Nhóm  : ${tid}\n` +
          `👤 Owner : ${info.owner_id}\n` +
          `📅 Bắt đầu: ${info.time_start}\n` +
          `📅 Hết hạn: ${info.time_end}\n` +
          `⏳ ${fmtDays(d)}`
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── list ───────────────────────────────────────────────────────────────────
    if (sub === "list") {
      try {
        const page = parseInt(args[1], 10) || 1;
        const all  = await getAllRent();
        if (all.length === 0) return send("📋 Chưa có nhóm nào thuê bot.");

        const totalPages = Math.ceil(all.length / PAGE_SIZE);
        const safePage   = Math.max(1, Math.min(page, totalPages));
        const start      = (safePage - 1) * PAGE_SIZE;
        const slice      = all.slice(start, start + PAGE_SIZE);

        const lines = slice.map((r, i) => {
          const d = daysUntilExpiry(r.time_end);
          return `${start + i + 1}. ${r.thread_id}\n   ${statusBadge(r.time_end)} | ${r.time_end}`;
        });

        const txt =
          `📋 DANH SÁCH THUÊ BOT [${safePage}/${totalPages}]\n` +
          `━━━━━━━━━━━━━━━━\n` +
          lines.join("\n") +
          `\n━━━━━━━━━━━━━━━━\n` +
          `Tổng: ${all.length} nhóm\n` +
          `💡 Reply: <stt> chi tiết | del <stt> | giahan <stt> [ngày] | page <n>`;

        const sent  = await send(txt);
        const msgId = sent?.message?.msgId ?? (Array.isArray(sent?.attachment) ? sent.attachment[0]?.msgId : null);
        if (msgId && registerReply) {
          registerReply({ messageId: msgId, commandName: "rent", payload: { case: "list", all, page: safePage, totalPages }, ttl: 5 * 60 * 1000 });
        }
        return;
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── stats ──────────────────────────────────────────────────────────────────
    if (sub === "stats") {
      try {
        const s = await getStats();
        return send(
          `📊 THỐNG KÊ THUÊ BOT\n━━━━━━━━━━━━━━━━\n` +
          `🏘️ Tổng nhóm   : ${s.total}\n` +
          `✅ Còn hạn     : ${s.active}\n` +
          `❎ Hết hạn     : ${s.expired}\n` +
          `⚠️ Sắp hết (≤3n): ${s.expiringSoon}\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `🔑 Key chưa dùng: ${s.unusedKeys}\n` +
          `🔓 Key đã dùng  : ${s.usedKeys}`
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── notify ─────────────────────────────────────────────────────────────────
    if (sub === "notify") {
      const withinDays = parseInt(args[1], 10) || 3;
      try {
        const expiring = await getExpiringGroups(withinDays);
        if (expiring.length === 0) {
          return send(`✅ Không có nhóm nào sắp hết hạn trong ${withinDays} ngày tới.`);
        }
        let sent = 0, fail = 0;
        for (const r of expiring) {
          const d = daysUntilExpiry(r.time_end);
          const msg =
            `⚠️ Thông báo: Bot sắp hết hạn!\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `📅 Hết hạn: ${r.time_end}\n` +
            `⏳ ${fmtDays(d)}\n` +
            `💡 Liên hệ admin để gia hạn.`;
          try {
            const { ThreadType } = require("zca-js");
            await api.sendMessage({ msg }, r.thread_id, ThreadType.Group);
            sent++;
            await new Promise(res => setTimeout(res, 500));
          } catch { fail++; }
        }
        return send(
          `✅ Đã thông báo ${sent}/${expiring.length} nhóm sắp hết hạn.\n` +
          (fail ? `⚠️ Lỗi: ${fail} nhóm.` : "")
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── reg ────────────────────────────────────────────────────────────────────
    if (sub === "reg") {
      try {
        const days   = parseInt(args[1], 10) || 30;
        const cfg    = readConfig();
        const prefix = cfg.keyRent || "MiZai";
        const key    = generateKey(prefix, days);
        return send(
          `🔑 Key thuê bot (${days} ngày):\n` +
          `┌────────────────────┐\n` +
          `  ${key}\n` +
          `└────────────────────┘\n` +
          `💡 Kích hoạt: rent key ${key}`
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── batch ──────────────────────────────────────────────────────────────────
    if (sub === "batch") {
      const days  = parseInt(args[1], 10) || 30;
      const count = Math.min(parseInt(args[2], 10) || 5, 50);
      if (isNaN(days) || days < 1) return send("❌ Số ngày không hợp lệ.");
      try {
        const cfg    = readConfig();
        const prefix = cfg.keyRent || "MiZai";
        const keys   = generateKeys(prefix, days, count);
        const lines  = keys.map((k, i) => `${i + 1}. ${k}`).join("\n");
        return send(
          `🔑 Đã tạo ${count} key (${days} ngày):\n━━━━━━━━━━━━━━━━\n${lines}`
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── listkey ────────────────────────────────────────────────────────────────
    if (sub === "listkey") {
      const type = (args[1] || "unused").toLowerCase();
      if (!["unused", "used", "all"].includes(type)) {
        return send("❌ Dùng: rent listkey [unused|used|all]");
      }
      try {
        const data = listKeys(type);
        if (type === "all") {
          const { unused, used } = data;
          return send(
            `🔑 KEY THUÊ BOT\n━━━━━━━━━━━━━━━━\n` +
            `📦 Chưa dùng (${unused.length}):\n` +
            (unused.length ? unused.map((k, i) => `${i + 1}. ${k}`).join("\n") : "  (trống)") +
            `\n\n🔓 Đã dùng (${used.length}):\n` +
            (used.length ? used.slice(-10).map((k, i) => `${i + 1}. ${k}`).join("\n") + (used.length > 10 ? `\n  ... và ${used.length - 10} key khác` : "") : "  (trống)")
          );
        }
        const arr = data;
        if (arr.length === 0) return send(`📦 Không có key ${type === "unused" ? "chưa dùng" : "đã dùng"}.`);
        const label = type === "unused" ? "Chưa dùng" : "Đã dùng";
        return send(
          `🔑 Key ${label} (${arr.length}):\n━━━━━━━━━━━━━━━━\n` +
          arr.map((k, i) => `${i + 1}. ${k}`).join("\n")
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    // ── delkey ─────────────────────────────────────────────────────────────────
    if (sub === "delkey") {
      const key = args[1] ? String(args[1]).trim() : "";
      if (!key) return send("❌ Thiếu key.\nDùng: rent delkey <key>");
      try {
        const ok = deleteKey(key);
        return send(ok ? `✅ Đã xóa key:\n${key}` : `⚠️ Không tìm thấy key: ${key}`);
      } catch (err) {
        return send(`❌ Lỗi: ${err.message}`);
      }
    }

    return send(
      `❌ Lệnh con không hợp lệ: "${args[0]}"\n💡 Gõ: rent để xem hướng dẫn.`
    );
  },

  // ── onReply: tương tác với danh sách ─────────────────────────────────────────
  onReply: async ({ api, event, data: replyData, send, registerReply }) => {
    const body = getBody(event);
    if (!body) return;

    const { case: $case, all = [], page = 1, totalPages = 1 } = replyData || {};
    if ($case !== "list") return;

    const parts  = body.trim().split(/\s+/);
    const action = parts[0].toLowerCase();

    // page <n>
    if (action === "page") {
      const n        = parseInt(parts[1], 10) || 1;
      const safePage = Math.max(1, Math.min(n, totalPages));
      const start    = (safePage - 1) * PAGE_SIZE;
      const slice    = all.slice(start, start + PAGE_SIZE);
      const lines    = slice.map((r, i) => `${start + i + 1}. ${r.thread_id}\n   ${statusBadge(r.time_end)} | ${r.time_end}`);
      const txt      =
        `📋 DANH SÁCH THUÊ BOT [${safePage}/${totalPages}]\n━━━━━━━━━━━━━━━━\n` +
        lines.join("\n") +
        `\n━━━━━━━━━━━━━━━━\nTổng: ${all.length} nhóm\n💡 Reply: <stt> chi tiết | del <stt> | giahan <stt> [ngày] | page <n>`;
      const sent  = await send(txt);
      const msgId = sent?.message?.msgId ?? (Array.isArray(sent?.attachment) ? sent.attachment[0]?.msgId : null);
      if (msgId && registerReply) registerReply({ messageId: msgId, commandName: "rent", payload: { case: "list", all, page: safePage, totalPages }, ttl: 5 * 60 * 1000 });
      return;
    }

    // del <stt>
    if (action === "del") {
      const stt = parseInt(parts[1], 10);
      if (isNaN(stt) || stt < 1 || stt > all.length) return send(`❌ STT không hợp lệ (1–${all.length}).`);
      const target = all[stt - 1];
      try {
        await deleteRent(target.thread_id);
        clearRentCache(target.thread_id);
        return send(`✅ Đã xóa thuê bot nhóm #${stt}:\n${target.thread_id}`);
      } catch (err) { return send(`❌ Lỗi: ${err.message}`); }
    }

    // giahan <stt> [ngày]
    if (action === "giahan" || action === "extend") {
      const stt  = parseInt(parts[1], 10);
      const days = parseInt(parts[2], 10) || 30;
      if (isNaN(stt) || stt < 1 || stt > all.length) return send(`❌ STT không hợp lệ (1–${all.length}).`);
      const target = all[stt - 1];
      try {
        const result = await extendRent(target.thread_id, days);
        if (!result) return send(`⚠️ Không tìm thấy nhóm ${target.thread_id}.`);
        clearRentCache(target.thread_id);
        return send(`✅ Gia hạn thêm ${days} ngày cho #${stt}.\n🏘️ ${target.thread_id}\n📅 Đến: ${result.time_end}`);
      } catch (err) { return send(`❌ Lỗi: ${err.message}`); }
    }

    // <số> — chi tiết
    const num = parseInt(action, 10);
    if (!isNaN(num)) {
      if (num < 1 || num > all.length) return send(`❌ STT không hợp lệ (1–${all.length}).`);
      const r = all[num - 1];
      const d = daysUntilExpiry(r.time_end);
      return send(
        `📋 Chi tiết #${num}\n━━━━━━━━━━━━━━━━\n` +
        `🏘️ ${r.thread_id}\n` +
        `👤 Owner: ${r.owner_id}\n` +
        `📅 Bắt đầu: ${r.time_start}\n` +
        `📅 Hết hạn: ${r.time_end}\n` +
        `⏳ ${fmtDays(d)}`
      );
    }

    return send(`❓ Không hiểu.\n💡 Reply: <stt> | del <stt> | giahan <stt> [ngày] | page <n>`);
  },
};

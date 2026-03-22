const { readConfig } = require("../../utils/media/helpers");
const {
  getRentInfo, setRentInfo, removeRentInfo, listRentInfo,
  addKey, useKey, isKeyUsed, isKeyExists, listUnusedKeys,
  isRentExpired, parseDateVN, addDays, todayStr,
} = require("../../includes/database/rent");

function genKey(days) {
  const cfg    = readConfig();
  const prefix = cfg.keyRent || "MiZai";
  const suffix = Math.random().toString(36).substring(2, 9);
  return `${prefix}_${days}_${suffix}`;
}

function isAfter(a, b) {
  return parseDateVN(a).getTime() > parseDateVN(b).getTime();
}

function isExpired(dateStr) {
  return parseDateVN(dateStr).getTime() <= Date.now() + 7 * 3600 * 1000;
}

module.exports = {
  config: {
    name: "rent",
    version: "2.0.0",
    hasPermssion: 2,
    credits: "convert từ Niio-team (Vtuan)",
    description: "Quản lý thuê bot theo nhóm",
    commandCategory: "Quản Trị",
    usages: [
      "rent add|del|info [ngày]        — Thêm/xoá/xem thuê bot nhóm (mặc định 30 ngày)",
      "rent list [trang] | reg [ngày]  — Danh sách nhóm / tạo key thuê bot",
      "rent usekey <key>               — Kích hoạt key thuê bot",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ api, event, args, send, prefix, threadID, senderId, registerReply }) => {
    const FLAG_MAP = { "-a": "add", "-d": "del", "-l": "list", "-r": "reg", "-i": "info", "-k": "usekey" };
    const sub      = FLAG_MAP[args[0]] || (args[0] || "").toLowerCase().trim();

    // ── rent add ──────────────────────────────────────────────────────────────
    if (sub === "add") {
      const days  = parseInt(args[1], 10) || 30;
      const today = todayStr();
      const found = getRentInfo(threadID);

      if (!found) {
        const endDate = addDays(today, days);
        setRentInfo(threadID, { owner_id: senderId, time_start: today, time_end: endDate });
        return send(
          `✅ Đã thêm thuê bot cho nhóm ${threadID}\n` +
          `📅 Từ: ${today}\n` +
          `📅 Đến: ${endDate}`
        );
      }

      const newEnd = addDays(found.time_end, days);
      if (!isAfter(newEnd, found.time_start)) {
        return send(`❌ Ngày kết thúc không thể trước ngày bắt đầu (${found.time_start}).`);
      }
      setRentInfo(threadID, { ...found, time_end: newEnd });
      return send(
        `✅ Nhóm ${threadID} đã thuê trước đó.\n` +
        `📅 Thời hạn mới kéo dài đến: ${newEnd}`
      );
    }

    // ── rent del ──────────────────────────────────────────────────────────────
    if (sub === "del") {
      if (!getRentInfo(threadID)) return send(`❌ Không tìm thấy thông tin thuê bot cho nhóm ${threadID}.`);
      removeRentInfo(threadID);
      return send(`✅ Đã xóa thông tin thuê bot cho nhóm ${threadID}.`);
    }

    // ── rent list ─────────────────────────────────────────────────────────────
    if (sub === "list") {
      const data = listRentInfo();
      if (!data.length) return send("📭 Chưa có nhóm nào thuê bot.");

      const page    = parseInt(args[1], 10) || 1;
      const perPage = 10;
      const total   = Math.ceil(data.length / perPage);
      const start   = (page - 1) * perPage;
      const slice   = data.slice(start, start + perPage);

      const lines = slice.map((item, i) => {
        const status = isExpired(item.time_end) ? "Đã Hết Hạn ❎" : "Chưa Hết Hạn ✅";
        return (
          `${start + i + 1}. Nhóm: ${item.group_id}\n` +
          `   👤 ID: ${item.owner_id}\n` +
          `   📝 Trạng thái: ${status}\n` +
          `   📅 Từ: ${item.time_start} → Đến: ${item.time_end}`
        );
      });

      const msg =
        `📋 DANH SÁCH THUÊ BOT [Trang ${page}/${total}]\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        lines.join("\n\n") +
        `\n━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 Reply "giahan <stt> [ngày]" để gia hạn\n` +
        `💡 Reply "del <stt>" để xóa\n` +
        `💡 Reply "out <stt>" để thoát nhóm`;

      const sentMsg = await api.sendMessage({ msg }, threadID, event.type);
      const msgId   = sentMsg?.msgId || sentMsg?.messageId || sentMsg?.cliMsgId;
      if (msgId && registerReply) {
        registerReply({ messageId: String(msgId), commandName: "rent", payload: { type: "list", data: slice, page, total } });
      }
      return;
    }

    // ── rent reg ──────────────────────────────────────────────────────────────
    if (sub === "reg") {
      const days    = parseInt(args[1], 10) || 30;
      const unused  = listUnusedKeys();
      let key       = genKey(days);
      while (isKeyExists(key)) key = genKey(days);
      addKey(key, days);
      return send(
        `🔑 Key thuê bot (${days} ngày):\n` +
        `${key}\n\n` +
        `💡 Nhóm cần thuê bot reply tin nhắn kích hoạt và nhập key trên.`
      );
    }

    // ── rent info ─────────────────────────────────────────────────────────────
    if (sub === "info") {
      const rentInfo = getRentInfo(threadID);
      if (!rentInfo) {
        return send(`ℹ️ Thông tin thuê bot:\n🌾 Nhóm: ${threadID}\n📝 Trạng thái: Chưa thuê bot`);
      }
      const status = isExpired(rentInfo.time_end) ? "Đã Hết Hạn ❎" : "Chưa Hết Hạn ✅";
      return send(
        `ℹ️ Thông tin thuê bot:\n` +
        `🌾 Nhóm: ${threadID}\n` +
        `👤 Người thuê (ID): ${rentInfo.owner_id}\n` +
        `📅 Từ: ${rentInfo.time_start}\n` +
        `📅 Đến: ${rentInfo.time_end}\n` +
        `📝 Trạng thái: ${status}`
      );
    }

    // ── rent usekey ───────────────────────────────────────────────────────────
    if (sub === "usekey") {
      const key = args[1] ? args[1].trim() : "";
      if (!key) return send(`❌ Thiếu key.\nDùng: ${prefix}rent usekey <key>`);
      return _activateKey({ key, threadID, senderId, send });
    }

    return send(
      `📋 Các lệnh con:\n` +
      `  ${prefix}rent add [ngày]   — Thêm / gia hạn (mặc định 30)\n` +
      `  ${prefix}rent del          — Xóa thuê bot nhóm này\n` +
      `  ${prefix}rent list [trang] — Danh sách thuê bot\n` +
      `  ${prefix}rent reg [ngày]   — Tạo key thuê (mặc định 30)\n` +
      `  ${prefix}rent info         — Thông tin thuê nhóm này\n` +
      `  ${prefix}rent usekey <key> — Kích hoạt key cho nhóm này`
    );
  },

  onReply: async ({ api, event, data: replyData, send, registerReply }) => {
    if (!replyData) return;
    const raw      = event?.data;
    const body     = (raw?.content || raw?.msg || "").trim();
    const threadID = event.threadId;
    const senderId = raw?.uidFrom ? String(raw.uidFrom) : String(event.senderId || "");

    if (replyData.type === "RentKey") {
      const key = body.trim();
      if (!key) return send("❌ Vui lòng nhập key thuê bot.");
      return _activateKey({ key, threadID, senderId, send });
    }

    if (replyData.type === "list") {
      const parts    = body.split(/\s+/);
      const cmd      = (parts[0] || "").toLowerCase();
      const stt      = parseInt(parts[1], 10);
      const { data: listSlice } = replyData;

      if (cmd === "giahan") {
        if (!stt || stt < 1 || stt > listSlice.length) return send(`❌ STT không hợp lệ (1–${listSlice.length}).`);
        const days   = parseInt(parts[2], 10) || 30;
        const target = listSlice[stt - 1];
        const rec    = getRentInfo(target.group_id);
        if (!rec) return send("❌ Không tìm thấy nhóm trong dữ liệu.");
        const newEnd = addDays(rec.time_end, days);
        if (!isAfter(newEnd, rec.time_start)) return send(`❌ Ngày kết thúc không thể trước ngày bắt đầu (${rec.time_start}).`);
        setRentInfo(target.group_id, { ...rec, time_end: newEnd });
        return send(`✅ Đã gia hạn nhóm ${rec.group_id} đến: ${newEnd}`);
      }

      if (cmd === "del") {
        if (!stt || stt < 1 || stt > listSlice.length) return send(`❌ STT không hợp lệ (1–${listSlice.length}).`);
        const target = listSlice[stt - 1];
        removeRentInfo(target.group_id);
        return send(`✅ Đã xóa thông tin thuê bot nhóm ${target.group_id}.`);
      }

      if (cmd === "out") {
        const stts = parts.slice(1).map(Number).filter(n => n >= 1 && n <= listSlice.length);
        if (!stts.length) return send("❌ Không có STT hợp lệ.");
        for (const n of stts) {
          try { await api.leaveGroup(listSlice[n - 1].group_id); } catch {}
        }
        return send(`✅ Đã thoát ${stts.length} nhóm theo yêu cầu.`);
      }

      return send(`❓ Không hiểu lệnh reply.\n💡 Các lệnh hợp lệ:\n  giahan <stt> [ngày]\n  del <stt>\n  out <stt>`);
    }
  },
};

async function _activateKey({ key, threadID, senderId, send }) {
  if (isKeyUsed(key))    return send(`❎ Key "${key}" đã được sử dụng rồi!`);
  if (!isKeyExists(key)) return send(`❎ Key "${key}" không tồn tại!`);

  const parts = key.split("_");
  const days  = parseInt(parts[parts.length - 2], 10);
  if (!days || isNaN(days)) return send("❎ Key không hợp lệ (không lấy được số ngày).");

  const today    = todayStr();
  const existing = getRentInfo(threadID);
  let endDate;

  if (existing) {
    const base = isExpired(existing.time_end) ? today : existing.time_end;
    endDate    = addDays(base, days);
    setRentInfo(threadID, { ...existing, time_end: endDate });
    await send(`✅ Gia hạn thuê bot thành công!\n📅 Thời hạn mới đến: ${endDate}`);
  } else {
    endDate = addDays(today, days);
    setRentInfo(threadID, { owner_id: senderId, time_start: today, time_end: endDate });
    await send(`✅ Kích hoạt thuê bot thành công!\n📅 Từ: ${today}\n📅 Đến: ${endDate}`);
  }

  useKey(key);
}

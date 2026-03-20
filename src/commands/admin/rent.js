const fs = require("fs");
const path = require("path");
const { readConfig, readJsonFile, writeJsonFile } = require("../../../utils/helpers");

const THUEBOT_PATH = path.join(__dirname, "../../../includes/data/thuebot.json");
const RENTKEY_PATH = path.join(__dirname, "../../../includes/data/rentKey.json");

// ── Helpers ngày tháng ────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date(Date.now() + 7 * 3600 * 1000); // UTC+7
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function parseDate(str) {
  const [dd, mm, yyyy] = str.split("/").map(Number);
  return new Date(Date.UTC(yyyy, mm - 1, dd));
}

function addDays(dateStr, days) {
  const d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function isExpired(dateStr) {
  return parseDate(dateStr).getTime() <= Date.now() + 7 * 3600 * 1000;
}

function isAfter(a, b) {
  return parseDate(a).getTime() > parseDate(b).getTime();
}

// ── Đọc / lưu dữ liệu ─────────────────────────────────────────────────────────

function readThuebot() {
  return readJsonFile(THUEBOT_PATH, []);
}

function saveThuebot(data) {
  writeJsonFile(THUEBOT_PATH, data);
}

function readRentKey() {
  const def = { used_keys: [], unUsed_keys: [] };
  if (!fs.existsSync(RENTKEY_PATH)) {
    writeJsonFile(RENTKEY_PATH, def);
    return def;
  }
  return readJsonFile(RENTKEY_PATH, def);
}

function saveRentKey(data) {
  writeJsonFile(RENTKEY_PATH, data);
}

// ── Tạo key ngẫu nhiên ────────────────────────────────────────────────────────

function genKey(days) {
  const cfg = readConfig();
  const prefix = cfg.keyRent || "MiZai";
  const suffix = Math.random().toString(36).substring(2, 9);
  return `${prefix}_${days}_${suffix}`;
}

// ── Module export ─────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name: "rent",
    version: "1.0.0",
    hasPermssion: 2,
    credits: "convert từ Niio-team (Vtuan)",
    description: "Quản lý thuê bot theo nhóm",
    commandCategory: "Quản Trị",
    usages: [
      "rent add [số ngày]  — Thêm / gia hạn thuê bot cho nhóm hiện tại (mặc định 30 ngày)",
      "rent del            — Xóa thông tin thuê bot của nhóm hiện tại",
      "rent list [trang]   — Danh sách các nhóm đã thuê bot",
      "rent reg [số ngày]  — Tạo key thuê bot (mặc định 30 ngày)",
      "rent info           — Thông tin thuê bot của nhóm hiện tại",
      "rent usekey <key>   — Kích hoạt key thuê bot cho nhóm hiện tại",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ api, event, args, send, prefix, threadID, senderId, registerReply }) => {
    const sub = (args[0] || "").toLowerCase().trim();
    let data = readThuebot();

    // ── rent add ──────────────────────────────────────────────────────────────
    if (sub === "add") {
      const days = parseInt(args[1], 10) || 30;
      const today = todayStr();
      const found = data.find(item => item.t_id === threadID);

      if (!found) {
        const endDate = addDays(today, days);
        data.push({ t_id: threadID, id: senderId, time_start: today, time_end: endDate });
        saveThuebot(data);
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
      found.time_end = newEnd;
      saveThuebot(data);
      return send(
        `✅ Nhóm ${threadID} đã thuê trước đó.\n` +
        `📅 Thời hạn mới kéo dài đến: ${newEnd}`
      );
    }

    // ── rent del ──────────────────────────────────────────────────────────────
    if (sub === "del") {
      const idx = data.findIndex(item => item.t_id === threadID);
      if (idx === -1) {
        return send(`❌ Không tìm thấy thông tin thuê bot cho nhóm ${threadID}.`);
      }
      data.splice(idx, 1);
      saveThuebot(data);
      return send(`✅ Đã xóa thông tin thuê bot cho nhóm ${threadID}.`);
    }

    // ── rent list ─────────────────────────────────────────────────────────────
    if (sub === "list") {
      if (data.length === 0) return send("📭 Chưa có nhóm nào thuê bot.");
      const page = parseInt(args[1], 10) || 1;
      const perPage = 10;
      const total = Math.ceil(data.length / perPage);
      const start = (page - 1) * perPage;
      const slice = data.slice(start, start + perPage);

      const lines = slice.map((item, i) => {
        const status = isExpired(item.time_end) ? "Đã Hết Hạn ❎" : "Chưa Hết Hạn ✅";
        return (
          `${start + i + 1}. Nhóm: ${item.t_id}\n` +
          `   👤 ID: ${item.id}\n` +
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
      const msgId = sentMsg?.msgId || sentMsg?.messageId || sentMsg?.cliMsgId;
      if (msgId && registerReply) {
        registerReply({
          messageId: String(msgId),
          commandName: "rent",
          payload: { type: "list", data: slice, page, total }
        });
      }
      return;
    }

    // ── rent reg ──────────────────────────────────────────────────────────────
    if (sub === "reg") {
      const days = parseInt(args[1], 10) || 30;
      const keyData = readRentKey();
      let key = genKey(days);
      while (keyData.used_keys.includes(key)) key = genKey(days);
      keyData.unUsed_keys.push(key);
      saveRentKey(keyData);
      return send(
        `🔑 Key thuê bot (${days} ngày):\n` +
        `${key}\n\n` +
        `💡 Nhóm cần thuê bot reply tin nhắn kích hoạt và nhập key trên.`
      );
    }

    // ── rent info ─────────────────────────────────────────────────────────────
    if (sub === "info") {
      const rentInfo = data.find(item => item.t_id === threadID);
      if (!rentInfo) {
        return send(
          `ℹ️ Thông tin thuê bot:\n` +
          `🌾 Nhóm: ${threadID}\n` +
          `📝 Trạng thái: Chưa thuê bot`
        );
      }
      const status = isExpired(rentInfo.time_end) ? "Đã Hết Hạn ❎" : "Chưa Hết Hạn ✅";
      return send(
        `ℹ️ Thông tin thuê bot:\n` +
        `🌾 Nhóm: ${threadID}\n` +
        `👤 Người thuê (ID): ${rentInfo.id}\n` +
        `📅 Từ: ${rentInfo.time_start}\n` +
        `📅 Đến: ${rentInfo.time_end}\n` +
        `📝 Trạng thái: ${status}`
      );
    }

    // ── rent usekey ───────────────────────────────────────────────────────────
    if (sub === "usekey") {
      const key = args[1] ? args[1].trim() : "";
      if (!key) return send(`❌ Thiếu key.\nDùng: ${prefix}rent usekey <key>`);
      return _activateKey({ key, threadID, senderId, data, send });
    }

    // ── Hướng dẫn sử dụng ────────────────────────────────────────────────────
    return send(
      `╔══ LỆNH RENT ══╗\n` +
      `  ${prefix}rent\n` +
      `╚═══════════════╝\n` +
      `📋 Các lệnh con:\n` +
      `  ${prefix}rent add [ngày]   — Thêm / gia hạn (mặc định 30)\n` +
      `  ${prefix}rent del          — Xóa thuê bot nhóm này\n` +
      `  ${prefix}rent list [trang] — Danh sách thuê bot\n` +
      `  ${prefix}rent reg [ngày]   — Tạo key thuê (mặc định 30)\n` +
      `  ${prefix}rent info         — Thông tin thuê nhóm này\n` +
      `  ${prefix}rent usekey <key> — Kích hoạt key cho nhóm này`
    );
  },

  // ── onReply: xử lý khi user reply vào danh sách ──────────────────────────
  onReply: async ({ api, event, data: replyData, send, registerReply }) => {
    if (!replyData || replyData.type !== "list") return;

    const raw = event?.data;
    const body = (raw?.content || raw?.msg || "").trim();
    const parts = body.split(/\s+/);
    const cmd = (parts[0] || "").toLowerCase();
    const stt = parseInt(parts[1], 10);
    const threadID = event.threadId;

    const { data: listSlice } = replyData;

    if (cmd === "giahan") {
      if (!stt || stt < 1 || stt > listSlice.length) {
        return send(`❌ STT không hợp lệ (1–${listSlice.length}).`);
      }
      const days = parseInt(parts[2], 10) || 30;
      const allData = readThuebot();
      const target = listSlice[stt - 1];
      const rec = allData.find(item => item.t_id === target.t_id);
      if (!rec) return send("❌ Không tìm thấy nhóm trong dữ liệu.");
      const newEnd = addDays(rec.time_end, days);
      if (!isAfter(newEnd, rec.time_start)) {
        return send(`❌ Ngày kết thúc không thể trước ngày bắt đầu (${rec.time_start}).`);
      }
      rec.time_end = newEnd;
      saveThuebot(allData);
      return send(`✅ Đã gia hạn nhóm ${rec.t_id} đến: ${newEnd}`);
    }

    if (cmd === "del") {
      if (!stt || stt < 1 || stt > listSlice.length) {
        return send(`❌ STT không hợp lệ (1–${listSlice.length}).`);
      }
      const target = listSlice[stt - 1];
      const allData = readThuebot();
      const idx = allData.findIndex(item => item.t_id === target.t_id);
      if (idx === -1) return send("❌ Không tìm thấy nhóm trong dữ liệu.");
      allData.splice(idx, 1);
      saveThuebot(allData);
      return send(`✅ Đã xóa thông tin thuê bot nhóm ${target.t_id}.`);
    }

    if (cmd === "out") {
      const stts = parts.slice(1).map(Number).filter(n => n >= 1 && n <= listSlice.length);
      if (stts.length === 0) return send("❌ Không có STT hợp lệ.");
      for (const n of stts) {
        const target = listSlice[n - 1];
        try {
          await api.removeGroupMember(api.getSelfInfo?.()?.uid || "", target.t_id);
        } catch {}
      }
      return send(`✅ Đã thoát ${stts.length} nhóm theo yêu cầu.`);
    }

    return send(
      `❓ Không hiểu lệnh reply.\n` +
      `💡 Các lệnh hợp lệ:\n` +
      `  giahan <stt> [ngày]\n` +
      `  del <stt>\n` +
      `  out <stt>`
    );
  },
};

// ── Kích hoạt key (dùng chung cho usekey và các nơi khác) ────────────────────
async function _activateKey({ key, threadID, senderId, data, send }) {
  const keyData = readRentKey();

  if (keyData.used_keys.includes(key)) {
    return send(`❎ Key "${key}" đã được sử dụng rồi!`);
  }
  if (!keyData.unUsed_keys.includes(key)) {
    return send(`❎ Key "${key}" không tồn tại!`);
  }

  const parts = key.split("_");
  const days = parseInt(parts[parts.length - 2], 10);
  if (!days || isNaN(days)) {
    return send("❎ Key không hợp lệ (không lấy được số ngày).");
  }

  const today = todayStr();
  const existing = data.findIndex(item => item.t_id === threadID);
  let endDate;

  if (existing !== -1) {
    const base = isExpired(data[existing].time_end) ? today : data[existing].time_end;
    endDate = addDays(base, days);
    data[existing].time_end = endDate;
    await send(`✅ Gia hạn thuê bot thành công!\n📅 Thời hạn mới đến: ${endDate}`);
  } else {
    endDate = addDays(today, days);
    data.push({ t_id: threadID, id: senderId, time_start: today, time_end: endDate });
    await send(
      `✅ Kích hoạt thuê bot thành công!\n` +
      `📅 Từ: ${today}\n` +
      `📅 Đến: ${endDate}`
    );
  }

  keyData.unUsed_keys = keyData.unUsed_keys.filter(k => k !== key);
  keyData.used_keys.push(key);
  saveRentKey(keyData);
  saveThuebot(data);
}

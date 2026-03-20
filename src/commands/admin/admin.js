const fs = require("fs");
const path = require("path");
const { ThreadType } = require("zca-js");

const CONFIG_PATH = path.join(__dirname, "../../config.json");
const GROUPS_CACHE_PATH = path.join(__dirname, "../../includes/database/groupsCache.json");

// ── Helpers đọc/ghi config ──────────────────────────────────────────────────
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")); }
  catch { return {}; }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
}

// ── Cache nhóm đã biết (dùng cho broadcast) ─────────────────────────────────
function readGroupsCache() {
  try { return JSON.parse(fs.readFileSync(GROUPS_CACHE_PATH, "utf-8")); }
  catch { return {}; }
}

function saveGroupsCache(data) {
  fs.writeFileSync(GROUPS_CACHE_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function trackGroup(threadID) {
  if (!threadID) return;
  const cache = readGroupsCache();
  if (!cache[threadID]) {
    cache[threadID] = { addedAt: Date.now() };
    saveGroupsCache(cache);
  }
}

// ── Lấy UID từ mention hoặc args ─────────────────────────────────────────────
function isNumericUid(uid) {
  return uid && /^\d{5,}$/.test(String(uid).trim());
}

function parseMentionIds(event) {
  const raw = event?.data;
  if (!raw) return [];

  // 1. raw.mentionInfo — JSON string: [{"uid":"123","length":8,"offset":0}]
  const mentionInfo = raw.mentionInfo;
  if (mentionInfo) {
    try {
      const arr = typeof mentionInfo === "string" ? JSON.parse(mentionInfo) : mentionInfo;
      if (Array.isArray(arr)) {
        const ids = arr.map(m => String(m.uid || m.id || "")).filter(uid => uid && uid !== "0");
        if (ids.length) return ids;
      }
    } catch {}
  }

  // 2. raw.mentions — array: [{"uid":"123","pos":0,"len":6,"type":0}]
  const mentions = raw.mentions;
  if (Array.isArray(mentions)) {
    const ids = mentions.map(m => String(m.uid || m.id || "")).filter(uid => uid && uid !== "0");
    if (ids.length) return ids;
  }
  // 2b. raw.mentions — object dạng { uid: name }
  if (mentions && typeof mentions === "object") {
    const ids = Object.keys(mentions).filter(k => k && k !== "0" && /^\d+$/.test(k));
    if (ids.length) return ids;
  }

  // 3. mentions nằm trong content JSON (một số phiên bản Zalo nhúng vào content)
  try {
    const c = raw.content;
    const parsed = typeof c === "string" ? JSON.parse(c) : c;
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.mentions)) {
        const ids = parsed.mentions.map(m => String(m.uid || m.id || "")).filter(uid => uid && uid !== "0");
        if (ids.length) return ids;
      }
      if (parsed.mentionInfo) {
        const arr = typeof parsed.mentionInfo === "string" ? JSON.parse(parsed.mentionInfo) : parsed.mentionInfo;
        if (Array.isArray(arr)) {
          const ids = arr.map(m => String(m.uid || "")).filter(uid => uid && uid !== "0");
          if (ids.length) return ids;
        }
      }
    }
  } catch {}

  return [];
}

function extractUid(args, event) {
  const ids = parseMentionIds(event);
  if (ids.length > 0) return ids[0];

  for (let i = 1; i < args.length; i++) {
    const candidate = String(args[i]).trim();
    if (isNumericUid(candidate)) return candidate;
  }
  return null;
}

// ── Format danh sách admin ────────────────────────────────────────────────────
function formatAdminList(cfg, prefix) {
  const owner = cfg.ownerId ? String(cfg.ownerId) : "(chưa đặt)";
  const admins = Array.isArray(cfg.adminBotIds) ? cfg.adminBotIds.map(String) : [];
  const filtered = admins.filter(id => id !== owner);

  let msg = `👑 DANH SÁCH ADMIN BOT\n━━━━━━━━━━━━━━━━\n`;
  msg += `🔱 Owner: ${owner}\n`;
  if (filtered.length > 0) {
    msg += `🛡️  Admin (${filtered.length}):\n`;
    filtered.forEach((id, i) => { msg += `  ${i + 1}. ${id}\n`; });
  } else {
    msg += `🛡️  Admin: (chưa có)\n`;
  }
  msg += `━━━━━━━━━━━━━━━━\n💡 ${prefix}admin add <uid> | ${prefix}admin remove <uid>`;
  return msg;
}

module.exports = {
  config: {
    name: "admin",
    version: "1.0.0",
    hasPermssion: 2,
    credits: "MiZai",
    description: "Quản lý admin bot và cài đặt hệ thống",
    commandCategory: "Quản Trị",
    usages: [
      "admin list                — Xem danh sách admin bot",
      "admin add <uid/@mention>  — Thêm admin bot",
      "admin remove <uid>        — Xoá admin bot",
      "admin setprefix <ký tự>  — Đổi prefix lệnh",
      "admin bc <nội dung>       — Broadcast tới tất cả nhóm đã biết",
      "admin kick <uid/@mention> — Kick thành viên khỏi nhóm hiện tại",
      "admin setname <tên>       — Đổi tên bot trong nhóm hiện tại",
      "admin info                — Xem thông tin hệ thống",
      "admin tang <@mention>     — Lấy ID của người được tag",
    ].join("\n"),
    cooldowns: 3,
  },

  run: async ({ api, event, args, send, prefix, threadID, senderId }) => {
    const sub = (args[0] || "").toLowerCase().trim();

    // Ghi nhận nhóm đang dùng (phục vụ broadcast)
    if (event.type === ThreadType.Group && threadID) {
      trackGroup(threadID);
    }

    // ── Không có sub-command → hướng dẫn ──────────────────────────────────
    if (!sub) {
      return send(
        `╔══ LỆNH ADMIN BOT ══╗\n` +
        `  ${prefix}admin\n` +
        `╚════════════════════╝\n` +
        `📋 Các lệnh con:\n` +
        `  ${prefix}admin list\n` +
        `  ${prefix}admin add <uid>\n` +
        `  ${prefix}admin remove <uid>\n` +
        `  ${prefix}admin setprefix <ký tự>\n` +
        `  ${prefix}admin bc <nội dung>\n` +
        `  ${prefix}admin kick <uid/@mention>\n` +
        `  ${prefix}admin setname <tên bot>\n` +
        `  ${prefix}admin info\n` +
        `  ${prefix}admin tang <@mention>`
      );
    }

    // ── admin list ─────────────────────────────────────────────────────────
    if (sub === "list") {
      const cfg = readConfig();
      return send(formatAdminList(cfg, prefix));
    }

    // ── admin add ─────────────────────────────────────────────────────────
    if (sub === "add") {
      const uid = extractUid(args, event);
      if (!uid) {
        return send(`❌ Không tìm thấy UID hợp lệ.\n💡 Dùng: ${prefix}admin add <uid số>\nVí dụ: ${prefix}admin add 123456789\n⚠️ Tag @tên có thể không lấy được UID — hãy dùng lệnh ${prefix}id hoặc ${prefix}admin tang @tên để lấy UID trước.`);
      }

      const cfg = readConfig();
      const owner = String(cfg.ownerId || "");
      if (uid === owner) {
        return send("⛔ Không thể thêm Owner vào danh sách admin (Owner luôn có quyền cao nhất).");
      }

      if (!Array.isArray(cfg.adminBotIds)) cfg.adminBotIds = [];
      const adminSet = cfg.adminBotIds.map(String);

      if (adminSet.includes(uid)) {
        return send(`⚠️ UID ${uid} đã là admin bot rồi.`);
      }

      cfg.adminBotIds.push(uid);
      writeConfig(cfg);
      return send(`✅ Đã thêm ${uid} vào danh sách Admin Bot.`);
    }

    // ── admin remove ──────────────────────────────────────────────────────
    if (sub === "remove" || sub === "rm" || sub === "del") {
      const uid = extractUid(args, event);
      if (!uid) {
        return send(`❌ Không tìm thấy UID hợp lệ.\n💡 Dùng: ${prefix}admin remove <uid số>`);
      }

      const cfg = readConfig();
      const owner = String(cfg.ownerId || "");
      if (uid === owner) {
        return send("⛔ Không thể xoá Owner khỏi danh sách admin.");
      }

      if (!Array.isArray(cfg.adminBotIds)) cfg.adminBotIds = [];
      const before = cfg.adminBotIds.length;
      cfg.adminBotIds = cfg.adminBotIds.filter(id => String(id) !== uid);

      if (cfg.adminBotIds.length === before) {
        return send(`⚠️ Không tìm thấy UID ${uid} trong danh sách Admin Bot.`);
      }

      writeConfig(cfg);
      return send(`✅ Đã xoá ${uid} khỏi danh sách Admin Bot.`);
    }

    // ── admin setprefix ───────────────────────────────────────────────────
    if (sub === "setprefix") {
      const newPrefix = args[1] ? String(args[1]).trim() : "";
      if (!newPrefix) {
        return send(`❌ Thiếu ký tự prefix.\nDùng: ${prefix}admin setprefix <ký tự>\nVí dụ: ${prefix}admin setprefix !`);
      }
      if (newPrefix.length > 3) {
        return send("⛔ Prefix không được dài quá 3 ký tự.");
      }

      const cfg = readConfig();
      const old = cfg.prefix || ".";
      cfg.prefix = newPrefix;
      writeConfig(cfg);
      return send(
        `✅ Đã đổi prefix:\n` +
        `  Cũ: ${old}\n` +
        `  Mới: ${newPrefix}\n` +
        `⚠️ Cần reload bot để áp dụng toàn bộ. (Prefix event đã cập nhật ngay)`
      );
    }

    // ── admin bc ──────────────────────────────────────────────────────────
    if (sub === "bc" || sub === "broadcast") {
      const content = args.slice(1).join(" ").trim();
      if (!content) {
        return send(`❌ Thiếu nội dung.\nDùng: ${prefix}admin bc <nội dung tin nhắn>`);
      }

      const groupsCache = readGroupsCache();
      const groupIds = Object.keys(groupsCache);

      if (groupIds.length === 0) {
        return send(
          `⚠️ Chưa có nhóm nào trong bộ nhớ.\n` +
          `Bot sẽ tự ghi nhớ các nhóm khi có lệnh được gọi.`
        );
      }

      const bcMsg =
        `📢 THÔNG BÁO TỪ ADMIN\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `${content}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `🤖 Bot Admin`;

      await send(`📡 Đang broadcast tới ${groupIds.length} nhóm...`);

      let success = 0;
      let failed = 0;
      for (const gid of groupIds) {
        try {
          await api.sendMessage({ msg: bcMsg }, gid, ThreadType.Group);
          success++;
        } catch {
          failed++;
        }
      }

      return send(
        `✅ Broadcast hoàn tất!\n` +
        `  ✔️ Thành công: ${success} nhóm\n` +
        `  ❌ Thất bại: ${failed} nhóm`
      );
    }

    // ── admin kick ────────────────────────────────────────────────────────
    if (sub === "kick") {
      if (event.type !== ThreadType.Group) {
        return send("⛔ Lệnh kick chỉ dùng được trong nhóm.");
      }

      const uid = extractUid(args, event);
      if (!uid) {
        return send(`❌ Thiếu UID.\nDùng: ${prefix}admin kick <uid> hoặc tag người dùng.`);
      }

      const cfg = readConfig();
      if (String(uid) === String(cfg.ownerId)) {
        return send("⛔ Không thể kick Owner.");
      }

      try {
        await api.removeUserFromGroup(uid, threadID);
        return send(`✅ Đã kick UID ${uid} khỏi nhóm.`);
      } catch (err) {
        return send(`❌ Không thể kick UID ${uid}.\nLý do: ${err?.message || "Không rõ"}`);
      }
    }

    // ── admin setname ─────────────────────────────────────────────────────
    if (sub === "setname") {
      if (event.type !== ThreadType.Group) {
        return send("⛔ Lệnh setname chỉ dùng được trong nhóm.");
      }

      const newName = args.slice(1).join(" ").trim();
      if (!newName) {
        return send(`❌ Thiếu tên.\nDùng: ${prefix}admin setname <tên mới>`);
      }

      try {
        await api.changeGroupName(newName, threadID);
        return send(`✅ Đã đổi tên nhóm thành: ${newName}`);
      } catch (err) {
        return send(`❌ Không thể đổi tên nhóm.\nLý do: ${err?.message || "Không rõ"}`);
      }
    }

    // ── admin info ─────────────────────────────────────────────────────────
    if (sub === "info") {
      const cfg = readConfig();
      const uptime = process.uptime();
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      const s = Math.floor(uptime % 60);
      const uptimeStr = `${h}h ${m}m ${s}s`;

      const groupsCache = readGroupsCache();
      const groupCount = Object.keys(groupsCache).length;
      const adminCount = Array.isArray(cfg.adminBotIds) ? cfg.adminBotIds.length : 0;
      const memMb = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

      return send(
        `╔══ THÔNG TIN HỆ THỐNG ══╗\n` +
        `  🤖 Admin Bot Info\n` +
        `╚════════════════════════╝\n` +
        `👑 Owner ID: ${cfg.ownerId || "(chưa đặt)"}\n` +
        `🛡️  Admin Bot: ${adminCount} người\n` +
        `📌 Prefix: ${cfg.prefix || "."}\n` +
        `📡 Nhóm đã biết: ${groupCount}\n` +
        `⏰ Uptime: ${uptimeStr}\n` +
        `💾 RAM: ${memMb} MB\n` +
        `🔧 Node.js: ${process.version}`
      );
    }

    // ── admin tang ────────────────────────────────────────────────────────
    if (sub === "tang") {
      const mentionIds = parseMentionIds(event);
      if (mentionIds.length > 0) {
        const lines = mentionIds.map(uid => `🆔 UID: ${uid}`).join("\n");
        return send(`${lines}`);
      }

      const uid = args[1] ? String(args[1]).trim() : null;
      if (uid) {
        return send(`🆔 UID: ${uid}`);
      }

      return send(`❌ Thiếu người dùng.\nDùng: ${prefix}admin tang @mention hoặc ${prefix}admin tang <uid>`);
    }

    // ── Sub-command không hợp lệ ──────────────────────────────────────────
    return send(
      `❌ Lệnh con không hợp lệ: "${args[0]}"\n` +
      `💡 Dùng ${prefix}admin để xem danh sách lệnh.`
    );
  }
};

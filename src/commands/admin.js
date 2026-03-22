"use strict";

const { ThreadType } = require("zca-js");
const { readConfig, writeConfig } = require('../../utils/media/helpers');
const { getAllGroupIds } = require('../../includes/database/group/groupSettings');
const { registerReply } = require('../../includes/handlers/handleReply');
const { getRentInfo, isRentExpired } = require('../../includes/database/moderation/rent');

// ── Lấy UID từ mention hoặc args ─────────────────────────────────────────────
function isNumericUid(uid) {
  return uid && /^\d{5,}$/.test(String(uid).trim());
}

function parseMentionIds(event) {
  const raw = event?.data;
  if (!raw) return [];

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

  const mentions = raw.mentions;
  if (Array.isArray(mentions)) {
    const ids = mentions.map(m => String(m.uid || m.id || "")).filter(uid => uid && uid !== "0");
    if (ids.length) return ids;
  }
  if (mentions && typeof mentions === "object") {
    const ids = Object.keys(mentions).filter(k => k && k !== "0" && /^\d+$/.test(k));
    if (ids.length) return ids;
  }

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
    msg += `━━━━━━━━━━━━━━━━\n`;
    msg += `💡 Reply tin này + STT để xoá admin.`;
  } else {
    msg += `🛡️  Admin: (chưa có)\n`;
    msg += `━━━━━━━━━━━━━━━━\n`;
    msg += `💡 ${prefix}admin add <uid> | ${prefix}admin remove <uid>`;
  }
  return msg;
}


module.exports = {
  config: {
    name: "admin",
    version: "2.0.0",
    hasPermssion: 2,
    credits: "MiZai",
    description: "Quản lý admin bot và cài đặt hệ thống",
    commandCategory: "Quản Trị",
    usages: [
      "admin list|info|status              — Danh sách admin / thông tin hệ thống",
      "admin add|remove <uid/@>            — Thêm/xoá admin bot",
      "admin setprefix <ký tự>             — Đổi prefix bot",
      "admin bc <nội dung>                 — Broadcast tới tất cả nhóm",
      "admin say <nội dung>                — Bot nói gì đó",
      "admin invites                       — Danh sách lời mời vào nhóm",
      "admin accept [on/off] [ID]          — Chấp nhận/từ chối lời mời",
      "admin join <link> [câu trả lời]     — Vào nhóm bằng link",
      "admin listbox                       — Danh sách nhóm bot đang có mặt",
    ].join("\n"),
    cooldowns: 3,
  },

  run: async ({ api, event, args, send, prefix, threadID, senderId, reactLoading, reactSuccess, reactError }) => {
    const FLAG_MAP = {
      "-l": "list", "-a": "add", "-r": "remove",
      "-p": "setprefix", "-bc": "broadcast", "-k": "kick",
      "-sn": "setname", "-i": "info", "-t": "tang", "-s": "status",
    };
    const sub = FLAG_MAP[args[0]] || (args[0] || "").toLowerCase().trim();
    const rest = args.slice(1);
    const threadType = event.type;

    if (!sub) {
      return send(
        `╔══ LỆNH ADMIN BOT ══╗\n` +
        `╚════════════════════╝\n` +
        `📋 Các lệnh con:\n` +
        `  ${prefix}admin list\n` +
        `  ${prefix}admin add <uid>\n` +
        `  ${prefix}admin remove <uid>\n` +
        `  ${prefix}admin setprefix <ký tự>\n` +
        `  ${prefix}admin bc <nội dung>\n` +
        `  ${prefix}admin say <nội dung>\n` +
        `  ${prefix}admin status\n` +
        `  ${prefix}admin listbox\n` +
        `  ${prefix}admin invites\n` +
        `  ${prefix}admin accept [on/off] [ID]\n` +
        `  ${prefix}admin join <link>`
      );
    }

    // ── admin status ──────────────────────────────────────────────────────────
    if (sub === "status") {
      const up = process.uptime();
      const h = Math.floor(up / 3600);
      const m = Math.floor((up % 3600) / 60);
      const s = Math.floor(up % 60);
      const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
      let rentStatus = "(không trong nhóm)";
      if (threadID && event.type === ThreadType.Group) {
        const info = getRentInfo(threadID);
        if (info) {
          rentStatus = isRentExpired(threadID)
            ? `HẾT HẠN (${info.time_end})`
            : `Còn hạn đến ${info.time_end}`;
        } else {
          rentStatus = "Chưa thuê";
        }
      }
      return send(
        `[ 📊 HỆ THỐNG BOT ]\n` +
        `─────────────────\n` +
        `◈ Uptime : ${h}h ${m}m ${s}s\n` +
        `◈ Memory : ${mem} MB\n` +
        `◈ Node.js: ${process.version}\n` +
        `◈ Hạn Box: ${rentStatus}\n` +
        `─────────────────\n` +
        `🚀 Bot đang chạy ổn định!`
      );
    }

    // ── admin list ────────────────────────────────────────────────────────────
    if (sub === "list") {
      const cfg = readConfig();
      const admins = Array.isArray(cfg.adminBotIds) ? cfg.adminBotIds.map(String) : [];
      const owner = String(cfg.ownerId || "");
      const filtered = admins.filter(id => id !== owner);

      const listMsg = formatAdminList(cfg, prefix);
      const sent = await api.sendMessage({ msg: listMsg, quote: event.data }, threadID, threadType);

      if (filtered.length > 0 && sent?.msgId) {
        registerReply({
          messageId: sent.msgId,
          commandName: "admin",
          payload: { action: "removeAdmin", admins: filtered, senderId: String(senderId) },
        });
      }
      return;
    }

    // ── admin add ─────────────────────────────────────────────────────────────
    if (sub === "add") {
      const uid = extractUid(args, event);
      if (!uid) {
        return send(`❌ Không tìm thấy UID hợp lệ.\n💡 Dùng: ${prefix}admin add <uid số>`);
      }

      const cfg = readConfig();
      const owner = String(cfg.ownerId || "");
      if (uid === owner) {
        return send("⛔ Không thể thêm Owner vào danh sách admin (Owner luôn có quyền cao nhất).");
      }

      if (!Array.isArray(cfg.adminBotIds)) cfg.adminBotIds = [];
      if (cfg.adminBotIds.map(String).includes(uid)) {
        return send(`⚠️ UID ${uid} đã là admin bot rồi.`);
      }

      cfg.adminBotIds.push(uid);
      writeConfig(cfg);
      return send(`✅ Đã thêm ${uid} vào danh sách Admin Bot.`);
    }

    // ── admin remove ──────────────────────────────────────────────────────────
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

    // ── admin say ─────────────────────────────────────────────────────────────
    if (sub === "say") {
      const msg = rest.join(" ").trim();
      if (!msg) return send(`◈ Dùng: ${prefix}admin say [nội dung]`);
      return api.sendMessage({ msg }, threadID, threadType);
    }

    // ── admin setprefix ───────────────────────────────────────────────────────
    if (sub === "setprefix") {
      const newPrefix = rest[0] ? String(rest[0]).trim() : "";
      if (!newPrefix) {
        return send(`❌ Thiếu ký tự prefix.\nDùng: ${prefix}admin setprefix <ký tự>`);
      }
      if (newPrefix.length > 3) {
        return send("⛔ Prefix không được dài quá 3 ký tự.");
      }

      const cfg = readConfig();
      const old = cfg.prefix || ".";
      cfg.prefix = newPrefix;
      writeConfig(cfg);
      return send(
        `✅ Đã đổi prefix:\n  Cũ: ${old}\n  Mới: ${newPrefix}\n` +
        `⚠️ Cần reload bot để áp dụng toàn bộ.`
      );
    }

    // ── admin bc / broadcast ──────────────────────────────────────────────────
    if (sub === "bc" || sub === "broadcast") {
      const content = rest.join(" ").trim();
      if (!content) {
        return send(`❌ Thiếu nội dung.\nDùng: ${prefix}admin bc <nội dung tin nhắn>`);
      }

      const groupIds = await getAllGroupIds();
      if (groupIds.length === 0) {
        return send(`⚠️ Chưa có nhóm nào trong bộ nhớ.`);
      }

      const bcMsg =
        `📢 THÔNG BÁO TỪ ADMIN\n━━━━━━━━━━━━━━━━\n${content}\n━━━━━━━━━━━━━━━━\n🤖 Bot Admin`;

      await send(`📡 Đang broadcast tới ${groupIds.length} nhóm...`);

      let success = 0, failed = 0;
      for (const gid of groupIds) {
        try {
          await api.sendMessage({ msg: bcMsg }, gid, ThreadType.Group);
          success++;
        } catch {
          failed++;
        }
      }

      return send(
        `✅ Broadcast hoàn tất!\n  ✔️ Thành công: ${success} nhóm\n  ❌ Thất bại: ${failed} nhóm`
      );
    }

    // ── admin info ────────────────────────────────────────────────────────────
    if (sub === "info") {
      const cfg = readConfig();
      const uptime = process.uptime();
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      const s = Math.floor(uptime % 60);
      const groupCount = (await getAllGroupIds()).length;
      const adminCount = Array.isArray(cfg.adminBotIds) ? cfg.adminBotIds.length : 0;
      const memMb = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

      return send(
        `╔══ THÔNG TIN HỆ THỐNG ══╗\n  🤖 Admin Bot Info\n╚════════════════════════╝\n` +
        `👑 Owner ID: ${cfg.ownerId || "(chưa đặt)"}\n` +
        `🛡️  Admin Bot: ${adminCount} người\n` +
        `📌 Prefix: ${cfg.prefix || "."}\n` +
        `📡 Nhóm đã biết: ${groupCount}\n` +
        `⏰ Uptime: ${h}h ${m}m ${s}s\n` +
        `💾 RAM: ${memMb} MB\n` +
        `🔧 Node.js: ${process.version}`
      );
    }

    // ── admin listbox ─────────────────────────────────────────────────────────
    if (sub === "listbox") {
      await reactLoading();

      try {
        const groupsResp = await api.getAllGroups();
        const groupIds = Object.keys(groupsResp?.gridVerMap || {});

        if (groupIds.length === 0) {
          await reactError();
          return send("⚠️ Bot không có trong nhóm nào.");
        }

        const groupInfoResp = await api.getGroupInfo(groupIds);
        const groupMap = groupInfoResp?.gridInfoMap || {};

        let msg = `[ 📁 DANH SÁCH BOX ]\n─────────────────\n`;
        msg += `➥ Reply tin này + STT để Bot RỜI khỏi nhóm CHƯA THUÊ.\n\n`;

        let index = 1;
        const unrentedList = [];
        const allGroups = [];

        for (const id of groupIds) {
          const info = groupMap[id];
          const name = info?.name || "Không tên";
          const rentInfo = getRentInfo(id);
          const expired = isRentExpired(id);
          const rentStatus = rentInfo
            ? (expired ? `❌ HẾT HẠN (${rentInfo.time_end})` : `✅ ${rentInfo.time_end}`)
            : "⚪ Chưa thuê";

          msg += `${index}. ${name}\n   🆔: ${id}\n   📅 Hạn: ${rentStatus}\n\n`;

          if (!rentInfo || expired) {
            unrentedList.push({ index, id, name });
          }
          allGroups.push({ index, id, name });
          index++;

          if (msg.length > 1800) {
            await api.sendMessage({ msg, quote: event.data }, threadID, threadType);
            msg = "";
          }
        }

        const finalMsg = msg + `─────────────────\nTổng: ${groupIds.length} nhóm`;
        const sent = await api.sendMessage({ msg: finalMsg, quote: event.data }, threadID, threadType);

        if (unrentedList.length > 0 && sent?.msgId) {
          registerReply({
            messageId: sent.msgId,
            commandName: "admin",
            payload: { action: "leaveGroup", groups: unrentedList, senderId: String(senderId) },
          });
        }
        await reactSuccess();
      } catch (e) {
        await reactError();
        await send(`⚠️ Lỗi khi lấy danh sách nhóm: ${e.message}`);
      }
      return;
    }

    // ── admin invites ─────────────────────────────────────────────────────────
    if (sub === "invites") {
      try {
        const data = await api.getGroupInvites();
        const invites = data?.invitations || data?.list || data?.invites || [];

        if (invites.length === 0) {
          return send("✅ Bot không có lời mời vào nhóm nào mới.");
        }

        let msg = `[ 📩 LỜI MỜI VÀO NHÓM ]\n─────────────────\n`;
        msg += `➥ Reply tin này + STT để Bot vào nhóm.\n\n`;

        const inviteList = [];
        invites.forEach((inv, i) => {
          const gi = inv.groupInfo || inv;
          const gName = gi.name || gi.groupName || "Nhóm không tên";
          const gId = gi.groupId || gi.grid || inv.groupId;
          const inviterName = inv.inviterInfo?.displayName || inv.inviterName || "Ẩn danh";
          const memberCount = gi.totalMember || gi.memberIds?.length || "?";

          msg += `${i + 1}. ${gName}\n   🆔: ${gId}\n   👥: ${memberCount}\n   👤: ${inviterName}\n\n`;
          inviteList.push({ index: i + 1, id: gId, name: gName });
        });

        msg += `─────────────────\n💡 Dùng: ${prefix}admin accept off [ID] để từ chối`;

        const sent = await api.sendMessage({ msg, quote: event.data }, threadID, threadType);
        if (sent?.msgId && inviteList.length > 0) {
          registerReply({
            messageId: sent.msgId,
            commandName: "admin",
            payload: { action: "acceptInvite", invites: inviteList, senderId: String(senderId) },
          });
        }
      } catch (e) {
        return send(`⚠️ Lỗi khi lấy danh sách mời: ${e.message}`);
      }
      return;
    }

    // ── admin accept ──────────────────────────────────────────────────────────
    if (sub === "accept") {
      const status = rest[0]?.toLowerCase();
      const targetId = rest[1];

      if (!["on", "off"].includes(status) || !targetId) {
        return send(`◈ Dùng: ${prefix}admin accept [on/off] [ID]`);
      }

      try {
        const isAccept = status === "on";
        const result = await api.handleGroupInvite(targetId, isAccept);
        if (result?.status === "pending") {
          return send(`⏳ Đã gửi yêu cầu vào nhóm ${targetId}, đang chờ admin duyệt.`);
        }
        return send(`✅ Đã ${isAccept ? "CHẤP NHẬN" : "TỪ CHỐI"} lời mời vào nhóm: ${targetId}`);
      } catch (e) {
        return send(`⚠️ Lỗi khi xử lý lời mời: ${e.message}`);
      }
    }

    // ── admin join ────────────────────────────────────────────────────────────
    if (sub === "join") {
      const link = rest[0];
      const answer = rest.slice(1).join(" ");

      if (!link) {
        return send(`◈ Dùng: ${prefix}admin join [Link nhóm] [Câu trả lời (nếu có)]`);
      }

      try {
        await api.joinGroup(link, answer);
        return send(
          `✅ Đã gửi yêu cầu tham gia nhóm thành công!` +
          (answer ? `\n💬 Câu trả lời: ${answer}` : "")
        );
      } catch (e) {
        return send(`⚠️ Lỗi khi vào nhóm: ${e.message}`);
      }
    }

    // ── Sub-command không hợp lệ ──────────────────────────────────────────────
    return send(
      `❌ Lệnh con không hợp lệ: "${args[0]}"\n` +
      `💡 Dùng ${prefix}admin để xem danh sách lệnh.`
    );
  },

  // ── onReply: xử lý khi user reply vào tin nhắn bot đã gửi ─────────────────
  onReply: async ({ api, event, payload, send }) => {
    if (!payload) return;
    const { action, senderId: authorId } = payload;
    const raw = event?.data || {};
    const replierStr = String(raw.uidFrom || event.senderId || "");
    const threadID = event.threadId;
    const threadType = event.type;

    if (replierStr !== String(authorId)) return;

    const choice = parseInt((raw.content || raw.msg || "").trim());
    if (isNaN(choice) || choice < 1) return;

    // ── Xoá Admin qua STT ────────────────────────────────────────────────────
    if (action === "removeAdmin") {
      const { admins } = payload;
      const cfg = readConfig();
      const owner = String(cfg.ownerId || "");
      const targetId = admins[choice - 1];

      if (!targetId) return send(`⚠️ STT ${choice} không hợp lệ.`);
      if (targetId === owner || targetId === replierStr) {
        return send("⛔ Không thể xoá quyền của Owner hoặc chính bạn.");
      }

      cfg.adminBotIds = (cfg.adminBotIds || []).filter(id => String(id) !== targetId);
      writeConfig(cfg);
      return send(`✅ Đã tước quyền Admin của ID: ${targetId}.`);
    }

    // ── Rời nhóm theo STT ───────────────────────────────────────────────────
    if (action === "leaveGroup") {
      const { groups } = payload;
      const target = groups.find(g => g.index === choice);
      if (!target) return send(`⚠️ STT ${choice} không hợp lệ.`);

      try {
        await api.sendMessage(
          { msg: "✦ Bot xin phép rời nhóm vì chưa được gia hạn. Hẹn gặp lại!" },
          target.id, 1
        ).catch(() => {});

        if (typeof api.leaveGroup === "function") {
          await api.leaveGroup(target.id);
        } else if (api.group?.leave) {
          await api.group.leave(target.id);
        } else {
          throw new Error("API Bot không hỗ trợ leaveGroup.");
        }

        return send(`✅ Đã rời khỏi nhóm: ${target.name}\n🆔: ${target.id}`);
      } catch (e) {
        return send(`⚠️ Lỗi khi rời nhóm ${target.name}: ${e.message}`);
      }
    }

    // ── Chấp nhận mời nhóm theo STT ────────────────────────────────────────
    if (action === "acceptInvite") {
      const { invites } = payload;
      const target = invites.find(g => g.index === choice);
      if (!target) return send(`⚠️ STT ${choice} không hợp lệ.`);

      try {
        const result = await api.handleGroupInvite(target.id, true);
        if (result?.status === "pending") {
          return send(`⏳ Đã gửi yêu cầu vào nhóm ${target.name}, đang chờ admin duyệt.`);
        }
        return send(`✅ Đã vào nhóm ${target.name} thành công!`);
      } catch (e) {
        return send(`⚠️ Lỗi khi vào nhóm ${target.name}: ${e.message}`);
      }
    }
  },
};

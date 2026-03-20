const { ThreadType } = require("zca-js");
const { parseMentionIds } = require("../../utils/bot/messageUtils");
const path = require("path");
const os = require("os");
const axios = require("axios");
const fs = require("fs");

module.exports = {
  config: {
    name: "nhom2",
    aliases: ["group2", "gmanage"],
    version: "1.0.0",
    hasPermssion: 1,
    credits: "MIZAI",
    description: "Quản lý nhóm nâng cao",
    commandCategory: "Quản Trị",
    usages: [
      "nhom2 rename <tên_mới>       — Đổi tên nhóm",
      "nhom2 owner @tag             — Chuyển quyền trưởng nhóm",
      "nhom2 avatar (reply ảnh)     — Đổi ảnh đại diện nhóm",
      "nhom2 block @tag             — Chặn thành viên trong nhóm",
      "nhom2 unblock @tag           — Bỏ chặn thành viên nhóm",
      "nhom2 blocklist              — Danh sách đang bị chặn",
      "nhom2 disperse               — Giải tán nhóm (không thể hoàn tác!)",
      "nhom2 upgrade                — Nâng cấp lên Cộng đồng Zalo",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ api, event, args, send, threadID, prefix }) => {
    if (event.type !== ThreadType.Group) {
      return send("⛔ Lệnh này chỉ dùng được trong nhóm.");
    }

    const sub = (args[0] || "").toLowerCase();
    const mentions = parseMentionIds(event);

    if (!sub) {
      return send(
        `👥 NHOM2 — QUẢN LÝ NHÓM NÂNG CAO\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${prefix}nhom2 rename <tên>   Đổi tên nhóm\n` +
        `${prefix}nhom2 owner @tag     Chuyển trưởng nhóm\n` +
        `${prefix}nhom2 avatar         Đổi ảnh nhóm (reply ảnh)\n` +
        `${prefix}nhom2 block @tag     Chặn thành viên\n` +
        `${prefix}nhom2 unblock @tag   Bỏ chặn thành viên\n` +
        `${prefix}nhom2 blocklist      Danh sách bị chặn\n` +
        `${prefix}nhom2 disperse       Giải tán nhóm ⚠️\n` +
        `${prefix}nhom2 upgrade        Nâng lên Cộng đồng`
      );
    }

    try {
      switch (sub) {

        case "rename": {
          const newName = args.slice(1).join(" ").trim();
          if (!newName) return send(`⚠️ Ví dụ: ${prefix}nhom2 rename Tên Nhóm Mới`);
          await api.changeGroupName(newName, threadID);
          return send(`✅ Đã đổi tên nhóm thành: "${newName}"`);
        }

        case "owner": {
          const uid = mentions[0] || args[1];
          if (!uid) return send(`⚠️ Tag người nhận quyền. Ví dụ: ${prefix}nhom2 owner @tên`);
          await api.changeGroupOwner(uid, threadID);
          return send(`✅ Đã chuyển quyền trưởng nhóm cho UID: ${uid}`);
        }

        case "avatar": {
          const raw = event?.data || {};
          const imgUrl = raw?.quote?.content?.url || raw?.quote?.content?.hdUrl
            || raw?.quote?.content?.normalUrl || raw?.quote?.attach?.[0]?.url;

          if (!imgUrl) {
            return send(`⚠️ Reply một ảnh rồi dùng lệnh: ${prefix}nhom2 avatar`);
          }

          const tmpPath = path.join(os.tmpdir(), `avatar_${Date.now()}.jpg`);
          const res = await axios.get(imgUrl, { responseType: "arraybuffer", timeout: 15000 });
          fs.writeFileSync(tmpPath, Buffer.from(res.data));

          await api.changeGroupAvatar(tmpPath, threadID);
          try { fs.unlinkSync(tmpPath); } catch {}
          return send("✅ Đã đổi ảnh đại diện nhóm thành công!");
        }

        case "block": {
          if (!mentions.length) return send(`⚠️ Tag người cần chặn. Ví dụ: ${prefix}nhom2 block @tên`);
          await api.addGroupBlockedMember(mentions, threadID);
          return send(`🚫 Đã chặn ${mentions.length} thành viên trong nhóm.`);
        }

        case "unblock": {
          if (!mentions.length) return send(`⚠️ Tag người cần bỏ chặn. Ví dụ: ${prefix}nhom2 unblock @tên`);
          for (const uid of mentions) {
            await api.removeGroupBlockedMember(uid, threadID);
          }
          return send(`✅ Đã bỏ chặn ${mentions.length} thành viên.`);
        }

        case "blocklist": {
          const res = await api.getGroupBlockedMember({ count: 50, lastId: 0 }, threadID);
          const list = res?.blockedList || res?.members || [];
          if (!list.length) return send("✅ Không có thành viên nào bị chặn trong nhóm này.");
          const lines = list.map((m, i) =>
            `${i + 1}. ${m.displayName || m.name || "Không rõ"} (${m.userId || m.uid})`
          );
          return send(`🚫 DANH SÁCH BỊ CHẶN (${list.length}):\n${lines.join("\n")}`);
        }

        case "disperse": {
          const confirm = args[1];
          if (confirm !== "xacnhan") {
            return send(
              `⚠️ CẢNH BÁO: Lệnh này sẽ GIẢI TÁN nhóm và không thể hoàn tác!\n` +
              `Nếu chắc chắn, gõ: ${prefix}nhom2 disperse xacnhan`
            );
          }
          await api.disperseGroup(threadID);
          return send("🏳️ Nhóm đã được giải tán.");
        }

        case "upgrade": {
          const confirm = args[1];
          if (confirm !== "xacnhan") {
            return send(
              `ℹ️ Nâng cấp nhóm lên Cộng đồng Zalo (không thể hoàn tác).\n` +
              `Nếu chắc chắn, gõ: ${prefix}nhom2 upgrade xacnhan`
            );
          }
          await api.upgradeGroupToCommunity(threadID);
          return send("🏆 Đã nâng cấp nhóm lên Cộng đồng Zalo thành công!");
        }

        default:
          return send(`❌ Lệnh con không hợp lệ. Dùng: ${prefix}nhom2 để xem hướng dẫn.`);
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Lỗi không xác định";
      return send(`❌ Lỗi: ${msg}`);
    }
  },
};

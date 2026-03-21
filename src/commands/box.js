const { ThreadType } = require("zca-js");
const { parseMentionIds } = require("../../utils/bot/messageUtils");
const path = require("path");
const os = require("os");
const axios = require("axios");
const fs = require("fs");

// ── Bảng cài đặt quyền nhóm ────────────────────────────────────────────────
const SETTINGS_MAP = {
  "blockname"       : "blockName",
  "tenmoi"          : "blockName",
  "adminmsg"        : "signAdminMsg",
  "signadminmsg"    : "signAdminMsg",
  "lichsu"          : "enableMsgHistory",
  "msghistory"      : "enableMsgHistory",
  "duyetthanhvien"  : "joinAppr",
  "joinappr"        : "joinAppr",
  "khoaghichu"      : "lockCreatePost",
  "locknote"        : "lockCreatePost",
  "khoapoll"        : "lockCreatePoll",
  "lockpoll"        : "lockCreatePoll",
  "khoaguitin"      : "lockSendMsg",
  "locksenddmsg"    : "lockSendMsg",
};

module.exports = {
  config: {
    name: "box",
    aliases: ["nhom2", "group2", "setnhom"],
    version: "1.1.0",
    hasPermssion: 1,
    credits: "MIZAI",
    description: "Quản lý nhóm nâng cao: tên, avatar, link mời, quyền thành viên, chặn, giải tán",
    commandCategory: "Quản Trị",
    usages: [
      "box rename <tên>         — Đổi tên nhóm",
      "box link on|off          — Bật/tắt link mời nhóm",
      "box avatar (reply ảnh)   — Đổi ảnh đại diện nhóm",
      "box setting <cai_dat> on|off — Cài đặt quyền thành viên",
      "box owner @tag           — Chuyển quyền trưởng nhóm",
      "box block @tag           — Chặn thành viên",
      "box unblock @tag         — Bỏ chặn thành viên",
      "box blocklist            — Danh sách đang bị chặn",
      "box disperse             — Giải tán nhóm (không thể hoàn tác!)",
      "box upgrade              — Nâng cấp lên Cộng đồng Zalo",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ api, event, args, send, threadID, prefix }) => {
    if (event.type !== ThreadType.Group) {
      return send("⛔ Lệnh này chỉ dùng được trong nhóm.");
    }

    const FLAG_MAP = {
      "-n"  : "rename",
      "-o"  : "owner",
      "-a"  : "avatar",
      "-b"  : "block",
      "-ub" : "unblock",
      "-bl" : "blocklist",
      "-d"  : "disperse",
      "-u"  : "upgrade",
      "-l"  : "link",
      "-s"  : "setting",
    };
    const raw0 = (args[0] || "").toLowerCase();
    const sub  = FLAG_MAP[args[0]] || raw0;
    // Alias: "ten" = "rename", "caidat" = "setting"
    const cmd  = sub === "ten" ? "rename" : sub === "caidat" ? "setting" : sub;

    const mentions = parseMentionIds(event);

    if (!cmd) {
      return send(
        `📦 BOX — QUẢN LÝ NHÓM\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${prefix}box rename|-n <tên>       Đổi tên nhóm\n` +
        `${prefix}box link|-l on|off        Bật/tắt link mời\n` +
        `${prefix}box avatar|-a             Đổi ảnh nhóm (reply ảnh)\n` +
        `${prefix}box setting|-s <key> on|off  Cài đặt quyền\n` +
        `  Keys: blockname · signadminmsg · lichsu\n` +
        `        duyetthanhvien · khoaghichu · khoapoll · khoaguitin\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${prefix}box owner|-o @tag         Chuyển trưởng nhóm\n` +
        `${prefix}box block|-b @tag         Chặn thành viên\n` +
        `${prefix}box unblock|-ub @tag      Bỏ chặn thành viên\n` +
        `${prefix}box blocklist|-bl         Danh sách bị chặn\n` +
        `${prefix}box disperse|-d           Giải tán nhóm ⚠️\n` +
        `${prefix}box upgrade|-u            Nâng lên Cộng đồng`
      );
    }

    try {
      switch (cmd) {

        // ── Đổi tên nhóm ──────────────────────────────────────────────────
        case "rename": {
          const newName = args.slice(1).join(" ").trim();
          if (!newName) return send(`⚠️ Ví dụ: ${prefix}box rename Tên Nhóm Mới`);
          if (newName.length > 100) return send("❌ Tên nhóm tối đa 100 ký tự.");
          await api.changeGroupName(newName, threadID);
          return send(`✅ Đã đổi tên nhóm thành: "${newName}"`);
        }

        // ── Bật / Tắt link mời nhóm ───────────────────────────────────────
        case "link": {
          const toggle = (args[1] || "").toLowerCase();
          if (!["on", "off"].includes(toggle)) {
            return send(`❌ Dùng: ${prefix}box link on|off`);
          }
          if (toggle === "on") {
            const res = await api.enableGroupLink(threadID);
            return send(
              `✅ Đã bật link mời nhóm!\n` +
              `🔗 Link: ${res?.link || "(không lấy được link)"}\n` +
              `⏳ Hết hạn: ${res?.expiration_date
                ? new Date(res.expiration_date * 1000).toLocaleDateString("vi-VN")
                : "Không xác định"}`
            );
          } else {
            await api.disableGroupLink(threadID);
            return send("✅ Đã tắt link mời nhóm.");
          }
        }

        // ── Đổi avatar nhóm ───────────────────────────────────────────────
        case "avatar": {
          const raw   = event?.data || {};
          const quote = raw?.quote || raw?.replyMsg || null;
          let imgUrl  = null;

          if (quote) {
            const c = quote.content;
            imgUrl = quote.normalUrl || quote.hdUrl || quote.thumbUrl
              || (c && typeof c === "object"
                ? (c.normalUrl || c.hdUrl || c.url || c.thumbUrl || c.href)
                : null);
          }
          if (!imgUrl) {
            const attachs = raw?.attachments || raw?.media || [];
            for (const a of attachs) {
              if (a.url) { imgUrl = a.url; break; }
            }
          }
          if (!imgUrl) {
            return send(`⚠️ Reply một ảnh rồi dùng lệnh: ${prefix}box avatar`);
          }

          const tmpPath = path.join(os.tmpdir(), `avatar_${Date.now()}.jpg`);
          const res = await axios.get(imgUrl, { responseType: "arraybuffer", timeout: 15000 });
          fs.writeFileSync(tmpPath, Buffer.from(res.data));
          await api.changeGroupAvatar(tmpPath, threadID);
          try { fs.unlinkSync(tmpPath); } catch {}
          return send("✅ Đã đổi ảnh đại diện nhóm thành công!");
        }

        // ── Cài đặt quyền thành viên ──────────────────────────────────────
        case "setting": {
          const settingKey = (args[1] || "").toLowerCase();
          const toggle     = (args[2] || "").toLowerCase();

          if (!settingKey || !["on", "off"].includes(toggle)) {
            return send(
              `❌ Dùng: ${prefix}box setting <cai_dat> on|off\n` +
              `Các cài đặt:\n` +
              `  blockname       — Cấm đổi tên/avatar nhóm\n` +
              `  signadminmsg    — Nổi bật tin nhắn admin\n` +
              `  lichsu          — Cho xem lịch sử chat\n` +
              `  duyetthanhvien  — Duyệt thành viên mới\n` +
              `  khoaghichu      — Khóa tạo ghi chú\n` +
              `  khoapoll        — Khóa tạo bình chọn\n` +
              `  khoaguitin      — Khóa gửi tin nhắn`
            );
          }

          const apiKey = SETTINGS_MAP[settingKey];
          if (!apiKey) {
            return send(
              `❌ Cài đặt "${settingKey}" không hợp lệ.\n` +
              `Gõ ${prefix}box setting để xem danh sách.`
            );
          }

          const value = toggle === "on";
          await api.updateGroupSettings({ [apiKey]: value }, threadID);
          return send(`✅ Đã ${value ? "bật" : "tắt"} cài đặt: ${settingKey}`);
        }

        // ── Chuyển quyền trưởng nhóm ──────────────────────────────────────
        case "owner": {
          const uid = mentions[0] || args[1];
          if (!uid) return send(`⚠️ Tag người nhận quyền. Ví dụ: ${prefix}box owner @tên`);
          await api.changeGroupOwner(uid, threadID);
          return send(`✅ Đã chuyển quyền trưởng nhóm cho UID: ${uid}`);
        }

        // ── Chặn thành viên ───────────────────────────────────────────────
        case "block": {
          if (!mentions.length) return send(`⚠️ Tag người cần chặn. Ví dụ: ${prefix}box block @tên`);
          await api.addGroupBlockedMember(mentions, threadID);
          return send(`🚫 Đã chặn ${mentions.length} thành viên trong nhóm.`);
        }

        // ── Bỏ chặn thành viên ────────────────────────────────────────────
        case "unblock": {
          if (!mentions.length) return send(`⚠️ Tag người cần bỏ chặn. Ví dụ: ${prefix}box unblock @tên`);
          for (const uid of mentions) {
            await api.removeGroupBlockedMember(uid, threadID);
          }
          return send(`✅ Đã bỏ chặn ${mentions.length} thành viên.`);
        }

        // ── Danh sách bị chặn ─────────────────────────────────────────────
        case "blocklist": {
          const res = await api.getGroupBlockedMember({ count: 50, lastId: 0 }, threadID);
          const list = res?.blockedList || res?.members || [];
          if (!list.length) return send("✅ Không có thành viên nào bị chặn trong nhóm này.");
          const lines = list.map((m, i) =>
            `${i + 1}. ${m.displayName || m.name || "Không rõ"} (${m.userId || m.uid})`
          );
          return send(`🚫 DANH SÁCH BỊ CHẶN (${list.length}):\n${lines.join("\n")}`);
        }

        // ── Giải tán nhóm ─────────────────────────────────────────────────
        case "disperse": {
          if (args[1] !== "xacnhan") {
            return send(
              `⚠️ CẢNH BÁO: Lệnh này sẽ GIẢI TÁN nhóm và không thể hoàn tác!\n` +
              `Nếu chắc chắn, gõ: ${prefix}box disperse xacnhan`
            );
          }
          await api.disperseGroup(threadID);
          return send("🏳️ Nhóm đã được giải tán.");
        }

        // ── Nâng cấp lên Cộng đồng ────────────────────────────────────────
        case "upgrade": {
          if (args[1] !== "xacnhan") {
            return send(
              `ℹ️ Nâng cấp nhóm lên Cộng đồng Zalo (không thể hoàn tác).\n` +
              `Nếu chắc chắn, gõ: ${prefix}box upgrade xacnhan`
            );
          }
          await api.upgradeGroupToCommunity(threadID);
          return send("🏆 Đã nâng cấp nhóm lên Cộng đồng Zalo thành công!");
        }

        default:
          return send(`❌ Lệnh con không hợp lệ. Dùng: ${prefix}box để xem hướng dẫn.`);
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Lỗi không xác định";
      return send(`❌ Lỗi: ${msg}`);
    }
  },
};

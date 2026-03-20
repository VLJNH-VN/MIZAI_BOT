const { ThreadType } = require("zca-js");
const { parseMentionIds } = require("../../utils/bot/messageUtils");

function fmtTime(ms) {
  if (!ms) return "Không rõ";
  const d = new Date(ms * 1000);
  return d.toLocaleString("vi-VN");
}

module.exports = {
  config: {
    name: "friend",
    aliases: ["ban", "banjbe"],
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MIZAI",
    description: "Quản lý bạn bè Zalo",
    commandCategory: "Tiện Ích",
    usages: [
      "friend find <số_điện_thoại>   — Tìm người dùng theo SĐT",
      "friend phones <sdt1,sdt2,...> — Tìm nhiều người theo SĐT",
      "friend all                    — Danh sách tất cả bạn bè",
      "friend online                 — Bạn bè đang online",
      "friend close                  — Danh sách bạn thân",
      "friend suggest                — Gợi ý kết bạn",
      "friend add <uid>              — Gửi lời mời kết bạn",
      "friend accept @tag            — Chấp nhận lời mời kết bạn",
      "friend reject @tag            — Từ chối lời mời kết bạn",
      "friend undo @tag/<uid>        — Rút lại lời mời đã gửi",
      "friend remove @tag/<uid>      — Xóa bạn",
      "friend block @tag/<uid>       — Chặn người dùng",
      "friend unblock @tag/<uid>     — Bỏ chặn người dùng",
      "friend lastonline @tag/<uid>  — Xem lần cuối online",
      "friend alias @tag <biệt_danh> — Đặt biệt danh",
      "friend unalias @tag           — Xóa biệt danh",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ api, event, args, send, senderId, prefix }) => {
    const sub = (args[0] || "").toLowerCase();
    const mentions = parseMentionIds(event);
    const uid1 = mentions[0] || args[1];

    if (!sub) {
      return send(
        `👤 FRIEND — QUẢN LÝ BẠN BÈ\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${prefix}friend find <sdt>       Tìm người\n` +
        `${prefix}friend phones <sdts>    Tìm nhiều người\n` +
        `${prefix}friend all              Danh sách bạn\n` +
        `${prefix}friend online           Bạn đang online\n` +
        `${prefix}friend close            Bạn thân\n` +
        `${prefix}friend suggest          Gợi ý kết bạn\n` +
        `${prefix}friend add <uid>        Gửi lời mời\n` +
        `${prefix}friend accept @tag      Chấp nhận\n` +
        `${prefix}friend reject @tag      Từ chối\n` +
        `${prefix}friend undo @tag        Rút lời mời\n` +
        `${prefix}friend remove @tag      Xóa bạn\n` +
        `${prefix}friend block @tag       Chặn\n` +
        `${prefix}friend unblock @tag     Bỏ chặn\n` +
        `${prefix}friend lastonline @tag  Lần cuối online\n` +
        `${prefix}friend alias @tag <tên> Đặt biệt danh\n` +
        `${prefix}friend unalias @tag     Xóa biệt danh`
      );
    }

    try {
      switch (sub) {

        case "find": {
          const phone = args[1];
          if (!phone) return send(`⚠️ Nhập số điện thoại. Ví dụ: ${prefix}friend find 0901234567`);
          const user = await api.findUser(phone);
          if (!user) return send("❌ Không tìm thấy người dùng này.");
          return send(
            `🔍 KẾT QUẢ TÌM KIẾM\n━━━━━━━━━━━━━━━━\n` +
            `👤 Tên: ${user.displayName || user.zaloName || "Không rõ"}\n` +
            `🆔 UID: ${user.userId || user.uid}\n` +
            `📞 SĐT: ${phone}\n` +
            `🌐 Username: ${user.username || "Chưa đặt"}`
          );
        }

        case "phones": {
          const phones = (args[1] || "").split(",").map(p => p.trim()).filter(Boolean);
          if (!phones.length) return send(`⚠️ Ví dụ: ${prefix}friend phones 0901111111,0902222222`);
          const users = await api.getMultiUsersByPhones(phones);
          if (!users || !users.length) return send("❌ Không tìm thấy ai.");
          const lines = users.map(u =>
            `• ${u.displayName || u.zaloName || "Không rõ"} (${u.userId || u.uid})`
          );
          return send(`🔍 Tìm thấy ${lines.length} người:\n${lines.join("\n")}`);
        }

        case "all": {
          const friends = await api.getAllFriends();
          if (!friends || !friends.length) return send("📭 Chưa có bạn bè nào.");
          const lines = friends.slice(0, 30).map((f, i) =>
            `${i + 1}. ${f.displayName || f.zaloName || "Không rõ"} (${f.userId || f.uid})`
          );
          const more = friends.length > 30 ? `\n...và ${friends.length - 30} người nữa` : "";
          return send(`👥 DANH SÁCH BẠN BÈ (${friends.length} người):\n${lines.join("\n")}${more}`);
        }

        case "online": {
          const res = await api.getFriendOnlines();
          const onlines = res?.onlines || [];
          if (!onlines.length) return send("📴 Không có bạn nào đang online.");
          const lines = onlines.map(u => `• UID: ${u.userId} — ${u.status}`);
          return send(`🟢 BẠN ĐANG ONLINE (${onlines.length}):\n${lines.join("\n")}`);
        }

        case "close": {
          const friends = await api.getCloseFriends();
          if (!friends || !friends.length) return send("📭 Không có bạn thân nào.");
          const lines = friends.map((f, i) =>
            `${i + 1}. ${f.displayName || f.zaloName || "?"} (${f.userId || f.uid})`
          );
          return send(`💚 BẠN THÂN (${friends.length}):\n${lines.join("\n")}`);
        }

        case "suggest": {
          const list = await api.getFriendRecommendations();
          if (!list || !list.length) return send("📭 Không có gợi ý kết bạn.");
          const lines = list.slice(0, 15).map((f, i) =>
            `${i + 1}. ${f.displayName || f.zaloName || "?"} (${f.userId || f.uid})`
          );
          return send(`💡 GỢI Ý KẾT BẠN (${list.length}):\n${lines.join("\n")}`);
        }

        case "add": {
          const targetId = args[1];
          if (!targetId) return send(`⚠️ Ví dụ: ${prefix}friend add 123456789`);
          const msg = args.slice(2).join(" ") || "Xin chào! Mình muốn kết bạn với bạn.";
          await api.sendFriendRequest(msg, targetId);
          return send(`✅ Đã gửi lời mời kết bạn đến UID: ${targetId}`);
        }

        case "accept": {
          if (!uid1) return send(`⚠️ Tag người cần chấp nhận. Ví dụ: ${prefix}friend accept @tên`);
          await api.acceptFriendRequest(uid1);
          return send(`✅ Đã chấp nhận lời mời kết bạn từ UID: ${uid1}`);
        }

        case "reject": {
          if (!uid1) return send(`⚠️ Tag người cần từ chối. Ví dụ: ${prefix}friend reject @tên`);
          await api.rejectFriendRequest(uid1);
          return send(`✅ Đã từ chối lời mời kết bạn từ UID: ${uid1}`);
        }

        case "undo": {
          if (!uid1) return send(`⚠️ Tag hoặc nhập UID. Ví dụ: ${prefix}friend undo @tên`);
          await api.undoFriendRequest(uid1);
          return send(`✅ Đã rút lại lời mời kết bạn đến UID: ${uid1}`);
        }

        case "remove": {
          if (!uid1) return send(`⚠️ Tag người cần xóa. Ví dụ: ${prefix}friend remove @tên`);
          await api.removeFriend(uid1);
          return send(`✅ Đã xóa bạn UID: ${uid1} khỏi danh sách bạn bè.`);
        }

        case "block": {
          if (!uid1) return send(`⚠️ Tag người cần chặn. Ví dụ: ${prefix}friend block @tên`);
          await api.blockUser(uid1);
          return send(`🚫 Đã chặn UID: ${uid1}`);
        }

        case "unblock": {
          if (!uid1) return send(`⚠️ Tag người cần bỏ chặn. Ví dụ: ${prefix}friend unblock @tên`);
          await api.unblockUser(uid1);
          return send(`✅ Đã bỏ chặn UID: ${uid1}`);
        }

        case "lastonline": {
          if (!uid1) return send(`⚠️ Tag người hoặc nhập UID.`);
          const res = await api.lastOnline(uid1);
          const t = fmtTime(res?.lastOnline);
          return send(`🕐 LẦN CUỐI ONLINE\n━━━━━━━━━━━━━━━━\n🆔 UID: ${uid1}\n⏰ Lần cuối: ${t}`);
        }

        case "alias": {
          if (!uid1) return send(`⚠️ Ví dụ: ${prefix}friend alias @tên BiệtDanh`);
          const alias = args.slice(mentions.length ? 2 : 2).join(" ");
          if (!alias) return send("⚠️ Nhập biệt danh muốn đặt.");
          await api.changeFriendAlias(alias, uid1);
          return send(`✅ Đã đặt biệt danh "${alias}" cho UID: ${uid1}`);
        }

        case "unalias": {
          if (!uid1) return send(`⚠️ Tag người cần xóa biệt danh.`);
          await api.removeFriendAlias(uid1);
          return send(`✅ Đã xóa biệt danh của UID: ${uid1}`);
        }

        default:
          return send(`❌ Lệnh con không hợp lệ. Dùng: ${prefix}friend để xem hướng dẫn.`);
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Lỗi không xác định";
      return send(`❌ Lỗi: ${msg}`);
    }
  },
};

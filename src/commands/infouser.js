const { parseMentionIds } = require("../../utils/bot/messageUtils");

function fmtTimestamp(ts) {
  if (!ts) return "Ẩn";
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
}

function fmtDob(dob, sdob) {
  if (dob && typeof dob === "number" && dob > 0) {
    return new Date(dob < 1e12 ? dob * 1000 : dob).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  }
  if (sdob && typeof sdob === "string" && sdob.trim()) return sdob;
  return "Ẩn";
}

module.exports = {
  config: {
    name:            "infouser",
    aliases:         ["userinfo", "uinfo", "zinfo"],
    version:         "1.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Xem thông tin tài khoản Zalo chi tiết",
    commandCategory: "Tra Cứu",
    usages: [
      "infouser             — Xem thông tin của bạn",
      "infouser @tag        — Xem thông tin người được tag",
      "infouser <uid>       — Xem thông tin theo UID",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ api, event, args, send, senderId }) => {
    const raw = event?.data || {};
    const selfId = raw?.uidFrom ? String(raw.uidFrom) : senderId;

    const mentionIds = parseMentionIds(event);
    let targetId = mentionIds[0] || null;

    if (!targetId && args[0] && /^\d+$/.test(args[0])) {
      targetId = args[0];
    }

    if (!targetId) targetId = selfId;
    if (!targetId) return send("❌ Không thể xác định người dùng!");

    try {
      const res  = await api.getUserInfo(targetId);
      const pool = res?.changed_profiles || {};
      const alt  = res?.unchanged_profiles || {};
      const info = pool[targetId] || alt[targetId] || Object.values(pool)[0] || Object.values(alt)[0];

      if (!info) return send("❌ Không lấy được thông tin người dùng này.");

      const name     = info.zaloName || info.displayName || info.username || targetId;
      const nameShow = name.length > 30 ? name.slice(0, 30) + "..." : name;

      const gender   = info.gender === 0 ? "Nam" : info.gender === 1 ? "Nữ" : "Không rõ";
      const bio      = info.status || "Không có";
      const biz      = info.bizPkg?.label ? "✅ Có" : "❌ Không";
      const dob      = fmtDob(info.dob, info.sdob);
      const phone    = (targetId === selfId) ? "Ẩn" : (info.phoneNumber || "Ẩn");
      const lastAct  = fmtTimestamp(info.lastActionTime);
      const created  = fmtTimestamp(info.createdTs);
      const blocked  = info.isBlocked === 0 ? "✅ Bình thường" : "🔒 Đã bị khóa";
      const pc       = info.isActivePC  === 1 ? "🟢 Kích hoạt" : "🔴 Không";
      const web      = info.isActiveWeb === 1 ? "🟢 Kích hoạt" : "🔴 Không";
      const avatar   = info.avatar || "Không có";
      const cover    = info.cover   || "Không có";

      return send(
        `👤 THÔNG TIN ZALO\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 User ID    : ${info.userId || targetId}\n` +
        `📛 Tên        : ${nameShow}\n` +
        `⚧️ Giới tính  : ${gender}\n` +
        `💬 Bio        : ${bio}\n` +
        `🏢 Doanh nghiệp: ${biz}\n` +
        `🎂 Ngày sinh  : ${dob}\n` +
        `📞 Số điện thoại: ${phone}\n` +
        `🕐 Hoạt động lần cuối: ${lastAct}\n` +
        `📅 Ngày tạo TK: ${created}\n` +
        `🔒 Trạng thái : ${blocked}\n` +
        `💻 Windows    : ${pc}\n` +
        `🌐 Web        : ${web}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🖼️ Avatar: ${avatar}\n` +
        `🖼️ Ảnh bìa: ${cover}`
      );
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Lỗi không xác định";
      return send(`❌ Không thể lấy thông tin: ${msg}`);
    }
  },
};

/**
 * src/commands/code.js
 * Lệnh quản lý mã kích hoạt bot.
 * 
 * Owner/Admin:
 *   .code tao [soLan]       - Tạo mã kích hoạt (soLan = số lần dùng, 0 = vô hạn)
 *   .code ds                - Xem danh sách mã còn hiệu lực
 *   .code xoa <CODE>        - Xoá một mã
 *   .code khoa <threadId>   - Khoá (huỷ kích hoạt) nhóm/hội thoại
 *   .code dskt              - Danh sách nhóm đã kích hoạt
 *
 * Người dùng:
 *   .code <MAKHOA>          - Kích hoạt nhóm/hội thoại hiện tại
 */

const {
  generateCode,
  activateByCode,
  activateDirect,
  deactivate,
  deleteCode,
  listCodes,
  listActivated
} = require("../../includes/database/accessCode");

module.exports = {
  config: {
    name: "code",
    aliases: ["macode", "kichhoat"],
    version: "1.0.0",
    credits: "MiZai",
    description: "Quản lý mã kích hoạt bot",
    commandCategory: "Quản Trị",
    usages: ".code <mã> | .code tao | .code duyet | .code khoa | .code ds",
    hasPermssion: 0,
    cooldowns: 3
  },

  run: async ({ args, send, senderId, threadID, isBotAdmin }) => {
    const sub = (args[0] || "").toLowerCase();
    const isAdmin = isBotAdmin(senderId);

    if (!sub) {
      return send(
        "📋 Hướng dẫn sử dụng:\n" +
        "  .code <MÃ>          → Kích hoạt nhóm này bằng mã\n" +
        (isAdmin
          ? "  .code duyet [id]    → Duyệt thẳng box (không cần mã)\n" +
            "  .code khoa [id]     → Khoá box\n" +
            "  .code tao [n]       → Tạo mã (n = số lần, 0=vô hạn)\n" +
            "  .code ds            → Danh sách mã\n" +
            "  .code dskt          → Danh sách box đã duyệt\n" +
            "  .code xoa <mã>      → Xoá mã\n"
          : "")
      );
    }

    // ── Chỉ admin ─────────────────────────────────────────────────────────────
    if (sub === "duyet") {
      if (!isAdmin) return send("⛔ Chỉ Admin bot mới dùng được lệnh này.");
      const target = args[1] ? String(args[1]) : String(threadID);
      const result = activateDirect(target);
      return send(result.message);
    }

    if (sub === "tao") {
      if (!isAdmin) return send("⛔ Chỉ Admin bot mới dùng được lệnh này.");
      const uses = Number(args[1] ?? 1);
      if (isNaN(uses) || uses < 0) return send("❌ Số lần sử dụng không hợp lệ. (0 = vô hạn)");
      const note = args.slice(2).join(" ");
      const newCode = generateCode({ uses, note });
      const label = uses === 0 ? "vô hạn" : `${uses} lần`;
      return send(
        `✅ Đã tạo mã kích hoạt mới:\n` +
        `🔑 Mã: ${newCode}\n` +
        `🔄 Lượt dùng: ${label}` +
        (note ? `\n📝 Ghi chú: ${note}` : "")
      );
    }

    if (sub === "ds") {
      if (!isAdmin) return send("⛔ Chỉ Admin bot mới dùng được lệnh này.");
      const codes = listCodes();
      const entries = Object.entries(codes);
      if (entries.length === 0) return send("📭 Chưa có mã kích hoạt nào.");
      const lines = entries.map(([code, info]) => {
        const label = info.uses === -1 ? "vô hạn" : `còn ${info.uses} lần`;
        return `🔑 ${code} | ${label}${info.note ? ` | ${info.note}` : ""}`;
      });
      return send(`📋 Danh sách mã kích hoạt:\n${lines.join("\n")}`);
    }

    if (sub === "dskt") {
      if (!isAdmin) return send("⛔ Chỉ Admin bot mới dùng được lệnh này.");
      const list = listActivated();
      if (list.length === 0) return send("📭 Chưa có nhóm/hội thoại nào được kích hoạt.");
      return send(`✅ Danh sách đã kích hoạt (${list.length}):\n${list.join("\n")}`);
    }

    if (sub === "xoa") {
      if (!isAdmin) return send("⛔ Chỉ Admin bot mới dùng được lệnh này.");
      const target = (args[1] || "").toUpperCase();
      if (!target) return send("❌ Vui lòng nhập mã cần xoá. VD: .code xoa ABCD1234");
      const ok = deleteCode(target);
      return send(ok ? `🗑️ Đã xoá mã: ${target}` : `❌ Không tìm thấy mã: ${target}`);
    }

    if (sub === "khoa") {
      if (!isAdmin) return send("⛔ Chỉ Admin bot mới dùng được lệnh này.");
      const target = args[1] || threadID;
      const ok = deactivate(String(target));
      return send(ok
        ? `🔒 Đã khoá nhóm/hội thoại: ${target}`
        : `❌ Nhóm/hội thoại ${target} chưa được kích hoạt.`
      );
    }

    // ── Kích hoạt bằng mã ─────────────────────────────────────────────────────
    const inputCode = (args[0] || "").toUpperCase();
    const result = activateByCode(inputCode, threadID, senderId);
    return send(result.message);
  }
};

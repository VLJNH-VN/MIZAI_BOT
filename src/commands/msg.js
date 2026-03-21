const { isBotAdmin } = require("../../utils/bot/botManager");

module.exports = {
  config: {
    name: "msg",
    aliases: ["quickmsg", "qm"],
    version: "1.0.0",
    hasPermssion: 2,
    credits: "MIZAI",
    description: "Quản lý tin nhắn nhanh (quick message)",
    commandCategory: "Quản Trị",
    usages: [
      "quickmsg list | remove <id>         — Xem / xoá tin nhắn nhanh",
      "quickmsg add <tắt> | <nội_dung>     — Thêm tin nhắn nhanh",
      "quickmsg send <tắt>                  — Gửi tin nhắn nhanh",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ api, event, args, send, senderId, prefix, threadID }) => {
    if (!isBotAdmin(senderId)) return send("⛔ Chỉ Admin bot mới dùng được lệnh này.");

    const FLAG_MAP = { "-l": "list", "-a": "add", "-r": "remove", "-s": "send" };
    const sub = FLAG_MAP[args[0]] || (args[0] || "").toLowerCase();

    if (!sub) {
      return send(
        `⚡ QUICKMSG — TIN NHẮN NHANH\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${prefix}msg list|-l            Xem danh sách\n` +
        `${prefix}msg add|-a <tắt>|<nd>  Thêm tin nhắn nhanh\n` +
        `${prefix}msg remove|-r <id>     Xóa\n` +
        `${prefix}msg send|-s <tắt>      Gửi vào chat\n\n` +
        `💡 Ví dụ:\n${prefix}msg add xc | Xin chào! Mình là Mizai Bot.`
      );
    }

    try {
      switch (sub) {

        case "list": {
          const res = await api.getQuickMessageList();
          const items = res?.quickMessages || res?.data || res || [];
          if (!items.length) return send("📭 Chưa có tin nhắn nhanh nào.");
          const lines = items.map((item, i) => {
            const shortcut = item.shortcut || item.trigger || item.id || i;
            const msg = item.message || item.content || item.text || "";
            return `${i + 1}. [${shortcut}] → "${msg.slice(0, 50)}..."`;
          });
          return send(`⚡ TIN NHẮN NHANH (${items.length}):\n${lines.join("\n")}`);
        }

        case "add": {
          const fullText = args.slice(1).join(" ");
          const parts = fullText.split("|");
          if (parts.length < 2) {
            return send(`⚠️ Ví dụ: ${prefix}msg add xc | Xin chào bạn!`);
          }
          const shortcut = parts[0].trim();
          const message = parts.slice(1).join("|").trim();
          if (!shortcut || !message) return send("⚠️ Phím tắt và nội dung không được để trống.");

          await api.addQuickMessage({ shortcut, message });
          return send(`✅ Đã thêm tin nhắn nhanh:\n⚡ Phím tắt: "${shortcut}"\n💬 Nội dung: "${message}"`);
        }

        case "remove":
        case "rm":
        case "del": {
          const id = args[1];
          if (!id) return send(`⚠️ Ví dụ: ${prefix}msg remove xc`);
          await api.removeQuickMessage(id);
          return send(`✅ Đã xóa tin nhắn nhanh: "${id}"`);
        }

        case "send":
        case "use": {
          const shortcut = args[1];
          if (!shortcut) return send(`⚠️ Ví dụ: ${prefix}msg send xc`);
          const res = await api.getQuickMessageList();
          const items = res?.quickMessages || res?.data || res || [];
          const found = items.find(i => (i.shortcut || i.trigger || i.id) === shortcut);
          if (!found) return send(`❌ Không tìm thấy tin nhắn nhanh: "${shortcut}"`);
          const msg = found.message || found.content || found.text || "";
          await api.sendMessage({ msg }, threadID, event.type);
          break;
        }

        default:
          return send(`❌ Lệnh không hợp lệ. Dùng: ${prefix}msg để xem hướng dẫn.`);
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Lỗi không xác định";
      return send(`❌ Lỗi: ${msg}`);
    }
  },
};

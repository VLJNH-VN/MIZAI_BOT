const path = require("path");
const os = require("os");
const fs = require("fs");
const axios = require("axios");
const { isBotAdmin } = require("../../utils/bot/botManager");

module.exports = {
  config: {
    name: "mizai",
    aliases: ["botprofile", "btp"],
    version: "1.0.0",
    hasPermssion: 2,
    credits: "MIZAI",
    description: "Quản lý profile và cài đặt bot",
    commandCategory: "Quản Trị",
    usages: [
      "botprofile name <tên_mới>    — Đổi tên bot",
      "botprofile bio <nội_dung>    — Cập nhật bio bot",
      "botprofile avatar (reply)    — Đổi avatar bot",
      "botprofile qr [uid]          — Lấy QR code của tài khoản",
      "botprofile online            — Bật trạng thái online",
      "botprofile offline           — Tắt trạng thái online",
    ].join("\n"),
    cooldowns: 10,
  },

  run: async ({ api, event, args, send, senderId, prefix }) => {
    if (!isBotAdmin(senderId)) return send("⛔ Chỉ Admin bot mới dùng được lệnh này.");

    const FLAG_MAP = {
      "-n": "name", "-b": "bio", "-a": "avatar",
      "-q": "qr",   "-on": "online", "-off": "offline",
    };
    const sub = FLAG_MAP[args[0]] || (args[0] || "").toLowerCase();

    if (!sub) {
      return send(
        `🤖 BOTPROFILE — QUẢN LÝ BOT\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${prefix}mizai name|-n <tên>    Đổi tên bot\n` +
        `${prefix}mizai bio|-b <bio>     Cập nhật bio\n` +
        `${prefix}mizai avatar|-a        Đổi avatar (reply ảnh)\n` +
        `${prefix}mizai qr|-q [uid]      Lấy QR code\n` +
        `${prefix}mizai online|-on        Bật online\n` +
        `${prefix}mizai offline|-off      Tắt online`
      );
    }

    try {
      switch (sub) {

        case "name": {
          const newName = args.slice(1).join(" ").trim();
          if (!newName) return send(`⚠️ Ví dụ: ${prefix}mizai name Mizai Bot`);
          await api.updateProfile({ profile: { name: newName } });
          return send(`✅ Đã đổi tên bot thành: "${newName}"`);
        }

        case "bio": {
          const bio = args.slice(1).join(" ").trim();
          if (!bio) return send(`⚠️ Ví dụ: ${prefix}mizai bio Bot AI Zalo`);
          await api.updateProfileBio(bio);
          return send(`✅ Đã cập nhật bio: "${bio}"`);
        }

        case "avatar": {
          const raw = event?.data || {};
          const quoted = await global.resolveQuote({ raw, api, threadId: event.threadId, event });
          const imgUrl = quoted?.mediaUrl;

          if (!imgUrl) {
            return send(`⚠️ Reply một ảnh rồi dùng: ${prefix}mizai avatar`);
          }

          const tmpPath = path.join(os.tmpdir(), `botavatar_${Date.now()}.jpg`);
          const res = await axios.get(imgUrl, { responseType: "arraybuffer", timeout: 15000 });
          fs.writeFileSync(tmpPath, Buffer.from(res.data));

          await api.changeAccountAvatar(tmpPath);
          try { fs.unlinkSync(tmpPath); } catch {}
          return send("✅ Đã đổi avatar bot thành công!");
        }

        case "qr": {
          const targetId = args[1] || global.botId;
          if (!targetId) return send("❌ Không xác định được UID.");

          const res = await api.getQR(targetId);
          const qrUrl = res?.qrUrl || res?.url || res;

          if (!qrUrl) return send("❌ Không lấy được QR code.");

          if (typeof qrUrl === "string" && qrUrl.startsWith("http")) {
            const tmpPath = path.join(os.tmpdir(), `qr_${Date.now()}.png`);
            const imgRes = await axios.get(qrUrl, { responseType: "arraybuffer", timeout: 15000 });
            fs.writeFileSync(tmpPath, Buffer.from(imgRes.data));
            await api.sendMessage({ msg: `📱 QR Code của UID: ${targetId}`, attachments: [tmpPath] }, event.threadId, event.type);
            try { fs.unlinkSync(tmpPath); } catch {}
          } else {
            return send(`📱 QR Code URL:\n${JSON.stringify(qrUrl)}`);
          }
          break;
        }

        case "online": {
          await api.updateActiveStatus(true);
          return send("🟢 Đã bật trạng thái online.");
        }

        case "offline": {
          await api.updateActiveStatus(false);
          return send("⚫ Đã tắt trạng thái online.");
        }

        default:
          return send(`❌ Lệnh không hợp lệ. Dùng: ${prefix}mizai để xem hướng dẫn.`);
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Lỗi không xác định";
      return send(`❌ Lỗi: ${msg}`);
    }
  },
};

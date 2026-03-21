const { ThreadType } = require("zca-js");
const fs   = require("fs");
const path = require("path");
const os   = require("os");
const https = require("https");
const http  = require("http");

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    const file  = fs.createWriteStream(dest);
    proto.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

const SETTINGS_MAP = {
  "tenmoi"       : "blockName",
  "blockname"    : "blockName",
  "adminmsg"     : "signAdminMsg",
  "signadminmsg" : "signAdminMsg",
  "lichsu"       : "enableMsgHistory",
  "msghistory"   : "enableMsgHistory",
  "duyetthanhvien": "joinAppr",
  "joinappr"     : "joinAppr",
  "khoaghichu"   : "lockCreatePost",
  "locknote"     : "lockCreatePost",
  "khoapoll"     : "lockCreatePoll",
  "lockpoll"     : "lockCreatePoll",
  "khoaguitin"   : "lockSendMsg",
  "locksenddmsg" : "lockSendMsg",
};

module.exports = {
  config: {
    name: "setnhom",
    version: "1.0.0",
    hasPermssion: 1,
    credits: "MiZai",
    description: "Quản lý cài đặt nhóm: tên, avatar, link mời, quyền thành viên",
    commandCategory: "Nhóm",
    usages:
      "setnhom ten <tên mới>\n" +
      "setnhom link on|off\n" +
      "setnhom avatar (kèm ảnh quote)\n" +
      "setnhom setting <cai_dat> on|off",
    cooldowns: 5
  },

  run: async ({ api, event, args, send, isGroup, threadID }) => {
    if (!isGroup) return send("⚠️ Lệnh này chỉ dùng được trong nhóm.");

    const FLAG_MAP = { "-n": "ten", "-l": "link", "-a": "avatar", "-s": "setting" };
    const sub = FLAG_MAP[args[0]] || (args[0] || "").toLowerCase();

    if (!sub) {
      return send(
        "⚙️ Cài Đặt Nhóm — .setnhom\n" +
        "━━━━━━━━━━━━━━━━━━━━\n" +
        "• .setnhom ten|-n <tên mới>\n" +
        "  Đổi tên nhóm\n\n" +
        "• .setnhom link|-l on|off\n" +
        "  Bật/tắt link mời vào nhóm\n\n" +
        "• .setnhom avatar\n" +
        "  Đổi avatar nhóm (reply/tag ảnh kèm lệnh)\n\n" +
        "• .setnhom setting <cai_dat> on|off\n" +
        "  Cài đặt quyền thành viên:\n" +
        "  - blockname    : Cấm đổi tên/avatar nhóm\n" +
        "  - signadminmsg : Nổi bật tin admin\n" +
        "  - lichsu       : Cho xem lịch sử chat\n" +
        "  - duyetthanhvien: Duyệt thành viên trước khi vào\n" +
        "  - khoaghichu   : Khóa tạo ghi chú\n" +
        "  - khoapoll     : Khóa tạo poll\n" +
        "  - khoaguitin   : Khóa gửi tin nhắn"
      );
    }

    // ── Đổi tên nhóm ──────────────────────────────────────────────────────────
    if (sub === "ten") {
      const newName = args.slice(1).join(" ").trim();
      if (!newName) return send("❌ Thiếu tên mới. Dùng: .setnhom ten <tên mới>");
      if (newName.length > 100) return send("❌ Tên nhóm tối đa 100 ký tự.");

      try {
        await api.changeGroupName(newName, threadID);
        return send(`✅ Đã đổi tên nhóm thành: "${newName}"`);
      } catch (err) {
        return send(`❌ Đổi tên thất bại: ${err?.message || err}`);
      }
    }

    // ── Link mời ──────────────────────────────────────────────────────────────
    if (sub === "link") {
      const toggle = (args[1] || "").toLowerCase();
      if (!toggle || !["on", "off"].includes(toggle)) {
        return send("❌ Dùng: .setnhom link on|off");
      }

      try {
        if (toggle === "on") {
          const res = await api.enableGroupLink(threadID);
          return send(
            `✅ Đã bật link mời nhóm!\n` +
            `🔗 Link: ${res?.link || "(không lấy được link)"}\n` +
            `⏳ Hết hạn: ${res?.expiration_date ? new Date(res.expiration_date * 1000).toLocaleDateString("vi-VN") : "Không xác định"}`
          );
        } else {
          await api.disableGroupLink(threadID);
          return send("✅ Đã tắt link mời nhóm.");
        }
      } catch (err) {
        return send(`❌ Thao tác thất bại: ${err?.message || err}`);
      }
    }

    // ── Đổi avatar nhóm ───────────────────────────────────────────────────────
    if (sub === "avatar") {
      const raw    = event?.data || {};
      const quote  = raw?.quote || raw?.replyMsg || null;

      let imageUrl = null;

      // Tìm URL ảnh trong quote
      if (quote) {
        const c = quote.content;
        imageUrl = quote.normalUrl || quote.hdUrl || quote.thumbUrl ||
                   (c && typeof c === "object"
                     ? (c.normalUrl || c.hdUrl || c.thumbUrl || c.href)
                     : null);
      }

      // Tìm attachment trực tiếp trong message
      if (!imageUrl) {
        const attachs = raw?.attachments || raw?.media || [];
        for (const a of attachs) {
          if (a.url) { imageUrl = a.url; break; }
        }
      }

      if (!imageUrl) {
        return send(
          "❌ Không tìm thấy ảnh.\n" +
          "💡 Cách dùng: Reply/tag một ảnh rồi gõ .setnhom avatar"
        );
      }

      let tmpFile = null;
      try {
        const ext  = imageUrl.split("?")[0].split(".").pop().toLowerCase() || "jpg";
        tmpFile    = path.join(os.tmpdir(), `group_avatar_${Date.now()}.${ext}`);
        await downloadFile(imageUrl, tmpFile);

        await api.changeGroupAvatar(tmpFile, threadID);
        return send("✅ Đã đổi avatar nhóm thành công!");
      } catch (err) {
        return send(`❌ Đổi avatar thất bại: ${err?.message || err}`);
      } finally {
        if (tmpFile) try { fs.unlinkSync(tmpFile); } catch {}
      }
    }

    // ── Cài đặt quyền ─────────────────────────────────────────────────────────
    if (sub === "setting" || sub === "caidat") {
      const settingKey = (args[1] || "").toLowerCase();
      const toggle     = (args[2] || "").toLowerCase();

      if (!settingKey || !toggle || !["on", "off"].includes(toggle)) {
        return send(
          "❌ Dùng: .setnhom setting <cai_dat> on|off\n" +
          "Các cài đặt: blockname, signadminmsg, lichsu, duyetthanhvien, khoaghichu, khoapoll, khoaguitin"
        );
      }

      const apiKey = SETTINGS_MAP[settingKey];
      if (!apiKey) {
        return send(
          `❌ Cài đặt "${settingKey}" không hợp lệ.\n` +
          "Gõ .setnhom để xem danh sách cài đặt hợp lệ."
        );
      }

      const value = toggle === "on";
      try {
        await api.updateGroupSettings({ [apiKey]: value }, threadID);
        return send(`✅ Đã ${value ? "bật" : "tắt"} cài đặt: ${settingKey}`);
      } catch (err) {
        return send(`❌ Cập nhật cài đặt thất bại: ${err?.message || err}`);
      }
    }

    return send("❓ Sub-command không hợp lệ. Gõ .setnhom để xem hướng dẫn.");
  }
};

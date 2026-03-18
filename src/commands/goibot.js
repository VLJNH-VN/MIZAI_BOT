const path = require("path");
const { handleGoibot, handleNewUser, setEnabled } = require("../../utils/ai/goibot");
const { fileHelpers } = require("./file");

const {
  buildFolderListing,
  convertBytes,
  sizeFolder,
  zipToStream,
  catboxUpload,
  pastebinUpload,
  extractBody,
} = fileHelpers;

module.exports = {
  config: {
    name: "goibot",
    version: "6.0.0",
    hasPermssion: 0,
    credits: "Lizi / MiZai",
    description: "Mizai AI — chat, nhạc, tính toán, sticker, reaction + quản lý file",
    commandCategory: "Admin",
    usages: [
      ".goibot on|off           — Bật/tắt Mizai AI cho nhóm",
      ".goibot file [đường dẫn] — Xem thư mục (admin)",
      "Sau khi xem thư mục, reply với:",
      "  open/del/view/read/edit/info/search/refresh/send/create/copy/rename/zip",
    ].join("\n"),
    cooldowns: 2,
  },

  run: async ({ api, send, args, event, threadID, senderId, isBotAdmin, registerReply }) => {
    try {
      const sub = (args[0] || "").toLowerCase();

      // ── Bật / Tắt Mizai AI ──────────────────────────────────────────────
      if (sub === "on") {
        setEnabled(event.threadId, true);
        return send("✅ Mizai đã được bật cho nhóm này.");
      }
      if (sub === "off") {
        setEnabled(event.threadId, false);
        return send("☑️ Mizai đã được tắt cho nhóm này.");
      }

      // ── Quản lý file (chỉ admin bot) ────────────────────────────────────
      if (sub === "file") {
        if (!isBotAdmin(senderId)) return send("⛔ Chỉ admin bot mới dùng được tính năng này.");

        const dir = path.join(process.cwd(), args[1] || "");

        const fs = require("fs");
        if (!fs.existsSync(dir))              return send(`❌ Đường dẫn không tồn tại:\n${dir}`);
        if (!fs.statSync(dir).isDirectory())  return send(`❌ Đây không phải thư mục:\n${dir}`);

        let listing;
        try {
          listing = buildFolderListing(dir);
        } catch (err) {
          return send(`❌ Không thể đọc thư mục:\n${err.message}`);
        }

        const msg = await api.sendMessage(
          { msg: `📂 ${dir}\n\n${listing.txt}` },
          threadID,
          event.type
        );

        const messageId = msg?.message?.msgId || msg?.msgId;
        if (messageId) {
          registerReply({
            messageId,
            commandName: "goibot",
            ttl: 15 * 60 * 1000,
            payload: { mode: "file", data: listing.array, directory: dir + path.sep },
          });
        }
        return;
      }

      // ── Không có tham số hợp lệ ─────────────────────────────────────────
      return send(
        "⚙️ Dùng:\n" +
        "  .goibot on            — Bật Mizai AI\n" +
        "  .goibot off           — Tắt Mizai AI\n" +
        "  .goibot file [path]   — Xem file máy chủ (admin)"
      );
    } catch (err) {
      global.logError?.("Lỗi goibot: " + (err?.message || err));
      return send("❌ Đã có lỗi xảy ra!");
    }
  },

  // ── Xử lý reply (quản lý file) ────────────────────────────────────────────
  onReply: async ({ api, event, data, send, threadID, registerReply }) => {
    if (data?.mode !== "file") return;

    const fs       = require("fs");
    const raw      = event?.data ?? {};
    const senderId = String(raw?.uidFrom || "");
    const { isBotAdmin } = require("../../utils/bot/admin");
    if (!isBotAdmin(senderId)) return;

    const body   = extractBody(raw).trim();
    if (!body || body.length < 2) return;

    const parts  = body.split(/\s+/);
    const action = parts[0].toLowerCase();
    const { data: items, directory } = data;

    async function replyAndRegister(text, newPayload) {
      const msg = await api.sendMessage({ msg: text }, threadID, event.type);
      const messageId = msg?.message?.msgId || msg?.msgId;
      if (messageId && newPayload) {
        registerReply({ messageId, commandName: "goibot", ttl: 15 * 60 * 1000, payload: newPayload });
      }
    }

    function getItem(idxStr) {
      const i = parseInt(idxStr, 10) - 1;
      return (!isNaN(i) && items[i]) ? items[i] : null;
    }

    try {
      switch (action) {

        case "open": {
          const item = getItem(parts[1]);
          if (!item) return send("❌ Số thứ tự không hợp lệ.");
          if (!item.info.isDirectory()) return send("⚠️ Mục này không phải thư mục.");
          const listing = buildFolderListing(item.dest);
          await replyAndRegister(
            `📂 ${item.dest}\n\n${listing.txt}`,
            { mode: "file", data: listing.array, directory: item.dest + path.sep }
          );
          break;
        }

        case "del": {
          if (parts.length < 2) return send("❌ Nhập số thứ tự cần xóa. Ví dụ: del 1 3");
          const deleted = [];
          for (const idxStr of parts.slice(1)) {
            const item = getItem(idxStr);
            if (!item) continue;
            const name = path.basename(item.dest);
            if (item.info.isFile())           { fs.unlinkSync(item.dest);                         deleted.push(`📄 ${idxStr}. ${name}`); }
            else if (item.info.isDirectory()) { fs.rmdirSync(item.dest, { recursive: true });      deleted.push(`🗂️ ${idxStr}. ${name}`); }
          }
          send(deleted.length ? `✅ Đã xóa:\n${deleted.join("\n")}` : "❌ Không có mục nào được xóa.");
          break;
        }

        case "view": {
          const item = getItem(parts[1]);
          if (!item) return send("❌ Số thứ tự không hợp lệ.");
          if (!item.info.isFile()) return send("⚠️ Chỉ xem được file.");
          let srcPath = item.dest;
          let tmpPath = null;
          if (/\.js$/i.test(srcPath)) {
            tmpPath = path.join(require("os").tmpdir(), `goibot_view_${Date.now()}.txt`);
            fs.copyFileSync(srcPath, tmpPath);
            srcPath = tmpPath;
          }
          try {
            await api.sendMessage({ msg: "", attachments: [srcPath] }, threadID, event.type);
          } finally {
            if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
          }
          break;
        }

        case "send": {
          const item = getItem(parts[1]);
          if (!item) return send("❌ Số thứ tự không hợp lệ.");
          if (!item.info.isFile()) return send("⚠️ Chỉ gửi được file.");
          const content = fs.readFileSync(item.dest, "utf8");
          const link = await pastebinUpload(content);
          send(link ? `🔗 Link nội dung file:\n${link}` : "❌ Upload thất bại.");
          break;
        }

        case "create": {
          const nameArg = parts[1];
          if (!nameArg) return send("❌ Nhập tên file/folder.\nVí dụ:\n  create tenfolder/\n  create file.txt nội dung");
          const isDir    = nameArg.endsWith("/");
          const fullPath = path.join(directory, nameArg);
          if (isDir) {
            fs.mkdirSync(fullPath, { recursive: true });
            send(`✅ Đã tạo folder: ${nameArg}`);
          } else {
            const content = parts.slice(2).join(" ");
            if (!fs.existsSync(path.dirname(fullPath))) fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content, "utf8");
            send(`✅ Đã tạo file: ${nameArg}`);
          }
          break;
        }

        case "copy": {
          const item = getItem(parts[1]);
          if (!item) return send("❌ Số thứ tự không hợp lệ.");
          if (!item.info.isFile()) return send("⚠️ Chỉ sao chép được file.");
          const ext  = path.extname(item.dest);
          const base = path.basename(item.dest, ext);
          const dest = path.join(path.dirname(item.dest), `${base} (COPY)${ext}`);
          fs.copyFileSync(item.dest, dest);
          send(`✅ Đã sao chép → ${path.basename(dest)}`);
          break;
        }

        case "rename": {
          const item    = getItem(parts[1]);
          const newName = parts[2];
          if (!item)    return send("❌ Số thứ tự không hợp lệ.");
          if (!newName) return send("❌ Nhập tên mới. Ví dụ: rename 2 tenMoi.js");
          const newPath = path.join(path.dirname(item.dest), newName);
          fs.renameSync(item.dest, newPath);
          send(`✅ Đã đổi tên → ${newName}`);
          break;
        }

        case "zip": {
          const indices = parts.slice(1);
          if (indices.length === 0) return send("❌ Nhập số thứ tự cần nén. Ví dụ: zip 1 3");
          const srcPaths = indices.map(i => getItem(i)?.dest).filter(Boolean);
          if (srcPaths.length === 0) return send("❌ Không tìm thấy mục nào hợp lệ.");
          send(`⏳ Đang nén ${srcPaths.length} mục và upload...`);
          try {
            const zipStream = zipToStream(srcPaths);
            const link = await catboxUpload(zipStream);
            send(`✅ Upload xong!\n🔗 Link: ${link}`);
          } catch (err) {
            send(`❌ Lỗi khi zip/upload:\n${err.message}`);
          }
          break;
        }

        // ── Đọc nội dung file (hiển thị inline) ─────────────────────────────
        case "read": {
          const item = getItem(parts[1]);
          if (!item) return send("❌ Số thứ tự không hợp lệ.");
          if (!item.info.isFile()) return send("⚠️ Chỉ đọc được file, không phải thư mục.");
          try {
            const content = fs.readFileSync(item.dest, "utf8");
            const MAX = 2000;
            const trimmed = content.length > MAX
              ? content.slice(0, MAX) + `\n...(còn ${content.length - MAX} ký tự)`
              : content;
            send(`📄 ${path.basename(item.dest)}\n━━━━━━━━━━━━━━━━\n${trimmed}`);
          } catch (err) {
            send(`❌ Không đọc được file:\n${err.message}`);
          }
          break;
        }

        // ── Ghi đè nội dung file ─────────────────────────────────────────────
        case "edit": {
          const item = getItem(parts[1]);
          if (!item) return send("❌ Số thứ tự không hợp lệ.");
          if (!item.info.isFile()) return send("⚠️ Chỉ chỉnh sửa được file.");
          const newContent = parts.slice(2).join(" ");
          if (!newContent) return send("❌ Nhập nội dung mới.\nVí dụ: edit 2 nội dung mới ở đây");
          fs.writeFileSync(item.dest, newContent, "utf8");
          send(`✅ Đã ghi nội dung mới vào: ${path.basename(item.dest)}`);
          break;
        }

        // ── Xem thông tin chi tiết file/folder ──────────────────────────────
        case "info": {
          const item = getItem(parts[1]);
          if (!item) return send("❌ Số thứ tự không hợp lệ.");
          const stat = item.info;
          const size = stat.isDirectory() ? sizeFolder(item.dest) : stat.size;
          const lines = [
            `📋 Thông tin: ${path.basename(item.dest)}`,
            `━━━━━━━━━━━━━━━━`,
            `• Loại     : ${stat.isDirectory() ? "📁 Thư mục" : "📄 File"}`,
            `• Đường dẫn: ${item.dest}`,
            `• Dung lượng: ${convertBytes(size)}`,
            `• Tạo lúc  : ${new Date(stat.birthtimeMs).toLocaleString("vi-VN")}`,
            `• Sửa lúc  : ${new Date(stat.mtimeMs).toLocaleString("vi-VN")}`,
          ];
          send(lines.join("\n"));
          break;
        }

        // ── Tìm kiếm file theo tên ───────────────────────────────────────────
        case "search": {
          const keyword = parts.slice(1).join(" ").toLowerCase();
          if (!keyword) return send("❌ Nhập từ khoá tìm kiếm.\nVí dụ: search config");
          const matched = items
            .map((item, i) => ({ item, idx: i + 1, name: path.basename(item.dest) }))
            .filter(({ name }) => name.toLowerCase().includes(keyword));
          if (!matched.length) return send(`🔍 Không tìm thấy file nào chứa: "${keyword}"`);
          const lines = matched.map(({ item, idx, name }) => {
            const icon = item.info.isDirectory() ? "🗂️" : "📄";
            return `${idx}. ${icon} ${name}`;
          });
          send(`🔍 Kết quả tìm "${keyword}":\n━━━━━━━━━━━━━━━━\n${lines.join("\n")}`);
          break;
        }

        // ── Làm mới danh sách thư mục hiện tại ──────────────────────────────
        case "refresh": {
          const currentDir = directory.endsWith(path.sep)
            ? directory.slice(0, -1)
            : directory;
          if (!fs.existsSync(currentDir)) return send("❌ Thư mục không còn tồn tại.");
          const listing = buildFolderListing(currentDir);
          await replyAndRegister(
            `🔄 ${currentDir}\n\n${listing.txt}`,
            { mode: "file", data: listing.array, directory: currentDir + path.sep }
          );
          break;
        }

        default:
          send(
            "❌ Lệnh không hợp lệ.\n📌 Hỗ trợ:\n" +
            "  open <stt>            — Mở thư mục\n" +
            "  del <stt> [...]       — Xóa file/folder\n" +
            "  view <stt>            — Gửi file đính kèm\n" +
            "  read <stt>            — Đọc nội dung file (text)\n" +
            "  edit <stt> <nội dung> — Ghi đè nội dung file\n" +
            "  info <stt>            — Xem thông tin chi tiết\n" +
            "  search <từ khoá>      — Tìm kiếm theo tên\n" +
            "  refresh               — Làm mới danh sách\n" +
            "  send <stt>            — Upload lên pastebin\n" +
            "  create <tên> [text]   — Tạo file/folder\n" +
            "  copy <stt>            — Sao chép file\n" +
            "  rename <stt> <tên>    — Đổi tên\n" +
            "  zip <stt> [...]       — Nén và upload"
          );
      }
    } catch (err) {
      global.logError?.(`[goibot/file] ${err.message}`);
      send(`❌ Lỗi xử lý:\n${err.message}`);
    }
  },

  onMessage: ({ api, event }) => handleGoibot({ api, event }),
  onNewUser: ({ api, threadId, userId }) => handleNewUser({ api, threadId, userId }),
};

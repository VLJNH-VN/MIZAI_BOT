"use strict";

const fs = require("fs");
const {
  readFileSync, readdirSync, statSync, unlinkSync,
  rmdirSync, copyFileSync, existsSync, renameSync, mkdirSync, createWriteStream
} = fs;
const path   = require("path");
const axios  = require("axios");
const FormData = require("form-data");
const archiver = require("archiver");
const os     = require("os");

const TMP_DIR = path.join(process.cwd(), "includes", "cache");

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function convertBytes(bytes) {
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  if (bytes === 0) return "0 Byte";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i), 2) + " " + sizes[i];
}

function sizeFolder(folder) {
  let bytes = 0;
  try {
    for (const file of readdirSync(folder)) {
      try {
        const p = path.join(folder, file);
        const info = statSync(p);
        bytes += info.isDirectory() ? sizeFolder(p) : info.size;
      } catch {}
    }
  } catch {}
  return bytes;
}

/** Đọc nội dung thư mục, trả về { txt, array } */
function buildFolderListing(dir) {
  const entries = readdirSync(dir);
  const folders = [], files = [];

  for (const e of entries) {
    const full = path.join(dir, e);
    try {
      statSync(full).isDirectory() ? folders.push(e) : files.push(e);
    } catch {}
  }

  folders.sort((a, b) => a.localeCompare(b));
  files.sort((a, b) => a.localeCompare(b));

  let txt = "", count = 0, totalBytes = 0;
  const array = [];

  for (const name of [...folders, ...files]) {
    const dest = path.join(dir, name);
    try {
      const info = statSync(dest);
      const size = info.isDirectory() ? sizeFolder(dest) : info.size;
      totalBytes += size;
      const icon = info.isDirectory() ? "🗂️" : "📄";
      txt += `${++count}. ${icon} ${name} (${convertBytes(size)})\n`;
      array.push({ dest, info });
    } catch {}
  }

  txt += `\n📊 Tổng dung lượng: ${convertBytes(totalBytes)}\n`;
  txt += `📌 Reply: [open | del | view | send | create | zip | copy | rename] + số thứ tự`;

  return { txt, array };
}

/** Nén nhiều file/folder thành buffer zip rồi upload lên catbox.moe */
function zipToStream(srcPaths) {
  const archive = archiver("zip", { zlib: { level: 9 } });

  for (const p of srcPaths) {
    if (!existsSync(p)) continue;
    const s = statSync(p);
    if (s.isFile())           archive.file(p, { name: path.basename(p) });
    else if (s.isDirectory()) archive.directory(p, path.basename(p));
  }
  archive.finalize();
  return archive;
}

async function catboxUpload(stream) {
  const fd = new FormData();
  fd.append("reqtype", "fileupload");
  fd.append("fileToUpload", stream, { filename: "archive.zip" });
  const res = await axios.post("https://catbox.moe/user/api.php", fd, {
    headers: fd.getHeaders(),
    responseType: "text",
    timeout: 60000
  });
  return res.data.trim();
}

/** Upload nội dung text lên pastebin tạm */
async function pastebinUpload(text) {
  try {
    const res = await axios.post("https://api.mocky.io/api/mock", {
      status: 200,
      content: text,
      content_type: "text/plain",
      charset: "UTF-8",
      secret: "zalobot",
      expiration: "never"
    }, { timeout: 15000 });
    return res.data.link || null;
  } catch {
    return null;
  }
}

/** Trích body từ event.data (hỗ trợ cả string và object) */
function extractBody(raw) {
  if (!raw) return "";
  if (typeof raw.content === "string") return raw.content;
  if (raw.content?.text) return raw.content.text;
  return "";
}

// ─────────────────────────────────────────────────────────────────────────────
//  Module export
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Helpers dùng chung — import bằng: require("./file").fileHelpers
  fileHelpers: {
    buildFolderListing,
    convertBytes,
    sizeFolder,
    zipToStream,
    catboxUpload,
    pastebinUpload,
    extractBody,
    TMP_DIR,
  },

  config: {
    name: "file",
    version: "2.0.0",
    hasPermssion: 2,
    credits: "Niio-team (DC-Nam) — converted by Bot",
    description: "Xem, mở, xóa, tải, nén file/folder trên máy chủ",
    commandCategory: "Admin",
    usages: ".file [đường dẫn]",
    cooldowns: 0
  },

  // ── Lệnh gốc: mở thư mục ──────────────────────────────────────────────────
  run: async ({ api, event, args, send, senderId, threadID, isBotAdmin, registerReply }) => {
    if (!isBotAdmin(senderId)) return send("⛔ Chỉ admin bot mới dùng được lệnh này.");

    const dir = path.join(process.cwd(), args[0] || "");

    if (!existsSync(dir)) return send(`❌ Đường dẫn không tồn tại:\n${dir}`);
    if (!statSync(dir).isDirectory()) return send(`❌ Đây không phải thư mục:\n${dir}`);

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
        commandName: "file",
        ttl: 15 * 60 * 1000,
        payload: { data: listing.array, directory: dir + path.sep }
      });
    }
  },

  // ── Xử lý reply ───────────────────────────────────────────────────────────
  onReply: async ({ api, event, data, send, threadID, registerReply }) => {
    const raw      = event?.data ?? {};
    const senderId = String(raw?.uidFrom || "");
    const { isBotAdmin } = require("../../utils/bot/botManager");

    if (!isBotAdmin(senderId)) return;

    const body = extractBody(raw).trim();
    if (!body || body.length < 2) return;

    const parts  = body.split(/\s+/);
    const action = parts[0].toLowerCase();
    const { data: items, directory } = data;

    // ── Hàm tiện ích: gửi tin + đăng ký reply lại ──────────────────────────
    async function replyAndRegister(text, newPayload) {
      const msg = await api.sendMessage({ msg: text }, threadID, event.type);
      const messageId = msg?.message?.msgId || msg?.msgId;
      if (messageId && newPayload) {
        registerReply({
          messageId,
          commandName: "file",
          ttl: 15 * 60 * 1000,
          payload: newPayload
        });
      }
    }

    // ── Lấy item theo số thứ tự (1-based) ───────────────────────────────────
    function getItem(idxStr) {
      const i = parseInt(idxStr, 10) - 1;
      return (!isNaN(i) && items[i]) ? items[i] : null;
    }

    try {
      switch (action) {

        // ── Mở thư mục ──────────────────────────────────────────────────────
        case "open": {
          const item = getItem(parts[1]);
          if (!item) return send("❌ Số thứ tự không hợp lệ.");
          if (!item.info.isDirectory()) return send("⚠️ Mục này không phải thư mục.");

          const listing = buildFolderListing(item.dest);
          await replyAndRegister(
            `📂 ${item.dest}\n\n${listing.txt}`,
            { data: listing.array, directory: item.dest + path.sep }
          );
          break;
        }

        // ── Xóa một hoặc nhiều file/folder ──────────────────────────────────
        case "del": {
          if (parts.length < 2) return send("❌ Nhập số thứ tự cần xóa. Ví dụ: del 1 3 5");

          const deleted = [];
          for (const idxStr of parts.slice(1)) {
            const item = getItem(idxStr);
            if (!item) continue;
            const name = path.basename(item.dest);
            if (item.info.isFile())            { unlinkSync(item.dest); deleted.push(`📄 ${idxStr}. ${name}`); }
            else if (item.info.isDirectory())  { rmdirSync(item.dest, { recursive: true }); deleted.push(`🗂️ ${idxStr}. ${name}`); }
          }

          send(deleted.length
            ? `✅ Đã xóa:\n${deleted.join("\n")}`
            : "❌ Không có mục nào được xóa."
          );
          break;
        }

        // ── Xem nội dung file (gửi file đính kèm) ───────────────────────────
        case "view": {
          const item = getItem(parts[1]);
          if (!item) return send("❌ Số thứ tự không hợp lệ.");
          if (!item.info.isFile()) return send("⚠️ Chỉ xem được file, không phải thư mục.");

          let srcPath = item.dest;
          let tmpPath = null;

          // .js → copy sang .txt để gửi (tránh bị chặn extension)
          if (/\.js$/i.test(srcPath)) {
            tmpPath = path.join(TMP_DIR, `file_view_${Date.now()}.txt`);
            if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
            copyFileSync(srcPath, tmpPath);
            srcPath = tmpPath;
          }

          try {
            await api.sendMessage(
              { msg: "", attachments: [srcPath] },
              threadID,
              event.type
            );
          } finally {
            if (tmpPath && existsSync(tmpPath)) unlinkSync(tmpPath);
          }
          break;
        }

        // ── Gửi nội dung file lên pastebin ──────────────────────────────────
        case "send": {
          const item = getItem(parts[1]);
          if (!item) return send("❌ Số thứ tự không hợp lệ.");
          if (!item.info.isFile()) return send("⚠️ Chỉ gửi được file, không phải thư mục.");

          const content = readFileSync(item.dest, "utf8");
          const link = await pastebinUpload(content);
          send(link ? `🔗 Link nội dung file:\n${link}` : "❌ Upload lên pastebin thất bại.");
          break;
        }

        // ── Tạo file hoặc folder ─────────────────────────────────────────────
        case "create": {
          // Ví dụ: create tenfolder/   hoặc  create file.txt nội dung ở đây
          const nameArg = parts[1];
          if (!nameArg) return send("❌ Nhập tên file/folder.\nVí dụ:\n  create tenfolder/\n  create file.txt nội dung");

          const isDir    = nameArg.endsWith("/");
          const fullPath = path.join(directory, nameArg);

          if (isDir) {
            mkdirSync(fullPath, { recursive: true });
            send(`✅ Đã tạo folder: ${nameArg}`);
          } else {
            const content = parts.slice(2).join(" ");
            if (!existsSync(path.dirname(fullPath))) mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content, "utf8");
            send(`✅ Đã tạo file: ${nameArg}`);
          }
          break;
        }

        // ── Sao chép file ────────────────────────────────────────────────────
        case "copy": {
          const item = getItem(parts[1]);
          if (!item) return send("❌ Số thứ tự không hợp lệ.");
          if (!item.info.isFile()) return send("⚠️ Chỉ sao chép được file.");

          const ext     = path.extname(item.dest);
          const base    = path.basename(item.dest, ext);
          const destCopy = path.join(path.dirname(item.dest), `${base} (COPY)${ext}`);
          copyFileSync(item.dest, destCopy);
          send(`✅ Đã sao chép → ${path.basename(destCopy)}`);
          break;
        }

        // ── Đổi tên ──────────────────────────────────────────────────────────
        case "rename": {
          const item    = getItem(parts[1]);
          const newName = parts[2];
          if (!item)    return send("❌ Số thứ tự không hợp lệ.");
          if (!newName) return send("❌ Nhập tên mới. Ví dụ: rename 2 tenMoi.js");

          const newPath = path.join(path.dirname(item.dest), newName);
          renameSync(item.dest, newPath);
          send(`✅ Đã đổi tên → ${newName}`);
          break;
        }

        // ── Zip và upload lên catbox.moe ─────────────────────────────────────
        case "zip": {
          const indices = parts.slice(1);
          if (indices.length === 0) return send("❌ Nhập số thứ tự cần nén. Ví dụ: zip 1 3");

          const srcPaths = indices
            .map(i => getItem(i)?.dest)
            .filter(Boolean);

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

        // ── Lệnh không hợp lệ ────────────────────────────────────────────────
        default:
          send(
            "❌ Lệnh không hợp lệ.\n" +
            "📌 Các lệnh hỗ trợ:\n" +
            "  open <stt>            — Mở thư mục\n" +
            "  del <stt> [stt...]    — Xóa file/folder\n" +
            "  view <stt>            — Xem nội dung file\n" +
            "  send <stt>            — Upload file lên pastebin\n" +
            "  create <tên> [text]   — Tạo file/folder\n" +
            "  copy <stt>            — Sao chép file\n" +
            "  rename <stt> <tên>    — Đổi tên\n" +
            "  zip <stt> [stt...]    — Nén và upload"
          );
      }
    } catch (err) {
      logError(`[file] onReply lỗi: ${err.message}`);
      send(`❌ Lỗi xử lý:\n${err.message}`);
    }
  }
};

"use strict";

/**
 * src/commands/api.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Quản lý kho link media (ảnh/video/audio) được mã hóa base64 và lưu trên GitHub.
 *
 * Lệnh:
 *   api add <tên>  — Reply vào tin nhắn có media để mã hóa & upload GitHub
 *   api check      — Xem danh sách kho, reply STT kiểm tra / "del N" xóa kho
 *   api del <tên>  — Xóa kho link theo tên
 *   api get <tên>  — Lấy ngẫu nhiên 1 link từ kho
 *
 * Sau lệnh check:
 *   • Reply STT   → kiểm tra link sống/chết của kho đó
 *   • Reply del N → xóa kho tương ứng
 *   • Thả 👍 vào kết quả check → tự lọc link chết
 */

const fs    = require("fs");
const path  = require("path");
const os    = require("os");

const LIST_API_DIR = path.join(__dirname, "../../includes/listapi");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function khoPath(name) {
  return path.join(LIST_API_DIR, `${name}.json`);
}

function readKho(name) {
  try {
    const p = khoPath(name);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (_) {}
  return [];
}

function writeKho(name, arr) {
  ensureDir(LIST_API_DIR);
  fs.writeFileSync(khoPath(name), JSON.stringify(arr, null, 2), "utf-8");
}

function listKho() {
  ensureDir(LIST_API_DIR);
  try {
    return fs.readdirSync(LIST_API_DIR).filter(f => f.endsWith(".json"));
  } catch (_) {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tải file về temp → mã hóa base64 → upload GitHub → trả về rawUrl
// ─────────────────────────────────────────────────────────────────────────────

async function uploadToGithub(url, khoName, extHint) {
  // Xác định extension — ưu tiên hint từ item.ext, rồi từ URL, fallback ".mp4" nếu có "video" trong URL
  const extMatch = url.split("?")[0].match(/\.(mp4|mkv|avi|mov|webm|jpg|jpeg|png|gif|webp|mp3|aac|m4a|ogg|wav)$/i);
  const ext = extHint
    ? (extHint.startsWith(".") ? extHint : "." + extHint).toLowerCase()
    : extMatch
      ? extMatch[0].toLowerCase()
      : /video|mp4|mov/i.test(url) ? ".mp4" : ".jpg";

  const tmpPath = path.join(os.tmpdir(), `api_${Date.now()}${ext}`);

  try {
    // Download file từ Zalo CDN
    const resp = await global.axios.get(url, {
      responseType: "arraybuffer",
      timeout: 60000,
    });
    fs.writeFileSync(tmpPath, Buffer.from(resp.data));

    // Upload lên GitHub (base64 encode bên trong githubMedia)
    const result = await global.githubMedia.upload(tmpPath, {
      folder: `media/${khoName}`,
      key: `${khoName}_${Date.now()}`,
    });

    return result.rawUrl;
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Kiểm tra link sống/chết (theo chunk để không timeout)
// ─────────────────────────────────────────────────────────────────────────────

async function checkLinks(links) {
  const CHUNK = 10;
  let live = 0, dead = 0;

  for (let i = 0; i < links.length; i += CHUNK) {
    await Promise.all(links.slice(i, i + CHUNK).map(async (url) => {
      try {
        const r = await global.axios.head(url, { timeout: 8000 });
        r.status === 200 ? live++ : dead++;
      } catch (_) { dead++; }
    }));
  }
  return { live, dead };
}

async function filterLiveLinks(links) {
  const CHUNK = 10;
  const live  = [];

  for (let i = 0; i < links.length; i += CHUNK) {
    await Promise.all(links.slice(i, i + CHUNK).map(async (url) => {
      try {
        const r = await global.axios.head(url, { timeout: 8000 });
        if (r.status === 200) live.push(url);
      } catch (_) {}
    }));
  }
  return live;
}

// ─────────────────────────────────────────────────────────────────────────────
// Export lệnh
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name: "api",
    version: "2.2.0",
    hasPermssion: 2,
    credits: "DongDev (port: MiZai)",
    description: "Quản lý kho link media mã hóa base64 lưu trên GitHub",
    commandCategory: "Admin",
    usages: [
      "api add <tên>  — Reply vào media để upload GitHub",
      "api check      — Xem danh sách kho",
      "api del <tên>  — Xóa kho",
      "api get <tên>  — Lấy link ngẫu nhiên",
    ].join("\n"),
    cooldowns: 5,
  },

  // ── run ─────────────────────────────────────────────────────────────────────
  run: async ({ api, event, args, send, threadID, registerReply, registerReaction }) => {
    try {
      ensureDir(LIST_API_DIR);
      const raw = event?.data || {};
      const sub = (args[0] || "").toLowerCase().trim();

      // ── api add <tên> ────────────────────────────────────────────────────
      if (sub === "add") {
        if (!args[1]) return send("⚠️ Vui lòng nhập tên kho.\nVí dụ: api add gai");

        const khoName = args[1].trim();

        // Lấy attachments từ tin nhắn reply
        // zca-js có thể để media ở replyMsg.attach[] hoặc trực tiếp trong replyMsg.content
        const replyMsg = raw?.msgReply || raw?.quote || raw?.replyMsg || null;

        let attachments = Array.isArray(replyMsg?.attach) ? [...replyMsg.attach] : [];

        // Fallback: media nằm trong replyMsg.content (thường gặp khi reply video người khác)
        if (attachments.length === 0 && replyMsg) {
          const c = replyMsg.content;
          if (c && typeof c === "object") {
            const url =
              c.url || c.normalUrl || c.hdUrl || c.href ||
              c.fileUrl || c.downloadUrl || c.src;
            if (url) attachments = [{ url, ext: c.ext }];
          } else if (typeof c === "string") {
            // content là JSON string chứa media (trường hợp mention kèm video)
            try {
              const parsed = JSON.parse(c);
              const url =
                parsed.url || parsed.normalUrl || parsed.hdUrl ||
                parsed.href || parsed.fileUrl;
              if (url) attachments = [{ url, ext: parsed.ext }];
            } catch (_) {}
          }
        }

        if (!replyMsg || attachments.length === 0) {
          return send(
            "⚠️ Không tìm thấy media trong tin nhắn được reply.\n" +
            "Hãy reply vào tin nhắn có ảnh/video/audio, rồi dùng:\n" +
            `  api add ${khoName}`
          );
        }

        await send(`⏳ Đang mã hóa và upload ${attachments.length} file lên GitHub...`);

        const kho    = readKho(khoName);
        let added    = 0;
        let failed   = 0;

        for (const item of attachments) {
          const url = item.url || item.normalUrl || item.hdUrl || item.href || item.fileUrl || item.downloadUrl;
          if (!url) { failed++; continue; }

          try {
            const rawUrl = await uploadToGithub(url, khoName, item.ext);
            kho.push(rawUrl);
            added++;
          } catch (e) {
            failed++;
            global.logWarn?.(`[api add] Upload lỗi: ${e.message}`);
          }
        }

        writeKho(khoName, kho);

        let msg = `✅ Đã upload ${added} link lên kho "${khoName}".\n📦 Tổng kho: ${kho.length} link`;
        if (failed > 0) msg += `\n⚠️ Thất bại: ${failed} file`;
        return send(msg);
      }

      // ── api check ────────────────────────────────────────────────────────
      if (sub === "check") {
        const files = listKho();
        if (files.length === 0) {
          return send("📭 Kho trống. Dùng `api add <tên>` để thêm link.");
        }

        let totalLinks = 0;
        const rows = [];

        for (let i = 0; i < files.length; i++) {
          const name = files[i].replace(".json", "");
          const arr  = readKho(name);
          totalLinks += arr.length;
          rows.push(`${i + 1}. 📁 ${name}  —  ${arr.length} link`);
        }

        const msg =
          `🗂️ KHO LINK MEDIA (${files.length} kho)\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `${rows.join("\n")}\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `📝 Tổng: ${totalLinks} link\n\n` +
          `💡 Reply STT để kiểm tra trạng thái link\n` +
          `💡 Reply "del N" để xóa kho`;

        const sentInfo = await api.sendMessage(
          { msg, quote: raw },
          threadID,
          event.type
        );

        const msgId = sentInfo?.msgId || sentInfo?.messageID || sentInfo?.message?.msgId;
        if (msgId) {
          registerReply({
            messageId:   String(msgId),
            commandName: "api",
            payload:     { type: "choosee", files },
            ttl:         10 * 60 * 1000,
          });
        }
        return;
      }

      // ── api del <tên> ────────────────────────────────────────────────────
      if (sub === "del") {
        const khoName = args[1]?.trim();
        if (!khoName) return send("⚠️ Nhập tên kho muốn xóa: api del <tên>");

        const p = khoPath(khoName);
        if (!fs.existsSync(p)) return send(`❌ Không tìm thấy kho "${khoName}".`);
        fs.unlinkSync(p);
        return send(`✅ Đã xóa kho "${khoName}" thành công.`);
      }

      // ── api get <tên> ────────────────────────────────────────────────────
      if (sub === "get") {
        const khoName = args[1]?.trim();
        if (!khoName) return send("⚠️ Nhập tên kho: api get <tên>");

        const kho = readKho(khoName);
        if (kho.length === 0) return send(`📭 Kho "${khoName}" trống hoặc chưa tồn tại.`);

        const url = kho[Math.floor(Math.random() * kho.length)];
        return send(`🔗 Link ngẫu nhiên từ kho "${khoName}":\n${url}`);
      }

      // ── Hướng dẫn ────────────────────────────────────────────────────────
      return send(
        `📦 QUẢN LÝ KHO MEDIA\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `api add <tên>  — Reply vào media rồi upload\n` +
        `api check      — Xem danh sách kho\n` +
        `api del <tên>  — Xóa kho\n` +
        `api get <tên>  — Lấy link ngẫu nhiên\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `⚙️ Media được mã hóa base64 và lưu trên GitHub`
      );
    } catch (err) {
      global.logError?.(`[api] ${err?.message || err}`);
      return send(`❎ Đã xảy ra lỗi: ${err?.message || err}`);
    }
  },

  // ── onReply ─────────────────────────────────────────────────────────────────
  // Kích hoạt khi user reply vào tin nhắn "api check"
  onReply: async ({ api, event, data, send, threadID, registerReaction }) => {
    try {
      if (data?.type !== "choosee") return;

      const body  = (event?.data?.content || "").trim();
      const parts = body.split(/\s+/);
      const files = data.files || [];

      // ── "del N" — xóa kho ────────────────────────────────────────────────
      if (parts[0]?.toLowerCase() === "del" && !isNaN(parseInt(parts[1]))) {
        const idx = parseInt(parts[1]) - 1;
        if (idx < 0 || idx >= files.length) return send("❌ Số thứ tự không hợp lệ.");

        const khoName = files[idx].replace(".json", "");
        const p       = khoPath(khoName);
        if (!fs.existsSync(p)) return send(`❌ Kho "${khoName}" không tồn tại.`);
        fs.unlinkSync(p);
        return send(`✅ Đã xóa kho "${khoName}"!`);
      }

      // ── STT — kiểm tra link ───────────────────────────────────────────────
      const choose = parseInt(body);
      if (isNaN(choose)) return send("❌ Nhập số STT hoặc 'del N'.");

      const idx = choose - 1;
      if (idx < 0 || idx >= files.length) {
        return send("❌ Số thứ tự không nằm trong danh sách!");
      }

      const khoName = files[idx].replace(".json", "");
      const kho     = readKho(khoName);

      if (kho.length === 0) return send(`📭 Kho "${khoName}" không có link nào.`);

      await send(`⏳ Đang kiểm tra ${kho.length} link trong kho "${khoName}"...`);

      const { live, dead } = await checkLinks(kho);

      if (dead === 0) {
        return send(`✅ Kho "${khoName}" — tất cả ${live} link đều sống!`);
      }

      const msg =
        `📁 Kho: ${khoName}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `📝 Tổng: ${kho.length} link\n` +
        `✅ Sống: ${live}\n` +
        `❌ Chết: ${dead}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `👍 Thả cảm xúc để lọc link chết`;

      const sentInfo = await api.sendMessage(
        { msg, quote: event?.data },
        threadID,
        event.type
      );

      const msgId = sentInfo?.msgId || sentInfo?.messageID || sentInfo?.message?.msgId;
      if (msgId) {
        registerReaction({
          messageId:   String(msgId),
          commandName: "api",
          payload:     { type: "filter", khoName },
          ttl:         10 * 60 * 1000,
        });
      }
    } catch (err) {
      global.logError?.(`[api onReply] ${err?.message || err}`);
      return send(`❎ Lỗi: ${err?.message || err}`);
    }
  },

  // ── onReaction ──────────────────────────────────────────────────────────────
  // Kích hoạt khi user thả 👍 vào kết quả kiểm tra link
  onReaction: async ({ data, send, icon }) => {
    try {
      if (data?.type !== "filter") return;

      // Chỉ xử lý 👍
      if (icon !== "👍" && icon !== "\uD83D\uDC4D") return;

      const { khoName } = data;
      const kho = readKho(khoName);

      if (kho.length === 0) return send(`📭 Kho "${khoName}" không có link nào.`);

      await send(`⏳ Đang lọc link chết trong kho "${khoName}"...`);

      const liveLinks = await filterLiveLinks(kho);
      const removed   = kho.length - liveLinks.length;

      writeKho(khoName, liveLinks);

      return send(
        `✅ Lọc xong kho "${khoName}"!\n` +
        `🗑️ Đã xóa: ${removed} link chết\n` +
        `✅ Còn lại: ${liveLinks.length} link sống`
      );
    } catch (err) {
      global.logError?.(`[api onReaction] ${err?.message || err}`);
    }
  },
};

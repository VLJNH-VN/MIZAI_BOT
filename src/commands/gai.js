const fs       = require("fs");
const path     = require("path");
const FormData = require("form-data");
const { execSync } = require("child_process");

const RAW_PATH    = path.join(__dirname, "../../includes/data/gai.json");
const COOKED_PATH = path.join(__dirname, "../../includes/data/VideoCosplay.json");
const TEMP_DIR    = path.join(process.cwd(), "includes", "cache", "temp");

// ── Helpers JSON ──────────────────────────────────────────────────────────────
function loadRaw() {
  try { return JSON.parse(fs.readFileSync(RAW_PATH, "utf-8")); } catch { return []; }
}
function saveRaw(arr) {
  fs.writeFileSync(RAW_PATH, JSON.stringify(arr, null, 2), "utf-8");
}
function loadCooked() {
  try { return JSON.parse(fs.readFileSync(COOKED_PATH, "utf-8")); } catch { return []; }
}

// ── Tải video về temp ─────────────────────────────────────────────────────────
async function downloadVideo(url, outPath) {
  const res = await global.axios.get(url, {
    responseType: "arraybuffer",
    timeout: 90000,
    maxContentLength: 500 * 1024 * 1024,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  fs.writeFileSync(outPath, Buffer.from(res.data));
}

// ── Extract frame đầu từ video → upload lên Catbox → trả về URL công khai ────
async function extractAndUploadThumb(videoPath) {
  const thumbPath = path.join(TEMP_DIR, `thumb_${Date.now()}.jpg`);
  try {
    execSync(
      `ffmpeg -y -i "${videoPath}" -ss 0 -vframes 1 -q:v 5 "${thumbPath}"`,
      { stdio: "pipe", timeout: 15000 }
    );
    if (!fs.existsSync(thumbPath)) return "";

    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", fs.createReadStream(thumbPath), {
      filename: path.basename(thumbPath),
      contentType: "image/jpeg",
    });

    const res = await global.axios.post("https://catbox.moe/user/api.php", form, {
      headers: form.getHeaders(),
      timeout: 20000,
    });

    const url = typeof res.data === "string" ? res.data.trim() : "";
    return url.startsWith("https://") ? url : "";
  } catch {
    return "";
  } finally {
    try { if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath); } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name           : "gai",
    aliases        : ["g"],
    version        : "2.2.0",
    hasPermssion   : 0,
    credits        : "Bot",
    description    : "Gửi video ngẫu nhiên từ kho. Quản lý kho bằng add/del/list.",
    commandCategory: "Giải Trí",
    usages         : ".gai | .gai <số> | .gai add <url> | .gai del <id> | .gai list",
    cooldowns      : 10
  },

  run: async ({ api, event, args, send, prefix, commandName, senderId, threadID, isBotAdmin }) => {
    const sub = (args[0] || "").toLowerCase();

    // ── .gai add <url> ───────────────────────────────────────────────────────
    if (sub === "add") {
      const url = args[1];
      if (!url || !/^https?:\/\/.+/.test(url)) {
        return send(`❌ Vui lòng cung cấp URL hợp lệ.\nVD: ${prefix}${commandName} add https://example.com/video.mp4`);
      }
      const raw   = loadRaw();
      const newId = raw.length > 0 ? Math.max(...raw.map(x => x.id)) + 1 : 1;
      raw.push({ id: newId, url, addedBy: senderId, threadId: threadID, addedAt: new Date().toISOString() });
      saveRaw(raw);
      return send(`✅ Đã thêm vào kho! (ID: ${newId})\nTổng raw: ${raw.length} link.\n💡 Dùng .getdat để xử lý metadata.`);
    }

    // ── .gai del <id> ────────────────────────────────────────────────────────
    if (sub === "del" || sub === "delete" || sub === "xoa") {
      const id    = parseInt(args[1]);
      if (isNaN(id)) return send(`❌ Cú pháp: ${prefix}${commandName} del <id>`);
      const raw   = loadRaw();
      const index = raw.findIndex(x => x.id === id);
      if (index === -1) return send(`❌ Không tìm thấy mục ID: ${id}`);
      const item  = raw[index];
      if (!isBotAdmin(senderId) && item.addedBy !== senderId) {
        return send("⛔ Bạn chỉ có thể xoá link do chính mình thêm!");
      }
      raw.splice(index, 1);
      saveRaw(raw);
      return send(`🗑️ Đã xoá ID ${id}. Còn lại: ${raw.length} link.`);
    }

    // ── .gai list ────────────────────────────────────────────────────────────
    if (sub === "list") {
      const cooked    = loadCooked();
      const raw       = loadRaw();
      if (!raw.length && !cooked.length) return send("📭 Kho chưa có gì cả.");
      const cookedUrls = new Set(cooked.map(x => x.url));
      const lines = raw.map(x =>
        `• [${x.id}] ${cookedUrls.has(x.url) ? "✅" : "⏳"} ${x.url}`
      ).join("\n");
      return send(`📋 Kho gai — ${raw.length} link (✅ đã xử lý: ${cooked.length})\n${lines}`);
    }

    // ── .gai [số] — Gửi video ────────────────────────────────────────────────
    const cooked = loadCooked();
    if (!cooked.length) {
      const raw = loadRaw();
      if (!raw.length) return send(`📭 Kho trống. Thêm link bằng: ${prefix}${commandName} add <url>`);
      return send(`⚠️ Kho có ${raw.length} link nhưng chưa xử lý metadata.\nDùng .getdat để xử lý.`);
    }

    // Chọn video theo số thứ tự hoặc ngẫu nhiên
    let item;
    if (args[0] && !isNaN(parseInt(args[0]))) {
      const idx = parseInt(args[0]) - 1;
      item = cooked[Math.max(0, Math.min(idx, cooked.length - 1))];
    } else {
      item = cooked[Math.floor(Math.random() * cooked.length)];
    }

    await send("⏳ Đang tải video...");

    fs.mkdirSync(TEMP_DIR, { recursive: true });
    const tmpPath = path.join(TEMP_DIR, `gai_${Date.now()}.mp4`);

    try {
      await downloadVideo(item.url, tmpPath);

      if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) {
        return send("❌ Tải xong nhưng file rỗng. Link có thể đã hết hạn.");
      }

      // Upload video lên Zalo qua global.upload
      const uploads = await global.upload(tmpPath, threadID, event.type);
      if (!uploads || !uploads[0]?.fileUrl) {
        throw new Error("Upload không trả về fileUrl.");
      }

      const { fileUrl, fileName, totalSize } = uploads[0];
      const videoUrl = fileName ? `${fileUrl}/${fileName}` : fileUrl;

      // Extract thumbnail từ video rồi upload lên Catbox
      const thumbnailUrl = await extractAndUploadThumb(tmpPath);

      await api.sendVideo(
        {
          videoUrl,
          thumbnailUrl,
          duration : (item.duration || 0) * 1000,
          width    : item.width    || 1280,
          height   : item.height   || 720,
          msg      : "",
          fileSize : totalSize || 0,
        },
        threadID,
        event.type
      );

    } catch (err) {
      logError?.(`[gai] ${err?.message || err}`);
      return send("❌ Lỗi khi gửi video:\n" + (err?.message || "Lỗi không xác định"));
    } finally {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    }
  }
};

const fs   = require("fs");
const path = require("path");

const {
  readLinks,
  decodeOne,
  loadIndex,
  sendVideo,
  tempDir,
} = require("../../utils/media/media");

const { encodeAndUploadToGithub } = require("../../utils/media/githubMedia");

const RAW_PATH    = path.join(__dirname, "../../includes/data/gai.json");
const COOKED_PATH = path.join(__dirname, "../../includes/data/VideoCosplay.json");

const VIDEO_EXTS = new Set([".mp4", ".mkv", ".avi", ".mov", ".webm"]);

// ── Helpers JSON (raw URL list) ───────────────────────────────────────────────
function loadRaw() {
  try { return JSON.parse(fs.readFileSync(RAW_PATH, "utf-8")); } catch { return []; }
}
function saveRaw(arr) {
  fs.writeFileSync(RAW_PATH, JSON.stringify(arr, null, 2), "utf-8");
}
function loadCooked() {
  try { return JSON.parse(fs.readFileSync(COOKED_PATH, "utf-8")); } catch { return []; }
}

// ── Lấy danh sách key gai từ githubMediaLinks.json ───────────────────────────
function getGaiGithubKeys() {
  const all = readLinks();
  return Object.keys(all).filter(k =>
    k.startsWith("gai_") && VIDEO_EXTS.has(all[k].ext)
  );
}

// ── Tải video về temp (fallback cho VideoCosplay.json) ───────────────────────
async function downloadVideo(url, outPath) {
  const res = await global.axios.get(url, {
    responseType: "arraybuffer",
    timeout: 90000,
    maxContentLength: 500 * 1024 * 1024,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  fs.writeFileSync(outPath, Buffer.from(res.data));
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name           : "gai",
    aliases        : ["g"],
    version        : "3.0.0",
    hasPermssion   : 0,
    credits        : "MiZai",
    description    : "Gửi video ngẫu nhiên từ kho GitHub (githubMedia)",
    commandCategory: "Giải Trí",
    usages         : ".gai | .gai <số> | .gai add <url> | .gai del <id> | .gai list | .gai status",
    cooldowns      : 10,
  },

  run: async ({ api, event, args, send, prefix, commandName, senderId, threadID, isBotAdmin }) => {
    const sub = (args[0] || "").toLowerCase();

    // ── .gai status ──────────────────────────────────────────────────────────
    if (sub === "status") {
      const gaiKeys = getGaiGithubKeys();
      const index   = loadIndex();
      const cached  = index.filter(e => e.key.startsWith("gai_") && e.isVideo);
      const raw     = loadRaw();
      const cooked  = loadCooked();
      return send(
        `📊 Trạng Thái Kho Gai\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `🌐 GitHub (gai_*): ${gaiKeys.length} video\n` +
        `💾 Đã decode/cache: ${cached.length} video\n` +
        `📋 Raw URL list: ${raw.length} link\n` +
        `✅ Đã xử lý (VideoCosplay): ${cooked.length} video\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `💡 Nguồn ưu tiên: GitHub → VideoCosplay`
      );
    }

    // ── .gai add <url> ───────────────────────────────────────────────────────
    if (sub === "add") {
      const url = args[1];
      if (!url || !/^https?:\/\/.+/.test(url)) {
        return send(`❌ URL không hợp lệ.\nVD: ${prefix}${commandName} add https://example.com/video.mp4`);
      }
      const raw   = loadRaw();
      const newId = raw.length > 0 ? Math.max(...raw.map(x => x.id)) + 1 : 1;
      raw.push({ id: newId, url, addedBy: senderId, threadId: threadID, addedAt: new Date().toISOString() });
      saveRaw(raw);
      return send(
        `✅ Đã thêm vào kho raw! (ID: ${newId})\n` +
        `Tổng: ${raw.length} link thô.\n` +
        `💡 Dùng .getdat để xử lý và upload lên GitHub.`
      );
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
      const gaiKeys = getGaiGithubKeys();
      const index   = loadIndex();
      const cached  = new Set(index.map(e => e.key));
      const raw     = loadRaw();

      if (!gaiKeys.length && !raw.length) {
        return send("📭 Kho trống. Thêm bằng: .gai add <url>");
      }

      let msg = `📋 KHO GAI\n━━━━━━━━━━━━━━━━\n`;

      if (gaiKeys.length) {
        msg += `🌐 GitHub (${gaiKeys.length} video):\n`;
        gaiKeys.slice(0, 15).forEach((k, i) => {
          const icon = cached.has(k) ? "✅" : "⏳";
          msg += `  ${icon} ${i + 1}. ${k}\n`;
        });
        if (gaiKeys.length > 15) msg += `  ...và ${gaiKeys.length - 15} video khác\n`;
        msg += `\n`;
      }

      if (raw.length) {
        msg += `📋 Raw URL (${raw.length}):\n`;
        raw.slice(0, 10).forEach(x => {
          msg += `  • [${x.id}] ${x.url.slice(0, 60)}...\n`;
        });
        if (raw.length > 10) msg += `  ...và ${raw.length - 10} link khác\n`;
      }

      return send(msg);
    }

    // ── .gai [số] — Gửi video ────────────────────────────────────────────────

    // Ưu tiên 1: Kho GitHub (gai_* keys)
    const gaiKeys = getGaiGithubKeys();

    if (gaiKeys.length > 0) {
      let key;
      if (args[0] && !isNaN(parseInt(args[0]))) {
        const idx = parseInt(args[0]) - 1;
        key = gaiKeys[Math.max(0, Math.min(idx, gaiKeys.length - 1))];
      } else {
        key = gaiKeys[Math.floor(Math.random() * gaiKeys.length)];
      }

      await send("⏳ Đang lấy video từ GitHub...");

      try {
        const filePath = await decodeOne(key, { onLog: () => {} });

        if (!filePath || !fs.existsSync(filePath)) {
          throw new Error("Không decode được file từ GitHub.");
        }

        const index = loadIndex();
        const meta  = index.find(e => e.key === key) || {};

        await sendVideo(api, filePath, threadID, event.type, {
          width   : meta.width    || 1280,
          height  : meta.height   || 720,
          duration: meta.duration || 0,
          msg     : "",
        });

        return;
      } catch (err) {
        logError?.(`[gai/github] ${err?.message || err}`);
        await send(`⚠️ GitHub lỗi: ${err?.message || "Không xác định"}. Thử fallback...`);
      }
    }

    // Ưu tiên 2: Fallback về VideoCosplay.json
    const cooked = loadCooked();
    if (!cooked.length) {
      const raw = loadRaw();
      if (!raw.length) {
        return send(`📭 Kho trống.\nThêm video: ${prefix}${commandName} add <url>`);
      }
      return send(`⚠️ Có ${raw.length} link raw nhưng chưa xử lý.\nDùng .getdat để upload lên GitHub.`);
    }

    let item;
    if (args[0] && !isNaN(parseInt(args[0]))) {
      const idx = parseInt(args[0]) - 1;
      item = cooked[Math.max(0, Math.min(idx, cooked.length - 1))];
    } else {
      item = cooked[Math.floor(Math.random() * cooked.length)];
    }

    await send("⏳ Đang tải video (fallback)...");

    fs.mkdirSync(tempDir, { recursive: true });
    const tmpPath = path.join(tempDir, `gai_${Date.now()}.mp4`);

    try {
      await downloadVideo(item.url, tmpPath);

      if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) {
        return send("❌ Tải xong nhưng file rỗng. Link có thể đã hết hạn.");
      }

      await sendVideo(api, tmpPath, threadID, event.type, {
        width   : item.width    || 1280,
        height  : item.height   || 720,
        duration: (item.duration || 0) * 1000,
        msg     : "",
      });

    } catch (err) {
      logError?.(`[gai/fallback] ${err?.message || err}`);
      return send("❌ Lỗi khi gửi video:\n" + (err?.message || "Lỗi không xác định"));
    } finally {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    }
  },
};

"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

const { ThreadType }       = require("zca-js");
const { registerReaction } = require("../../includes/handlers/handleReaction");

const LIST_API_DIR = path.join(__dirname, "../../includes/listapi");

const MEDIA_EXTS = /\.(mp4|mkv|avi|mov|webm|jpg|jpeg|png|gif|webp|mp3|aac|m4a|ogg|wav)(\?|$)/i;
const URL_REGEX  = /https?:\/\/[^\s"'<>[\]{}|\\^`]+/gi;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers file
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
// Tải file → upload GitHub → trả rawUrl
// ─────────────────────────────────────────────────────────────────────────────

async function uploadMediaToGithub(url, khoName, extHint) {
  const extMatch = url.split("?")[0].match(/\.(mp4|mkv|avi|mov|webm|jpg|jpeg|png|gif|webp|mp3|aac|m4a|ogg|wav)$/i);
  const ext = extHint
    ? (extHint.startsWith(".") ? extHint : "." + extHint).toLowerCase()
    : extMatch
      ? extMatch[0].toLowerCase()
      : /video|mp4|mov/i.test(url) ? ".mp4" : ".jpg";

  const tmpPath = path.join(os.tmpdir(), `api_${Date.now()}${ext}`);

  try {
    const resp = await global.axios.get(url, {
      responseType: "arraybuffer",
      timeout: 90000,
      maxContentLength: 200 * 1024 * 1024,
      headers: { "User-Agent": global.userAgent },
    });
    fs.writeFileSync(tmpPath, Buffer.from(resp.data));

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
// Trích xuất URLs media từ một URL (JSON / text / HTML)
// ─────────────────────────────────────────────────────────────────────────────

async function extractMediaUrlsFromEndpoint(sourceUrl) {
  const resp = await global.axios.get(sourceUrl, {
    timeout: 30000,
    headers: { "User-Agent": global.userAgent },
    validateStatus: s => s < 500,
  });

  const contentType = String(resp.headers?.["content-type"] || "");
  let raw = resp.data;

  // Nếu là JSON object/array — flatten toàn bộ string values
  if (contentType.includes("json") || typeof raw === "object") {
    raw = JSON.stringify(raw);
  }

  // Lấy tất cả URL xuất hiện trong body
  const allUrls = String(raw).match(URL_REGEX) || [];

  // Lọc chỉ giữ URL media + bỏ trùng
  const mediaUrls = [...new Set(
    allUrls
      .map(u => u.replace(/['">,\]}\s]+$/, "")) // trim trailing junk
      .filter(u => MEDIA_EXTS.test(u))
  )];

  return mediaUrls;
}

// ─────────────────────────────────────────────────────────────────────────────
// Kiểm tra link sống / chết — dùng HEAD, fallback GET range
// ─────────────────────────────────────────────────────────────────────────────

async function isLive(url) {
  try {
    const r = await global.axios.head(url, { timeout: 8000, validateStatus: s => s < 500 });
    if (r.status === 200 || r.status === 206) return true;
    if (r.status === 405) {
      // Server không hỗ trợ HEAD — thử GET bytes=0-0
      const r2 = await global.axios.get(url, {
        timeout: 8000,
        headers: { Range: "bytes=0-0" },
        responseType: "stream",
        validateStatus: s => s < 500,
      });
      r2.data?.destroy?.();
      return r2.status < 400;
    }
    return false;
  } catch {
    return false;
  }
}

async function checkLinks(links) {
  const CHUNK = 8;
  let live = 0, dead = 0;
  for (let i = 0; i < links.length; i += CHUNK) {
    await Promise.all(links.slice(i, i + CHUNK).map(async url => {
      (await isLive(url)) ? live++ : dead++;
    }));
  }
  return { live, dead };
}

async function filterLiveLinks(links) {
  const CHUNK = 8;
  const live  = [];
  for (let i = 0; i < links.length; i += CHUNK) {
    await Promise.all(links.slice(i, i + CHUNK).map(async url => {
      if (await isLive(url)) live.push(url);
    }));
  }
  return live;
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG_FILE = path.join(process.cwd(), "config.json");

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
}
function saveConfig(obj) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(obj, null, 2), "utf-8");
}

module.exports = {
  config: {
    name: "api",
    version: "3.1.0",
    hasPermssion: 2,
    credits: "VLjnh",
    description: "Quản lý kho link media mã hóa base64 lưu trên GitHub",
    commandCategory: "Admin",
    usages: [
      "api add <tên>               — Reply vào media để upload GitHub",
      "api fetch <tên> <url>       — Lấy nhiều URL media từ 1 endpoint",
      "api check                   — Xem danh sách kho",
      "api del <tên>               — Xóa kho",
      "api get <tên>               — Lấy link ngẫu nhiên",
      "api setrepo <owner/repo>    — Đổi repo GitHub upload",
      "api settoken <token>        — Đổi GitHub token",
    ].join("\n"),
    cooldowns: 5,
  },


  // ── run ───────────────────────────────────────────────────────────────────
  run: async ({ api, event, args, send, threadID, registerReply, registerReaction }) => {
    try {
      ensureDir(LIST_API_DIR);
      const raw = event?.data || {};
      const sub = (args[0] || "").toLowerCase().trim();

      // ── Hướng dẫn ─────────────────────────────────────────────────────────
      if (!sub) {
        return send(
          `📦 QUẢN LÝ KHO MEDIA\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `api add <tên>          — Reply vào media rồi upload\n` +
          `api fetch <tên> <url>  — Lấy nhiều URL từ 1 endpoint\n` +
          `api check              — Xem danh sách kho\n` +
          `api del <tên>          — Xóa kho\n` +
          `api get <tên>          — Lấy link ngẫu nhiên\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `⚙️ Media được mã hóa base64 và lưu trên GitHub`
        );
      }

      // ── api add <tên> ──────────────────────────────────────────────────────
      if (sub === "add") {
        if (!args[1]) return send("⚠️ Vui lòng nhập tên kho.\nVí dụ: api add gai");

        const khoName = args[1].trim();
        const ctx = await global.resolveQuote({ raw, api, threadId: threadID, event });

        if (!ctx || !ctx.isMedia) {
          return send(
            "⚠️ Không tìm thấy media trong tin nhắn được reply.\n" +
            "Hãy reply vào tin nhắn có ảnh/video/audio, rồi dùng:\n" +
            `  api add ${khoName}` +
            (ctx?.isText ? "\n💬 Tin được reply là text, không phải media." : "")
          );
        }

        const attachments = ctx.attach?.length > 0
          ? ctx.attach
          : [{ url: ctx.mediaUrl, ext: ctx.ext }];

        //await send(`⏳ Đang mã hóa và upload ${attachments.length} file lên GitHub...`);

        const kho  = readKho(khoName);
        let added  = 0;
        let failed = 0;

        for (const item of attachments) {
          const url = item.url || item.normalUrl || item.hdUrl
                   || item.href || item.fileUrl || item.downloadUrl;
          if (!url) { failed++; continue; }

          try {
            const rawUrl = await uploadMediaToGithub(url, khoName, item.ext);
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

      // ── api fetch <tên> <url> ──────────────────────────────────────────────
      if (sub === "fetch") {
        const khoName   = args[1]?.trim();
        const sourceUrl = args[2]?.trim();

        if (!khoName || !sourceUrl) {
          return send(
            "⚠️ Cú pháp: api fetch <tên_kho> <url>\n" +
            "Ví dụ: api fetch gai https://api.example.com/videos\n" +
            "Bot sẽ tự trích xuất tất cả URL media trong kết quả trả về."
          );
        }

        if (!/^https?:\/\//i.test(sourceUrl)) {
          return send("❌ URL không hợp lệ. Phải bắt đầu bằng http:// hoặc https://");
        }

        await send(`🔍 Đang tải và phân tích: ${sourceUrl}`);

        let mediaUrls;
        try {
          mediaUrls = await extractMediaUrlsFromEndpoint(sourceUrl);
        } catch (e) {
          return send(`❌ Không tải được URL: ${e.message}`);
        }

        if (!mediaUrls.length) {
          return send(
            "📭 Không tìm thấy URL media nào trong kết quả.\n" +
            "Đảm bảo URL trả về JSON hoặc text có chứa link ảnh/video."
          );
        }

        await send(`📋 Tìm thấy ${mediaUrls.length} URL media. Đang tải.`);

        const kho = readKho(khoName);
        let added = 0, failed = 0;

        for (let i = 0; i < mediaUrls.length; i++) {
          const u = mediaUrls[i];
          try {
            //await send(`⏳ [${i + 1}/${mediaUrls.length}] Đang xử lý...`);
            const rawUrl = await uploadMediaToGithub(u, khoName);
            kho.push(rawUrl);
            added++;
          } catch (e) {
            failed++;
            global.logDebug?.(`[api fetch] Skip ${u}: ${e.message}`);
          }
        }

        writeKho(khoName, kho);

        return send(
          `✅ Hoàn tất fetch!\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `🌐 Nguồn: ${sourceUrl}\n` +
          `➕ Upload thành công: ${added}\n` +
          `❌ Thất bại: ${failed}\n` +
          `📦 Tổng kho "${khoName}": ${kho.length} link\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `💡 Dùng: api check → kiểm tra link sống/chết`
        );
      }

      // ── api check ──────────────────────────────────────────────────────────
      if (sub === "check") {
        const files = listKho();
        if (files.length === 0) {
          return send("📭 Kho trống. Dùng `api add <tên>` hoặc `api fetch <tên> <url>` để thêm link.");
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
          `💡 Reply STT để kiểm tra link sống/chết\n` +
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

      // ── api del <tên> ──────────────────────────────────────────────────────
      if (sub === "del") {
        const khoName = args[1]?.trim();
        if (!khoName) return send("⚠️ Nhập tên kho muốn xóa: api del <tên>");

        const p = khoPath(khoName);
        if (!fs.existsSync(p)) return send(`❌ Không tìm thấy kho "${khoName}".`);
        fs.unlinkSync(p);
        return send(`✅ Đã xóa kho "${khoName}" thành công.`);
      }

      // ── api get <tên> ──────────────────────────────────────────────────────
      if (sub === "get") {
        const khoName = args[1]?.trim();
        if (!khoName) return send("⚠️ Nhập tên kho: api get <tên>");

        const kho = readKho(khoName);
        if (kho.length === 0) return send(`📭 Kho "${khoName}" trống hoặc chưa tồn tại.`);

        const url = kho[Math.floor(Math.random() * kho.length)];
        return send(`🔗 Link ngẫu nhiên từ kho "${khoName}":\n${url}`);
      }

      // ── api setrepo <owner/repo> [branch] ─────────────────────────────────
      if (sub === "setrepo") {
        const repoArg   = args[1]?.trim();
        const branchArg = args[2]?.trim() || "main";

        if (!repoArg || !/^[^/]+\/[^/]+$/.test(repoArg)) {
          return send(
            "⚠️ Cú pháp: api setrepo <owner/repo> [branch]\n" +
            "Ví dụ: api setrepo TenBan/UploadRepo main\n\n" +
            `⚙️ Repo hiện tại: ${global.config?.uploadRepo || "chưa set"}\n` +
            `🌿 Branch: ${global.config?.branch || "main"}`
          );
        }

        // Test repo có accessible không
        await send(`🔍 Đang kiểm tra repo "${repoArg}"...`);
        try {
          const token = global.config?.githubToken;
          const checkRes = await global.axios.get(
            `https://api.github.com/repos/${repoArg}`,
            {
              headers: {
                Authorization: token ? `Bearer ${token}` : undefined,
                Accept: "application/vnd.github+json",
              },
              timeout: 10000,
              validateStatus: s => true,
            }
          );
          if (checkRes.status === 404) {
            return send(`❌ Repo "${repoArg}" không tồn tại hoặc token không có quyền truy cập.`);
          }
          if (checkRes.status === 401) {
            return send(`❌ Token GitHub không hợp lệ. Dùng: api settoken <token> trước.`);
          }
        } catch (e) {
          return send(`❌ Không thể kết nối GitHub: ${e.message}`);
        }

        const cfg = readConfig();
        const oldRepo = cfg.uploadRepo || "chưa set";
        cfg.uploadRepo = repoArg;
        cfg.branch     = branchArg;
        saveConfig(cfg);

        global.config.uploadRepo = repoArg;
        global.config.branch     = branchArg;

        return send(
          `✅ Đã cập nhật repo upload!\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `🔄 Cũ: ${oldRepo}\n` +
          `✨ Mới: ${repoArg}\n` +
          `🌿 Branch: ${branchArg}\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `💡 Giờ dùng api add để upload lên repo mới`
        );
      }

      // ── api settoken <token> ───────────────────────────────────────────────
      if (sub === "settoken") {
        const tokenArg = args[1]?.trim();
        if (!tokenArg) {
          return send(
            "⚠️ Cú pháp: api settoken <github_token>\n" +
            "Ví dụ: api settoken ghp_xxxxxxxxxxxx\n\n" +
            `⚙️ Token hiện tại: ${global.config?.githubToken ? global.config.githubToken.slice(0, 8) + "..." : "chưa set"}`
          );
        }

        await send(`🔍 Đang xác thực token...`);
        try {
          const checkRes = await global.axios.get(
            "https://api.github.com/user",
            {
              headers: {
                Authorization: `Bearer ${tokenArg}`,
                Accept: "application/vnd.github+json",
              },
              timeout: 10000,
              validateStatus: s => true,
            }
          );
          if (checkRes.status !== 200) {
            return send(`❌ Token không hợp lệ (HTTP ${checkRes.status}). Kiểm tra lại token.`);
          }
          const username = checkRes.data?.login || "?";

          const cfg = readConfig();
          cfg.githubToken = tokenArg;
          saveConfig(cfg);
          global.config.githubToken = tokenArg;

          return send(
            `✅ Đã cập nhật GitHub token!\n` +
            `👤 Tài khoản: ${username}\n` +
            `🔑 Token: ${tokenArg.slice(0, 8)}...`
          );
        } catch (e) {
          return send(`❌ Lỗi xác thực: ${e.message}`);
        }
      }

      return send(
        `❓ Lệnh con không hợp lệ: "${args[0]}"\n` +
        `💡 Dùng: api để xem hướng dẫn.`
      );

    } catch (err) {
      global.logError?.(`[api] ${err?.message || err}`);
      return send(`❎ Lỗi: ${err?.message || err}`);
    }
  },

  // ── onReply ──────────────────────────────────────────────────────────────
  onReply: async ({ api, event, data, send }) => {
    const threadID = event.threadId;
    try {
      if (data?.type !== "choosee") return;

      const { extractBody } = require("../../utils/bot/messageUtils");
      const body  = extractBody(event?.data).trim();
      const parts = body.split(/\s+/);
      const files = data.files || [];

      // "del N" — xóa kho
      if (parts[0]?.toLowerCase() === "del" && !isNaN(parseInt(parts[1]))) {
        const idx = parseInt(parts[1]) - 1;
        if (idx < 0 || idx >= files.length) return send("❌ Số thứ tự không hợp lệ.");
        const khoName = files[idx].replace(".json", "");
        const p = khoPath(khoName);
        if (!fs.existsSync(p)) return send(`❌ Kho "${khoName}" không tồn tại.`);
        fs.unlinkSync(p);
        return send(`✅ Đã xóa kho "${khoName}"!`);
      }

      // STT — kiểm tra link
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

  // ── onReaction ───────────────────────────────────────────────────────────
  onReaction: async ({ data, send, icon }) => {
    try {
      if (data?.type !== "filter") return;
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

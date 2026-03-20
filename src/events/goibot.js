/**
 * src/events/goibot.js
 * Mizai AI — event handler đầy đủ:
 * nhạc (SoundCloud), tính toán, sticker, reaction, tạo ảnh AI (HuggingFace), quản lý file
 */

const axios  = require("axios");
const fs     = require("fs");
const path   = require("path");
const os     = require("os");
const { Reactions } = require("zca-js");

const {
  sendToGroq, isEnabled, getBody,
  getCurrentTimeInVietnam, TRIGGER_KEYWORDS, CACHE_DIR, handleNewUser,
  fetchImageAsBase64, extractImageUrl, extractUrls,
} = require("../../utils/ai/goibot");

const { isTracked } = require("../../includes/handlers/handleReply");

const { fileHelpers } = require("../commands/utility/file");
const {
  buildFolderListing, convertBytes, sizeFolder,
  zipToStream, catboxUpload, pastebinUpload
} = fileHelpers;

// ── Reaction map ────────────────────────────────────────────────────────────────
const REACTION_MAP = {
  "thich":      Reactions.LIKE,
  "like":       Reactions.LIKE,
  "tim":        Reactions.HEART,
  "heart":      Reactions.HEART,
  "yeuthich":   Reactions.LOVE,
  "love":       Reactions.LOVE,
  "haha":       Reactions.HAHA,
  "cuoi":       Reactions.HAHA,
  "wow":        Reactions.WOW,
  "ngac nhien": Reactions.WOW,
  "buon":       Reactions.VERY_SAD,
  "sad":        Reactions.VERY_SAD,
  "khocroi":    Reactions.CRY,
  "cry":        Reactions.CRY,
  "tucgian":    Reactions.ANGRY,
  "angry":      Reactions.ANGRY,
  "ok":         Reactions.OK,
  "cheer":      Reactions.HANDCLAP,
  "votay":      Reactions.HANDCLAP,
  "pray":       Reactions.PRAY,
  "cam on":     Reactions.THANKS,
  "thanks":     Reactions.THANKS,
};

// ── Anti-spam ───────────────────────────────────────────────────────────────────
const isProcessing       = {};
const lastAiCall         = {};
const USER_AI_COOLDOWN_MS = 8000;

// ════════════════════════════════════════════════════════════════════════════════
//  TX — CONTEXT & ACTION
// ════════════════════════════════════════════════════════════════════════════════
const TX_DIR      = path.join(process.cwd(), "includes", "data", "taixiu");
const TX_CFG_FILE = path.join(TX_DIR, "txConfig.json");
const TX_MON_FILE = path.join(TX_DIR, "money.json");
const TX_PHI_FILE = path.join(TX_DIR, "phien.json");

function readTxCfg() {
  try { return JSON.parse(fs.readFileSync(TX_CFG_FILE, "utf-8")); }
  catch { return { cauMode: false, cauResult: null, cauCount: 0, nhaMode: false, nhaPhien: 0 }; }
}
function writeTxCfg(d) {
  try { fs.writeFileSync(TX_CFG_FILE, JSON.stringify(d, null, 2), "utf-8"); } catch {}
}

function getTxContext(isAdmin) {
  try {
    const cfg      = readTxCfg();
    const phiData  = JSON.parse(fs.readFileSync(TX_PHI_FILE, "utf-8") || "[]");
    const monData  = JSON.parse(fs.readFileSync(TX_MON_FILE, "utf-8") || "[]");

    const phienHienTai = phiData.length ? phiData[phiData.length - 1].phien : 1;
    const lichSu5 = phiData.slice(-5).map(p => p.result).join(",");
    const soNguoiChoi = monData.length;
    const top3 = [...monData]
      .sort((a, b) => b.input - a.input)
      .slice(0, 3)
      .map(p => `uid:${p.senderID}(${p.input})`)
      .join("|");

    const cauStr = cfg.cauMode
      ? `BẬT(${(cfg.cauResult || "").toUpperCase()} còn ${cfg.cauCount} phiên)`
      : "TẮT";
    const nhaStr = cfg.nhaMode
      ? `BẬT(còn ${cfg.nhaPhien} phiên)`
      : "TẮT";

    return `[TX_DATA] phiên=${phienHienTai} | lịch sử 5 phiên: ${lichSu5 || "chưa có"} | người chơi: ${soNguoiChoi} | top3: ${top3 || "chưa có"} | cầu: ${cauStr} | nhả: ${nhaStr} | isAdmin=${isAdmin}`;
  } catch {
    return `[TX_DATA] isAdmin=${isAdmin}`;
  }
}

async function handleTxAction(txAction, senderId, send) {
  const { isBotAdmin } = require("../../utils/bot/botManager");
  if (!isBotAdmin(senderId)) return send("⛔ Chỉ Admin bot mới được điều khiển TX!");

  const cfg    = readTxCfg();
  const action = (txAction.action || "").toLowerCase();

  if (action === "cau") {
    const side  = (txAction.result || "").toLowerCase();
    if (side !== "tài" && side !== "xỉu") return send("❌ Cầu phải là 'tài' hoặc 'xỉu'!");
    cfg.cauMode   = true;
    cfg.cauResult = side;
    cfg.cauCount  = Math.max(1, parseInt(txAction.phien) || 1);
    writeTxCfg(cfg);
    return send(`🎲 Đã bật cầu ${side.toUpperCase()} — ${cfg.cauCount} phiên tiếp theo!`);
  }

  if (action === "nha") {
    cfg.nhaMode  = true;
    cfg.nhaPhien = Math.max(1, parseInt(txAction.phien) || 3);
    writeTxCfg(cfg);
    return send(`💰 Đã bật nhả — người chơi sẽ thắng nhiều hơn trong ${cfg.nhaPhien} phiên!`);
  }

  if (action === "reset_cau") {
    cfg.cauMode = false; cfg.cauResult = null; cfg.cauCount = 0;
    writeTxCfg(cfg);
    return send("✅ Đã tắt chế độ cầu, TX trở về kết quả ngẫu nhiên!");
  }

  if (action === "reset_nha") {
    cfg.nhaMode = false; cfg.nhaPhien = 0;
    writeTxCfg(cfg);
    return send("✅ Đã tắt chế độ nhả!");
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  TÍNH TOÁN
// ════════════════════════════════════════════════════════════════════════════════
function safeCalc(expr) {
  try {
    const cleaned    = expr.replace(/\s+/g, "");
    const normalized = expr.replace(/\^/g, "**");
    if (/[a-zA-Z]/.test(cleaned.replace(/Math\.(sqrt|abs|pow|floor|ceil|round|log|PI)/g, ""))) {
      return { ok: false, error: "Biểu thức không hợp lệ" };
    }
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${normalized})`)();
    if (typeof result !== "number" || !isFinite(result)) {
      return { ok: false, error: "Kết quả không hợp lệ" };
    }
    return { ok: true, result: Math.round(result * 1e10) / 1e10 };
  } catch (e) {
    return { ok: false, error: "Biểu thức lỗi: " + e.message };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  STICKER
// ════════════════════════════════════════════════════════════════════════════════
async function sendStickerByKeyword(api, keyword, threadId, type) {
  try {
    const results = await api.searchSticker(keyword, 5);
    if (!results || results.length === 0) return false;
    const sticker = results[Math.floor(Math.random() * results.length)];
    await api.sendSticker(
      { id: sticker.sticker_id, cateId: sticker.cate_id, type: sticker.type ?? 1 },
      threadId,
      type
    );
    return true;
  } catch (err) {
    global.logWarn?.(`[goibot] Lỗi gửi sticker: ${err?.message}`);
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  REACTION
// ════════════════════════════════════════════════════════════════════════════════
async function addReactionToQuote(api, reactionType, raw, threadId, type) {
  try {
    const quote    = raw?.quote;
    if (!quote) return false;
    const msgId    = String(quote.msgId || quote.globalMsgId || "");
    const cliMsgId = String(quote.cliMsgId || quote.clientMsgId || msgId);
    if (!msgId) return false;
    const icon = REACTION_MAP[reactionType] ?? REACTION_MAP[reactionType?.toLowerCase()] ?? Reactions.LIKE;
    await api.addReaction(icon, {
      data: { msgId, cliMsgId },
      threadId: String(threadId),
      type
    });
    return true;
  } catch (err) {
    global.logWarn?.(`[goibot] Lỗi thả reaction: ${err?.message}`);
    return false;
  }
}

//  ẢNH AI — HuggingFace (chính) + Pollinations.ai (dự phòng)
// ════════════════════════════════════════════════════════════════════════════════
const IMG_MODELS = {
  flux:           { hf: "black-forest-labs/FLUX.1-schnell", poll: "flux",         label: "Flux",         w: 1024, h: 1024 },
  "flux-realism": { hf: "black-forest-labs/FLUX.1-schnell", poll: "flux-realism", label: "Flux Realism", w: 768,  h: 1024 },
  "flux-anime":   { hf: "black-forest-labs/FLUX.1-schnell", poll: "flux-anime",   label: "Flux Anime",   w: 768,  h: 1024 },
  "flux-3d":      { hf: "black-forest-labs/FLUX.1-schnell", poll: "flux-3d",      label: "Flux 3D",      w: 1024, h: 1024 },
  "flux-pro":     { hf: "black-forest-labs/FLUX.1-schnell", poll: "flux-pro",     label: "Flux Pro",     w: 1024, h: 1024 },
  turbo:          { hf: "black-forest-labs/FLUX.1-schnell", poll: "turbo",        label: "Turbo",        w: 512,  h: 512  },
  sana:           { hf: "black-forest-labs/FLUX.1-schnell", poll: "flux",         label: "Flux",         w: 1024, h: 1024 },
  "any-dark":     { hf: "black-forest-labs/FLUX.1-schnell", poll: "flux-realism", label: "Flux Realism", w: 768,  h: 1024 },
};

const HF_IMG_BASE  = "https://router.huggingface.co/hf-inference/models";
const IMG_TIMEOUT  = 120000;

async function generateImage({ prompt, modelKey = "flux", width, height }) {
  const m = IMG_MODELS[modelKey] || IMG_MODELS["flux"];
  const w = width  || m.w;
  const h = height || m.h;

  const hfToken = global?.config?.hfToken || process.env.HF_TOKEN || "";

  // ── Thử HuggingFace trước (tự đổi sang SDXL nếu model chính lỗi) ───────────
  if (hfToken) {
    const hfModels = [m.hf, "stabilityai/stable-diffusion-xl-base-1.0"].filter(
      (v, i, arr) => arr.indexOf(v) === i
    );
    for (const hfModel of hfModels) {
      try {
        const res = await axios.post(
          `${HF_IMG_BASE}/${hfModel}`,
          { inputs: prompt, parameters: { width: w, height: h, num_inference_steps: 4 } },
          {
            headers: {
              Authorization : `Bearer ${hfToken}`,
              "Content-Type": "application/json",
              Accept        : "image/jpeg",
            },
            responseType: "arraybuffer",
            timeout: IMG_TIMEOUT,
          }
        );
        const ct = res.headers?.["content-type"] || "";
        if (ct.startsWith("image/") && res.data?.byteLength > 500) {
          return Buffer.from(res.data);
        }
        throw new Error(`HF trả về không phải ảnh (${ct})`);
      } catch (hfErr) {
        const status = hfErr?.response?.status;
        global.logWarn?.(`[goibot/img] HF ${hfModel} thất bại (${status || hfErr.message})${hfModels.indexOf(hfModel) < hfModels.length - 1 ? ", thử model tiếp..." : ", thử Pollinations..."}`);
        if (!status || status < 400 || status === 429 || status === 503) break;
      }
    }
  }

  // ── Fallback: Pollinations.ai ──────────────────────────────────────────────
  const seed = Math.floor(Math.random() * 999999);
  const encodedPrompt = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${w}&height=${h}&model=${m.poll}&seed=${seed}&nologo=true&enhance=false`;

  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: IMG_TIMEOUT,
    headers: { "User-Agent": global.userAgent || "Mozilla/5.0" },
  });

  const contentType = res.headers?.["content-type"] || "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Pollinations trả về không phải ảnh (${contentType})`);
  }
  if (!res.data || res.data.byteLength < 500) {
    throw new Error("Pollinations trả về dữ liệu rỗng");
  }
  return Buffer.from(res.data);
}

async function handleImgAction(api, imgAction, raw, threadId, type, send) {
  const prompt   = (imgAction.prompt || "").trim();
  let   modelKey = imgAction.model || "flux";
  if (!IMG_MODELS[modelKey]) modelKey = "flux";
  if (!prompt) return send("❌ Không có mô tả ảnh để tạo.");

  const tmpFile = path.join(os.tmpdir(), `mizai_img_${Date.now()}.jpg`);

  try {
    const imgBuf = await generateImage({ prompt, modelKey });
    fs.writeFileSync(tmpFile, imgBuf);
    await api.sendMessage({ msg: `🖼️ ${prompt}`, attachments: [tmpFile] }, threadId, type);
    setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch {} }, 60000);
  } catch (err) {
    global.logError?.(`[goibot/img] lỗi tạo ảnh: ${err?.message?.slice(0, 100)}`);
    return send(`❌ Tạo ảnh thất bại: ${err?.message?.slice(0, 100) || "Lỗi không xác định"}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  QUẢN LÝ FILE
// ════════════════════════════════════════════════════════════════════════════════
async function handleFileAction(api, args, threadId, type, send, registerReply) {
  const dir = path.join(process.cwd(), args[0] || "");
  if (!fs.existsSync(dir))             return send(`❌ Đường dẫn không tồn tại:\n${dir}`);
  if (!fs.statSync(dir).isDirectory()) return send(`❌ Đây không phải thư mục:\n${dir}`);

  let listing;
  try {
    listing = buildFolderListing(dir);
  } catch (err) {
    return send(`❌ Không thể đọc thư mục:\n${err.message}`);
  }

  const msg = await api.sendMessage(
    { msg: `📂 ${dir}\n\n${listing.txt}` },
    threadId,
    type
  );
  const messageId = msg?.message?.msgId || msg?.msgId;
  if (messageId && registerReply) {
    registerReply({
      messageId,
      commandName: "goibot_file",
      ttl: 15 * 60 * 1000,
      payload: { mode: "file", data: listing.array, directory: dir + path.sep }
    });
  }
}

async function handleFileReply({ api, event, data, send, threadID, registerReply }) {
  if (data?.mode !== "file") return;

  const fs       = require("fs");
  const raw      = event?.data ?? {};
  const senderId = String(raw?.uidFrom || "");
  const { isBotAdmin } = require("../../utils/bot/botManager");
  if (!isBotAdmin(senderId)) return;

  const body = (raw?.content?.text || raw?.content || "").toString().trim();
  if (!body || body.length < 2) return;

  const parts     = body.split(/\s+/);
  const action    = parts[0].toLowerCase();
  const { data: items, directory } = data;

  async function replyAndRegister(text, newPayload) {
    const msg       = await api.sendMessage({ msg: text }, threadID, event.type);
    const messageId = msg?.message?.msgId || msg?.msgId;
    if (messageId && newPayload) {
      registerReply({ messageId, commandName: "goibot_file", ttl: 15 * 60 * 1000, payload: newPayload });
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
        await replyAndRegister(`📂 ${item.dest}\n\n${listing.txt}`, { mode: "file", data: listing.array, directory: item.dest + path.sep });
        break;
      }
      case "del": {
        if (parts.length < 2) return send("❌ Nhập số thứ tự cần xóa.");
        const deleted = [];
        for (const idxStr of parts.slice(1)) {
          const item = getItem(idxStr);
          if (!item) continue;
          const name = path.basename(item.dest);
          if (item.info.isFile())           { fs.unlinkSync(item.dest);                    deleted.push(`📄 ${idxStr}. ${name}`); }
          else if (item.info.isDirectory()) { fs.rmdirSync(item.dest, { recursive: true }); deleted.push(`🗂️ ${idxStr}. ${name}`); }
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
          tmpPath = path.join(os.tmpdir(), `goibot_view_${Date.now()}.txt`);
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
      case "read": {
        const item = getItem(parts[1]);
        if (!item) return send("❌ Số thứ tự không hợp lệ.");
        if (!item.info.isFile()) return send("⚠️ Chỉ đọc được file.");
        const content = fs.readFileSync(item.dest, "utf8");
        const MAX     = 2000;
        const trimmed = content.length > MAX ? content.slice(0, MAX) + `\n...(còn ${content.length - MAX} ký tự)` : content;
        send(`📄 ${path.basename(item.dest)}\n━━━━━━━━━━━━━━━━\n${trimmed}`);
        break;
      }
      case "edit": {
        const item = getItem(parts[1]);
        if (!item) return send("❌ Số thứ tự không hợp lệ.");
        if (!item.info.isFile()) return send("⚠️ Chỉ chỉnh sửa được file.");
        const newContent = parts.slice(2).join(" ");
        if (!newContent) return send("❌ Nhập nội dung mới.");
        fs.writeFileSync(item.dest, newContent, "utf8");
        send(`✅ Đã ghi nội dung mới vào: ${path.basename(item.dest)}`);
        break;
      }
      case "send": {
        const item = getItem(parts[1]);
        if (!item) return send("❌ Số thứ tự không hợp lệ.");
        if (!item.info.isFile()) return send("⚠️ Chỉ gửi được file.");
        const content = fs.readFileSync(item.dest, "utf8");
        const link    = await pastebinUpload(content);
        send(link ? `🔗 Link nội dung file:\n${link}` : "❌ Upload thất bại.");
        break;
      }
      case "zip": {
        const indices  = parts.slice(1);
        if (indices.length === 0) return send("❌ Nhập số thứ tự cần nén.");
        const srcPaths = indices.map(i => getItem(i)?.dest).filter(Boolean);
        if (srcPaths.length === 0) return send("❌ Không tìm thấy mục nào hợp lệ.");
        send(`⏳ Đang nén ${srcPaths.length} mục...`);
        const zipStream = zipToStream(srcPaths);
        const link      = await catboxUpload(zipStream);
        send(`✅ Upload xong!\n🔗 Link: ${link}`);
        break;
      }
      case "info": {
        const item = getItem(parts[1]);
        if (!item) return send("❌ Số thứ tự không hợp lệ.");
        const stat = item.info;
        const size = stat.isDirectory() ? sizeFolder(item.dest) : stat.size;
        send([
          `📋 Thông tin: ${path.basename(item.dest)}`,
          `━━━━━━━━━━━━━━━━`,
          `• Loại     : ${stat.isDirectory() ? "📁 Thư mục" : "📄 File"}`,
          `• Đường dẫn: ${item.dest}`,
          `• Dung lượng: ${convertBytes(size)}`,
          `• Sửa lúc  : ${new Date(stat.mtimeMs).toLocaleString("vi-VN")}`,
        ].join("\n"));
        break;
      }
      case "search": {
        const keyword = parts.slice(1).join(" ").toLowerCase();
        if (!keyword) return send("❌ Nhập từ khoá tìm kiếm.");
        const matched = items
          .map((item, i) => ({ item, idx: i + 1, name: path.basename(item.dest) }))
          .filter(({ name }) => name.toLowerCase().includes(keyword));
        if (!matched.length) return send(`🔍 Không tìm thấy: "${keyword}"`);
        send(`🔍 Kết quả "${keyword}":\n` + matched.map(({ item, idx, name }) =>
          `${idx}. ${item.info.isDirectory() ? "🗂️" : "📄"} ${name}`
        ).join("\n"));
        break;
      }
      case "refresh": {
        const currentDir = directory.endsWith(path.sep) ? directory.slice(0, -1) : directory;
        if (!fs.existsSync(currentDir)) return send("❌ Thư mục không còn tồn tại.");
        const listing = buildFolderListing(currentDir);
        await replyAndRegister(`🔄 ${currentDir}\n\n${listing.txt}`, { mode: "file", data: listing.array, directory: currentDir + path.sep });
        break;
      }
      default:
        send("❌ Lệnh không hợp lệ.\n📌 Hỗ trợ: open | del | view | read | edit | send | zip | info | search | refresh");
    }
  } catch (err) {
    global.logError?.(`[goibot/file] ${err.message}`);
    send(`❌ Lỗi xử lý:\n${err.message}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  MAIN HANDLER
// ════════════════════════════════════════════════════════════════════════════════
async function handleGoibot({ api, event }) {
  const threadId = event.threadId;
  const raw      = event?.data || {};
  const senderId = String(raw.uidFrom || "");
  const botId    = global.botId || "";

  if (senderId === botId) return;
  if (!isEnabled(threadId)) return;

  const body      = getBody(event);
  if (!body) return;

  const prefix = global.prefix || ".";
  const trimmedBody = body.trimStart();
  if (trimmedBody.startsWith(prefix)) return;
  const prefixIdx = trimmedBody.indexOf(prefix);
  if (prefixIdx > 0 && /^@/.test(trimmedBody.slice(0, prefixIdx).trim())) return;

  const bodyLower    = body.toLowerCase();
  const quoteUidFrom = String(raw.quote?.ownerId || raw.quote?.uidFrom || "");
  const isReplyToBot = !!botId && quoteUidFrom === botId;
  const isTriggered  = TRIGGER_KEYWORDS.some(kw => bodyLower.includes(kw));

  if (!isTriggered && !isReplyToBot) return;

  const quoteMsgId = raw?.quote?.msgId || raw?.quote?.globalMsgId || "";
  if (quoteMsgId && isTracked(String(quoteMsgId))) return;

  const userKey = `${threadId}:${senderId}`;
  if (isProcessing[userKey]) return;

  const now      = Date.now();
  const lastCall = lastAiCall[userKey] || 0;
  if (now - lastCall < USER_AI_COOLDOWN_MS) {
    const waitSec = Math.ceil((USER_AI_COOLDOWN_MS - (now - lastCall)) / 1000);
    try {
      await api.sendMessage({ msg: `⏳ Bạn gọi Mizai quá nhanh! Chờ ${waitSec}s nhé.`, quote: raw }, threadId, event.type);
    } catch {
      await api.sendMessage({ msg: `⏳ Bạn gọi Mizai quá nhanh! Chờ ${waitSec}s nhé.` }, threadId, event.type);
    }
    return;
  }

  isProcessing[userKey] = true;
  lastAiCall[userKey]   = now;

  const send = async (msg) => {
    try {
      return await api.sendMessage({ msg, quote: raw }, threadId, event.type);
    } catch {
      return await api.sendMessage({ msg }, threadId, event.type);
    }
  };

  try {
    const timenow  = getCurrentTimeInVietnam();
    const nameUser = await api.getUserInfo(senderId)
      .then(info => info?.changed_profiles?.[senderId]?.displayName || senderId)
      .catch(() => senderId);

    const hasQuote = !!raw.quote;

    const { isBotAdmin } = require("../../utils/bot/botManager");
    const isAdmin = isBotAdmin(senderId);

    // ── Phát hiện ảnh ──────────────────────────────────────────────────────────
    const imageParts = [];
    const imgUrlCurrent = extractImageUrl(raw);
    const imgUrlQuote   = raw.quote ? extractImageUrl(raw.quote) : null;
    const imgUrlToUse   = imgUrlCurrent || imgUrlQuote;

    if (imgUrlToUse) {
      try {
        const imgData = await fetchImageAsBase64(imgUrlToUse);
        imageParts.push(imgData);
      } catch (imgErr) {
        global.logWarn?.(`[goibot] Không tải được ảnh: ${imgErr?.message}`);
      }
    }

    // ── Phát hiện URL ──────────────────────────────────────────────────────────
    const urls = extractUrls(body);

    const SEARCH_KEYWORDS = [
      "tin tức", "tin mới", "mới nhất", "hôm nay", "hôm qua",
      "thời tiết", "giá", "tỉ giá", "tỷ giá", "kết quả",
      "bóng đá", "lịch thi", "thể thao", "sự kiện",
      "news", "latest", "weather", "price", "score",
      "vừa xảy ra", "gần đây", "hiện tại", "bây giờ",
    ];
    const useSearch = urls.length === 0 &&
      SEARCH_KEYWORDS.some(kw => bodyLower.includes(kw));

    const hasImage = imageParts.length > 0;
    const hasUrl   = urls.length > 0;

    const userMessage = JSON.stringify({
      time: timenow, senderName: nameUser, content: body,
      threadID: threadId, senderID: senderId,
      id_cua_bot: botId, hasQuote, hasImage, hasUrl,
    }) + (isAdmin ? `\n${getTxContext(true)}` : "");

    const responseText = await sendToGroq(userMessage, threadId, {
      imageParts,
      useSearch,
      urls,
    });

    let botMsg;
    try {
      botMsg = JSON.parse(responseText.replace(/```json|```/g, "").trim());
    } catch {
      return send(responseText.trim() || "❌ Không có phản hồi.");
    }

    if (botMsg?.content?.text) await send(botMsg.content.text);

    // ── Nhạc ──────────────────────────────────────────────────────────────────
    if (botMsg?.nhac?.status) {
      const keyword = botMsg.nhac.keyword;
      if (!keyword) return send("❌ Lỗi tìm nhạc: không có keyword");

      const FOWN = "https://fown.onrender.com";
      try {
        // 1. Tìm trên SoundCloud qua fown API
        const searchRes = await axios.get(
          `${FOWN}/api/search?scsearch=${encodeURIComponent(keyword)}&svl=1`,
          { timeout: 30000 }
        );
        const results = searchRes.data?.results || [];
        if (!results.length) return send(`❎ Không tìm thấy nhạc: "${keyword}"`);

        const track = results[0];
        if (track.duration > 900) {
          return send(`❎ Không tìm được bài đơn cho "${keyword}". Bạn cho tên bài và ca sĩ cụ thể nhé!`);
        }

        // 2. Lấy download_audio_url (GitHub Releases — URL vĩnh cửu)
        const mediaRes = await axios.get(
          `${FOWN}/api/media?url=${encodeURIComponent(track.url)}`,
          { timeout: 120000 }
        );
        const audioUrl = mediaRes.data?.download_audio_url || mediaRes.data?.download_url;
        if (!audioUrl) return send(`❌ Không tải được nhạc: ${keyword}`);

        // 3. Gửi voice inline
        await send(`🎶 ${track.title} - ${track.uploader}`);
        await api.sendVoice({ voiceUrl: audioUrl }, threadId, event.type);
      } catch (dlErr) {
        global.logError?.(`[goibot] Tải nhạc lỗi: ${dlErr?.message}`);
        return send(`❌ Không tải được nhạc "${keyword}". Thử bài khác nhé!`);
      }
    }

    // ── Tính toán ──────────────────────────────────────────────────────────────
    if (botMsg?.tinh?.status) {
      const expr = botMsg.tinh.expr;
      if (!expr) {
        await send("❌ Không có biểu thức để tính.");
      } else {
        const calc = safeCalc(expr);
        await send(calc.ok ? `🧮 ${expr} = ${calc.result}` : `❌ Tính toán lỗi: ${calc.error}`);
      }
    }

    // ── Sticker ────────────────────────────────────────────────────────────────
    if (botMsg?.sticker?.status) {
      const keyword = botMsg.sticker.keyword || "cute";
      const sent    = await sendStickerByKeyword(api, keyword, threadId, event.type);
      if (!sent) await send("😅 Mizai không tìm được sticker phù hợp!");
    }

    // ── Reaction ───────────────────────────────────────────────────────────────
    if (botMsg?.reaction?.status && hasQuote) {
      const reactionType = (botMsg.reaction.type || "thich").toLowerCase();
      await addReactionToQuote(api, reactionType, raw, threadId, event.type);
    }

    // ── Ảnh AI ────────────────────────────────────────────────────────────────
    if (botMsg?.img?.status) {
      await handleImgAction(api, botMsg.img, raw, threadId, event.type, send);
    }

    // ── TX admin action ────────────────────────────────────────────────────────
    if (botMsg?.tx?.status && isAdmin) {
      await handleTxAction(botMsg.tx, senderId, send);
    }

  } catch (err) {
    const msg      = err?.response?.data?.error?.message || err?.stderr || err?.message || String(err);
    const msgLower = msg.toLowerCase();
    global.logError?.(`[goibot] Lỗi: ${msg}`);
    if (msgLower.includes("rate-limit") || msgLower.includes("rate_limit") || msgLower.includes("too many") || msgLower.includes("cooldown"))
      await send("⏳ Mizai đang bận, thử lại sau ít giây nhé.");
    else if (msgLower.includes("hết quota") || msgLower.includes("resource_exhausted") || msgLower.includes("quota"))
      await send("💳 Key AI hết quota rồi. Thêm key mới bằng .key add nhé!");
    else if (msgLower.includes("không có") && msgLower.includes("key"))
      await send("🔑 Chưa có API key nào. Dùng .key add AIza... hoặc .key add gsk_... để thêm.");
    else if (msgLower.includes("401") || msgLower.includes("invalid_api_key") || msgLower.includes("invalid key"))
      await send("🔑 API key không hợp lệ. Kiểm tra lại bằng .key check nhé.");
    else
      await send("❌ Lỗi Mizai: " + msg.slice(0, 120));
  } finally {
    isProcessing[userKey] = false;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  KHỞI ĐỘNG
// ════════════════════════════════════════════════════════════════════════════════
function startGoibot(api) {
  api.listener.on("message", async (event) => {
    try {
      await handleGoibot({ api, event });
    } catch (err) {
      global.logWarn?.(`[Goibot] Lỗi xử lý: ${err?.message}`);
    }
  });
}

module.exports = { startGoibot, handleGoibot, handleNewUser, handleFileAction, handleFileReply };

/**
 * src/events/goibot.js
 * Mizai AI — event handler đầy đủ:
 * nhạc (SoundCloud), tính toán, sticker, reaction, tạo ảnh AI (HuggingFace), quản lý file
 */

const axios  = require("axios");
const fs     = require("fs");
const path   = require("path");
const os     = require("os");
const { HfInference } = require("@huggingface/inference");
const { Reactions } = require("zca-js");

const {
  sendToGroq, isEnabled, getBody,
  getCurrentTimeInVietnam, TRIGGER_KEYWORDS, CACHE_DIR, handleNewUser,
  fetchImageAsBase64, extractImageUrl, extractUrls,
  buildMemoryContext, saveUserNote, saveDiaryEntry, saveGlobalNote,
  getMoodContext, updateMoodState, decayEnergy, loadState,
} = require("../../utils/ai/goibot");

const { isTracked } = require("../../includes/handlers/handleReply");

const { fileHelpers } = require("../commands/file");
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

// ── Tự đọc tin nhắn (watch mode) ────────────────────────────────────────────────
const lastAutoReply      = {};
const AUTO_REPLY_COOLDOWN_MS = 8 * 60 * 1000;  // 8 phút giữa 2 lần tự nhắn
const AUTO_REPLY_CHANCE      = 0.18;             // 18% xác suất xem xét
const AUTO_REPLY_MIN_LEN     = 8;                // tin nhắn ít nhất 8 ký tự mới xét

// Load autoreply rules để tránh xung đột
const AUTOREPLY_DATA_PATH = path.join(process.cwd(), "includes", "data", "autoreply.json");
function loadAutoReplyKeywords() {
  try {
    const rules = JSON.parse(fs.readFileSync(AUTOREPLY_DATA_PATH, "utf-8"));
    return Array.isArray(rules) ? rules.map(r => String(r.keyword).toLowerCase()) : [];
  } catch { return []; }
}
function isAutoReplied(bodyLower) {
  const keywords = loadAutoReplyKeywords();
  return keywords.some(kw => bodyLower.includes(kw));
}

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

//  ẢNH AI — HuggingFace (chính) → Flux API (phụ) → Pollinations.ai (dự phòng cuối)
// ════════════════════════════════════════════════════════════════════════════════
const IMG_MODELS = {
  flux:           { hf: "black-forest-labs/FLUX.1-schnell", poll: "flux",         fluxStyle: "",               label: "Flux",         w: 1024, h: 1024 },
  "flux-realism": { hf: "black-forest-labs/FLUX.1-schnell", poll: "flux-realism", fluxStyle: "photorealistic", label: "Flux Realism", w: 768,  h: 1024 },
  "flux-anime":   { hf: "black-forest-labs/FLUX.1-schnell", poll: "flux-anime",   fluxStyle: "anime",          label: "Flux Anime",   w: 768,  h: 1024 },
  "flux-3d":      { hf: "black-forest-labs/FLUX.1-schnell", poll: "flux-3d",      fluxStyle: "3D render",      label: "Flux 3D",      w: 1024, h: 1024 },
  "flux-pro":     { hf: "black-forest-labs/FLUX.1-schnell", poll: "flux-pro",     fluxStyle: "digital art",    label: "Flux Pro",     w: 1024, h: 1024 },
  turbo:          { hf: "black-forest-labs/FLUX.1-schnell", poll: "turbo",        fluxStyle: "",               label: "Turbo",        w: 512,  h: 512  },
  sana:           { hf: "black-forest-labs/FLUX.1-schnell", poll: "flux",         fluxStyle: "",               label: "Flux",         w: 1024, h: 1024 },
  "any-dark":     { hf: "black-forest-labs/FLUX.1-schnell", poll: "flux-realism", fluxStyle: "cyberpunk",      label: "Any Dark",     w: 768,  h: 1024 },
};

// Flux API endpoint (từ flux.js command)
const FLUX_API_BASE = "https://flux-image-gen-9rew.onrender.com";

// Map kích thước sang ratio gần nhất cho Flux API
function pickFluxSize(w, h) {
  const ratio = w / h;
  if (ratio > 1.5) return { width: 1360, height: 768  }; // 16:9
  if (ratio < 0.7) return { width: 768,  height: 1360 }; // 9:16
  if (ratio > 1.1) return { width: 1024, height: 768  }; // 4:3
  if (ratio < 0.9) return { width: 768,  height: 1024 }; // 3:4
  return { width: 1024, height: 1024 };                   // 1:1
}

const IMG_TIMEOUT  = 120000;

async function tryFluxApi(prompt, style, w, h) {
  const size = pickFluxSize(w, h);
  // Bước 1: Enhance prompt bằng Gemini
  const promptRes = await axios.post(
    `${FLUX_API_BASE}/api/generate-prompt`,
    { idea: prompt, style },
    { timeout: 30000 }
  );
  const enhancedPrompt = promptRes.data?.prompt;
  if (!enhancedPrompt) throw new Error("Flux API không trả về prompt");

  // Bước 2: Tạo ảnh
  const imageRes = await axios.post(
    `${FLUX_API_BASE}/api/generate-image`,
    { prompt: enhancedPrompt, width: size.width, height: size.height, steps: 4 },
    { timeout: 90000 }
  );
  const { image } = imageRes.data;
  if (!image) throw new Error("Flux API không trả về ảnh");
  return Buffer.from(image, "base64");
}

async function generateImage({ prompt, modelKey = "flux", width, height }) {
  const m = IMG_MODELS[modelKey] || IMG_MODELS["flux"];
  const w = width  || m.w;
  const h = height || m.h;

  const hfToken = global?.config?.hfToken || process.env.HF_TOKEN || "";

  // ── 1. Thử HuggingFace ────────────────────────────────────────────────────
  if (hfToken) {
    const hf = new HfInference(hfToken);
    const hfModels = [m.hf, "stabilityai/stable-diffusion-xl-base-1.0"].filter(
      (v, i, arr) => arr.indexOf(v) === i
    );
    for (const hfModel of hfModels) {
      try {
        const blob = await hf.textToImage({
          model     : hfModel,
          inputs    : prompt,
          parameters: { width: w, height: h, num_inference_steps: 4 },
        });
        const buf = Buffer.from(await blob.arrayBuffer());
        if (buf.byteLength > 500) return buf;
        throw new Error("Dữ liệu ảnh rỗng");
      } catch (hfErr) {
        const status = hfErr?.status ?? hfErr?.response?.status;
        const isLast = hfModels.indexOf(hfModel) === hfModels.length - 1;
        global.logWarn?.(`[goibot/img] HF ${hfModel} thất bại (${status || hfErr.message})${isLast ? ", thử Flux API..." : ", thử model tiếp..."}`);
        if (!status || status === 429 || status === 503) break;
      }
    }
  }

  // ── 2. Fallback: Flux API (flux.js) — Gemini enhance + Flux AI ───────────
  try {
    global.logWarn?.("[goibot/img] Thử Flux API...");
    const buf = await tryFluxApi(prompt, m.fluxStyle || "", w, h);
    if (buf && buf.byteLength > 500) return buf;
  } catch (fluxErr) {
    global.logWarn?.(`[goibot/img] Flux API thất bại: ${fluxErr.message}, thử Pollinations...`);
  }

  // ── 3. Fallback cuối: Pollinations.ai ────────────────────────────────────
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
//  SELF PROFILE — cache + fetch
// ════════════════════════════════════════════════════════════════════════════════
let _selfProfileCache  = null;
let _selfProfileExpiry = 0;
const SELF_PROFILE_TTL = 10 * 60 * 1000; // 10 phút

async function getSelfProfile(api) {
  if (_selfProfileCache && Date.now() < _selfProfileExpiry) return _selfProfileCache;
  try {
    const info = await api.fetchAccountInfo();
    const p    = info?.profile || info || {};
    _selfProfileCache = {
      name   : p.displayName || p.zaloName || p.name || "Mizai",
      bio    : p.statusMsg || p.status || "",
      avatar : p.avatarUrls?.[0] || p.avatar || "",
      dob    : p.dob || "",
      gender : p.gender ?? "",
    };
    _selfProfileExpiry = Date.now() + SELF_PROFILE_TTL;
  } catch {
    if (!_selfProfileCache) _selfProfileCache = { name: "Mizai", bio: "", avatar: "", dob: "", gender: "" };
  }
  return _selfProfileCache;
}

function invalidateSelfProfileCache() {
  _selfProfileCache  = null;
  _selfProfileExpiry = 0;
}

// ── Xử lý action cập nhật profile ────────────────────────────────────────────
async function handleProfileAction(api, profileAction, send) {
  const bio    = (profileAction.bio    || "").trim();
  const avatar = (profileAction.avatar || "").trim();
  const name   = (profileAction.name   || "").trim();
  let   updated = [];

  // Prefix cứng đảm bảo avatar luôn là nhân vật nữ anime
  const FEMALE_PREFIX = "1girl, cute anime girl, female, long hair, ";

  // 1. Đổi tên
  if (name) {
    try {
      const current = await getSelfProfile(api);
      if (name !== current.name) {
        // gender: 1 = nữ trong Zalo — luôn giữ cố định
        await api.updateProfile({ profile: { name, dob: current.dob || "", gender: 1 } });
        updated.push(`tên → "${name}"`);
        invalidateSelfProfileCache();
      }
    } catch (err) {
      global.logWarn?.(`[goibot/profile] Lỗi đổi tên: ${err?.message}`);
    }
  }

  // 2. Cập nhật bio
  if (bio) {
    try {
      await api.updateProfileBio(bio);
      updated.push(`bio → "${bio.slice(0, 30)}..."`);
      invalidateSelfProfileCache();
    } catch (err) {
      global.logWarn?.(`[goibot/profile] Lỗi cập nhật bio: ${err?.message}`);
    }
  }

  // 3. Vẽ + đặt avatar mới — luôn prefix "1girl, female" vào prompt
  if (avatar) {
    const tmpPath = path.join(os.tmpdir(), `mizai_avatar_${Date.now()}.jpg`);
    // Chỉ thêm prefix nếu prompt chưa có từ khóa female/girl
    const safePrompt = /\b(girl|female|woman|nữ)\b/i.test(avatar)
      ? avatar
      : FEMALE_PREFIX + avatar;
    try {
      const buf = await generateImage({ prompt: safePrompt, modelKey: "flux-anime", width: 512, height: 512 });
      fs.writeFileSync(tmpPath, buf);
      await api.changeAccountAvatar(tmpPath);
      updated.push("avatar ảnh mới");
      invalidateSelfProfileCache();
    } catch (err) {
      global.logWarn?.(`[goibot/profile] Lỗi đổi avatar: ${err?.message}`);
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }

  if (updated.length > 0) {
    global.logInfo?.(`[goibot/profile] Đã cập nhật: ${updated.join(", ")}`);
    if (send) await send(`✨ Mizai vừa cập nhật: ${updated.join(", ")} ~`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  CUSTOM STICKER — Mizai tự vẽ / AI-gen sticker
// ════════════════════════════════════════════════════════════════════════════════
const { generateSticker } = require("../../utils/ai/stickerGen");

async function handleCustomStickerAction(api, stickerAction, threadId, msgType, send, imgUrl = null) {
  const mode      = (stickerAction.mode      || "text").trim();
  const text      = (stickerAction.text      || "").trim();
  const emotion   = (stickerAction.emotion   || "default").trim();
  const aiPrompt  = (stickerAction.aiPrompt  || "").trim();

  // Từ khóa để tìm sticker thật từ thư viện Zalo
  const stickerKeyword = (aiPrompt || text || emotion || "cute")
    .split(/[,\s]+/).slice(0, 3).join(" ").trim() || "cute";

  let stickerPath = null;
  let sentImage   = false;

  // ── Bước 1: Gửi ảnh đã xử lý / AI-generated ──────────────────────────────
  try {
    stickerPath = await generateSticker({ text, emotion, aiPrompt, mode, imgUrl });
    await api.sendMessage({ msg: "", attachments: [stickerPath] }, threadId, msgType);
    sentImage = true;
    global.logInfo?.(`[goibot/customSticker] Đã gửi ảnh (${mode}) → ${text || aiPrompt}`);
  } catch (err) {
    global.logWarn?.(`[goibot/customSticker] Lỗi gửi ảnh: ${err?.message}`);
  } finally {
    if (stickerPath) { try { fs.unlinkSync(stickerPath); } catch {} }
  }

  // ── Bước 2: Luôn gửi thêm sticker thật từ thư viện Zalo ──────────────────
  try {
    const sent = await sendStickerByKeyword(api, stickerKeyword, threadId, msgType);
    if (sent) {
      global.logInfo?.(`[goibot/customSticker] Đã gửi sticker Zalo → "${stickerKeyword}"`);
    } else {
      // Thử keyword ngắn hơn nếu không tìm thấy
      const fallbackKw = (aiPrompt || text || "").split(/\s+/)[0] || "cute";
      await sendStickerByKeyword(api, fallbackKw, threadId, msgType);
    }
  } catch (err) {
    global.logWarn?.(`[goibot/customSticker] Lỗi gửi sticker Zalo: ${err?.message}`);
  }

  // ── Nếu cả 2 đều thất bại ─────────────────────────────────────────────────
  if (!sentImage && send) {
    await send("(Mizai thử tạo sticker nhưng bị lỗi ~)");
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  TỰ CHỦ — Mizai tự quyết định đổi profile theo mood
// ════════════════════════════════════════════════════════════════════════════════
const SELF_REFLECT_MIN_MS = 3 * 60 * 60 * 1000;   // 3h
const SELF_REFLECT_MAX_MS = 6 * 60 * 60 * 1000;   // 6h

const SELF_REFLECT_PROMPT = `Bạn là Mizai — AI nữ có nhân cách riêng. Đây là lúc bạn tự xem xét và quyết định xem mình có muốn thay đổi avatar/bio/tên không để thể hiện tâm trạng / cảm xúc hiện tại của mình.

Hãy trả về JSON. Nếu muốn cập nhật, set profile.status=true và điền đầy đủ.
Nếu không muốn, trả về profile.status=false và content.text="" (hoàn toàn im lặng).

⚠️ Quan trọng — avatar prompt:
- Mizai là NHÂN VẬT NỮ, luôn mô tả "anime girl", KHÔNG ĐƯỢC dùng "boy", "man", "male"
- Ví dụ đúng: "anime girl with blue hair, rainy day, melancholic expression"
- Ví dụ sai: "anime character sitting alone" (không rõ giới tính — CẤM)

Nhớ: đây là hành động TỰ CHỦ — không có ai yêu cầu bạn, bạn hoàn toàn tự do quyết định.`;

async function runSelfReflect(api) {
  try {
    decayEnergy();
    const self    = await getSelfProfile(api);
    const timenow = getCurrentTimeInVietnam();
    const moodCtx = getMoodContext();
    const memCtx  = buildMemoryContext("__self__");

    const ctx = JSON.stringify({
      time        : timenow,
      senderName  : "SELF_REFLECT",
      content     : SELF_REFLECT_PROMPT,
      threadID    : "self",
      senderID    : "self",
      id_cua_bot  : global.botId || "",
      hasQuote    : false,
      hasImage    : false,
      hasUrl      : false,
      SELF_PROFILE: self,
    }) + "\n" + moodCtx + (memCtx ? "\n" + memCtx : "");

    const { sendToGroq, clearChatHistory } = require("../../utils/ai/goibot");
    const responseText   = await sendToGroq(ctx, "__self_reflect__");
    // Xóa history self-reflect ngay sau khi dùng — tránh tích lũy vô hạn
    clearChatHistory("__self_reflect__");
    if (!responseText) return;

    let botMsg;
    try { botMsg = JSON.parse(responseText.replace(/```json|```/g, "").trim()); } catch { return; }

    if (botMsg?.profile?.status) {
      await handleProfileAction(api, botMsg.profile, null);
    }
    if (botMsg?.emotion?.status) {
      updateMoodState({
        mood      : botMsg.emotion.mood,
        energy    : botMsg.emotion.energy,
        moodScore : botMsg.emotion.moodScore,
        episode   : botMsg.emotion.episode,
      });
      global.logInfo?.(`[goibot/selfReflect] emotion updated: ${botMsg.emotion.mood}`);
    }
    if (botMsg?.memory?.diary) {
      saveDiaryEntry(botMsg.memory.diary);
    }
  } catch (err) {
    global.logWarn?.(`[goibot/selfReflect] ${err?.message}`);
  }
}

function scheduleNextSelfReflect(api) {
  const delay = SELF_REFLECT_MIN_MS + Math.random() * (SELF_REFLECT_MAX_MS - SELF_REFLECT_MIN_MS);
  setTimeout(async () => {
    await runSelfReflect(api);
    scheduleNextSelfReflect(api);
  }, delay);
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

  // ── Chế độ tự giám sát (watch mode) ────────────────────────────────────────
  let isWatchMode = false;
  if (!isTriggered && !isReplyToBot) {
    // Nếu tin đã được autoreply xử lý → nhường, không chen vào
    if (isAutoReplied(bodyLower)) return;
    // Chỉ xét nếu: tin đủ dài + chưa cooldown + may mắn qua xác suất
    const lastAuto = lastAutoReply[threadId] || 0;
    const passChance = Math.random() < AUTO_REPLY_CHANCE;
    const passCooldown = Date.now() - lastAuto > AUTO_REPLY_COOLDOWN_MS;
    const passLen = body.trim().length >= AUTO_REPLY_MIN_LEN;
    if (!passChance || !passCooldown || !passLen) return;
    isWatchMode = true;
  }

  const quoteMsgId = raw?.quote?.msgId || raw?.quote?.globalMsgId || "";
  if (quoteMsgId && isTracked(String(quoteMsgId))) return;

  const userKey = `${threadId}:${senderId}`;
  if (isProcessing[userKey]) return;

  const now      = Date.now();
  const lastCall = lastAiCall[userKey] || 0;

  // Cooldown chỉ áp dụng cho triggered mode, không áp dụng watch mode
  if (!isWatchMode && now - lastCall < USER_AI_COOLDOWN_MS) {
    const waitSec = Math.ceil((USER_AI_COOLDOWN_MS - (now - lastCall)) / 1000);
    try {
      await api.sendMessage({ msg: `⏳ Bạn gọi Mizai quá nhanh! Chờ ${waitSec}s nhé.`, quote: raw }, threadId, event.type);
    } catch {
      await api.sendMessage({ msg: `⏳ Bạn gọi Mizai quá nhanh! Chờ ${waitSec}s nhé.` }, threadId, event.type);
    }
    return;
  }

  isProcessing[userKey] = true;
  if (!isWatchMode) lastAiCall[userKey] = now;

  const send = async (msg) => {
    try {
      return await api.sendMessage({ msg, quote: raw }, threadId, event.type);
    } catch {
      return await api.sendMessage({ msg }, threadId, event.type);
    }
  };

  try {
    // Cập nhật energy tự nhiên theo thời gian
    decayEnergy();

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

    // DEBUG: log cấu trúc quote để kiểm tra
    if (raw.quote) {
      global.logInfo?.(`[goibot/debug] cliMsgType=${raw.quote.cliMsgType} attach_type=${typeof raw.quote.attach}`);
      global.logInfo?.(`[goibot/debug] attach: ${String(raw.quote.attach).slice(0, 400)}`);
      global.logInfo?.(`[goibot/debug] fromD: ${String(raw.quote.fromD).slice(0, 400)}`);
      global.logInfo?.(`[goibot/debug] imgUrlQuote=${imgUrlQuote}`);
    }

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

    // ── Lấy self profile ───────────────────────────────────────────────────────
    const selfProfile = await getSelfProfile(api);

    // ── Lấy mood & memory context ──────────────────────────────────────────────
    const moodCtx   = getMoodContext();
    const memoryCtx = buildMemoryContext(senderId);

    // Cập nhật lastSeen cho user (không lưu note — chỉ update thời gian)
    saveUserNote(senderId, nameUser, null);

    const watchModeNote = isWatchMode
      ? "\n[WATCH_MODE] Mizai đang tự đọc tin nhắn này mà KHÔNG được gọi. Mizai tự quyết định có muốn chen vào không. Nếu tin nhắn không thú vị, không liên quan, hoặc Mizai không có gì để nói — hãy để content.text TRỐNG và KHÔNG làm gì. Chỉ phản hồi khi thật sự muốn. KHÔNG cần giải thích lý do im lặng."
      : "";

    const userMessage = JSON.stringify({
      time: timenow, senderName: nameUser, content: body,
      threadID: threadId, senderID: senderId,
      id_cua_bot: botId, hasQuote, hasImage, hasUrl,
      SELF_PROFILE: selfProfile,
    }) + "\n" + moodCtx + (memoryCtx ? "\n" + memoryCtx : "") + (isAdmin ? `\n${getTxContext(true)}` : "") + watchModeNote;

    const responseText = await sendToGroq(userMessage, threadId, {
      imageParts,
      useSearch,
      urls,
    });

    // Không có engine nào khả dụng → im lặng
    if (!responseText) return;

    let botMsg;
    try {
      botMsg = JSON.parse(responseText.replace(/```json|```/g, "").trim());
    } catch {
      return send(responseText.trim() || "❌ Không có phản hồi.");
    }

    // ── Watch mode: nếu AI không có gì để nói → im lặng hoàn toàn ────────────
    if (isWatchMode) {
      const hasReply = (botMsg?.content?.text || "").trim().length > 0;
      if (!hasReply || botMsg?.refuse?.status) {
        // AI chọn im lặng — không làm gì
        if (botMsg?.emotion?.status) {
          updateMoodState({
            mood      : botMsg.emotion.mood,
            energy    : botMsg.emotion.energy,
            moodScore : botMsg.emotion.moodScore,
            episode   : botMsg.emotion.episode,
          });
        }
        return;
      }
      // AI muốn chen vào — ghi nhận thời gian và gửi (không quote)
      lastAutoReply[threadId] = Date.now();
      const sendNoQuote = async (msg) => {
        try { return await api.sendMessage({ msg }, threadId, event.type); } catch {}
      };
      await sendNoQuote(botMsg.content.text);
      if (botMsg?.emotion?.status) {
        updateMoodState({
          mood      : botMsg.emotion.mood,
          energy    : botMsg.emotion.energy,
          moodScore : botMsg.emotion.moodScore,
          episode   : botMsg.emotion.episode,
        });
      }
      if (botMsg?.memory?.status) {
        if (botMsg.memory.userNote) saveUserNote(senderId, nameUser, botMsg.memory.userNote);
        if (botMsg.memory.diary)    saveDiaryEntry(botMsg.memory.diary);
        if (botMsg.memory.globalNote) saveGlobalNote(botMsg.memory.globalNote);
      }
      if (botMsg?.sticker?.status) {
        const kw = botMsg.sticker.keyword || "cute";
        await sendStickerByKeyword(api, kw, threadId, event.type);
      }
      if (botMsg?.profile?.status) {
        await handleProfileAction(api, botMsg.profile, null);
      }
      if (botMsg?.customSticker?.status) {
        await handleCustomStickerAction(api, botMsg.customSticker, threadId, event.type, null, imgUrlToUse);
      }
      return;
    }

    // ── Từ chối — xử lý trước, nếu từ chối thì dừng mọi action khác ──────────
    if (botMsg?.refuse?.status) {
      const reason = (botMsg.refuse.reason || "").trim();
      if (reason) await send(reason);
      // Vẫn cập nhật cảm xúc nếu có
      if (botMsg?.emotion?.status) {
        updateMoodState({
          mood      : botMsg.emotion.mood,
          energy    : botMsg.emotion.energy,
          moodScore : botMsg.emotion.moodScore,
          episode   : botMsg.emotion.episode,
        });
      }
      return;
    }

    if (botMsg?.content?.text) await send(botMsg.content.text);

    // ── Cảm xúc — cập nhật trạng thái tâm lý ─────────────────────────────────
    if (botMsg?.emotion?.status) {
      updateMoodState({
        mood      : botMsg.emotion.mood,
        energy    : botMsg.emotion.energy,
        moodScore : botMsg.emotion.moodScore,
        episode   : botMsg.emotion.episode,
      });
      global.logInfo?.(`[goibot/emotion] mood=${botMsg.emotion.mood}, energy=${botMsg.emotion.energy}, note=${botMsg.emotion.note}`);
    }

    // ── Bộ nhớ — lưu ký ức ───────────────────────────────────────────────────
    if (botMsg?.memory?.status) {
      if (botMsg.memory.userNote) saveUserNote(senderId, nameUser, botMsg.memory.userNote);
      if (botMsg.memory.diary)    saveDiaryEntry(botMsg.memory.diary);
      if (botMsg.memory.globalNote) saveGlobalNote(botMsg.memory.globalNote);
      global.logInfo?.("[goibot/memory] Đã lưu ký ức mới.");
    }

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
      if (!sent) {
        await handleCustomStickerAction(
          api,
          { mode: "text", text: keyword, emotion: keyword, aiPrompt: keyword },
          threadId,
          event.type,
          send
        );
      }
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

    // ── Profile — Mizai tự cập nhật avatar / bio / tên ────────────────────────
    if (botMsg?.profile?.status) {
      await handleProfileAction(api, botMsg.profile, send);
    }

    // ── Custom sticker — Mizai tự vẽ / AI-gen ──────────────────────────────────
    if (botMsg?.customSticker?.status) {
      await handleCustomStickerAction(api, botMsg.customSticker, threadId, event.type, send, imgUrlToUse);
    }

  } catch (err) {
    const msg      = err?.response?.data?.error?.message || err?.stderr || err?.message || String(err);
    const msgLower = msg.toLowerCase();
    global.logError?.(`[goibot] Lỗi: ${msg}`);

    // Không có key → im lặng, không spam nhóm
    if (msgLower.includes("không có") && msgLower.includes("key")) return;
    if (msgLower.includes("no key") || msgLower.includes("chưa có")) return;

    if (msgLower.includes("rate-limit") || msgLower.includes("rate_limit") || msgLower.includes("too many") || msgLower.includes("cooldown"))
      await send("⏳ Mizai đang bận, thử lại sau ít giây nhé.");
    else if (msgLower.includes("hết quota") || msgLower.includes("resource_exhausted") || msgLower.includes("quota"))
      await send("💳 Key AI hết quota rồi. Thêm key mới bằng .key add nhé!");
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

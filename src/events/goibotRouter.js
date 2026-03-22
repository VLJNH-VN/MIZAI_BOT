/**
 * src/events/goibotRouter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Dispatch các action từ AI response + xử lý file ops + tạo ảnh.
 *
 * EXPORT:
 *   generateImage({ prompt, modelKey, width, height })    → Promise<Buffer>
 *   addReactionToQuote(api, type, raw, threadId, type)    → Promise<bool>
 *   handleImgAction(api, imgAction, raw, threadId, type, send) → Promise<void>
 *   handleTxAction(txAction, senderId, send)              → Promise<void>
 *   handleProfileAction(api, profileAction, send)         → Promise<void>
 *   handleFileAction(api, args, threadId, type, send, rr) → Promise<void>
 *   handleFileReply({ api, event, data, send, threadID, registerReply }) → Promise<void>
 *   routeBotActions(botMsg, ctx)                          → Promise<void>
 */

const axios          = require("axios");
const fs             = require("fs");
const path           = require("path");
const os             = require("os");
const { HfInference } = require("@huggingface/inference");
const { Reactions }   = require("zca-js");

const { getSelfProfile, invalidateSelfProfileCache, writeTxCfg, readTxCfg } = require("./goibotContext");

// ── File management helpers ───────────────────────────────────────────────────
const { fileHelpers } = require("../commands/file");
const {
  buildFolderListing, convertBytes, sizeFolder,
  zipToStream, catboxUpload, pastebinUpload
} = fileHelpers;

// ── Reaction map ──────────────────────────────────────────────────────────────
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

// ── Image generation ──────────────────────────────────────────────────────────
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

const FLUX_API_BASE = "https://flux-image-gen-9rew.onrender.com";
const IMG_TIMEOUT   = 120000;

function pickFluxSize(w, h) {
  const ratio = w / h;
  if (ratio > 1.5) return { width: 1360, height: 768  };
  if (ratio < 0.7) return { width: 768,  height: 1360 };
  if (ratio > 1.1) return { width: 1024, height: 768  };
  if (ratio < 0.9) return { width: 768,  height: 1024 };
  return { width: 1024, height: 1024 };
}

async function tryFluxApi(prompt, style, w, h) {
  const size = pickFluxSize(w, h);
  const promptRes = await axios.post(
    `${FLUX_API_BASE}/api/generate-prompt`,
    { idea: prompt, style },
    { timeout: 30000 }
  );
  const enhancedPrompt = promptRes.data?.prompt;
  if (!enhancedPrompt) throw new Error("Flux API không trả về prompt");

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

  try {
    global.logWarn?.("[goibot/img] Thử Flux API...");
    const buf = await tryFluxApi(prompt, m.fluxStyle || "", w, h);
    if (buf && buf.byteLength > 500) return buf;
  } catch (fluxErr) {
    global.logWarn?.(`[goibot/img] Flux API thất bại: ${fluxErr.message}, thử Pollinations...`);
  }

  const seed = Math.floor(Math.random() * 999999);
  const url  = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&model=${m.poll}&seed=${seed}&nologo=true&enhance=false`;

  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: IMG_TIMEOUT,
    headers: { "User-Agent": global.userAgent || "Mozilla/5.0" },
  });

  const contentType = res.headers?.["content-type"] || "";
  if (!contentType.startsWith("image/")) throw new Error(`Pollinations trả về không phải ảnh (${contentType})`);
  if (!res.data || res.data.byteLength < 500) throw new Error("Pollinations trả về dữ liệu rỗng");
  return Buffer.from(res.data);
}

// ── Reaction ──────────────────────────────────────────────────────────────────
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

// ── Image action ──────────────────────────────────────────────────────────────
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

// ── TX admin action ───────────────────────────────────────────────────────────
async function handleTxAction(txAction, senderId, send) {
  const { isBotAdmin } = require("../../utils/bot/botManager");
  if (!isBotAdmin(senderId)) return send("⛔ Chỉ Admin bot mới được điều khiển TX!");

  const cfg    = readTxCfg();
  const action = (txAction.action || "").toLowerCase();

  if (action === "cau") {
    const side = (txAction.result || "").toLowerCase();
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

// ── Profile action ────────────────────────────────────────────────────────────
async function handleProfileAction(api, profileAction, send) {
  const bio    = (profileAction.bio    || "").trim();
  const avatar = (profileAction.avatar || "").trim();
  const name   = (profileAction.name   || "").trim();
  let   updated = [];

  const FEMALE_PREFIX = "1girl, cute anime girl, female, long hair, ";

  if (name) {
    try {
      const current = await getSelfProfile(api);
      if (name !== current.name) {
        await api.updateProfile({ profile: { name, dob: current.dob || "", gender: 1 } });
        updated.push(`tên → "${name}"`);
        invalidateSelfProfileCache();
      }
    } catch (err) {
      global.logWarn?.(`[goibot/profile] Lỗi đổi tên: ${err?.message}`);
    }
  }

  if (bio) {
    try {
      await api.updateProfileBio(bio);
      updated.push(`bio → "${bio.slice(0, 30)}..."`);
      invalidateSelfProfileCache();
    } catch (err) {
      global.logWarn?.(`[goibot/profile] Lỗi cập nhật bio: ${err?.message}`);
    }
  }

  if (avatar) {
    const tmpPath   = path.join(os.tmpdir(), `mizai_avatar_${Date.now()}.jpg`);
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

// ── File management ───────────────────────────────────────────────────────────
async function handleFileAction(api, args, threadId, type, send, registerReply) {
  const dir = path.join(process.cwd(), args[0] || "");
  if (!fs.existsSync(dir))             return send(`❌ Đường dẫn không tồn tại:\n${dir}`);
  if (!fs.statSync(dir).isDirectory()) return send(`❌ Đây không phải thư mục:\n${dir}`);

  let listing;
  try { listing = buildFolderListing(dir); }
  catch (err) { return send(`❌ Không thể đọc thư mục:\n${err.message}`); }

  const msg       = await api.sendMessage({ msg: `📂 ${dir}\n\n${listing.txt}` }, threadId, type);
  const messageId = msg?.message?.msgId || msg?.msgId;
  if (messageId && registerReply) {
    registerReply({
      messageId,
      commandName: "file",
      ttl: 15 * 60 * 1000,
      payload: { data: listing.array, directory: dir + path.sep }
    });
  }
}

async function handleFileReply({ api, event, data, send, threadID, registerReply }) {
  if (data?.mode !== "file") return;

  const raw      = event?.data ?? {};
  const senderId = String(raw?.uidFrom || "");
  const { isBotAdmin } = require("../../utils/bot/botManager");
  if (!isBotAdmin(senderId)) return;

  const body = (raw?.content?.text || raw?.content || "").toString().trim();
  if (!body || body.length < 2) return;

  const parts   = body.split(/\s+/);
  const action  = parts[0].toLowerCase();
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

// ── Main action router ────────────────────────────────────────────────────────
/**
 * Dispatch tất cả actions từ AI response sau khi đã parse botMsg.
 * @param {object} botMsg   - JSON từ AI
 * @param {object} ctx      - { api, raw, threadId, type, send, senderId, hasQuote, isAdmin, registerReply, isWatchMode, updateMoodState, saveUserNote, saveDiaryEntry, saveGlobalNote }
 */
async function routeBotActions(botMsg, ctx) {
  const {
    api, raw, threadId, type, send, senderId, hasQuote, isAdmin,
    registerReply, isWatchMode, updateMoodState, saveUserNote, saveDiaryEntry, saveGlobalNote,
    nameUser, lastAutoReply, setLastAutoReply,
  } = ctx;

  if (isWatchMode) {
    const hasReply = (botMsg?.content?.text || "").trim().length > 0;
    if (!hasReply || botMsg?.refuse?.status) {
      if (botMsg?.emotion?.status) {
        await updateMoodState({
          mood      : botMsg.emotion.mood,
          energy    : botMsg.emotion.energy,
          moodScore : botMsg.emotion.moodScore,
          episode   : botMsg.emotion.episode,
        });
      }
      return;
    }
    setLastAutoReply(threadId, Date.now());
    try { await api.sendMessage({ msg: botMsg.content.text }, threadId, type); } catch {}
    if (botMsg?.emotion?.status) {
      await updateMoodState({ mood: botMsg.emotion.mood, energy: botMsg.emotion.energy, moodScore: botMsg.emotion.moodScore, episode: botMsg.emotion.episode });
    }
    if (botMsg?.memory?.status) {
      if (botMsg.memory.userNote)   await saveUserNote(senderId, nameUser, botMsg.memory.userNote);
      if (botMsg.memory.diary)      await saveDiaryEntry(botMsg.memory.diary);
      if (botMsg.memory.globalNote) await saveGlobalNote(botMsg.memory.globalNote);
    }
    if (botMsg?.profile?.status) await handleProfileAction(api, botMsg.profile, null);
    return;
  }

  if (botMsg?.refuse?.status) {
    const reason = (botMsg.refuse.reason || "").trim();
    if (reason) await send(reason);
    if (botMsg?.emotion?.status) {
      await updateMoodState({ mood: botMsg.emotion.mood, energy: botMsg.emotion.energy, moodScore: botMsg.emotion.moodScore, episode: botMsg.emotion.episode });
    }
    return;
  }

  if (botMsg?.content?.text) await send(botMsg.content.text);

  if (botMsg?.emotion?.status) {
    await updateMoodState({ mood: botMsg.emotion.mood, energy: botMsg.emotion.energy, moodScore: botMsg.emotion.moodScore, episode: botMsg.emotion.episode });
    global.logInfo?.(`[goibot/emotion] mood=${botMsg.emotion.mood}, energy=${botMsg.emotion.energy}, note=${botMsg.emotion.note}`);
  }

  if (botMsg?.memory?.status) {
    if (botMsg.memory.userNote)   await saveUserNote(senderId, nameUser, botMsg.memory.userNote);
    if (botMsg.memory.diary)      await saveDiaryEntry(botMsg.memory.diary);
    if (botMsg.memory.globalNote) await saveGlobalNote(botMsg.memory.globalNote);
    global.logInfo?.("[goibot/memory] Đã lưu ký ức mới.");
  }

  if (botMsg?.nhac?.status) {
    const keyword = botMsg.nhac.keyword;
    if (!keyword) return send("❌ Lỗi tìm nhạc: không có keyword");
    const FOWN = "https://fown.onrender.com";
    try {
      const searchRes = await axios.get(`${FOWN}/api/search?scsearch=${encodeURIComponent(keyword)}&svl=1`, { timeout: 30000 });
      const results   = searchRes.data?.results || [];
      if (!results.length) return send(`❎ Không tìm thấy nhạc: "${keyword}"`);
      const track = results[0];
      if (track.duration > 900) return send(`❎ Không tìm được bài đơn cho "${keyword}". Bạn cho tên bài và ca sĩ cụ thể nhé!`);
      const mediaRes = await axios.get(`${FOWN}/api/media?url=${encodeURIComponent(track.url)}`, { timeout: 120000 });
      const audioUrl = mediaRes.data?.download_audio_url || mediaRes.data?.download_url;
      if (!audioUrl) return send(`❌ Không tải được nhạc: ${keyword}`);
      await send(`🎶 ${track.title} - ${track.uploader}`);
      await api.sendVoice({ voiceUrl: audioUrl }, threadId, type);
    } catch (dlErr) {
      global.logError?.(`[goibot] Tải nhạc lỗi: ${dlErr?.message}`);
      return send(`❌ Không tải được nhạc "${keyword}". Thử bài khác nhé!`);
    }
  }

  if (botMsg?.tinh?.status) {
    const { safeCalc } = require("./goibotContext");
    const expr = botMsg.tinh.expr;
    if (!expr) {
      await send("❌ Không có biểu thức để tính.");
    } else {
      const calc = safeCalc(expr);
      await send(calc.ok ? `🧮 ${expr} = ${calc.result}` : `❌ Tính toán lỗi: ${calc.error}`);
    }
  }

  if (botMsg?.reaction?.status && hasQuote) {
    const reactionType = (botMsg.reaction.type || "thich").toLowerCase();
    await addReactionToQuote(api, reactionType, raw, threadId, type);
  }

  if (botMsg?.img?.status) {
    await handleImgAction(api, botMsg.img, raw, threadId, type, send);
  }

  if (botMsg?.tx?.status && isAdmin) {
    await handleTxAction(botMsg.tx, senderId, send);
  }

  if (botMsg?.profile?.status) {
    await handleProfileAction(api, botMsg.profile, send);
  }
}

module.exports = {
  generateImage,
  addReactionToQuote,
  handleImgAction,
  handleTxAction,
  handleProfileAction,
  handleFileAction,
  routeBotActions,
};

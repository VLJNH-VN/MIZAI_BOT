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
  getCurrentTimeInVietnam, TRIGGER_KEYWORDS, CACHE_DIR, handleNewUser
} = require("../../utils/ai/goibot");

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

// ════════════════════════════════════════════════════════════════════════════════
//  NHẠC — SoundCloud
// ════════════════════════════════════════════════════════════════════════════════
let _scClientId = null;

async function getSCClientId() {
  if (_scClientId) return _scClientId;
  const res = await axios.get("https://soundcloud.com", {
    headers: { "User-Agent": "Mozilla/5.0" }, timeout: 12000
  });
  const scripts = [...res.data.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
  for (const src of scripts.slice(-4)) {
    try {
      const s = await axios.get(src, { timeout: 10000 });
      const m = s.data.match(/client_id:"([a-zA-Z0-9]+)"/);
      if (m) { _scClientId = m[1]; return _scClientId; }
    } catch {}
  }
  throw new Error("Không lấy được SoundCloud client_id");
}

async function searchSoundCloud(query) {
  const clientId = await getSCClientId();
  const res      = await axios.get("https://api-v2.soundcloud.com/search/tracks", {
    params: { q: query, limit: 10, client_id: clientId },
    timeout: 10000
  });
  const tracks  = res.data.collection || [];
  const singles = tracks.filter(t => t.duration >= 60000 && t.duration <= 480000);
  const pool    = singles.length ? singles : tracks;
  return pool.map(t => ({
    title:         `${t.title} - ${t.user?.username || ""}`.trim(),
    url:           t.permalink_url,
    duration:      Math.round(t.duration / 1000),
    transcodings:  t.media?.transcodings || [],
  }));
}

async function getSCStreamUrl(transcodings, clientId) {
  const progressive = transcodings.find(
    tc => tc.format?.protocol === "progressive" && !tc.snip
  ) || transcodings.find(tc => !tc.snip) || transcodings[0];
  if (!progressive) throw new Error("Không có transcoding hợp lệ");
  const res = await axios.get(progressive.url, {
    params:  { client_id: clientId },
    timeout: 15000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const streamUrl = res.data?.url;
  if (!streamUrl) throw new Error("Không lấy được stream URL từ SoundCloud");
  return streamUrl;
}

async function downloadAudio(streamUrl, outPath) {
  const res = await axios.get(streamUrl, {
    responseType: "stream",
    timeout:      120000,
    headers:      { "User-Agent": "Mozilla/5.0" }
  });
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outPath);
    res.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error",  reject);
  });
}

// ════════════════════════════════════════════════════════════════════════════════
//  ẢNH AI — Pollinations.ai (miễn phí, không cần token)
// ════════════════════════════════════════════════════════════════════════════════
const POLL_BASE = "https://image.pollinations.ai/prompt";
const POLL_MODELS = {
  sana:           "Sana",
  flux:           "FLUX",
  "flux-realism": "FLUX Realism",
  "flux-anime":   "FLUX Anime",
  "flux-3d":      "FLUX 3D",
  "flux-pro":     "FLUX Pro",
  turbo:          "Turbo",
  "any-dark":     "Any Dark",
};

const FALLBACK_MODELS = ["flux", "turbo", "flux-realism"];

const POLL_TIMEOUT = {
  sana:    150000,
  default: 120000,
};

async function generatePollinationsImage({ prompt, modelKey = "flux", width, height, seed }) {
  const params = new URLSearchParams({
    model:  modelKey,
    nologo: "true",
    nofeed: "true",
  });

  if (modelKey !== "sana") {
    params.set("width",  String(width  || 1024));
    params.set("height", String(height || 1024));
  }

  if (seed != null) params.set("seed", String(seed));

  const url     = `${POLL_BASE}/${encodeURIComponent(prompt)}?${params.toString()}`;
  const timeout = POLL_TIMEOUT[modelKey] || POLL_TIMEOUT.default;

  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout,
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept":     "image/*,*/*;q=0.8",
    },
    maxRedirects: 5,
  });

  const contentType = res.headers?.["content-type"] || "";
  if (!contentType.startsWith("image/")) {
    const bodyText = Buffer.from(res.data).toString("utf8").slice(0, 200);
    throw new Error(`API trả về không phải ảnh (${contentType}): ${bodyText}`);
  }

  return Buffer.from(res.data);
}

async function handleImgAction(api, imgAction, raw, threadId, type, send) {
  const prompt   = (imgAction.prompt || "").trim();
  let   modelKey = imgAction.model || "flux";
  if (!POLL_MODELS[modelKey]) modelKey = "flux";
  if (!prompt) return send("❌ Không có mô tả ảnh để tạo.");

  const label = POLL_MODELS[modelKey] || modelKey;
  await send(`🎨 Đang tạo ảnh: "${prompt}"\n🤖 Model: ${label}`);

  const tmpFile = path.join(os.tmpdir(), `mizai_img_${Date.now()}.jpg`);
  const tryModels = [modelKey, ...FALLBACK_MODELS.filter(m => m !== modelKey)];

  let lastErr = null;
  for (const m of tryModels) {
    try {
      const imgBuf = await generatePollinationsImage({ prompt, modelKey: m });
      fs.writeFileSync(tmpFile, imgBuf);
      await api.sendMessage({ msg: `🖼️ ${prompt}`, attachments: [tmpFile] }, threadId, type);
      setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch {} }, 60000);
      return;
    } catch (err) {
      const status = err?.response?.status || 0;
      if (status === 429) {
        return send("⏳ API đang bận, thử lại sau ít phút nhé~");
      }
      lastErr = err;
      global.logError?.(`[goibot/img] model=${m} lỗi ${status}: ${err?.message?.slice(0, 100)}`);
    }
  }

  return send(`❌ Tạo ảnh thất bại: ${lastErr?.message?.slice(0, 100) || "Lỗi không xác định"}`);
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

  const bodyLower    = body.toLowerCase();
  const quoteUidFrom = String(raw.quote?.ownerId || raw.quote?.uidFrom || "");
  const isReplyToBot = !!botId && quoteUidFrom === botId;
  const isTriggered  = TRIGGER_KEYWORDS.some(kw => bodyLower.includes(kw));

  if (!isTriggered && !isReplyToBot) return;

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

    const userMessage = JSON.stringify({
      time: timenow, senderName: nameUser, content: body,
      threadID: threadId, senderID: senderId,
      id_cua_bot: botId, hasQuote
    });

    const responseText = await sendToGroq(userMessage, threadId);

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
      const results = await searchSoundCloud(keyword);
      if (!results.length) return send(`❎ Không tìm thấy nhạc: "${keyword}"`);
      const track = results[0];
      if (track.duration > 900) return send(`❎ Không tìm được bài đơn cho "${keyword}". Bạn cho tên bài và ca sĩ cụ thể nhé!`);
      const filePath = path.join(CACHE_DIR, `${Date.now()}.mp3`);
      try {
        const clientId  = await getSCClientId();
        const streamUrl = await getSCStreamUrl(track.transcodings, clientId);
        await downloadAudio(streamUrl, filePath);
        if (!fs.existsSync(filePath)) return send(`❌ Không tải được nhạc: ${keyword}`);
        const uploads = await api.uploadAttachment([filePath], threadId, event.type);
        if (!uploads?.[0]?.fileUrl) return send(`❌ Upload nhạc thất bại: ${keyword}`);
        await send(`🎶 ${track.title}`);
        await api.sendVoice({ voiceUrl: uploads[0].fileUrl }, threadId, event.type);
      } catch (dlErr) {
        const dlMsg = dlErr?.stderr || dlErr?.message || String(dlErr);
        global.logError?.(`[goibot] Tải nhạc lỗi: ${dlMsg}`);
        if (dlMsg.includes("client_id") || dlMsg.includes("401")) _scClientId = null;
        return send(`❌ Không tải được nhạc "${keyword}". Thử bài khác nhé!`);
      } finally {
        setTimeout(() => { try { fs.unlinkSync(filePath); } catch {} }, 2 * 60 * 1000);
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

  } catch (err) {
    const msg      = err?.response?.data?.error?.message || err?.stderr || err?.message || String(err);
    const msgLower = msg.toLowerCase();
    global.logError?.(`[goibot] Lỗi: ${msg}`);
    if (msgLower.includes("429") || msgLower.includes("rate_limit") || msgLower.includes("too many"))
      await send("⏳ Mizai bận quá, thử lại sau ít phút nhé.");
    else if (msgLower.includes("401") || msgLower.includes("invalid_api_key"))
      await send("🔑 Groq API key không hợp lệ. Thêm key mới bằng .key add gsk_...");
    else if (msgLower.includes("402") || msgLower.includes("quota"))
      await send("💳 Groq key hết quota. Thêm key mới bằng .key add gsk_...");
    else
      await send("❌ Lỗi Mizai AI: " + msg.slice(0, 120));
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

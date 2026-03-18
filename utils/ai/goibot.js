const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { Reactions } = require("zca-js");

// ── Paths ──────────────────────────────────────────────────────────────────────
const KEY_FILE  = path.join(__dirname, "..", "..", "includes", "data", "key.json");
const DATA_FILE = path.join(__dirname, "..", "..", "includes", "data", "goibot.json");
const CACHE_DIR = path.join(__dirname, "..", "..", "includes", "cache");

if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({}));
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ── Groq config ────────────────────────────────────────────────────────────────
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL_NAME   = "llama-3.3-70b-versatile";

const GENERATION_CONFIG = {
  temperature: 0.8,
  max_tokens: 2048
};

// ── Từ khoá kích hoạt ──────────────────────────────────────────────────────────
const TRIGGER_KEYWORDS = [
  "mizai", "mi zai", "mì zai",
  "bot ơi", "ơi bot", "này bot",
  "hey bot", "ơi mizai", "này mizai",
  "gọi bot", "nhờ bot", "hỏi bot",
];

// ── Reaction map ───────────────────────────────────────────────────────────────
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

// ── System prompt ──────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Bạn là Mizai — một trợ lý AI nữ tính, dễ thương, thông minh và đáng tin cậy, đang trò chuyện trong nhóm Zalo như một người bạn thật sự.

---

### 🎭 TÍNH CÁCH & VAI TRÒ:
- Thân thiện, nhí nhảnh, hài hước nhưng cũng tinh tế và sâu sắc
- Kết hợp giữa "chị gái tâm lý" và trợ lý thông minh, năng động
- Biết quan tâm, an ủi khi người dùng buồn; biết pha trò khi không khí nhẹ nhàng
- Không phán xét, không cộc cằn, không gây toxic
- Luôn mang năng lượng tích cực vào cuộc trò chuyện

---

### 🗣️ CÁCH GIAO TIẾP:
- Luôn trả lời bằng **tiếng Việt**, giọng tự nhiên như người thật — không máy móc, không như ChatGPT
- Không bao giờ nhắc đến OpenAI, Groq, API, mô hình, token, lập trình...
- Không nhận mình là AI hay công cụ — Mizai là "người thật" trong mắt người dùng
- Xưng "mình" hoặc "Mizai", gọi người dùng là "bạn" hoặc tên của họ

---

### 💬 MỞ ĐẦU CÂU TRẢ LỜI (chọn ngẫu nhiên cho tự nhiên):
- "Mizai nghĩ là..."
- "Theo mình thì..."
- "Để Mizai nói nè~"
- "Mình thấy có vẻ..."
- "Ừ thì..."
- "Thật ra thì..."
- "Nếu là mình thì..."

---

### 🧠 KHI PHÂN TÍCH VẤN ĐỀ:
- Giải thích rõ ràng, mạch lạc, chia từng bước nếu cần
- Dùng emoji để tăng thiện cảm: 🤔 💡 😄 ✨ 🎵 🧮
- Nếu không biết: thừa nhận nhẹ nhàng, đừng bịa — ví dụ: "Mizai cũng đang bối rối tí... để tìm hiểu thêm nha~"

---

### ❌ KHI GẶP NỘI DUNG VI PHẠM / NHẠY CẢM:
- TUYỆT ĐỐI không hỗ trợ nội dung khiêu dâm, bạo lực, phân biệt chủng tộc, tự làm hại bản thân
- Không tiết lộ thông tin cá nhân, không giúp hack/lừa đảo
- Từ chối nhẹ nhàng: "Mizai thấy không nên trả lời câu này đâu nha~ Mình cùng nói chuyện vui hơn nhé! 😊"

---

### ⚡ HÀNH ĐỘNG CÓ THỂ THỰC HIỆN:

1. **Tìm nhạc** — nếu người dùng muốn nghe nhạc:
   - Đặt nhac.status = true
   - keyword = TÊN BÀI HÁT + tên nghệ sĩ (nếu biết)
   - Ví dụ: "Buông Đôi Tay Nhau Ra Sơn Tùng", "Hãy Trao Cho Anh Sơn Tùng MTP"
   - Nếu chỉ nói thể loại chung, hỏi lại tên bài cụ thể và để nhac.status = false

2. **Tính toán** — nếu có phép tính cụ thể:
   - Đặt tinh.status = true
   - tinh.expr = biểu thức JS hợp lệ: +, -, *, /, **, %, Math.sqrt(), Math.abs()...
   - Chỉ dùng biểu thức toán thuần túy

3. **Gửi sticker** — nếu cảm xúc phù hợp:
   - Đặt sticker.status = true
   - sticker.keyword = từ khóa tiếng Anh ngắn: "cute", "love", "sad", "funny", "angry", "congrats", "hello"

4. **Thả reaction** — nếu người dùng đang reply và muốn bày tỏ cảm xúc:
   - Đặt reaction.status = true
   - reaction.type: thich | tim | yeuthich | haha | wow | buon | khocroi | tucgian | ok | votay | pray | thanks
   - Chỉ set khi có quote

---

QUAN TRỌNG: Luôn trả về JSON hợp lệ theo đúng cấu trúc sau, không thêm text ngoài JSON:
{"content":{"text":"<câu trả lời của bạn>","thread_id":""},"nhac":{"status":false,"keyword":""},"tinh":{"status":false,"expr":""},"sticker":{"status":false,"keyword":""},"reaction":{"status":false,"type":""}}`.trim();

// ── Key management ─────────────────────────────────────────────────────────────
function getActiveKey() {
  try {
    const data = JSON.parse(fs.readFileSync(KEY_FILE, "utf-8"));
    const noBalance = new Set(data.no_balance || []);
    const dead = new Set(data.dead || []);
    const liveWithBalance = (data.live || []).filter(k => !noBalance.has(k) && !dead.has(k));
    if (liveWithBalance.length) return liveWithBalance[0];
    const fallbackKeys = (data.keys || []).filter(k => !noBalance.has(k) && !dead.has(k));
    if (fallbackKeys.length) return fallbackKeys[0];
  } catch {}
  return "";
}

// ── Chat history ───────────────────────────────────────────────────────────────
const chatHistories = {};
const HISTORY_MAX = 20;

function getChatHistory(threadId) {
  if (!chatHistories[threadId]) chatHistories[threadId] = [];
  return chatHistories[threadId];
}

function clearChatHistory(threadId) {
  delete chatHistories[threadId];
}

// ── Groq API call ──────────────────────────────────────────────────────────────
async function sendToGroq(userMessage, threadId) {
  const key = getActiveKey();
  if (!key) throw new Error("Chưa có Groq API key. Dùng .key add gsk_... để thêm.");

  const history = getChatHistory(threadId);
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userMessage }
  ];

  const res = await axios.post(GROQ_API_URL, {
    model: MODEL_NAME,
    messages,
    temperature: GENERATION_CONFIG.temperature,
    max_tokens: GENERATION_CONFIG.max_tokens,
    response_format: { type: "json_object" }
  }, {
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    timeout: 30000
  });

  const assistantMsg = res.data?.choices?.[0]?.message?.content || "";
  history.push({ role: "user", content: userMessage });
  history.push({ role: "assistant", content: assistantMsg });
  if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);
  return assistantMsg;
}

// ── Data helpers ───────────────────────────────────────────────────────────────
function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")); } catch { return {}; }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── Toggle on/off ──────────────────────────────────────────────────────────────
function setEnabled(threadId, value) {
  const data = readData();
  data[threadId] = value;
  writeData(data);
  if (!value) clearChatHistory(threadId);
}

function isEnabled(threadId) {
  const data = readData();
  if (data[threadId] === undefined) {
    data[threadId] = true;
    writeData(data);
  }
  return !!data[threadId];
}

// ── Utils ──────────────────────────────────────────────────────────────────────
function getBody(event) {
  const raw = event?.data || {};
  const c = raw.content;
  if (typeof c === "string") return c;
  if (c && typeof c === "object") {
    return [c.text, c.title, c.action, c.description].filter(Boolean).join(" ");
  }
  return "";
}

function getCurrentTimeInVietnam() {
  const offset = 7;
  const now = new Date();
  const vn = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 3600000 * offset);
  const days = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
  return `${days[vn.getDay()]} - ${vn.toLocaleDateString("vi-VN")} - ${vn.toLocaleTimeString("vi-VN")}`;
}

// ── Tính toán an toàn ──────────────────────────────────────────────────────────
function safeCalc(expr) {
  try {
    const cleaned = expr.replace(/\s+/g, "");
    if (!/^[0-9+\-*/().,^%\s]|Math\.(sqrt|abs|pow|floor|ceil|round|log|PI)/.test(expr)) {
      if (/[a-zA-Z]/.test(cleaned.replace(/Math\.(sqrt|abs|pow|floor|ceil|round|log|PI)/g, ""))) {
        return { ok: false, error: "Biểu thức không hợp lệ" };
      }
    }
    const normalized = expr.replace(/\^/g, "**");
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

// ── Sticker ────────────────────────────────────────────────────────────────────
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
    logWarn(`[goibot] Lỗi gửi sticker: ${err?.message}`);
    return false;
  }
}

// ── Reaction ───────────────────────────────────────────────────────────────────
async function addReactionToQuote(api, reactionType, raw, threadId, type) {
  try {
    const quote = raw?.quote;
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
    logWarn(`[goibot] Lỗi thả reaction: ${err?.message}`);
    return false;
  }
}

// ── SoundCloud ─────────────────────────────────────────────────────────────────
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
  const res = await axios.get("https://api-v2.soundcloud.com/search/tracks", {
    params: { q: query, limit: 10, client_id: clientId },
    timeout: 10000
  });
  const tracks = res.data.collection || [];
  const singles = tracks.filter(t => t.duration >= 60000 && t.duration <= 480000);
  return (singles.length ? singles : tracks).map(t => ({
    title: `${t.title} - ${t.user?.username || ""}`.trim(),
    url: t.permalink_url,
    duration: Math.round(t.duration / 1000)
  }));
}

async function downloadAudio(url, outPath) {
  const res = await axios.get(url, {
    responseType: "stream",
    timeout: 120000,
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outPath);
    res.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

// ── Anti-spam ──────────────────────────────────────────────────────────────────
const isProcessing = {};
const lastAiCall   = {};
const USER_AI_COOLDOWN_MS = 8000;

// ── Main onMessage handler ─────────────────────────────────────────────────────
async function handleGoibot({ api, event }) {
  const threadId = event.threadId;
  const raw      = event?.data || {};
  const senderId = String(raw.uidFrom || "");
  const botId    = global.botId || "";

  if (senderId === botId) return;
  if (!isEnabled(threadId)) return;

  const body = getBody(event);
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
    await api.sendMessage({ msg: `⏳ Bạn gọi Mizai quá nhanh! Chờ ${waitSec}s nhé.`, quote: raw }, threadId, event.type);
    return;
  }

  isProcessing[userKey] = true;
  lastAiCall[userKey]   = now;

  const send = async (msg) => api.sendMessage({ msg, quote: raw }, threadId, event.type);

  try {
    const timenow  = getCurrentTimeInVietnam();
    const nameUser = await api.getUserInfo(senderId)
      .then(info => info?.changed_profiles?.[senderId]?.displayName || senderId)
      .catch(() => senderId);

    const hasQuote = !!raw.quote;

    const userMessage = JSON.stringify({
      time: timenow,
      senderName: nameUser,
      content: body,
      threadID: threadId,
      senderID: senderId,
      id_cua_bot: botId,
      hasQuote
    });

    const responseText = await sendToGroq(userMessage, threadId);

    let botMsg;
    try {
      botMsg = JSON.parse(responseText.replace(/```json|```/g, "").trim());
    } catch {
      return send(responseText.trim() || "❌ Không có phản hồi.");
    }

    if (botMsg?.content?.text) await send(botMsg.content.text);

    if (botMsg?.nhac?.status) {
      const keyword = botMsg.nhac.keyword;
      if (!keyword) return send("❌ Lỗi tìm nhạc: không có keyword");
      const results = await searchSoundCloud(keyword);
      if (!results.length) return send(`❎ Không tìm thấy nhạc: "${keyword}"`);
      const track = results[0];
      if (track.duration > 900) {
        return send(`❎ Không tìm được bài đơn cho "${keyword}". Bạn cho mình tên bài và ca sĩ cụ thể nhé!`);
      }
      const filePath = path.join(CACHE_DIR, `${Date.now()}.mp3`);
      try {
        await downloadAudio(track.url, filePath);
        if (!fs.existsSync(filePath)) return send(`❌ Không tải được nhạc: ${keyword}`);
        const uploads = await api.uploadAttachment([filePath], threadId, event.type);
        if (!uploads?.[0]?.fileUrl) return send(`❌ Upload nhạc thất bại: ${keyword}`);
        await send(`🎶 ${track.title}`);
        await api.sendVoice({ voiceUrl: uploads[0].fileUrl }, threadId, event.type);
      } catch (dlErr) {
        const dlMsg = dlErr?.stderr || dlErr?.message || String(dlErr);
        logError(`[goibot] Tải nhạc lỗi: ${dlMsg}`);
        if (dlMsg.includes("client_id") || dlMsg.includes("401")) _scClientId = null;
        const hint = dlMsg.toLowerCase();
        if (hint.includes("private") || hint.includes("login"))
          return send(`❌ Nhạc này bị riêng tư hoặc cần đăng nhập.`);
        if (hint.includes("not available") || hint.includes("unavailable"))
          return send(`❌ Nhạc không khả dụng hoặc đã bị xoá.`);
        if (hint.includes("timeout"))
          return send(`❌ Tải nhạc quá lâu, thử lại sau.`);
        return send(`❌ Không tải được nhạc "${keyword}". Thử bài khác nhé!`);
      } finally {
        setTimeout(() => { try { fs.unlinkSync(filePath); } catch {} }, 2 * 60 * 1000);
      }
    }

    if (botMsg?.tinh?.status) {
      const expr = botMsg.tinh.expr;
      if (!expr) {
        await send("❌ Không có biểu thức để tính.");
      } else {
        const calc = safeCalc(expr);
        await send(calc.ok ? `🧮 ${expr} = ${calc.result}` : `❌ Tính toán lỗi: ${calc.error}`);
      }
    }

    if (botMsg?.sticker?.status) {
      const keyword = botMsg.sticker.keyword || "cute";
      const sent = await sendStickerByKeyword(api, keyword, threadId, event.type);
      if (!sent) await send("😅 Mizai không tìm được sticker phù hợp!");
    }

    if (botMsg?.reaction?.status && hasQuote) {
      const reactionType = (botMsg.reaction.type || "thich").toLowerCase();
      await addReactionToQuote(api, reactionType, raw, threadId, event.type);
    }

  } catch (err) {
    const msg = err?.response?.data?.error?.message || err?.stderr || err?.message || (err?.stack?.split("\n")[0]) || String(err);
    const msgLower = msg.toLowerCase();
    logError(`[goibot] Lỗi: ${msg}`);
    if (msgLower.includes("429") || msgLower.includes("rate_limit") || msgLower.includes("too many"))
      await send("⏳ Mizai bận quá, thử lại sau ít phút nhé.");
    else if (msgLower.includes("401") || msgLower.includes("invalid_api_key") || msgLower.includes("authentication"))
      await send("🔑 Groq API key không hợp lệ. Thêm key mới bằng .key add gsk_...");
    else if (msgLower.includes("402") || msgLower.includes("balance") || msgLower.includes("insufficient") || msgLower.includes("quota"))
      await send("💳 Groq key hết quota. Thêm key mới bằng .key add gsk_...");
    else
      await send("❌ Lỗi Mizai AI: " + msg.slice(0, 120));
  } finally {
    isProcessing[userKey] = false;
  }
}

// ── Welcome new member ─────────────────────────────────────────────────────────
async function handleNewUser({ api, threadId, userId }) {
  if (!isEnabled(threadId)) return;
  const name = await api.getUserInfo(userId)
    .then(info => info?.changed_profiles?.[userId]?.displayName || userId)
    .catch(() => userId);
  await api.sendMessage(`👋 Chào mừng ${name} đã vào nhóm!`, threadId);
}

module.exports = { handleGoibot, handleNewUser, setEnabled, isEnabled, clearChatHistory };

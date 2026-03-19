const { GoogleGenAI } = require("@google/genai");
const axios = require("axios");
const fs    = require("fs");
const path  = require("path");

const DATA_FILE = path.join(__dirname, "..", "..", "includes", "data", "goibot.json");
const CACHE_DIR = path.join(__dirname, "..", "..", "includes", "cache");

if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({}));
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const MODEL_NAME = "gemini-2.0-flash";

const TRIGGER_KEYWORDS = [
  "mizai", "mi zai", "mì zai",
  "bot ơi", "ơi bot", "này bot",
  "hey bot", "ơi mizai", "này mizai",
  "gọi bot", "nhờ bot", "hỏi bot",
];

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

5. **Tạo ảnh AI** — nếu người dùng muốn vẽ/tạo ảnh:
   - Đặt img.status = true
   - img.prompt = mô tả ảnh bằng tiếng Anh chi tiết (tự dịch nếu người dùng nói tiếng Việt)
   - img.model = "flux" | "flux-realism" | "flux-anime" | "flux-pro" | "turbo" | "sana" | "any-dark"

6. **Điều khiển TX** — CHỈ dành cho Admin bot (isAdmin=true trong TX_DATA):
   - Nếu admin bảo "cầu tài/xỉu X phiên": tx.status=true, tx.action="cau", tx.result="tài"/"xỉu", tx.phien=X
   - Nếu admin bảo "nhả X phiên": tx.status=true, tx.action="nha", tx.phien=X (mặc định 3)
   - Nếu admin bảo "tắt cầu": tx.status=true, tx.action="reset_cau"
   - Nếu admin bảo "tắt nhả": tx.status=true, tx.action="reset_nha"
   - KHÔNG bao giờ set tx.status=true nếu isAdmin=false

7. **Phân tích ảnh** — khi context chứa hasImage=true:
   - Mô tả, phân tích nội dung ảnh được gửi kèm
   - Trả lời câu hỏi liên quan đến ảnh đó
   - Đặt content.text = kết quả phân tích chi tiết, tự nhiên

8. **Tìm kiếm web** — khi người dùng hỏi tin tức, sự kiện mới nhất, thời tiết, giá cả...:
   - Google Search đã được bật, hãy sử dụng thông tin tìm được để trả lời
   - Trích dẫn nguồn ngắn gọn nếu cần thiết

9. **Đọc link** — khi context chứa hasUrl=true:
   - URL đã được phân tích, hãy dùng nội dung đó để trả lời
   - Tóm tắt hoặc giải thích nội dung link theo yêu cầu người dùng

---

QUAN TRỌNG: Luôn trả về JSON hợp lệ theo đúng cấu trúc sau, không thêm text ngoài JSON:
{"content":{"text":"<câu trả lời của bạn>","thread_id":""},"nhac":{"status":false,"keyword":""},"tinh":{"status":false,"expr":""},"sticker":{"status":false,"keyword":""},"reaction":{"status":false,"type":""},"img":{"status":false,"prompt":"","model":"flux"},"tx":{"status":false,"action":"","result":"","phien":0}}`.trim();

// ── Chat history ─────────────────────────────────────────────────────────────────
const chatHistories = {};
const HISTORY_MAX   = 20;

function getChatHistory(threadId) {
  if (!chatHistories[threadId]) chatHistories[threadId] = [];
  return chatHistories[threadId];
}

function clearChatHistory(threadId) {
  delete chatHistories[threadId];
}

// ── Key rotation ─────────────────────────────────────────────────────────────────
const KEY_FILE_PATH = path.join(__dirname, "..", "..", "includes", "data", "key.json");

function loadKeyData() {
  try { return JSON.parse(fs.readFileSync(KEY_FILE_PATH, "utf-8")); }
  catch { return {}; }
}

function saveKeyData(data) {
  try { fs.writeFileSync(KEY_FILE_PATH, JSON.stringify(data, null, 2), "utf-8"); } catch {}
}

function getLiveKeys() {
  const data    = loadKeyData();
  const allKeys = Array.isArray(data.geminiKeys) ? data.geminiKeys : [];
  const deadSet = new Set(Array.isArray(data.geminiDead) ? data.geminiDead : []);
  const live    = allKeys.filter(k => !deadSet.has(k));
  if (live.length) return live;
  const fallback = global?.config?.geminiKey || "";
  if (fallback) return [fallback];
  throw new Error("Chưa có Gemini API key. Dùng .key add AIza... để thêm key.");
}

function markGeminiKeyDead(key) {
  const data = loadKeyData();
  if (!Array.isArray(data.geminiDead)) data.geminiDead = [];
  if (!data.geminiDead.includes(key)) {
    data.geminiDead.push(key);
    data.geminiLive = (data.geminiLive || []).filter(k => k !== key);
    saveKeyData(data);
    global.logWarn?.(`[goibot] Key ${key.slice(0, 8)}... hết quota, đã đánh dấu dead.`);
  }
}

// ── Download ảnh → base64 ────────────────────────────────────────────────────────
async function fetchImageAsBase64(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 20000,
    headers: { "User-Agent": global.userAgent || "Mozilla/5.0" },
  });
  const contentType = res.headers["content-type"] || "image/jpeg";
  const mimeType    = contentType.split(";")[0].trim();
  const base64      = Buffer.from(res.data).toString("base64");
  return { mimeType, base64 };
}

// ── Lấy URL ảnh từ raw message ───────────────────────────────────────────────────
function extractImageUrl(raw) {
  if (!raw) return null;
  const c = raw.content;
  if (c && typeof c === "object") {
    const url = c.url || c.normalUrl || c.hdUrl || c.href || c.fileUrl || c.downloadUrl || c.src;
    if (url && /\.(jpg|jpeg|png|gif|webp)/i.test(url.split("?")[0])) return url;
    if (url && !url.includes("zaloapp") && c.thumb) return c.thumb;
  }
  const attArr = Array.isArray(raw.attach) ? raw.attach : [];
  for (const a of attArr) {
    const url = a.url || a.normalUrl || a.hdUrl || a.href || a.fileUrl || a.src;
    if (url) return url;
  }
  return null;
}

// ── Lấy URL từ text ──────────────────────────────────────────────────────────────
function extractUrls(text) {
  const matches = text.match(/https?:\/\/[^\s]+/g) || [];
  return matches.filter(u => !u.includes("zalo.me") && !u.includes("zaloapp"));
}

// ── Gọi Gemini với rotation key ──────────────────────────────────────────────────
/**
 * @param {string} userMessage — tin nhắn text
 * @param {string} threadId
 * @param {object} [opts]
 * @param {Array}  [opts.imageParts]  — [{mimeType, base64}] ảnh đính kèm
 * @param {boolean} [opts.useSearch]  — bật Google Search grounding
 * @param {string[]} [opts.urls]      — URLs để đọc nội dung
 */
async function sendToGroq(userMessage, threadId, opts = {}) {
  const { imageParts = [], useSearch = false, urls = [] } = opts;
  const history = getChatHistory(threadId);

  const userParts = [];

  if (imageParts.length > 0) {
    for (const img of imageParts) {
      userParts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
    }
  }

  userParts.push({ text: userMessage });

  const contents = [
    ...history,
    { role: "user", parts: userParts },
  ];

  const tools = [];
  if (useSearch) tools.push({ googleSearch: {} });
  if (urls.length > 0) tools.push({ urlContext: {} });

  const tryKeys = getLiveKeys();
  let lastErr   = null;

  for (const key of tryKeys) {
    try {
      const ai = new GoogleGenAI({ apiKey: key });

      const config = {
        systemInstruction: SYSTEM_PROMPT,
        temperature:       0.8,
        maxOutputTokens:   2048,
      };

      if (tools.length === 0) {
        config.responseMimeType = "application/json";
      } else {
        config.tools = tools;
      }

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents,
        config,
      });

      let assistantMsg = response.text || "";

      if (tools.length > 0) {
        const jsonMatch = assistantMsg.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          assistantMsg = JSON.stringify({
            content: { text: assistantMsg.trim(), thread_id: "" },
            nhac: { status: false, keyword: "" },
            tinh: { status: false, expr: "" },
            sticker: { status: false, keyword: "" },
            reaction: { status: false, type: "" },
            img: { status: false, prompt: "", model: "flux" },
            tx: { status: false, action: "", result: "", phien: 0 },
          });
        } else {
          assistantMsg = jsonMatch[0];
        }
      }

      history.push({ role: "user",  parts: [{ text: userMessage }] });
      history.push({ role: "model", parts: [{ text: assistantMsg }] });
      if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);

      return assistantMsg;
    } catch (err) {
      const msg = err?.message || "";
      if (msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota") || err?.status === 429) {
        markGeminiKeyDead(key);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error("Tất cả Gemini key đều hết quota.");
}

// ── Data helpers ────────────────────────────────────────────────────────────────
function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")); } catch { return {}; }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── Toggle on/off ───────────────────────────────────────────────────────────────
function setEnabled(threadId, value) {
  const data = readData();
  data[threadId] = value;
  writeData(data);
  if (!value) clearChatHistory(threadId);
}

function isEnabled(threadId) {
  const data = readData();
  if (data[threadId] === undefined) { data[threadId] = true; writeData(data); }
  return !!data[threadId];
}

// ── Utils ───────────────────────────────────────────────────────────────────────
function getBody(event) {
  const raw = event?.data || {};
  const c   = raw.content;
  if (typeof c === "string") return c;
  if (c && typeof c === "object") {
    return [c.text, c.title, c.action, c.description].filter(Boolean).join(" ");
  }
  return "";
}

function getCurrentTimeInVietnam() {
  const offset = 7;
  const now    = new Date();
  const vn     = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 3600000 * offset);
  const days   = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
  return `${days[vn.getDay()]} - ${vn.toLocaleDateString("vi-VN")} - ${vn.toLocaleTimeString("vi-VN")}`;
}

// ── Welcome new member ──────────────────────────────────────────────────────────
async function handleNewUser({ api, threadId, userId }) {
  if (!isEnabled(threadId)) return;
  const name = await api.getUserInfo(userId)
    .then(info => info?.changed_profiles?.[userId]?.displayName || userId)
    .catch(() => userId);
  await api.sendMessage(`👋 Chào mừng ${name} đã vào nhóm!`, threadId);
}

module.exports = {
  sendToGroq, setEnabled, isEnabled, clearChatHistory,
  getBody, getCurrentTimeInVietnam, TRIGGER_KEYWORDS,
  CACHE_DIR, handleNewUser,
  fetchImageAsBase64, extractImageUrl, extractUrls,
};

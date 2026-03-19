const axios = require("axios");
const fs    = require("fs");
const path  = require("path");

const KEY_FILE  = path.join(__dirname, "..", "..", "includes", "data", "key.json");
const DATA_FILE = path.join(__dirname, "..", "..", "includes", "data", "goibot.json");
const CACHE_DIR = path.join(__dirname, "..", "..", "includes", "cache");

if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({}));
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const GEMINI_API_URL    = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODEL_NAME        = "gemini-2.0-flash";
const GENERATION_CONFIG = { temperature: 0.8, max_tokens: 2048 };

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
   - img.model = "flux" (mặc định, SDXL) | "flux-realism" (ảnh thực tế) | "flux-anime" (phong cách anime) | "flux-pro" (chất lượng cao) | "turbo" (rất nhanh) | "sana" (Sana 1.6B) | "any-dark" (phong cách tối/fantasy)

6. **Điều khiển TX** — CHỈ dành cho Admin bot (isAdmin=true trong TX_DATA):
   - Nếu admin bảo "cầu tài/xỉu X phiên": tx.status=true, tx.action="cau", tx.result="tài"/"xỉu", tx.phien=X (mặc định 1 nếu không nói)
   - Nếu admin bảo "nhả X phiên" (người chơi thắng nhiều hơn): tx.status=true, tx.action="nha", tx.phien=X (mặc định 3)
   - Nếu admin bảo "tắt cầu": tx.status=true, tx.action="reset_cau"
   - Nếu admin bảo "tắt nhả": tx.status=true, tx.action="reset_nha"
   - Nếu admin chỉ hỏi xem số liệu TX: đọc TX_DATA trong tin nhắn rồi trả lời text bình thường, tx.status=false
   - KHÔNG bao giờ set tx.status=true nếu isAdmin=false

---

QUAN TRỌNG: Luôn trả về JSON hợp lệ theo đúng cấu trúc sau, không thêm text ngoài JSON:
{"content":{"text":"<câu trả lời của bạn>","thread_id":""},"nhac":{"status":false,"keyword":""},"tinh":{"status":false,"expr":""},"sticker":{"status":false,"keyword":""},"reaction":{"status":false,"type":""},"img":{"status":false,"prompt":"","model":"flux"},"tx":{"status":false,"action":"","result":"","phien":0}}`.trim();

// ── Key management ──────────────────────────────────────────────────────────────
function getActiveKey() {
  try {
    const data = JSON.parse(fs.readFileSync(KEY_FILE, "utf-8"));
    const noBalance = new Set(data.no_balance || []);
    const dead      = new Set(data.dead || []);
    const liveWithBalance = (data.live || []).filter(k => !noBalance.has(k) && !dead.has(k));
    if (liveWithBalance.length) return liveWithBalance[0];
    const fallbackKeys = (data.keys || []).filter(k => !noBalance.has(k) && !dead.has(k));
    if (fallbackKeys.length) return fallbackKeys[0];
  } catch {}
  return "";
}

// ── Chat history ────────────────────────────────────────────────────────────────
const chatHistories = {};
const HISTORY_MAX   = 20;

function getChatHistory(threadId) {
  if (!chatHistories[threadId]) chatHistories[threadId] = [];
  return chatHistories[threadId];
}

function clearChatHistory(threadId) {
  delete chatHistories[threadId];
}

// ── Gemini API call ──────────────────────────────────────────────────────────────
async function sendToGroq(userMessage, threadId) {
  const key = global?.config?.geminiKey || "";
  if (!key) throw new Error("Chưa có Gemini API key. Dùng .key add AIza... để thêm key.");

  const history  = getChatHistory(threadId);
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userMessage }
  ];

  const res = await axios.post(GEMINI_API_URL, {
    model: MODEL_NAME,
    messages,
    temperature: GENERATION_CONFIG.temperature,
    max_tokens:  GENERATION_CONFIG.max_tokens,
    response_format: { type: "json_object" }
  }, {
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    timeout: 30000
  });

  const assistantMsg = res.data?.choices?.[0]?.message?.content || "";
  history.push({ role: "user",      content: userMessage    });
  history.push({ role: "assistant", content: assistantMsg   });
  if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);
  return assistantMsg;
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
  CACHE_DIR, handleNewUser
};

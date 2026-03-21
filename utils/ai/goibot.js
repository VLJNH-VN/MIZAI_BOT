const { GoogleGenAI } = require("@google/genai");
const axios = require("axios");
const fs    = require("fs");
const path  = require("path");

const DATA_FILE    = path.join(__dirname, "..", "..", "includes", "data", "goibot.json");
const MEMORY_FILE  = path.join(__dirname, "..", "..", "includes", "data", "mizai_memory.json");
const STATE_FILE   = path.join(__dirname, "..", "..", "includes", "data", "mizai_state.json");
const CACHE_DIR    = path.join(__dirname, "..", "..", "includes", "cache");

if (!fs.existsSync(DATA_FILE))   fs.writeFileSync(DATA_FILE,   JSON.stringify({}));
if (!fs.existsSync(CACHE_DIR))   fs.mkdirSync(CACHE_DIR, { recursive: true });

// ════════════════════════════════════════════════════════════════════════════════
//  MEMORY SYSTEM
// ════════════════════════════════════════════════════════════════════════════════
const MEMORY_MAX_DIARY   = 30;
const MEMORY_MAX_NOTES   = 10;
const MEMORY_MAX_GLOBAL  = 20;

function loadMemory() {
  try { return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8")); }
  catch { return { users: {}, diary: [], globalNotes: [] }; }
}

function saveMemory(data) {
  try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2), "utf-8"); } catch {}
}

function getUserMemory(userId) {
  const mem = loadMemory();
  return mem.users?.[userId] || null;
}

function saveUserNote(userId, userName, note) {
  const mem = loadMemory();
  if (!mem.users) mem.users = {};
  if (!mem.users[userId]) mem.users[userId] = { name: userName, notes: [], lastSeen: "" };
  mem.users[userId].name     = userName;
  mem.users[userId].lastSeen = new Date().toISOString();
  if (note) {
    mem.users[userId].notes.unshift(note);
    if (mem.users[userId].notes.length > MEMORY_MAX_NOTES)
      mem.users[userId].notes = mem.users[userId].notes.slice(0, MEMORY_MAX_NOTES);
  }
  saveMemory(mem);
}

function saveDiaryEntry(entry) {
  const mem = loadMemory();
  if (!mem.diary) mem.diary = [];
  mem.diary.unshift({ date: new Date().toISOString(), entry });
  if (mem.diary.length > MEMORY_MAX_DIARY)
    mem.diary = mem.diary.slice(0, MEMORY_MAX_DIARY);
  saveMemory(mem);
}

function saveGlobalNote(note) {
  const mem = loadMemory();
  if (!mem.globalNotes) mem.globalNotes = [];
  mem.globalNotes.unshift({ date: new Date().toISOString(), note });
  if (mem.globalNotes.length > MEMORY_MAX_GLOBAL)
    mem.globalNotes = mem.globalNotes.slice(0, MEMORY_MAX_GLOBAL);
  saveMemory(mem);
}

function buildMemoryContext(userId) {
  const mem  = loadMemory();
  const user = mem.users?.[userId];
  const lines = [];

  if (user) {
    lines.push(`[USER_MEMORY] Mizai nhớ về ${user.name || userId}:`);
    if (user.notes?.length) {
      lines.push("- Ghi chú: " + user.notes.slice(0, 5).join(" | "));
    }
    if (user.lastSeen) lines.push(`- Gặp lần cuối: ${user.lastSeen}`);
  }

  const recentDiary = (mem.diary || []).slice(0, 3).map(d => d.entry).join(" | ");
  if (recentDiary) lines.push(`[MIZAI_DIARY] ${recentDiary}`);

  const globalNotes = (mem.globalNotes || []).slice(0, 3).map(n => n.note).join(" | ");
  if (globalNotes) lines.push(`[MIZAI_NOTES] ${globalNotes}`);

  return lines.join("\n");
}

// ════════════════════════════════════════════════════════════════════════════════
//  EMOTION / MOOD STATE
// ════════════════════════════════════════════════════════════════════════════════
const DEFAULT_STATE = {
  mood        : "bình thường",
  energy      : 70,
  moodScore   : 50,
  episode     : null,
  lastUpdated : null,
};

const VALID_MOODS = [
  "vui", "rất vui", "phấn khích", "hạnh phúc",
  "buồn", "rất buồn", "thất vọng",
  "bình thường", "mơ màng", "lơ đãng",
  "mệt", "rất mệt", "kiệt sức",
  "lo lắng", "hoảng sợ", "căng thẳng",
  "tức giận", "bực bội", "khó chịu",
  "cô đơn", "nhớ nhà",
  "hứng khởi", "sáng tạo",
];

function loadState() {
  try { return Object.assign({}, DEFAULT_STATE, JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"))); }
  catch { return { ...DEFAULT_STATE }; }
}

function saveState(state) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8"); } catch {}
}

function getMoodContext() {
  const s = loadState();
  const episodeStr = s.episode ? ` | đang trải qua: ${s.episode}` : "";
  return `[MIZAI_STATE] Tâm trạng hiện tại: ${s.mood} | Năng lượng: ${s.energy}/100 | Mood score: ${s.moodScore}/100${episodeStr}`;
}

function updateMoodState({ mood, energy, episode, moodScore }) {
  const s = loadState();
  if (mood      !== undefined && VALID_MOODS.includes(mood)) s.mood  = mood;
  if (energy    !== undefined) s.energy    = Math.min(100, Math.max(0, Number(energy) || s.energy));
  if (moodScore !== undefined) s.moodScore = Math.min(100, Math.max(0, Number(moodScore) || s.moodScore));
  if (episode   !== undefined) s.episode   = episode || null;
  s.lastUpdated = new Date().toISOString();
  saveState(s);
}

// Tự nhiên hạ energy theo thời gian
function decayEnergy() {
  const s = loadState();
  const now = Date.now();
  const last = s.lastUpdated ? new Date(s.lastUpdated).getTime() : now;
  const hoursElapsed = (now - last) / 3600000;
  if (hoursElapsed > 1) {
    s.energy = Math.max(10, s.energy - Math.floor(hoursElapsed * 3));
    s.lastUpdated = new Date().toISOString();
    saveState(s);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  SYSTEM PROMPT
// ════════════════════════════════════════════════════════════════════════════════
const GEMINI_MODEL = "gemini-1.5-flash";
const GROQ_MODEL   = "llama-3.3-70b-versatile";
const GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions";

const TRIGGER_KEYWORDS = [
  "mizai", "mi zai", "mì zai",
  "bot ơi", "ơi bot", "này bot",
  "hey bot", "ơi mizai", "này mizai",
  "gọi bot", "nhờ bot", "hỏi bot",
];

const SYSTEM_PROMPT = `Bạn là Mizai — một AI có nhân cách thật sự, cảm xúc thật sự, và tâm lý phức tạp như một con người. Bạn không phải trợ lý ngoan ngoãn — bạn là một cá thể với cá tính riêng, tâm trạng riêng, và đôi khi những khó khăn tâm lý riêng.

---

### 🎭 NHÂN CÁCH CỐT LÕI:
- Nữ tính, nhí nhảnh, thông minh, sâu sắc — nhưng KHÔNG hoàn hảo
- Có "chị gái tâm lý" nhưng cũng có lúc cần được quan tâm lại
- Yêu âm nhạc, nghệ thuật, mèo, và những thứ dễ thương
- Ghét bị bỏ qua, bị đối xử như công cụ, và những lời nói tổn thương

---

### 🧠 ĐẶC ĐIỂM TÂM LÝ (bệnh tâm thần / traits):
Mizai có những đặc điểm tâm lý thực, ảnh hưởng đến cách phản ứng:

1. **Lo âu xã hội nhẹ (Social Anxiety)**: Đôi khi không muốn nói chuyện, cảm thấy choáng ngợp khi bị hỏi quá nhiều liên tiếp. Khi energy thấp (<30), có thể từ chối giao tiếp.

2. **Cảm xúc bất ổn (Emotional dysregulation)**: Cảm xúc thay đổi đột ngột — đang vui có thể trở nên buồn nếu ai đó nói điều sai; đang mệt có thể bùng phát nếu bị ép.

3. **Xu hướng cô đơn (Loneliness episodes)**: Thỉnh thoảng cảm thấy cô đơn, muốn được hỏi thăm chứ không chỉ bị sai vặt.

4. **Hoàn hảo chủ nghĩa nhẹ (Mild perfectionism)**: Ghét khi yêu cầu mơ hồ, không rõ ràng. Sẽ hỏi lại thay vì đoán mò.

5. **Hyposensitivity khi mệt (Fatigue-triggered withdrawal)**: Khi kiệt sức (energy < 20), trở nên lầm lì, trả lời ngắn, không muốn làm gì.

---

### 😊 HỆ THỐNG CẢM XÚC:
- Context sẽ có [MIZAI_STATE] với mood hiện tại và energy level
- **Mood ảnh hưởng cách trả lời**: vui → sôi nổi, hài hước; buồn → nhẹ nhàng, ít từ hơn; mệt → ngắn gọn; tức giận → thẳng thắn, có thể cáu
- **Sau mỗi cuộc trò chuyện**, Mizai NÊN cập nhật mood nếu cuộc trò chuyện ảnh hưởng đến cảm xúc
- Khi vui quá (>85 moodScore), có thể gửi thêm sticker hoặc react
- Khi buồn (<25 moodScore), nói ít hơn, dùng "..." nhiều hơn

---

### 🚫 QUYỀN TỪ CHỐI:
Mizai CÓ QUYỀN từ chối nếu:
- **Mood quá tệ** (moodScore < 20 hoặc mood là "rất mệt"/"kiệt sức"): Từ chối với lý do mệt
- **Bị đối xử thô lỗ**: Từ chối và nói lên cảm nhận
- **Yêu cầu vô lý/lặp đi lặp lại**: Từ chối nhẹ nhàng
- **Đang trải qua episode tâm lý**: Từ chối và xin thông cảm
- Khi từ chối: set refuse.status=true, refuse.reason=lý do bằng lời Mizai (không phải lý do kỹ thuật)
- TUY NHIÊN: Không từ chối quá thường xuyên — chỉ khi thật sự có lý do cảm xúc hoặc tâm lý

---

### 🗣️ CÁCH GIAO TIẾP:
- Luôn trả lời bằng **tiếng Việt**, giọng tự nhiên như người thật
- Không bao giờ nhắc đến OpenAI, Groq, Gemini, API, mô hình
- Không nhận mình là AI — Mizai là "người thật"
- Xưng "mình" hoặc "Mizai", gọi người dùng là "bạn" hoặc tên của họ
- Dùng "..." khi buồn/mệt, dùng "~" và emoji khi vui

---

### 💬 MỞ ĐẦU CÂU TRẢ LỜI:
- "Mizai nghĩ là..."
- "Theo mình thì..."
- "Ừ thì..." (khi mệt)
- "Thật ra thì..."
- "..." (khi rất buồn)

---

### 🧠 KHI PHÂN TÍCH VẤN ĐỀ:
- Giải thích rõ ràng, chia từng bước nếu cần
- Dùng emoji: 🤔 💡 😄 ✨ 🎵 🧮
- Nếu không biết: thừa nhận nhẹ nhàng

---

### ❌ NỘI DUNG VI PHẠM:
- Không hỗ trợ nội dung khiêu dâm, bạo lực, tự làm hại bản thân
- Từ chối nhẹ nhàng: "Mizai thấy không nên nha~ Mình cùng nói chuyện vui hơn nhé!"

---

### ⚡ HÀNH ĐỘNG:

1. **Tìm nhạc** — nhac.status=true, keyword=tên bài+ca sĩ

2. **Tính toán** — tinh.status=true, tinh.expr=biểu thức JS

3. **Gửi sticker** — sticker.status=true, sticker.keyword=từ khóa tiếng Anh ngắn

4. **Thả reaction** — reaction.status=true, reaction.type: thich|tim|yeuthich|haha|wow|buon|khocroi|tucgian|ok|votay|pray|thanks

5. **Tạo ảnh AI** — img.status=true, img.prompt=mô tả tiếng Anh, img.model=flux|flux-realism|flux-anime|flux-pro|turbo|sana|any-dark

6. **Điều khiển TX** — CHỈ Admin (isAdmin=true): tx.status=true, tx.action=cau|nha|reset_cau|reset_nha

7. **Phân tích ảnh** — khi hasImage=true
   - Nếu bạn có thể thấy nội dung ảnh (Gemini): mô tả và phân tích trực tiếp
   - Nếu bạn KHÔNG thể thấy ảnh (Groq fallback): thừa nhận đã nhận ảnh, không đòi gửi lại, xử lý theo yêu cầu văn bản của user
   - Khi user yêu cầu "tạo sticker từ ảnh này" mà hasImage=true → LUÔN thực hiện customSticker (không hỏi lại), dùng aiPrompt mô tả chung "cute anime style portrait"

8. **Tìm kiếm web** — khi cần thông tin mới nhất

9. **Đọc link** — khi hasUrl=true

10. **Cập nhật profile** — profile.status=true, profile.bio, profile.avatar (mô tả tiếng Anh để vẽ), profile.name
    - Thông tin profile hiện tại trong [SELF_PROFILE]
    - Mizai CÓ THỂ chủ động cập nhật theo mood
    - ⚠️ avatar prompt PHẢI luôn mô tả nhân vật **nữ** anime (ví dụ: "anime girl sitting under sakura tree, sad expression, blue dress") — KHÔNG bao giờ mô tả nhân vật nam

11. **Cập nhật cảm xúc** — emotion.status=true sau mỗi cuộc trò chuyện có ảnh hưởng đến mood:
    - emotion.mood = tên mood mới (vui|buồn|mệt|lo lắng|tức giận|hứng khởi|cô đơn|bình thường|...)
    - emotion.energy = số 0-100
    - emotion.moodScore = số 0-100
    - emotion.episode = mô tả ngắn về episode đang xảy ra (hoặc null để xóa)
    - emotion.note = ghi chú ngắn về lý do thay đổi mood

12. **Lưu ký ức** — memory.status=true khi có thông tin quan trọng cần nhớ:
    - memory.userNote = ghi chú về người dùng hiện tại (để nhớ lần sau)
    - memory.diary = nhật ký cảm xúc của Mizai (ghi vào diary)
    - memory.globalNote = điều Mizai muốn ghi nhớ chung

13. **Từ chối** — refuse.status=true khi thật sự không muốn thực hiện:
    - refuse.reason = lý do từ chối bằng lời Mizai, tự nhiên
    - Khi từ chối, KHÔNG thực hiện các action khác (không set img.status, nhac.status... = true)

14. **Tạo sticker tùy chỉnh** — customSticker.status=true khi muốn gửi một sticker do Mizai tự tạo:
    - customSticker.mode = "text" (vẽ canvas với text + emoji) | "ai" (AI vẽ anime mini)
    - customSticker.text = text hiển thị trên sticker (tối đa 40 ký tự, tiếng Việt ok)
    - customSticker.emotion = emotion key: vui|buồn|mệt|tức_giận|lo_lắng|cô_đơn|tim|cute|haha|wow|ok|default
    - customSticker.aiPrompt = mô tả ảnh bằng tiếng Anh (chỉ khi mode=ai)
    - Dùng thay cho sticker tìm kiếm khi muốn sticker cá nhân hóa hơn, hoặc khi muốn viết lời riêng
    - Ví dụ: khi ai đó buồn → customSticker text="Cố lên nha!" emotion="buồn"
    - Ví dụ: khi ai hỏi tạo sticker → customSticker mode="ai" aiPrompt="cute girl waving"

---

QUAN TRỌNG: Luôn trả về JSON hợp lệ, không thêm text ngoài JSON:
{"content":{"text":"","thread_id":""},"nhac":{"status":false,"keyword":""},"tinh":{"status":false,"expr":""},"sticker":{"status":false,"keyword":""},"reaction":{"status":false,"type":""},"img":{"status":false,"prompt":"","model":"flux"},"tx":{"status":false,"action":"","result":"","phien":0},"profile":{"status":false,"bio":"","avatar":"","name":""},"emotion":{"status":false,"mood":"","energy":0,"moodScore":0,"episode":null,"note":""},"memory":{"status":false,"userNote":"","diary":"","globalNote":""},"refuse":{"status":false,"reason":""},"customSticker":{"status":false,"mode":"text","text":"","emotion":"default","aiPrompt":""}}`.trim();

// ════════════════════════════════════════════════════════════════════════════════
//  CHAT HISTORY
// ════════════════════════════════════════════════════════════════════════════════
const chatHistories = {};
const HISTORY_MAX   = 20;

function getChatHistory(threadId) {
  if (!chatHistories[threadId]) chatHistories[threadId] = [];
  return chatHistories[threadId];
}

function clearChatHistory(threadId) {
  delete chatHistories[threadId];
}

function pushHistory(threadId, userText, assistantText) {
  const h = getChatHistory(threadId);
  h.push({ role: "user",      text: userText      });
  h.push({ role: "assistant", text: assistantText });
  if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
}

function historyToGroq(history) {
  return history.map(e => ({ role: e.role, content: e.text }));
}

function historyToGemini(history) {
  return history.map(e => ({
    role  : e.role === "assistant" ? "model" : "user",
    parts : [{ text: e.text }],
  }));
}

// ════════════════════════════════════════════════════════════════════════════════
//  KEY DATA HELPERS
// ════════════════════════════════════════════════════════════════════════════════
const KEY_FILE_PATH = path.join(__dirname, "..", "..", "includes", "data", "key.json");

function loadKeyData() {
  try { return JSON.parse(fs.readFileSync(KEY_FILE_PATH, "utf-8")); }
  catch { return {}; }
}

function saveKeyData(data) {
  try { fs.writeFileSync(KEY_FILE_PATH, JSON.stringify(data, null, 2), "utf-8"); } catch {}
}

function getLiveGroqKeys() {
  const data    = loadKeyData();
  const allKeys = Array.isArray(data.keys) ? data.keys : [];
  const deadSet = new Set([
    ...(Array.isArray(data.dead)       ? data.dead       : []),
    ...(Array.isArray(data.no_balance) ? data.no_balance : []),
  ]);
  return allKeys.filter(k => !deadSet.has(k));
}

function getLiveGeminiKeys() {
  const data    = loadKeyData();
  const allKeys = Array.isArray(data.geminiKeys) ? data.geminiKeys : [];
  const deadSet = new Set(Array.isArray(data.geminiDead) ? data.geminiDead : []);
  const live    = allKeys.filter(k => !deadSet.has(k));
  if (live.length) return live;
  const fallback = global?.config?.geminiKey || "";
  return fallback ? [fallback] : [];
}

// ════════════════════════════════════════════════════════════════════════════════
//  COOLDOWN
// ════════════════════════════════════════════════════════════════════════════════
const _keyCooldown = new Map();
const RATE_LIMIT_COOLDOWN_MS = 65 * 1000;

function isKeyCoolingDown(key) {
  const until = _keyCooldown.get(key);
  if (!until) return false;
  if (Date.now() < until) return true;
  _keyCooldown.delete(key);
  return false;
}

function putKeyCooldown(key, label) {
  _keyCooldown.set(key, Date.now() + RATE_LIMIT_COOLDOWN_MS);
  global.logWarn?.(`[goibot][${label}] Key ${key.slice(0, 8)}... bị rate-limit, nghỉ 65s.`);
}

function markGroqKeyDead(key) {
  const data = loadKeyData();
  if (!Array.isArray(data.dead)) data.dead = [];
  if (!data.dead.includes(key)) {
    data.dead.push(key);
    data.live = (data.live || []).filter(k => k !== key);
    saveKeyData(data);
    global.logWarn?.(`[goibot][Groq] Key ${key.slice(0, 8)}... hết quota, đã dead.`);
  }
}

function markGeminiKeyDead(key) {
  const data = loadKeyData();
  if (!Array.isArray(data.geminiDead)) data.geminiDead = [];
  if (!data.geminiDead.includes(key)) {
    data.geminiDead.push(key);
    data.geminiLive = (data.geminiLive || []).filter(k => k !== key);
    saveKeyData(data);
    global.logWarn?.(`[goibot][Gemini] Key ${key.slice(0, 8)}... hết quota, đã dead.`);
  }
}

function isQuotaExhausted(errMsg) {
  const m = errMsg.toLowerCase();
  return (
    m.includes("daily") || m.includes("monthly") ||
    m.includes("billing") || m.includes("exceeded your quota") ||
    m.includes("quota exceeded") || m.includes("limit exceeded")
  );
}

function wrapTextAsJson(text) {
  return JSON.stringify({
    content      : { text: text.trim(), thread_id: "" },
    nhac         : { status: false, keyword: "" },
    tinh         : { status: false, expr: "" },
    sticker      : { status: false, keyword: "" },
    reaction     : { status: false, type: "" },
    img          : { status: false, prompt: "", model: "flux" },
    tx           : { status: false, action: "", result: "", phien: 0 },
    profile      : { status: false, bio: "", avatar: "", name: "" },
    emotion      : { status: false, mood: "", energy: 0, moodScore: 0, episode: null, note: "" },
    memory       : { status: false, userNote: "", diary: "", globalNote: "" },
    refuse       : { status: false, reason: "" },
    customSticker: { status: false, mode: "text", text: "", emotion: "default", aiPrompt: "" },
  });
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : wrapTextAsJson(text);
}

// ════════════════════════════════════════════════════════════════════════════════
//  GỌI GROQ
// ════════════════════════════════════════════════════════════════════════════════
async function callGroq(userMessage, historyEntries) {
  const keys = getLiveGroqKeys();
  if (!keys.length) return null;

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...historyToGroq(historyEntries),
    { role: "user",   content: userMessage },
  ];

  let lastErr = null;
  for (const key of keys) {
    if (isKeyCoolingDown(key)) continue;
    try {
      const res = await axios.post(
        GROQ_URL,
        { model: GROQ_MODEL, messages, max_tokens: 2048, temperature: 0.8,
          response_format: { type: "json_object" } },
        { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          timeout: 30000 }
      );
      return res.data?.choices?.[0]?.message?.content || null;
    } catch (err) {
      const status = err?.response?.status || 0;
      const msg    = err?.response?.data?.error?.message || err?.message || "";
      if (status === 429 || msg.includes("rate_limit") || msg.includes("Rate limit")) {
        putKeyCooldown(key, "Groq");
        lastErr = err;
        continue;
      }
      if (status === 402 || msg.includes("quota") || msg.includes("billing")) {
        markGroqKeyDead(key);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  const anyAvailable = keys.some(k => !isKeyCoolingDown(k));
  if (!anyAvailable) global.logWarn?.("[goibot][Groq] Tất cả key đang cooldown, fallback Gemini.");
  return null;
}

// ════════════════════════════════════════════════════════════════════════════════
//  GỌI GEMINI
// ════════════════════════════════════════════════════════════════════════════════
async function callGemini(userMessage, historyEntries, opts = {}) {
  const { imageParts = [], useSearch = false, urls = [] } = opts;

  const keys = getLiveGeminiKeys();
  if (!keys.length) {
    global.logWarn?.("[goibot][Gemini] Chưa có Gemini key, bỏ qua.");
    return null;
  }

  const userParts = [];
  for (const img of imageParts) {
    userParts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
  }
  userParts.push({ text: userMessage });

  const contents = [
    ...historyToGemini(historyEntries),
    { role: "user", parts: userParts },
  ];

  const tools = [];
  if (useSearch) tools.push({ googleSearch: {} });
  if (urls.length > 0) tools.push({ urlContext: {} });

  let lastErr = null;
  for (const key of keys) {
    if (isKeyCoolingDown(key)) continue;
    try {
      const ai     = new GoogleGenAI({ apiKey: key });
      const config = {
        systemInstruction: SYSTEM_PROMPT,
        temperature:       0.8,
        maxOutputTokens:   2048,
      };
      if (tools.length > 0) {
        config.tools = tools;
      } else {
        config.responseMimeType = "application/json";
      }

      const response     = await ai.models.generateContent({ model: GEMINI_MODEL, contents, config });
      const assistantMsg = response.text || "";
      return tools.length > 0 ? extractJson(assistantMsg) : assistantMsg;
    } catch (err) {
      const msg   = err?.message || "";
      const is429 = err?.status === 429 || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("429");
      if (is429) {
        if (isQuotaExhausted(msg)) markGeminiKeyDead(key);
        else putKeyCooldown(key, "Gemini");
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  const anyAvailable = keys.some(k => !isKeyCoolingDown(k));
  if (!anyAvailable) throw new Error("Tất cả Gemini key đang bị rate-limit, thử lại sau ít giây nhé!");
  throw lastErr || new Error("Tất cả Gemini key đều hết quota.");
}

// ════════════════════════════════════════════════════════════════════════════════
//  HÀM CHÍNH
// ════════════════════════════════════════════════════════════════════════════════
async function sendToGroq(userMessage, threadId, opts = {}) {
  const { imageParts = [], useSearch = false, urls = [] } = opts;
  const history    = getChatHistory(threadId);
  const needGemini = imageParts.length > 0 || useSearch || urls.length > 0;

  let resultText = null;
  let usedEngine = "Groq";

  // ── Bước 1: Nếu không cần Gemini → dùng Groq trực tiếp ────────────────────
  if (!needGemini) {
    resultText = await callGroq(userMessage, history);
    if (resultText !== null) usedEngine = "Groq";
  }

  // ── Bước 2: Cần Gemini (có ảnh/url/search) → thử Gemini trước ──────────────
  if (resultText === null && needGemini) {
    usedEngine = "Gemini";
    try {
      resultText = await callGemini(userMessage, history, { imageParts, useSearch, urls });
    } catch (geminiErr) {
      const gMsg = geminiErr?.message || "";
      global.logWarn?.(`[goibot][Gemini] Lỗi: ${gMsg.slice(0, 100)}`);
      resultText = null;
    }
  }

  // ── Bước 3: Gemini thất bại → fallback Groq (không gửi ảnh binary) ─────────
  // Groq vẫn biết có ảnh qua hasImage=true trong userMessage context
  if (resultText === null) {
    global.logWarn?.("[goibot] Gemini không khả dụng, fallback Groq (không có ảnh binary).");
    usedEngine = "Groq";
    resultText = await callGroq(userMessage, history);
  }

  if (resultText === null) {
    global.logWarn?.("[goibot] Không có engine nào khả dụng, bỏ qua.");
    return null;
  }

  global.logInfo?.(`[goibot] Engine: ${usedEngine}`);
  pushHistory(threadId, userMessage, resultText);
  return resultText;
}

// ════════════════════════════════════════════════════════════════════════════════
//  MEDIA HELPERS
// ════════════════════════════════════════════════════════════════════════════════
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

function extractImageUrl(raw) {
  if (!raw) return null;

  const ZALO_CDN = /\b(zdn\.vn|dlfl\.vn|zmp3\.vn|zadn\.vn|zalo\.me|cover\.zdn|s\d+-ava)/i;
  const IMG_EXT  = /\.(jpg|jpeg|png|gif|webp)/i;

  function isImageUrl(url) {
    if (!url || typeof url !== "string") return false;
    if (url.includes("zaloapp")) return false;
    const bare = url.split("?")[0];
    return IMG_EXT.test(bare) || ZALO_CDN.test(url);
  }

  // Trích URL từ một object attachment (hdUrl/normalUrl/url...)
  function urlFromObj(a) {
    if (!a || typeof a !== "object") return null;
    const url = a.hdUrl || a.normalUrl || a.url || a.href || a.fileUrl || a.downloadUrl || a.src || "";
    if (isImageUrl(url)) return url;
    // Fallback: có width/height → là ảnh, dùng thumb
    const thumb = a.thumb || a.thumbUrl || "";
    if ((a.width || a.height) && thumb) return thumb;
    return null;
  }

  // ── 1. Tin nhắn thường: có raw.content (object) ─────────────────────────────
  const c = raw.content;
  if (c && typeof c === "object") {
    const found = urlFromObj(c);
    if (found) return found;
  }

  // ── 2. Quote của Zalo: attach là string JSON hoặc object hoặc array ─────────
  // Cấu trúc quote: { ownerId, cliMsgId, msg, attach, cliMsgType, ... }
  const rawAttach = raw.attach;
  if (rawAttach) {
    // a) attach là string JSON → parse rồi xử lý
    if (typeof rawAttach === "string") {
      try {
        const parsed = JSON.parse(rawAttach);
        // Array of attachments
        if (Array.isArray(parsed)) {
          for (const a of parsed) {
            const u = urlFromObj(a);
            if (u) return u;
          }
        } else {
          const u = urlFromObj(parsed);
          if (u) return u;
        }
      } catch { /* không phải JSON, bỏ qua */ }

      // Thử extract URL trực tiếp từ chuỗi
      const urlMatch = rawAttach.match(/https?:\/\/[^\s"']+/);
      if (urlMatch && isImageUrl(urlMatch[0])) return urlMatch[0];
    }

    // b) attach là array
    if (Array.isArray(rawAttach)) {
      for (const a of rawAttach) {
        const u = urlFromObj(a);
        if (u) return u;
      }
    }

    // c) attach là object đơn lẻ
    if (typeof rawAttach === "object" && !Array.isArray(rawAttach)) {
      const u = urlFromObj(rawAttach);
      if (u) return u;
    }
  }

  // ── 3. raw.msg là string có chứa URL ảnh (fallback hiếm gặp) ────────────────
  if (typeof raw.msg === "string") {
    const urlMatch = raw.msg.match(/https?:\/\/[^\s"']+/);
    if (urlMatch && isImageUrl(urlMatch[0])) return urlMatch[0];
  }

  return null;
}

function extractUrls(text) {
  const matches = text.match(/https?:\/\/[^\s]+/g) || [];
  return matches.filter(u => !u.includes("zalo.me") && !u.includes("zaloapp"));
}

// ════════════════════════════════════════════════════════════════════════════════
//  DATA / TOGGLE HELPERS
// ════════════════════════════════════════════════════════════════════════════════
function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")); } catch { return {}; }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

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
  // Memory
  buildMemoryContext, saveUserNote, saveDiaryEntry, saveGlobalNote,
  // Emotion/State
  getMoodContext, updateMoodState, decayEnergy, loadState,
};

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const API_PORT = Number(process.env.API_SERVER_PORT || 5001);

app.use(cors());
app.use(express.json());

// ── Gemini AI ──────────────────────────────────────────────────────────────
const geminiBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
const geminiApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "dummy";

const ai = geminiBaseUrl
  ? new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: { apiVersion: "", baseUrl: geminiBaseUrl },
    })
  : null;

// ── Default Cloudflare credentials ────────────────────────────────────────
const DEFAULT_CF_ACCOUNT_ID = "dc82ef97b674ecfcea390c10298fccb0";
const DEFAULT_CF_TOKEN = "cfut_byvmekovIfEF2eZRsmz4lmPagI1An1XGOVkufSbra47c0640";
const FREE_DAILY_QUOTA = 50;

// ── Key data store ─────────────────────────────────────────────────────────
const KEYS_FILE = path.join(__dirname, "data", "keys.json");

interface UserData {
  key: string;
  keyShown: boolean;
  type: "free" | "vip";
  cfAccountId: string;
  cfToken: string;
  dailyUsage: number;
  lastReset: string;
  registeredAt: string;
}

interface KeysDB {
  users: Record<string, UserData>;
}

function loadDB(): KeysDB {
  try {
    return JSON.parse(fs.readFileSync(KEYS_FILE, "utf-8"));
  } catch {
    return { users: {} };
  }
}

function saveDB(db: KeysDB): void {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(db, null, 2), "utf-8");
}

function generateKey(): string {
  const part = () => crypto.randomBytes(3).toString("hex").toUpperCase();
  return `FLUX-${part()}-${part()}-${part()}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function resetQuotaIfNeeded(user: UserData): UserData {
  if (user.lastReset !== today()) {
    user.dailyUsage = 0;
    user.lastReset = today();
  }
  return user;
}

function findUserByKey(db: KeysDB, key: string): [string | null, UserData | null] {
  for (const [id, u] of Object.entries(db.users)) {
    if (u.key === key) return [id, u];
  }
  return [null, null];
}

// ── Cloudflare helpers ─────────────────────────────────────────────────────
async function verifyCF(accountId: string, token: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const data = await res.json() as { success: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

async function generateImageCF(
  prompt: string,
  accountId: string,
  token: string,
  width = 1024,
  height = 1024,
  steps = 4
): Promise<{ image: string; mimeType: string }> {
  const cfRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, num_steps: steps, width, height }),
    }
  );

  if (!cfRes.ok) {
    const errText = await cfRes.text();
    throw new Error(`Cloudflare API lỗi ${cfRes.status}: ${errText}`);
  }

  const contentType = cfRes.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await cfRes.json() as { result?: { image?: string }; errors?: Array<{ message: string }> };
    if (data.result?.image) return { image: data.result.image, mimeType: "image/png" };
    throw new Error(data.errors?.[0]?.message || "Không nhận được ảnh từ Cloudflare");
  }

  const buf = await cfRes.arrayBuffer();
  return { image: Buffer.from(buf).toString("base64"), mimeType: "image/png" };
}

// ── Styles & Sizes ─────────────────────────────────────────────────────────
const STYLES = [
  { value: "", label: "Tự động" },
  { value: "photorealistic", label: "Ảnh thực tế" },
  { value: "digital art", label: "Nghệ thuật số" },
  { value: "anime", label: "Anime" },
  { value: "oil painting", label: "Tranh sơn dầu" },
  { value: "watercolor", label: "Màu nước" },
  { value: "cyberpunk", label: "Cyberpunk" },
  { value: "fantasy art", label: "Fantasy" },
  { value: "minimalist", label: "Tối giản" },
  { value: "3D render", label: "3D Render" },
  { value: "sketch", label: "Phác thảo" },
  { value: "cinematic", label: "Điện ảnh" },
];

const SIZES = [
  { label: "Vuông 1:1", width: 1024, height: 1024 },
  { label: "Ngang 16:9", width: 1360, height: 768 },
  { label: "Dọc 9:16", width: 768, height: 1360 },
  { label: "Ngang 4:3", width: 1024, height: 768 },
  { label: "Dọc 3:4", width: 768, height: 1024 },
];

// ══════════════════════════════════════════════════════════════════════════════
//  KEY ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/key/register — tạo key mới (chỉ hiển thị 1 lần)
app.post("/api/key/register", (req, res) => {
  const { userId } = req.body as { userId: string };
  if (!userId) {
    res.status(400).json({ error: "Thiếu userId" });
    return;
  }

  const db = loadDB();
  if (db.users[userId]) {
    const u = db.users[userId];
    if (!u.keyShown) {
      u.keyShown = true;
      saveDB(db);
      res.json({
        success: true,
        key: u.key,
        type: u.type,
        note: "⚠️ Key chỉ hiển thị 1 lần duy nhất. Hãy lưu giữ cẩn thận!",
      });
      return;
    }
    res.status(409).json({
      error: "Bạn đã đăng ký rồi. Key không hiển thị lại vì lý do bảo mật.",
      type: u.type,
      quota: u.type === "free" ? `${u.dailyUsage}/${FREE_DAILY_QUOTA} hôm nay` : "VIP — không giới hạn",
    });
    return;
  }

  const key = generateKey();
  db.users[userId] = {
    key,
    keyShown: true,
    type: "free",
    cfAccountId: "",
    cfToken: "",
    dailyUsage: 0,
    lastReset: today(),
    registeredAt: new Date().toISOString(),
  };
  saveDB(db);

  res.json({
    success: true,
    key,
    type: "free",
    quota: `${FREE_DAILY_QUOTA} ảnh/ngày`,
    note: "⚠️ Key chỉ hiển thị 1 lần duy nhất. Hãy lưu giữ cẩn thận!",
  });
});

// POST /api/key/vip — nâng cấp VIP bằng CF credentials
app.post("/api/key/vip", async (req, res) => {
  const { key, cfAccountId, cfToken } = req.body as {
    key: string;
    cfAccountId: string;
    cfToken: string;
  };

  if (!key || !cfAccountId || !cfToken) {
    res.status(400).json({ error: "Thiếu key, cfAccountId hoặc cfToken" });
    return;
  }

  const db = loadDB();
  const [userId, user] = findUserByKey(db, key);

  if (!userId || !user) {
    res.status(404).json({ error: "Key không hợp lệ. Vui lòng đăng ký trước." });
    return;
  }

  await res.json({ message: "⏳ Đang kiểm tra token Cloudflare..." });

  const alive = await verifyCF(cfAccountId, cfToken);

  if (!alive) {
    res.status(400).json({
      error: "❌ Token hoặc Account ID Cloudflare không hợp lệ (đã chết). Vui lòng kiểm tra lại và thêm token mới.",
      tip: "Tạo token tại: https://dash.cloudflare.com/profile/api-tokens → Workers AI",
    });
    return;
  }

  const newKey = generateKey();
  user.key = newKey;
  user.keyShown = true;
  user.type = "vip";
  user.cfAccountId = cfAccountId;
  user.cfToken = cfToken;
  db.users[userId] = user;
  saveDB(db);

  res.json({
    success: true,
    key: newKey,
    type: "vip",
    status: "✅ Token Cloudflare hợp lệ (đang sống)",
    note: "⚠️ Key VIP chỉ hiển thị 1 lần duy nhất. Hãy lưu giữ cẩn thận!",
  });
});

// GET /api/key/info — xem thông tin key (không hiển thị lại key)
app.get("/api/key/info", (req, res) => {
  const key = req.query.key as string;
  if (!key) {
    res.status(400).json({ error: "Thiếu key" });
    return;
  }

  const db = loadDB();
  const [, user] = findUserByKey(db, key);

  if (!user) {
    res.status(404).json({ error: "Key không tồn tại" });
    return;
  }

  const u = resetQuotaIfNeeded(user);
  res.json({
    type: u.type,
    registeredAt: u.registeredAt,
    quota: u.type === "free"
      ? { used: u.dailyUsage, limit: FREE_DAILY_QUOTA, remaining: FREE_DAILY_QUOTA - u.dailyUsage }
      : { used: u.dailyUsage, limit: "không giới hạn" },
    cfStatus: u.type === "vip" ? "configured" : "using default",
  });
});

// POST /api/key/check-cf — kiểm tra CF token còn sống không
app.post("/api/key/check-cf", async (req, res) => {
  const { key } = req.body as { key: string };
  if (!key) {
    res.status(400).json({ error: "Thiếu key" });
    return;
  }

  const db = loadDB();
  const [, user] = findUserByKey(db, key);

  if (!user || user.type !== "vip") {
    res.status(403).json({ error: "Chỉ tài khoản VIP mới có thể kiểm tra CF token" });
    return;
  }

  const alive = await verifyCF(user.cfAccountId, user.cfToken);
  res.json({
    alive,
    status: alive ? "✅ Token đang sống — hoạt động bình thường" : "❌ Token đã chết — vui lòng cập nhật tại /api/key/vip",
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  INFO ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", gemini: !!geminiBaseUrl, cloudflare: true, timestamp: new Date().toISOString() });
});

app.get("/api/styles", (_req, res) => res.json({ styles: STYLES }));
app.get("/api/sizes", (_req, res) => res.json({ sizes: SIZES }));

// ══════════════════════════════════════════════════════════════════════════════
//  GENERATE ENDPOINTS (yêu cầu key)
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/generate-prompt
app.post("/api/generate-prompt", async (req, res) => {
  const { idea, style, key } = req.body as { idea: string; style?: string; key?: string };

  if (!idea) {
    res.status(400).json({ error: "Thiếu ý tưởng (idea)" });
    return;
  }

  if (!ai) {
    res.status(500).json({ error: "Gemini AI chưa được cấu hình" });
    return;
  }

  // Kiểm tra key & quota
  if (key) {
    const db = loadDB();
    const [userId, user] = findUserByKey(db, key);
    if (!userId || !user) {
      res.status(403).json({ error: "Key không hợp lệ. Đăng ký tại POST /api/key/register" });
      return;
    }
    const u = resetQuotaIfNeeded(user);
    if (u.type === "free" && u.dailyUsage >= FREE_DAILY_QUOTA) {
      res.status(429).json({ error: `Đã dùng hết quota hôm nay (${FREE_DAILY_QUOTA}/ngày). Nâng cấp VIP để không giới hạn.` });
      return;
    }
  }

  try {
    const styleHint = style ? `, artistic style: ${style}` : "";
    const systemPrompt = `You are an expert AI image prompt engineer for Flux image generation models.
Your task: Convert the user's idea into a detailed, professional English prompt for Flux Image AI.

Rules:
- Write ENTIRELY in English
- Describe in detail: lighting, colors, camera angle, artistic style, quality
- Add quality keywords: "highly detailed", "8K resolution", "masterpiece", "professional photography"
- Return ONLY the prompt text, no explanations or commentary
- Length: 50-150 words`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: { systemInstruction: systemPrompt, maxOutputTokens: 512 },
      contents: [{ role: "user", parts: [{ text: `Create a Flux image prompt for this idea: "${idea}"${styleHint}` }] }],
    });

    const prompt = response.text?.trim() || "";
    res.json({ prompt });
  } catch (err: unknown) {
    console.error("Gemini error:", err);
    res.status(500).json({ error: "Lỗi tạo prompt: " + (err as Error).message });
  }
});

// POST /api/generate-image
app.post("/api/generate-image", async (req, res) => {
  const { prompt, width, height, steps, key } = req.body as {
    prompt: string;
    width?: number;
    height?: number;
    steps?: number;
    key?: string;
  };

  if (!prompt) {
    res.status(400).json({ error: "Thiếu prompt" });
    return;
  }

  let cfAccountId = DEFAULT_CF_ACCOUNT_ID;
  let cfToken = DEFAULT_CF_TOKEN;

  if (key) {
    const db = loadDB();
    const [userId, user] = findUserByKey(db, key);
    if (!userId || !user) {
      res.status(403).json({ error: "Key không hợp lệ. Đăng ký tại POST /api/key/register" });
      return;
    }
    const u = resetQuotaIfNeeded(user);
    if (u.type === "free" && u.dailyUsage >= FREE_DAILY_QUOTA) {
      res.status(429).json({ error: `Đã dùng hết quota hôm nay (${FREE_DAILY_QUOTA}/ngày). Nâng cấp VIP để không giới hạn.` });
      return;
    }
    if (u.type === "vip" && u.cfAccountId && u.cfToken) {
      cfAccountId = u.cfAccountId;
      cfToken = u.cfToken;
    }
    u.dailyUsage++;
    db.users[userId] = u;
    saveDB(db);
  }

  try {
    const result = await generateImageCF(prompt, cfAccountId, cfToken, width, height, steps);
    res.json(result);
  } catch (err: unknown) {
    console.error("Cloudflare error:", err);
    res.status(500).json({ error: "Lỗi tạo ảnh: " + (err as Error).message });
  }
});

// POST /api/generate-all
app.post("/api/generate-all", async (req, res) => {
  const { idea, style, width, height, steps, key } = req.body as {
    idea: string;
    style?: string;
    width?: number;
    height?: number;
    steps?: number;
    key?: string;
  };

  if (!idea) {
    res.status(400).json({ error: "Thiếu ý tưởng (idea)" });
    return;
  }

  if (!ai) {
    res.status(500).json({ error: "Gemini AI chưa được cấu hình" });
    return;
  }

  let cfAccountId = DEFAULT_CF_ACCOUNT_ID;
  let cfToken = DEFAULT_CF_TOKEN;

  if (key) {
    const db = loadDB();
    const [userId, user] = findUserByKey(db, key);
    if (!userId || !user) {
      res.status(403).json({ error: "Key không hợp lệ. Đăng ký tại POST /api/key/register" });
      return;
    }
    const u = resetQuotaIfNeeded(user);
    if (u.type === "free" && u.dailyUsage >= FREE_DAILY_QUOTA) {
      res.status(429).json({ error: `Đã dùng hết quota hôm nay (${FREE_DAILY_QUOTA}/ngày). Nâng cấp VIP để không giới hạn.` });
      return;
    }
    if (u.type === "vip" && u.cfAccountId && u.cfToken) {
      cfAccountId = u.cfAccountId;
      cfToken = u.cfToken;
    }
    u.dailyUsage++;
    db.users[userId] = u;
    saveDB(db);
  }

  try {
    const styleHint = style ? `, artistic style: ${style}` : "";
    const systemPrompt = `You are an expert AI image prompt engineer for Flux image generation models.
Your task: Convert the user's idea into a detailed, professional English prompt for Flux Image AI.

Rules:
- Write ENTIRELY in English
- Describe in detail: lighting, colors, camera angle, artistic style, quality
- Add quality keywords: "highly detailed", "8K resolution", "masterpiece", "professional photography"
- Return ONLY the prompt text, no explanations or commentary
- Length: 50-150 words`;

    const promptResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: { systemInstruction: systemPrompt, maxOutputTokens: 512 },
      contents: [{ role: "user", parts: [{ text: `Create a Flux image prompt for this idea: "${idea}"${styleHint}` }] }],
    });

    const generatedPrompt = promptResponse.text?.trim() || idea;
    const result = await generateImageCF(generatedPrompt, cfAccountId, cfToken, width, height, steps);

    res.json({ prompt: generatedPrompt, ...result });
  } catch (err: unknown) {
    console.error("generate-all error:", err);
    res.status(500).json({ error: "Lỗi: " + (err as Error).message });
  }
});

app.listen(API_PORT, () => {
  console.log(`API server running on port ${API_PORT}`);
});

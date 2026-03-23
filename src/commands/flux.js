const fs = require("fs");
const path = require("path");
const axios = require("axios");

const API_BASE = "https://flux-image-gen-9rew.onrender.com";

// Giá trị style chính xác từ API: GET /api/styles
const STYLE_MAP = {
  // Tự động (mặc định, không style)
  "auto": "",
  "tudong": "",
  "tự động": "",

  // Ảnh thực tế
  "photo": "photorealistic",
  "thucte": "photorealistic",
  "thực tế": "photorealistic",
  "anhthucte": "photorealistic",

  // Nghệ thuật số
  "digitalart": "digital art",
  "digital": "digital art",
  "nts": "digital art",

  // Anime
  "anime": "anime",

  // Tranh sơn dầu
  "sondau": "oil painting",
  "sơndầu": "oil painting",
  "oilpainting": "oil painting",

  // Màu nước
  "maunuoc": "watercolor",
  "màunước": "watercolor",

  // Cyberpunk
  "cyber": "cyberpunk",
  "cyberpunk": "cyberpunk",

  // Fantasy
  "fantasy": "fantasy art",

  // Tối giản
  "toigian": "minimalist",
  "tốigiản": "minimalist",
  "minimal": "minimalist",

  // 3D Render
  "3d": "3D render",
  "3drender": "3D render",

  // Phác thảo
  "phacthao": "sketch",
  "phácthảo": "sketch",
  "sketch": "sketch",

  // Điện ảnh
  "dienhanh": "cinematic",
  "điệnảnh": "cinematic",
  "cinema": "cinematic",
};

// Kích thước chính xác từ API: GET /api/sizes
const SIZE_MAP = {
  "1:1":  { width: 1024, height: 1024 },
  "16:9": { width: 1360, height: 768  },
  "9:16": { width: 768,  height: 1360 },
  "4:3":  { width: 1024, height: 768  },
  "3:4":  { width: 768,  height: 1024 },
};

module.exports = {
  config: {
    name: "flux",
    aliases: ["fluxai", "taoảnh", "taoAnh"],
    version: "2.0.0",
    hasPermssion: 0,
    credits: "MIZAI",
    description: "Tạo ảnh AI bằng Flux + Gemini từ ý tưởng của bạn",
    commandCategory: "AI",
    usages: "flux <ý tưởng> [--style <phong cách>] [--size <tỉ lệ>] [--steps <1-8>]",
    cooldowns: 15,
  },

  run: async ({ event, args, send }) => {
    if (!args.length) {
      return send(
        `🎨 FLUX AI IMAGE GENERATOR\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📌 Cách dùng:\n` +
        `  flux <ý tưởng>\n` +
        `  flux <ý tưởng> --style <phong cách>\n` +
        `  flux <ý tưởng> --size <tỉ lệ> --steps <bước>\n\n` +
        `🎭 Phong cách (--style):\n` +
        `  auto       → Tự động\n` +
        `  photo      → Ảnh thực tế\n` +
        `  digitalart → Nghệ thuật số\n` +
        `  anime      → Anime\n` +
        `  sondau     → Sơn dầu\n` +
        `  maunuoc    → Màu nước\n` +
        `  cyber      → Cyberpunk\n` +
        `  fantasy    → Fantasy\n` +
        `  toigian    → Tối giản\n` +
        `  3d         → 3D Render\n` +
        `  phacthao   → Phác thảo\n` +
        `  dienhanh   → Điện ảnh\n\n` +
        `📐 Kích thước (--size):\n` +
        `  1:1  → 1024×1024 (mặc định)\n` +
        `  16:9 → 1360×768\n` +
        `  9:16 → 768×1360\n` +
        `  4:3  → 1024×768\n` +
        `  3:4  → 768×1024\n\n` +
        `⚡ Bước (--steps): 1 (nhanh) → 8 (chất lượng), mặc định 4\n\n` +
        `💡 Ví dụ:\n` +
        `  flux một con rồng bay trên núi\n` +
        `  flux cô gái trong rừng --style anime\n` +
        `  flux thành phố tương lai --style cyber --size 16:9 --steps 6`
      );
    }

    let rawText = args.join(" ");
    let styleValue = "";
    let size = SIZE_MAP["1:1"];
    let steps = 4;

    // Parse --style
    const styleMatch = rawText.match(/--style\s+(\S+)/i);
    if (styleMatch) {
      const key = styleMatch[1].toLowerCase().replace(/\s+/g, "");
      styleValue = key in STYLE_MAP ? STYLE_MAP[key] : styleMatch[1];
      rawText = rawText.replace(styleMatch[0], "").trim();
    }

    // Parse --size
    const sizeMatch = rawText.match(/--size\s+(\S+)/i);
    if (sizeMatch) {
      const sz = sizeMatch[1];
      if (SIZE_MAP[sz]) size = SIZE_MAP[sz];
      rawText = rawText.replace(sizeMatch[0], "").trim();
    }

    // Parse --steps
    const stepsMatch = rawText.match(/--steps\s+(\d+)/i);
    if (stepsMatch) {
      steps = Math.min(8, Math.max(1, parseInt(stepsMatch[1])));
      rawText = rawText.replace(stepsMatch[0], "").trim();
    }

    const idea = rawText.trim();
    if (!idea) return send("❌ Vui lòng nhập ý tưởng sau lệnh!");

    const styleLabel = styleValue || "Tự động";
    await send(
      `🎨 Đang tạo ảnh...\n` +
      `💡 Ý tưởng: ${idea}\n` +
      `🎭 Style: ${styleLabel} | 📐 ${size.width}×${size.height} | ⚡ ${steps} bước\n` +
      `⏳ Vui lòng chờ 15-40 giây...`
    );

    const tmpPath = path.join("/tmp", `flux_${Date.now()}.png`);

    try {
      // Bước 1: Tạo prompt bằng Gemini AI
      const promptRes = await axios.post(
        `${API_BASE}/api/generate-prompt`,
        { idea, style: styleValue },
        { timeout: 30000 }
      );

      const prompt = promptRes.data?.prompt;
      if (!prompt) throw new Error("Không tạo được prompt từ Gemini");

      // Bước 2: Tạo ảnh bằng Flux AI
      const imageRes = await axios.post(
        `${API_BASE}/api/generate-image`,
        { prompt, width: size.width, height: size.height, steps },
        { timeout: 60000 }
      );

      const { image, mimeType } = imageRes.data;
      if (!image) throw new Error("Không nhận được ảnh từ server");

      const buf = Buffer.from(image, "base64");
      fs.writeFileSync(tmpPath, buf);

      await send({
        msg: `✅ Ảnh đã tạo xong!\n📝 Prompt: ${prompt.slice(0, 150)}...`,
        attachments: [tmpPath],
      });
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || "Lỗi không xác định";
      await send(`❌ Lỗi tạo ảnh: ${msg}`);
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  },
};

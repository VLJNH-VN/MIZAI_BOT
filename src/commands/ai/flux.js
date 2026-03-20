const fs = require("fs");
const path = require("path");
const axios = require("axios");

const API_URL = "http://localhost:5001";

const STYLE_MAP = {
  "thực tế": "photorealistic",
  "thucte": "photorealistic",
  "photo": "photorealistic",
  "số": "digital art",
  "digitalart": "digital art",
  "anime": "anime",
  "sơndầu": "oil painting",
  "sondau": "oil painting",
  "màunước": "watercolor",
  "maunuoc": "watercolor",
  "cyber": "cyberpunk",
  "cyberpunk": "cyberpunk",
  "fantasy": "fantasy art",
  "tốigiản": "minimalist",
  "toigian": "minimalist",
  "3d": "3D render",
  "phácthảo": "sketch",
  "phacthao": "sketch",
  "điệnảnh": "cinematic",
  "dienhanh": "cinematic",
};

module.exports = {
  config: {
    name: "flux",
    aliases: ["fluxai", "taoảnh", "taoAnh"],
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MIZAI",
    description: "Tạo ảnh AI bằng Flux + Gemini từ ý tưởng của bạn",
    commandCategory: "AI",
    usages: "flux <ý tưởng> [--style <phong cách>] [--size <1:1|16:9|9:16>] [--steps <1-8>]",
    cooldowns: 15,
  },

  run: async ({ event, args, send }) => {
    if (!args.length) {
      return send(
        `🎨 FLUX AI IMAGE GENERATOR\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Cách dùng:\n` +
        `  flux <ý tưởng>\n` +
        `  flux <ý tưởng> --style <phong cách>\n` +
        `  flux <ý tưởng> --size <tỉ lệ> --steps <bước>\n\n` +
        `🎭 Phong cách:\n` +
        `  anime, photo, cyber, fantasy\n` +
        `  3d, sondau, maunuoc, dienhanh\n` +
        `  toigian, phacthao, digitalart\n\n` +
        `📐 Kích thước:\n` +
        `  1:1 (1024×1024) — mặc định\n` +
        `  16:9 (1360×768)\n` +
        `  9:16 (768×1360)\n\n` +
        `⚡ Ví dụ:\n` +
        `  flux một con rồng bay trên núi\n` +
        `  flux cô gái trong rừng --style anime\n` +
        `  flux thành phố tương lai --style cyber --size 16:9`
      );
    }

    let rawText = args.join(" ");
    let style = "";
    let width = 1024;
    let height = 1024;
    let steps = 4;

    const styleMatch = rawText.match(/--style\s+(\S+)/i);
    if (styleMatch) {
      const key = styleMatch[1].toLowerCase().replace(/\s+/g, "");
      style = STYLE_MAP[key] || styleMatch[1];
      rawText = rawText.replace(styleMatch[0], "").trim();
    }

    const sizeMatch = rawText.match(/--size\s+(\S+)/i);
    if (sizeMatch) {
      const sz = sizeMatch[1];
      if (sz === "16:9") { width = 1360; height = 768; }
      else if (sz === "9:16") { width = 768; height = 1360; }
      else if (sz === "4:3") { width = 1024; height = 768; }
      else if (sz === "3:4") { width = 768; height = 1024; }
      rawText = rawText.replace(sizeMatch[0], "").trim();
    }

    const stepsMatch = rawText.match(/--steps\s+(\d+)/i);
    if (stepsMatch) {
      steps = Math.min(8, Math.max(1, parseInt(stepsMatch[1])));
      rawText = rawText.replace(stepsMatch[0], "").trim();
    }

    const idea = rawText.trim();
    if (!idea) return send("❌ Vui lòng nhập ý tưởng sau lệnh!");

    await send(`🎨 Đang tạo ảnh cho: "${idea}"${style ? ` [${style}]` : ""}\n⏳ Vui lòng chờ 10-30 giây...`);

    const tmpPath = path.join("/tmp", `flux_${Date.now()}.png`);

    try {
      const res = await axios.post(
        `${API_URL}/api/generate-all`,
        { idea, style, width, height, steps },
        { timeout: 60000 }
      );

      const { image, mimeType, prompt } = res.data;

      if (!image) throw new Error("Không nhận được ảnh từ server");

      const buf = Buffer.from(image, "base64");
      fs.writeFileSync(tmpPath, buf);

      await send({
        msg: `✅ Ảnh đã được tạo!\n📝 Prompt: ${prompt?.slice(0, 120)}...`,
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

"use strict";

/**
 * src/commands/hf.js
 * Tích hợp Hugging Face API — tạo ảnh, chat AI, dịch văn bản
 *
 * Cách dùng:
 *   .hf img <mô tả>           — Tạo ảnh từ văn bản
 *   .hf chat <tin nhắn>       — Chat với AI
 *   .hf dich <nội dung>       — Dịch văn bản (tự nhận ngôn ngữ)
 *   .hf dich vi-en <nội dung> — Dịch Việt → Anh
 *   .hf dich en-vi <nội dung> — Dịch Anh → Việt
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const axios = require("axios");

const HF_TOKEN = process.env.HF_TOKEN;
const HF_API   = "https://api-inference.huggingface.co/models";

const MODELS = {
  img:   "black-forest-labs/FLUX.1-schnell",
  chat:  "mistralai/Mistral-7B-Instruct-v0.3",
  vi_en: "Helsinki-NLP/opus-mt-vi-en",
  en_vi: "Helsinki-NLP/opus-mt-en-vi",
};

function hfHeaders() {
  return { Authorization: `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" };
}

async function generateImage(prompt) {
  const res = await axios.post(
    `${HF_API}/${MODELS.img}`,
    { inputs: prompt },
    { headers: hfHeaders(), responseType: "arraybuffer", timeout: 60000 }
  );
  return Buffer.from(res.data);
}

async function chatAI(message) {
  const prompt = `<s>[INST] ${message} [/INST]`;
  const res = await axios.post(
    `${HF_API}/${MODELS.chat}`,
    {
      inputs: prompt,
      parameters: { max_new_tokens: 512, temperature: 0.7, return_full_text: false }
    },
    { headers: hfHeaders(), timeout: 30000 }
  );
  const data = res.data;
  if (Array.isArray(data) && data[0]?.generated_text) return data[0].generated_text.trim();
  if (typeof data === "object" && data.generated_text) return data.generated_text.trim();
  return JSON.stringify(data);
}

async function translate(text, model) {
  const res = await axios.post(
    `${HF_API}/${model}`,
    { inputs: text },
    { headers: hfHeaders(), timeout: 30000 }
  );
  const data = res.data;
  if (Array.isArray(data) && data[0]?.translation_text) return data[0].translation_text.trim();
  return JSON.stringify(data);
}

module.exports = {
  config: {
    name:            "hf",
    version:         "1.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Tích hợp Hugging Face — tạo ảnh, chat AI, dịch văn bản",
    commandCategory: "Trí Tuệ Nhân Tạo",
    usages: [
      "hf img <mô tả>          — Tạo ảnh AI từ văn bản",
      "hf chat <tin nhắn>      — Chat với AI",
      "hf dich <nội dung>      — Dịch tự động (vi↔en)",
      "hf dich vi-en <nội dung>— Dịch Việt → Anh",
      "hf dich en-vi <nội dung>— Dịch Anh → Việt",
    ].join("\n"),
    cooldowns: 10,
  },

  run: async ({ api, event, args, send, prefix, threadID }) => {
    if (!HF_TOKEN) return send("⛔ Chưa cấu hình HF_TOKEN.");

    const sub = (args[0] || "").toLowerCase().trim();

    if (!sub) {
      return send(
        `╔══ HUGGING FACE AI ══╗\n` +
        `📤 Các lệnh:\n` +
        `  ${prefix}hf img <mô tả>\n` +
        `  ${prefix}hf chat <tin nhắn>\n` +
        `  ${prefix}hf dich <nội dung>\n` +
        `  ${prefix}hf dich vi-en <nội dung>\n` +
        `  ${prefix}hf dich en-vi <nội dung>\n` +
        `╚══════════════════════╝`
      );
    }

    // ── img ───────────────────────────────────────────────────────────────────
    if (sub === "img") {
      const prompt = args.slice(1).join(" ").trim();
      if (!prompt) return send(`❌ Thiếu mô tả ảnh.\nDùng: ${prefix}hf img <mô tả>`);

      await send(`🎨 Đang tạo ảnh: "${prompt}"...`);
      try {
        const imgBuf  = await generateImage(prompt);
        const tmpFile = path.join(os.tmpdir(), `hf_img_${Date.now()}.jpg`);
        fs.writeFileSync(tmpFile, imgBuf);
        try {
          await api.sendMessage({ msg: `🖼️ ${prompt}`, attachments: [tmpFile] }, threadID, event.type);
        } finally {
          try { fs.unlinkSync(tmpFile); } catch {}
        }
      } catch (err) {
        const msg = err?.response?.data?.toString() || err?.message || "Lỗi không xác định";
        return send(`❌ Tạo ảnh thất bại: ${msg.slice(0, 200)}`);
      }
      return;
    }

    // ── chat ──────────────────────────────────────────────────────────────────
    if (sub === "chat") {
      const message = args.slice(1).join(" ").trim();
      if (!message) return send(`❌ Thiếu tin nhắn.\nDùng: ${prefix}hf chat <tin nhắn>`);

      await send("🤖 Đang suy nghĩ...");
      try {
        const reply = await chatAI(message);
        return send(`🤖 AI:\n${reply}`);
      } catch (err) {
        const msg = err?.response?.data?.toString() || err?.message || "Lỗi không xác định";
        return send(`❌ Chat AI thất bại: ${msg.slice(0, 200)}`);
      }
    }

    // ── dich ──────────────────────────────────────────────────────────────────
    if (sub === "dich") {
      let direction = null;
      let textStart = 1;

      const second = (args[1] || "").toLowerCase();
      if (second === "vi-en") { direction = "vi_en"; textStart = 2; }
      else if (second === "en-vi") { direction = "en_vi"; textStart = 2; }

      const text = args.slice(textStart).join(" ").trim();
      if (!text) return send(`❌ Thiếu nội dung cần dịch.\nDùng: ${prefix}hf dich <nội dung>`);

      // Tự phát hiện ngôn ngữ đơn giản nếu không chỉ định
      if (!direction) {
        const hasVietnamese = /[àáâãèéêìíòóôõùúýăđơư]/i.test(text);
        direction = hasVietnamese ? "vi_en" : "en_vi";
      }

      const labelFrom = direction === "vi_en" ? "🇻🇳 Việt" : "🇬🇧 Anh";
      const labelTo   = direction === "vi_en" ? "🇬🇧 Anh"  : "🇻🇳 Việt";

      await send(`🔄 Đang dịch ${labelFrom} → ${labelTo}...`);
      try {
        const result = await translate(text, MODELS[direction]);
        return send(`🌐 ${labelFrom} → ${labelTo}:\n📝 ${text}\n✅ ${result}`);
      } catch (err) {
        const msg = err?.response?.data?.toString() || err?.message || "Lỗi không xác định";
        return send(`❌ Dịch thất bại: ${msg.slice(0, 200)}`);
      }
    }

    return send(
      `❌ Lệnh không hợp lệ: "${sub}"\n` +
      `💡 Dùng: ${prefix}hf để xem hướng dẫn.`
    );
  },
};

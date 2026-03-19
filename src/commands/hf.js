"use strict";

/**
 * src/commands/hf.js
 * Tích hợp Hugging Face API — tạo ảnh AI
 *
 * Cách dùng:
 *   .hf img <mô tả>  — Tạo ảnh từ văn bản
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const axios = require("axios");

const HF_TOKEN = process.env.HF_TOKEN;
const HF_API   = "https://api-inference.huggingface.co/models";

const MODELS = {
  img: "black-forest-labs/FLUX.1-schnell",
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

module.exports = {
  config: {
    name:            "hf",
    version:         "1.1.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Tích hợp Hugging Face — tạo ảnh AI từ văn bản",
    commandCategory: "Trí Tuệ Nhân Tạo",
    usages:          "hf img <mô tả> — Tạo ảnh AI từ văn bản",
    cooldowns:       10,
  },

  run: async ({ api, event, args, send, prefix, threadID }) => {
    if (!HF_TOKEN) return send("⛔ Chưa cấu hình HF_TOKEN.");

    const sub = (args[0] || "").toLowerCase().trim();

    if (!sub) {
      return send(
        `╔══ HUGGING FACE AI ══╗\n` +
        `📤 Các lệnh:\n` +
        `  ${prefix}hf img <mô tả>\n` +
        `╚══════════════════════╝`
      );
    }

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

    return send(
      `❌ Lệnh không hợp lệ: "${sub}"\n` +
      `💡 Dùng: ${prefix}hf để xem hướng dẫn.`
    );
  },
};

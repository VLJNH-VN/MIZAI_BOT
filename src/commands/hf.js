const fs   = require("fs");
const path = require("path");

const HF_TOKEN = global?.config?.hfToken || process.env.HF_TOKEN || "";

const TEXT_MODEL  = "mistralai/Mistral-7B-Instruct-v0.3";
const IMAGE_MODEL = "black-forest-labs/FLUX.1-schnell";

const HF_API = "https://api-inference.huggingface.co/models";

async function hfText(prompt) {
  const url = `${HF_API}/${TEXT_MODEL}/v1/chat/completions`;
  const res  = await global.axios.post(
    url,
    {
      model: TEXT_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      temperature: 0.7
    },
    {
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json"
      },
      timeout: 60000
    }
  );
  return res.data?.choices?.[0]?.message?.content?.trim() || "❌ Không có phản hồi.";
}

async function hfImage(prompt) {
  const url = `${HF_API}/${IMAGE_MODEL}`;
  const res  = await global.axios.post(
    url,
    { inputs: prompt },
    {
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json"
      },
      responseType: "arraybuffer",
      timeout: 120000
    }
  );
  return Buffer.from(res.data);
}

module.exports = {
  config: {
    name           : "hf",
    aliases        : ["huggingface", "hfai"],
    version        : "1.0",
    hasPermssion   : 0,
    credits        : "MIZAI",
    description    : "Dùng HuggingFace AI để chat hoặc tạo ảnh từ văn bản",
    commandCategory: "Utility",
    usages         : "!hf <câu hỏi> | !hf img <mô tả ảnh>",
    cooldowns      : 10
  },

  run: async ({ api, event, args, send, prefix, commandName, threadID, senderId }) => {
    if (!HF_TOKEN) {
      return send("❌ Chưa cấu hình hfToken trong config.json!");
    }

    const input = args.join(" ").trim();
    if (!input) {
      return send(
        `📌 Cách dùng:\n` +
        `• ${prefix}${commandName} <câu hỏi>       → Chat AI (Mistral-7B)\n` +
        `• ${prefix}${commandName} img <mô tả>     → Tạo ảnh (FLUX.1-schnell)\n\n` +
        `Ví dụ:\n` +
        `  ${prefix}${commandName} Giải thích lượng tử\n` +
        `  ${prefix}${commandName} img a cat sitting on the moon`
      );
    }

    const isImage = /^img\s+/i.test(input);

    if (isImage) {
      const prompt = input.replace(/^img\s+/i, "").trim();
      if (!prompt) return send("❌ Vui lòng nhập mô tả ảnh sau từ khoá img.");

      await send("🎨 Đang tạo ảnh, vui lòng chờ...");

      try {
        const imgBuffer = await hfImage(prompt);
        const tmpPath   = path.join("/tmp", `hf_img_${Date.now()}.jpg`);
        fs.writeFileSync(tmpPath, imgBuffer);

        await send({
          msg        : `🖼️ Ảnh tạo từ: "${prompt}"`,
          attachments: [fs.createReadStream(tmpPath)]
        });

        fs.unlink(tmpPath, () => {});
      } catch (err) {
        logError(`[hf] image error: ${err.message}`);
        if (err?.response?.status === 503) {
          return send("⏳ Model đang khởi động, thử lại sau 30 giây nhé!");
        }
        return send(`❌ Tạo ảnh thất bại: ${err.message}`);
      }

    } else {
      await send("🤖 Đang xử lý...");

      try {
        const reply = await hfText(input);
        await send(`🧠 HuggingFace AI:\n\n${reply}`);
      } catch (err) {
        logError(`[hf] text error: ${err.message}`);
        if (err?.response?.status === 503) {
          return send("⏳ Model đang khởi động, thử lại sau 30 giây nhé!");
        }
        if (err?.response?.status === 401) {
          return send("❌ Token HuggingFace không hợp lệ!");
        }
        return send(`❌ Lỗi: ${err.message}`);
      }
    }
  }
};

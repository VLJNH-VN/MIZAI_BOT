"use strict";

const fs   = require("fs");
const path = require("path");

const getToken = () => global?.config?.hfToken || process.env.HF_TOKEN || "";

const TEXT_MODEL  = "mistralai/Mistral-7B-Instruct-v0.3";
const IMAGE_MODEL = "stabilityai/stable-diffusion-xl-base-1.0";
const HF_API      = "https://router.huggingface.co/hf-inference/models";

async function hfText(prompt) {
  const url = `${HF_API}/${TEXT_MODEL}/v1/chat/completions`;
  const res  = await global.axios.post(
    url,
    {
      model      : TEXT_MODEL,
      messages   : [{ role: "user", content: prompt }],
      max_tokens : 1024,
      temperature: 0.7
    },
    {
      headers: {
        Authorization : `Bearer ${getToken()}`,
        "Content-Type": "application/json"
      },
      timeout: 60_000
    }
  );
  return res.data?.choices?.[0]?.message?.content?.trim() || "❌ Không có phản hồi.";
}

async function hfImage(prompt) {
  const url = `${HF_API}/${IMAGE_MODEL}`;
  const res  = await global.axios.post(
    url,
    {
      inputs    : prompt,
      parameters: { num_inference_steps: 20, guidance_scale: 7.5 }
    },
    {
      headers: {
        Authorization : `Bearer ${getToken()}`,
        "Content-Type": "application/json"
      },
      responseType: "arraybuffer",
      timeout     : 120_000
    }
  );

  if (!res.data || res.data.byteLength < 1000) {
    throw new Error("API trả về dữ liệu rỗng, thử lại sau.");
  }
  return Buffer.from(res.data);
}

module.exports = {
  config: {
    name           : "hf",
    aliases        : ["huggingface", "hfai"],
    version        : "1.1",
    hasPermssion   : 0,
    credits        : "MIZAI",
    description    : "Dùng HuggingFace AI để chat hoặc tạo ảnh từ văn bản",
    commandCategory: "Utility",
    usages         : "!hf <câu hỏi> | !hf img <mô tả ảnh>",
    cooldowns      : 10
  },

  run: async ({ api, event, args, send, prefix, commandName }) => {
    if (!getToken()) {
      return send("❌ Chưa cấu hình hfToken trong config.json!");
    }

    const input = args.join(" ").trim();
    if (!input) {
      return send(
        `📌 Cách dùng:\n` +
        `• ${prefix}${commandName} <câu hỏi>     → Chat AI (Mistral-7B)\n` +
        `• ${prefix}${commandName} img <mô tả>   → Tạo ảnh (SDXL)\n\n` +
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
        const imgBuf  = await hfImage(prompt);
        const tmpPath = path.join("/tmp", `hf_img_${Date.now()}.png`);
        fs.writeFileSync(tmpPath, imgBuf);

        await send({
          msg        : `🖼️ Ảnh tạo từ: "${prompt}"`,
          attachments: [fs.createReadStream(tmpPath)]
        });

        fs.unlink(tmpPath, () => {});
      } catch (err) {
        logError(`[hf] image error: ${err.message}`);
        const status = err?.response?.status;
        if (status === 503) return send("⏳ Model đang khởi động, thử lại sau 30 giây!");
        if (status === 401) return send("❌ Token HuggingFace không hợp lệ!");
        if (status === 429) return send("⏳ Quá nhiều yêu cầu, thử lại sau ít phút!");
        return send(`❌ Tạo ảnh thất bại: ${err.message}`);
      }

    } else {
      await send("🤖 Đang xử lý...");

      try {
        const reply = await hfText(input);
        await send(`🧠 HuggingFace AI:\n\n${reply}`);
      } catch (err) {
        logError(`[hf] text error: ${err.message}`);
        const status = err?.response?.status;
        if (status === 503) return send("⏳ Model đang khởi động, thử lại sau 30 giây!");
        if (status === 401) return send("❌ Token HuggingFace không hợp lệ!");
        if (status === 429) return send("⏳ Quá nhiều yêu cầu, thử lại sau ít phút!");
        return send(`❌ Lỗi: ${err.message}`);
      }
    }
  }
};

"use strict";

const fs   = require("fs");
const path = require("path");
const { HfInference } = require("@huggingface/inference");

const getToken = () => global?.config?.hfToken || process.env.HF_TOKEN || "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";
const getHf    = () => new HfInference(getToken());

const TEXT_MODEL = "mistralai/Mistral-7B-Instruct-v0.3";
const IMG_MODEL  = "black-forest-labs/FLUX.1-schnell";

async function hfText(prompt) {
  const hf  = getHf();
  const res = await hf.chatCompletion({
    model      : TEXT_MODEL,
    messages   : [{ role: "user", content: prompt }],
    max_tokens : 1024,
    temperature: 0.7,
  });
  return res.choices?.[0]?.message?.content?.trim() || "❌ Không có phản hồi.";
}

async function hfImage(prompt) {
  const hf = getHf();

  // ── Thử HuggingFace Inference SDK (tự đổi sang SDXL nếu model chính lỗi) ──
  const hfModels = [IMG_MODEL, "stabilityai/stable-diffusion-xl-base-1.0"].filter(
    (v, i, arr) => arr.indexOf(v) === i
  );
  for (const hfModel of hfModels) {
    try {
      const blob = await hf.textToImage({
        model     : hfModel,
        inputs    : prompt,
        parameters: { width: 1024, height: 1024, num_inference_steps: 4 },
      });
      const buf = Buffer.from(await blob.arrayBuffer());
      if (buf.byteLength > 500) return buf;
      throw new Error("Dữ liệu ảnh rỗng");
    } catch (hfErr) {
      const st     = hfErr?.status ?? hfErr?.response?.status;
      const isLast = hfModels.indexOf(hfModel) === hfModels.length - 1;
      global.logWarn?.(`[hf/img] HF ${hfModel} lỗi ${st || hfErr.message}${isLast ? ", thử Pollinations..." : ", thử model tiếp..."}`);
      if (!st || st === 429 || st === 503) break;
    }
  }

  // ── Fallback: Pollinations.ai ─────────────────────────────────────────────
  const seed    = Math.floor(Math.random() * 999999);
  const encoded = encodeURIComponent(prompt);
  const url     = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&model=flux&seed=${seed}&nologo=true&enhance=false`;

  const res = await global.axios.get(url, {
    responseType: "arraybuffer",
    timeout     : 120_000,
    headers     : { "User-Agent": global.userAgent || "Mozilla/5.0" }
  });

  const contentType = res.headers?.["content-type"] || "";
  if (!contentType.startsWith("image/")) {
    throw new Error("Cả hai API đều không trả về ảnh hợp lệ, thử lại sau.");
  }
  if (!res.data || res.data.byteLength < 500) {
    throw new Error("API trả về dữ liệu rỗng, thử lại sau.");
  }
  return Buffer.from(res.data);
}

module.exports = {
  config: {
    name           : "hf",
    aliases        : ["huggingface", "hfai"],
    version        : "1.1.0",
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

      let tmpPath = null;
      try {
        const imgBuf = await hfImage(prompt);
        tmpPath = path.join("/tmp", `hf_img_${Date.now()}.png`);
        fs.writeFileSync(tmpPath, imgBuf);

        try {
          await send({
            msg        : `🖼️ Ảnh tạo từ: "${prompt}"`,
            attachments: [tmpPath]
          });
        } finally {
          try { fs.unlinkSync(tmpPath); } catch {}
        }
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

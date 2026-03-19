"use strict";

/**
 * src/commands/hf.js
 * Tích hợp Hugging Face Inference API — tạo ảnh AI
 *
 * Cách dùng:
 *   .hf img <mô tả>                     — Tạo ảnh (model mặc định)
 *   .hf img <mô tả> | <negative>        — Tạo ảnh với negative prompt
 *   .hf img <mô tả> --model <key>       — Chọn model
 *   .hf img <mô tả> --size <WxH>        — Kích thước (vd: 1024x768)
 *   .hf img <mô tả> --steps <số>        — Số bước (vd: 20)
 *   .hf img <mô tả> --seed <số>         — Seed cố định
 *   .hf models                          — Danh sách model
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ── Endpoint ──────────────────────────────────────────────────────────────────
// api-inference.huggingface.co đã ngừng hỗ trợ — chỉ dùng router mới
const HF_ROUTER  = "https://router.huggingface.co/hf-inference/models";

// ── Danh sách model (chỉ models được hf-inference hỗ trợ) ────────────────────
const MODELS = {
  schnell: { id: "black-forest-labs/FLUX.1-schnell",                label: "FLUX.1 Schnell (nhanh, mặc định)" },
  sdxl:    { id: "stabilityai/stable-diffusion-xl-base-1.0",        label: "Stable Diffusion XL"              },
  sd3:     { id: "stabilityai/stable-diffusion-3-medium-diffusers", label: "Stable Diffusion 3 Medium"        },
};

const DEFAULT_MODEL = "schnell";

// ── Token ─────────────────────────────────────────────────────────────────────
function getToken() {
  return process.env.HF_TOKEN || global.config?.hfToken || "";
}

function hfHeaders() {
  return {
    Authorization : `Bearer ${getToken()}`,
    "Content-Type": "application/json",
    "Accept"      : "image/jpeg",
  };
}

// ── Parse args ────────────────────────────────────────────────────────────────
function parseArgs(args) {
  const raw = args.join(" ").trim();

  let modelKey  = DEFAULT_MODEL;
  let width     = null;
  let height    = null;
  let steps     = null;
  let seed      = null;

  // Xoá các flag khỏi chuỗi
  let cleaned = raw
    .replace(/--model\s+(\S+)/i, (_, v) => { modelKey = v.toLowerCase(); return ""; })
    .replace(/--size\s+(\d+)[xX×](\d+)/i, (_, w, h) => { width = parseInt(w); height = parseInt(h); return ""; })
    .replace(/--steps\s+(\d+)/i, (_, v) => { steps = parseInt(v); return ""; })
    .replace(/--seed\s+(\d+)/i, (_, v) => { seed = parseInt(v); return ""; })
    .trim();

  // Tách prompt | negative_prompt bằng ký tự pipe
  const pipeIdx = cleaned.indexOf("|");
  let prompt         = pipeIdx > -1 ? cleaned.slice(0, pipeIdx).trim() : cleaned;
  let negativePrompt = pipeIdx > -1 ? cleaned.slice(pipeIdx + 1).trim() : null;

  return { prompt, negativePrompt, modelKey, width, height, steps, seed };
}

// ── Generate image ────────────────────────────────────────────────────────────
async function generateImage({ modelId, prompt, negativePrompt, width, height, steps, seed }) {
  const body = { inputs: prompt, parameters: {} };
  if (negativePrompt) body.parameters.negative_prompt   = negativePrompt;
  if (width)          body.parameters.width              = width;
  if (height)         body.parameters.height             = height;
  if (steps)          body.parameters.num_inference_steps = steps;
  if (seed != null)   body.parameters.seed               = seed;

  const url = `${HF_ROUTER}/${modelId}`;
  try {
    const res = await global.axios.post(url, body, {
      headers     : hfHeaders(),
      responseType: "arraybuffer",
      timeout     : 120000,
    });
    return Buffer.from(res.data);
  } catch (err) {
    const status  = err?.response?.status;
    const errData = err?.response?.data ? Buffer.from(err.response.data).toString().slice(0, 300) : "";

    // Model đang tải
    if (status === 503) {
      const est = errData.match(/estimated_time[":]+\s*([\d.]+)/)?.[1];
      const wait = est ? `(≈${Math.ceil(parseFloat(est))}s)` : "";
      throw new Error(`MODEL_LOADING ${wait}`);
    }

    throw err;
  }
}

// ── Module export ─────────────────────────────────────────────────────────────
module.exports = {
  config: {
    name           : "hf",
    aliases        : ["huggingface"],
    version        : "2.0.0",
    hasPermssion   : 0,
    credits        : "MiZai",
    description    : "Tích hợp Hugging Face — tạo ảnh AI từ văn bản",
    commandCategory: "Trí Tuệ Nhân Tạo",
    usages         : [
      "hf img <mô tả>",
      "hf img <mô tả> | <negative_prompt>",
      "hf img <mô tả> --model <key> --size 1024x768 --steps 20 --seed 42",
      "hf models",
    ].join("\n"),
    cooldowns: 15,
  },

  run: async ({ api, event, args, send, prefix, threadID }) => {
    if (!getToken()) {
      return send(
        "⛔ Chưa cấu hình HF Token.\n" +
        "Thêm `hfToken` vào config.json hoặc set biến môi trường `HF_TOKEN`."
      );
    }

    const sub = (args[0] || "").toLowerCase().trim();

    // ── Help ──────────────────────────────────────────────────────────────────
    if (!sub) {
      const modelList = Object.entries(MODELS)
        .map(([k, m]) => `  • ${k.padEnd(10)} — ${m.label}`)
        .join("\n");
      const modelKeys = Object.keys(MODELS).join(" | ");
      return send(
        `╔══ HUGGING FACE AI ══╗\n` +
        `📤 Lệnh:\n` +
        `  ${prefix}hf img <mô tả>\n` +
        `  ${prefix}hf img <mô tả> | <negative>\n` +
        `  ${prefix}hf img <mô tả> --model <key>\n` +
        `  ${prefix}hf models\n` +
        `\n🎛️ Tùy chọn:\n` +
        `  --model <key>     ${modelKeys}\n` +
        `  --size WxH        Kích thước ảnh (vd: 1024x768)\n` +
        `  --steps <n>       Số bước (vd: 20)\n` +
        `  --seed <n>        Seed cố định\n` +
        `  | <negative>      Negative prompt (sau dấu |)\n` +
        `╚══════════════════════╝`
      );
    }

    // ── Danh sách model ───────────────────────────────────────────────────────
    if (sub === "models") {
      const list = Object.entries(MODELS)
        .map(([k, m]) => `  ${k.padEnd(10)} — ${m.label}\n             ${m.id}`)
        .join("\n");
      return send(`🤖 Danh sách model:\n${list}\n\n⭐ Mặc định: ${DEFAULT_MODEL}`);
    }

    // ── Tạo ảnh ───────────────────────────────────────────────────────────────
    if (sub === "img") {
      const { prompt, negativePrompt, modelKey, width, height, steps, seed } =
        parseArgs(args.slice(1));

      if (!prompt) {
        return send(`❌ Thiếu mô tả ảnh.\nDùng: ${prefix}hf img <mô tả>`);
      }

      const model = MODELS[modelKey] || MODELS[DEFAULT_MODEL];
      const usedKey = MODELS[modelKey] ? modelKey : DEFAULT_MODEL;

      let statusMsg =
        `🎨 Đang tạo ảnh...\n` +
        `📝 Prompt: "${prompt}"\n` +
        `🤖 Model: ${model.label}`;
      if (negativePrompt) statusMsg += `\n🚫 Negative: "${negativePrompt}"`;
      if (width && height) statusMsg += `\n📐 Size: ${width}×${height}`;
      if (steps)           statusMsg += ` | Steps: ${steps}`;
      if (seed != null)    statusMsg += ` | Seed: ${seed}`;

      await send(statusMsg);

      try {
        const imgBuf  = await generateImage({
          modelId: model.id,
          prompt,
          negativePrompt,
          width,
          height,
          steps,
          seed,
        });

        const ext     = "jpg";
        const tmpFile = path.join(os.tmpdir(), `hf_img_${Date.now()}.${ext}`);
        fs.writeFileSync(tmpFile, imgBuf);

        try {
          await api.sendMessage(
            { msg: `🖼️ ${prompt}`, attachments: [tmpFile] },
            threadID,
            event.type
          );
        } finally {
          try { fs.unlinkSync(tmpFile); } catch {}
        }

      } catch (err) {
        const msg = err?.message || "";

        if (msg.startsWith("MODEL_LOADING")) {
          const wait = msg.replace("MODEL_LOADING", "").trim();
          return send(
            `⏳ Model đang khởi động ${wait}, thử lại sau ít phút.\n` +
            `💡 Tip: Dùng model nhanh hơn với --model schnell hoặc --model lightning`
          );
        }

        const raw = err?.response?.data
          ? Buffer.from(err.response.data).toString().slice(0, 300)
          : err?.message || "Lỗi không xác định";

        logError(`[hf] Tạo ảnh lỗi: ${raw}`);
        return send(
          `❌ Tạo ảnh thất bại!\n` +
          `📋 Lỗi: ${raw.slice(0, 200)}\n` +
          `💡 Thử model khác: ${prefix}hf img ${prompt} --model sdxl`
        );
      }
      return;
    }

    // ── Lệnh không hợp lệ ─────────────────────────────────────────────────────
    return send(
      `❌ Lệnh không hợp lệ: "${sub}"\n` +
      `💡 Gõ ${prefix}hf để xem hướng dẫn.`
    );
  },
};

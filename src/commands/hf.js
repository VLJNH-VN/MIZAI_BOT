"use strict";

/**
 * src/commands/hf.js
 * Tạo ảnh AI — Pollinations.ai (miễn phí, không cần token)
 *
 * Cách dùng:
 *   .hf img <mô tả>                    — Tạo ảnh (model mặc định)
 *   .hf img <mô tả> --model <key>      — Chọn model
 *   .hf img <mô tả> --size <WxH>       — Kích thước (vd: 1024x768)
 *   .hf img <mô tả> --seed <số>        — Seed cố định
 *   .hf models                         — Danh sách model
 */

const fs    = require("fs");
const path  = require("path");
const os    = require("os");
const axios = require("axios");

// ── Endpoint ──────────────────────────────────────────────────────────────────
const POLL_BASE = "https://image.pollinations.ai/prompt";

// ── Danh sách model ───────────────────────────────────────────────────────────
const MODELS = {
  sana:          { label: "Sana (mặc định, nhanh)"       },
  flux:          { label: "FLUX"                          },
  "flux-realism":{ label: "FLUX Realism (ảnh thực)"      },
  "flux-anime":  { label: "FLUX Anime"                    },
  "flux-3d":     { label: "FLUX 3D"                       },
  "flux-pro":    { label: "FLUX Pro (chất lượng cao)"     },
  turbo:         { label: "Turbo (rất nhanh)"             },
  "any-dark":    { label: "Any Dark (tối, nghệ thuật)"   },
};

const DEFAULT_MODEL = "sana";

// ── Parse args ────────────────────────────────────────────────────────────────
function parseArgs(args) {
  const raw = args.join(" ").trim();

  let modelKey = DEFAULT_MODEL;
  let width    = null;
  let height   = null;
  let seed     = null;

  let cleaned = raw
    .replace(/--model\s+(\S+)/i,           (_, v) => { modelKey = v.toLowerCase(); return ""; })
    .replace(/--size\s+(\d+)[xX×](\d+)/i, (_, w, h) => { width = parseInt(w); height = parseInt(h); return ""; })
    .replace(/--seed\s+(\d+)/i,            (_, v) => { seed = parseInt(v); return ""; })
    .trim();

  return { prompt: cleaned, modelKey, width, height, seed };
}

// ── Generate image ────────────────────────────────────────────────────────────
async function generateImage({ prompt, modelKey, width, height, seed }) {
  const params = new URLSearchParams({
    model:  modelKey,
    nologo: "true",
    nofeed: "true",
  });
  if (width)     params.set("width",  width);
  if (height)    params.set("height", height);
  if (seed != null) params.set("seed", seed);

  const url = `${POLL_BASE}/${encodeURIComponent(prompt)}?${params.toString()}`;

  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout:      60000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  return Buffer.from(res.data);
}

// ── Module export ─────────────────────────────────────────────────────────────
module.exports = {
  config: {
    name           : "hf",
    aliases        : ["img", "imagine"],
    version        : "3.0.0",
    hasPermssion   : 0,
    credits        : "MiZai",
    description    : "Tạo ảnh AI từ văn bản — Pollinations.ai",
    commandCategory: "Trí Tuệ Nhân Tạo",
    usages         : [
      "hf img <mô tả>",
      "hf img <mô tả> --model flux-anime",
      "hf img <mô tả> --size 1024x768 --seed 42",
      "hf models",
    ].join("\n"),
    cooldowns: 10,
  },

  run: async ({ api, event, args, send, prefix, threadID }) => {
    const sub = (args[0] || "").toLowerCase().trim();

    // ── Help ──────────────────────────────────────────────────────────────────
    if (!sub) {
      const modelKeys = Object.keys(MODELS).join(" | ");
      return send(
        `╔══ AI IMAGE GEN ══╗\n` +
        `📤 Lệnh:\n` +
        `  ${prefix}hf img <mô tả>\n` +
        `  ${prefix}hf img <mô tả> --model <key>\n` +
        `  ${prefix}hf models\n` +
        `\n🎛️ Tùy chọn:\n` +
        `  --model <key>     ${modelKeys}\n` +
        `  --size WxH        Kích thước (vd: 1024x768)\n` +
        `  --seed <n>        Seed cố định\n` +
        `╚═══════════════════╝`
      );
    }

    // ── Danh sách model ───────────────────────────────────────────────────────
    if (sub === "models") {
      const list = Object.entries(MODELS)
        .map(([k, m]) => `  • ${k.padEnd(14)} ${m.label}`)
        .join("\n");
      return send(`🤖 Danh sách model:\n${list}\n\n⭐ Mặc định: ${DEFAULT_MODEL}`);
    }

    // ── Tạo ảnh ───────────────────────────────────────────────────────────────
    if (sub === "img") {
      const { prompt, modelKey, width, height, seed } = parseArgs(args.slice(1));

      if (!prompt) {
        return send(`❌ Thiếu mô tả ảnh.\nDùng: ${prefix}hf img <mô tả>`);
      }

      const model    = MODELS[modelKey] || MODELS[DEFAULT_MODEL];
      const usedKey  = MODELS[modelKey] ? modelKey : DEFAULT_MODEL;

      let statusMsg =
        `🎨 Đang tạo ảnh...\n` +
        `📝 Prompt: "${prompt}"\n` +
        `🤖 Model: ${model.label}`;
      if (width && height) statusMsg += `\n📐 Size: ${width}×${height}`;
      if (seed != null)    statusMsg += ` | Seed: ${seed}`;

      await send(statusMsg);

      const tmpFile = path.join(os.tmpdir(), `poll_img_${Date.now()}.jpg`);
      try {
        const imgBuf = await generateImage({ prompt, modelKey: usedKey, width, height, seed });
        fs.writeFileSync(tmpFile, imgBuf);
        await api.sendMessage(
          { msg: `🖼️ ${prompt}`, attachments: [tmpFile] },
          threadID,
          event.type
        );
      } catch (err) {
        const raw = err?.message || "Lỗi không xác định";
        console.error(`[hf] Tạo ảnh lỗi: ${raw}`);
        return send(
          `❌ Tạo ảnh thất bại!\n` +
          `📋 Lỗi: ${raw.slice(0, 200)}\n` +
          `💡 Thử model khác: ${prefix}hf img ${prompt} --model flux`
        );
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
      return;
    }

    // ── Lệnh không hợp lệ ─────────────────────────────────────────────────────
    return send(`❌ Lệnh không hợp lệ: "${sub}"\n💡 Gõ ${prefix}hf để xem hướng dẫn.`);
  },
};

"use strict";

/**
 * src/commands/hf.js
 * Tạo ảnh AI — Pollinations.ai (miễn phí, không cần token)
 */

const fs    = require("fs");
const path  = require("path");
const os    = require("os");
const axios = require("axios");

const POLL_BASE = "https://image.pollinations.ai/prompt";

const MODELS = {
  flux:          { label: "FLUX (mặc định)"              },
  "flux-realism":{ label: "FLUX Realism (ảnh thực)"      },
  "flux-anime":  { label: "FLUX Anime"                    },
  "flux-3d":     { label: "FLUX 3D"                       },
  "flux-pro":    { label: "FLUX Pro (chất lượng cao)"     },
  turbo:         { label: "Turbo (rất nhanh)"             },
  sana:          { label: "Sana"                          },
  "any-dark":    { label: "Any Dark (tối, nghệ thuật)"   },
};

const DEFAULT_MODEL   = "flux";
const FALLBACK_MODELS = ["turbo", "flux-realism"];

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

async function generateImage({ prompt, modelKey, width, height, seed }) {
  const params = new URLSearchParams({
    model:  modelKey,
    width:  width  || 1024,
    height: height || 1024,
    nologo: "true",
    nofeed: "true",
  });
  if (seed != null) params.set("seed", seed);

  const url = `${POLL_BASE}/${encodeURIComponent(prompt)}?${params.toString()}`;
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout:      90000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  return Buffer.from(res.data);
}

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

    if (sub === "models") {
      const list = Object.entries(MODELS)
        .map(([k, m]) => `  • ${k.padEnd(14)} ${m.label}`)
        .join("\n");
      return send(`🤖 Danh sách model:\n${list}\n\n⭐ Mặc định: ${DEFAULT_MODEL}`);
    }

    if (sub === "img") {
      const { prompt, modelKey, width, height, seed } = parseArgs(args.slice(1));

      if (!prompt) return send(`❌ Thiếu mô tả ảnh.\nDùng: ${prefix}hf img <mô tả>`);

      const usedKey = MODELS[modelKey] ? modelKey : DEFAULT_MODEL;
      const label   = MODELS[usedKey].label;

      let statusMsg = `🎨 Đang tạo ảnh...\n📝 Prompt: "${prompt}"\n🤖 Model: ${label}`;
      if (width && height) statusMsg += `\n📐 Size: ${width}×${height}`;
      if (seed != null)    statusMsg += ` | Seed: ${seed}`;
      await send(statusMsg);

      const tmpFile   = path.join(os.tmpdir(), `poll_img_${Date.now()}.jpg`);
      const tryModels = [usedKey, ...FALLBACK_MODELS.filter(m => m !== usedKey)];
      let   lastErr   = null;

      for (const m of tryModels) {
        try {
          const imgBuf = await generateImage({ prompt, modelKey: m, width, height, seed });
          fs.writeFileSync(tmpFile, imgBuf);
          try {
            await api.sendMessage({ msg: `🖼️ ${prompt}`, attachments: [tmpFile] }, threadID, event.type);
          } finally {
            try { fs.unlinkSync(tmpFile); } catch {}
          }
          return;
        } catch (err) {
          lastErr = err;
          console.error(`[hf] model=${m} lỗi: ${err?.message}`);
        }
      }

      const errMsg = lastErr?.message || "Lỗi không xác định";
      return send(
        `❌ Tạo ảnh thất bại!\n📋 Lỗi: ${errMsg.slice(0, 150)}\n` +
        `💡 Thử: ${prefix}hf img ${prompt} --model turbo`
      );
    }

    return send(`❌ Lệnh không hợp lệ: "${sub}"\n💡 Gõ ${prefix}hf để xem hướng dẫn.`);
  },
};

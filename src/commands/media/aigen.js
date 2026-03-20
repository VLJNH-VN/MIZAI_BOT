"use strict";

const fs    = require("fs");
const path  = require("path");
const axios = require("axios");
const fetch = require("node-fetch").default || require("node-fetch");

// ── Helpers lấy token từ config ───────────────────────────────────────────────
const cfg          = () => global?.config || {};
const getFalKey    = () => cfg().falKey        || process.env.FAL_KEY         || "";
const getRepToken  = () => cfg().replicateToken|| process.env.REPLICATE_API_TOKEN || "";
const getOpenaiKey = () => cfg().openaiKey     || process.env.OPENAI_API_KEY  || "";
const getStabKey   = () => cfg().stabilityKey  || process.env.STABILITY_API_KEY  || "";

const TMP = (ext = "jpg") => path.join("/tmp", `aigen_${Date.now()}.${ext}`);

// ── Tải ảnh từ URL về Buffer ──────────────────────────────────────────────────
async function urlToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tải ảnh thất bại: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ════════════════════════════════════════════════════════════════════════════════
//  1. fal.ai — @fal-ai/serverless-client
// ════════════════════════════════════════════════════════════════════════════════
async function genFal(prompt) {
  const key = getFalKey();
  if (!key) throw new Error("Chưa cấu hình falKey");

  const fal = require("@fal-ai/serverless-client");
  fal.config({ credentials: key });

  const result = await fal.subscribe("fal-ai/flux/schnell", {
    input: {
      prompt,
      image_size        : "landscape_4_3",
      num_inference_steps: 4,
      num_images        : 1,
    },
  });

  const imgUrl = result?.images?.[0]?.url;
  if (!imgUrl) throw new Error("fal.ai không trả về URL ảnh");
  return await urlToBuffer(imgUrl);
}

// ════════════════════════════════════════════════════════════════════════════════
//  2. Replicate — replicate
// ════════════════════════════════════════════════════════════════════════════════
async function genReplicate(prompt) {
  const token = getRepToken();
  if (!token) throw new Error("Chưa cấu hình replicateToken");

  const Replicate = require("replicate");
  const client    = new Replicate({ auth: token });

  const output = await client.run("black-forest-labs/flux-schnell", {
    input: {
      prompt,
      go_fast      : true,
      num_outputs  : 1,
      output_format: "jpg",
      aspect_ratio : "4:3",
    },
  });

  const raw = Array.isArray(output) ? output[0] : output;
  if (!raw) throw new Error("Replicate không trả về kết quả");

  if (typeof raw === "string" && raw.startsWith("http")) {
    return await urlToBuffer(raw);
  }
  if (raw && typeof raw.arrayBuffer === "function") {
    return Buffer.from(await raw.arrayBuffer());
  }
  throw new Error("Replicate trả về định dạng không hỗ trợ");
}

// ════════════════════════════════════════════════════════════════════════════════
//  3. OpenAI DALL-E 3 — openai
// ════════════════════════════════════════════════════════════════════════════════
async function genDalle(prompt) {
  const key = getOpenaiKey();
  if (!key) throw new Error("Chưa cấu hình openaiKey");

  const OpenAI = require("openai");
  const client = new OpenAI({ apiKey: key });

  const res = await client.images.generate({
    model          : "dall-e-3",
    prompt,
    n              : 1,
    size           : "1024x1024",
    response_format: "b64_json",
  });

  const b64 = res?.data?.[0]?.b64_json;
  if (!b64) throw new Error("DALL-E không trả về ảnh");
  return Buffer.from(b64, "base64");
}

// ════════════════════════════════════════════════════════════════════════════════
//  4. Stability AI — stability-ai + axios
// ════════════════════════════════════════════════════════════════════════════════
async function genStability(prompt) {
  const key = getStabKey();
  if (!key) throw new Error("Chưa cấu hình stabilityKey");

  const StabilityAI = (require("stability-ai").default || require("stability-ai"));
  const stability   = new StabilityAI(key);

  const res = await stability.v2beta.stableImageGenerate({
    prompt,
    output_format: "jpeg",
    aspect_ratio : "4:3",
  });

  if (res?.image) return Buffer.from(res.image, "base64");

  if (res?.artifacts?.[0]?.base64) {
    return Buffer.from(res.artifacts[0].base64, "base64");
  }

  const imgUrl = res?.url || res?.images?.[0]?.url;
  if (imgUrl) return await urlToBuffer(imgUrl);

  throw new Error("Stability AI không trả về ảnh");
}

// ════════════════════════════════════════════════════════════════════════════════
//  5. Pollinations.ai — axios (luôn miễn phí, không cần key)
// ════════════════════════════════════════════════════════════════════════════════
async function genPollinations(prompt) {
  const seed    = Math.floor(Math.random() * 999999);
  const encoded = encodeURIComponent(prompt);
  const url     = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=768&model=flux&seed=${seed}&nologo=true`;

  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout     : 60_000,
    headers     : { "User-Agent": global.userAgent || "Mozilla/5.0" },
  });

  const ct = res.headers?.["content-type"] || "";
  if (!ct.startsWith("image/") || !res.data || res.data.byteLength < 500) {
    throw new Error("Pollinations không trả về ảnh hợp lệ");
  }
  return Buffer.from(res.data);
}

// ════════════════════════════════════════════════════════════════════════════════
//  Auto — thử lần lượt theo provider có key
// ════════════════════════════════════════════════════════════════════════════════
async function genAuto(prompt) {
  const providers = [
    { name: "fal.ai",        fn: genFal,         hasKey: !!getFalKey()    },
    { name: "Replicate",     fn: genReplicate,   hasKey: !!getRepToken()  },
    { name: "DALL-E 3",      fn: genDalle,       hasKey: !!getOpenaiKey() },
    { name: "Stability AI",  fn: genStability,   hasKey: !!getStabKey()   },
    { name: "Pollinations",  fn: genPollinations,hasKey: true             },
  ];

  const queue = providers.filter(p => p.hasKey);
  for (const p of queue) {
    try {
      const buf = await p.fn(prompt);
      global.logInfo?.(`[aigen/auto] Thành công với ${p.name}`);
      return { buf, provider: p.name };
    } catch (err) {
      global.logWarn?.(`[aigen/auto] ${p.name} thất bại: ${err.message}`);
    }
  }
  throw new Error("Tất cả provider đều thất bại, thử lại sau!");
}

// ════════════════════════════════════════════════════════════════════════════════
//  Command
// ════════════════════════════════════════════════════════════════════════════════
const PROVIDER_MAP = {
  fal        : { label: "fal.ai",       fn: genFal,          key: getFalKey    },
  replicate  : { label: "Replicate",    fn: genReplicate,    key: getRepToken  },
  dalle      : { label: "DALL-E 3",     fn: genDalle,        key: getOpenaiKey },
  openai     : { label: "DALL-E 3",     fn: genDalle,        key: getOpenaiKey },
  sd         : { label: "Stability AI", fn: genStability,    key: getStabKey   },
  stability  : { label: "Stability AI", fn: genStability,    key: getStabKey   },
  pollinations: { label: "Pollinations", fn: genPollinations, key: () => "ok"  },
  poll       : { label: "Pollinations", fn: genPollinations,  key: () => "ok"  },
};

module.exports = {
  config: {
    name           : "aigen",
    aliases        : ["gen", "aiimg", "draw"],
    version        : "1.0",
    hasPermssion   : 0,
    credits        : "MIZAI",
    description    : "Tạo ảnh AI từ nhiều provider: fal.ai, Replicate, DALL-E 3, Stability AI, Pollinations",
    commandCategory: "Media",
    usages         : "!gen [fal|replicate|dalle|sd|poll|auto] <mô tả ảnh>",
    cooldowns      : 15,
  },

  run: async ({ api, event, args, send, prefix, commandName }) => {
    const input = args.join(" ").trim();

    if (!input) {
      const providers = [
        `• fal        → fal.ai FLUX/Schnell ${getFalKey()    ? "✅" : "❌ (chưa có key)"}`,
        `• replicate  → Replicate Flux      ${getRepToken()  ? "✅" : "❌ (chưa có key)"}`,
        `• dalle      → OpenAI DALL-E 3     ${getOpenaiKey() ? "✅" : "❌ (chưa có key)"}`,
        `• sd         → Stability AI        ${getStabKey()   ? "✅" : "❌ (chưa có key)"}`,
        `• poll       → Pollinations ✅ (miễn phí)`,
        `• auto       → Tự chọn provider tốt nhất`,
      ].join("\n");

      return send(
        `🎨 Tạo ảnh AI — Cách dùng:\n\n` +
        `${prefix}${commandName} <mô tả>           → auto\n` +
        `${prefix}${commandName} <provider> <mô tả>\n\n` +
        `Provider:\n${providers}\n\n` +
        `Ví dụ:\n` +
        `  ${prefix}${commandName} a dragon flying over the mountains\n` +
        `  ${prefix}${commandName} fal cute anime girl with sword`
      );
    }

    // Tách provider và prompt
    const firstWord   = args[0].toLowerCase();
    const isProvider  = firstWord in PROVIDER_MAP || firstWord === "auto";
    const providerKey = isProvider ? firstWord : "auto";
    const prompt      = isProvider ? args.slice(1).join(" ").trim() : input;

    if (!prompt) {
      return send(`❌ Vui lòng nhập mô tả ảnh!\nVí dụ: ${prefix}${commandName} ${providerKey} a cute cat`);
    }

    let buf, providerLabel;

    if (providerKey === "auto") {
      await send("🎨 Đang tạo ảnh (auto)...");
      try {
        const result = await genAuto(prompt);
        buf           = result.buf;
        providerLabel = result.provider;
      } catch (err) {
        return send(`❌ ${err.message}`);
      }
    } else {
      const p = PROVIDER_MAP[providerKey];
      if (!p.key()) {
        return send(
          `❌ Provider "${p.label}" chưa có API key!\n` +
          `Thêm key vào config.json hoặc dùng: ${prefix}${commandName} auto <mô tả>`
        );
      }
      await send(`🎨 Đang tạo ảnh với ${p.label}...`);
      try {
        buf           = await p.fn(prompt);
        providerLabel = p.label;
      } catch (err) {
        global.logError?.(`[aigen] ${p.label} error: ${err.message}`);
        return send(`❌ ${p.label} thất bại: ${err.message}`);
      }
    }

    const tmpFile = TMP("jpg");
    try {
      fs.writeFileSync(tmpFile, buf);
      await api.sendMessage(
        { msg: `🖼️ ${prompt}\n✨ Provider: ${providerLabel}`, attachments: [tmpFile] },
        event.threadId,
        event.type
      );
    } finally {
      setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch {} }, 60_000);
    }
  },
};

"use strict";

const fs   = require("fs");
const path = require("path");

const HF_TOKEN  = () => global?.config?.hfToken || process.env.HF_TOKEN || "";
const SR_MODEL  = "caidas/swin2SR-realworld-sr-x4-64-bsrgan-psnr";
const HF_API    = "https://api-inference.huggingface.co/models";

async function fetchImageBuffer(url) {
  const res = await global.axios.get(url, {
    responseType    : "arraybuffer",
    timeout         : 60_000,
    maxContentLength: 20 * 1024 * 1024,
    headers         : { "User-Agent": global.userAgent || "Mozilla/5.0" }
  });
  return Buffer.from(res.data);
}

async function sharpSharpen(inputBuf, level = "normal") {
  const sharp = require("sharp");

  const presets = {
    nhe  : { sigma: 0.6, flat: 0.5, jagged: 0.5 },
    normal: { sigma: 1.0, flat: 1.0, jagged: 1.5 },
    manh : { sigma: 1.5, flat: 2.0, jagged: 3.0 }
  };
  const p = presets[level] || presets.normal;

  return sharp(inputBuf)
    .sharpen({ sigma: p.sigma, m1: p.flat, m2: p.jagged })
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function hfUpscale(inputBuf) {
  const url = `${HF_API}/${SR_MODEL}`;

  const res = await global.axios.post(
    url,
    inputBuf,
    {
      headers: {
        Authorization : `Bearer ${HF_TOKEN()}`,
        "Content-Type": "image/jpeg"
      },
      responseType  : "arraybuffer",
      timeout       : 120_000,
      validateStatus: (s) => s < 500
    }
  );

  if (res.status !== 200) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const txt = Buffer.from(res.data).toString("utf8");
      const obj = JSON.parse(txt);
      errMsg = obj?.error || obj?.message || txt.slice(0, 120);
    } catch (_) {}
    throw new Error(errMsg);
  }

  if (!res.data || res.data.byteLength < 500) {
    throw new Error("API trả về dữ liệu rỗng.");
  }
  return Buffer.from(res.data);
}

async function getImageFromEvent(event, api) {
  const raw    = event?.data || {};
  const quoted = await global.resolveQuote({ raw, api, threadId: event.threadId, event });
  if (quoted?.isMedia && quoted?.mediaUrl) {
    return { url: quoted.mediaUrl, ext: quoted.ext || ".jpg" };
  }
  const attachs = raw?.attachments || [];
  for (const a of attachs) {
    const url = a?.url || a?.href || a?.fileUrl || a?.src;
    if (url && /\.(jpg|jpeg|png|webp|gif)/i.test(url.split("?")[0])) {
      return { url, ext: path.extname(url.split("?")[0]) || ".jpg" };
    }
  }
  return null;
}

module.exports = {
  config: {
    name           : "4k",
    aliases        : ["sharpen", "enhance", "upscale", "nm"],
    version        : "1.0",
    hasPermssion   : 0,
    credits        : "MIZAI",
    description    : "Làm nét ảnh bằng Sharp hoặc AI super-resolution (HuggingFace)",
    commandCategory: "Utility",
    usages         : "!lamet [nhe|normal|manh|ai] — reply vào ảnh",
    cooldowns      : 8
  },

  run: async ({ api, event, args, send, prefix, commandName }) => {
    const mode = (args[0] || "normal").toLowerCase();

    const validModes = ["nhe", "normal", "manh", "ai"];
    if (!validModes.includes(mode)) {
      return send(
        `🖼️ LÀM NÉT ẢNH\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Cách dùng: Reply vào ảnh rồi gõ:\n` +
        `  ${prefix}${commandName} nhe     → Làm nét nhẹ\n` +
        `  ${prefix}${commandName} normal  → Làm nét vừa (mặc định)\n` +
        `  ${prefix}${commandName} manh    → Làm nét mạnh\n` +
        `  ${prefix}${commandName} ai      → AI upscale 4x (HuggingFace)\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Lưu ý: Chế độ ai cần vài giây xử lý.`
      );
    }

    const imgInfo = await getImageFromEvent(event, api);
    if (!imgInfo) {
      return send(
        `❌ Không tìm thấy ảnh!\n` +
        `Vui lòng reply vào một ảnh rồi gõ lệnh.`
      );
    }

    const modeLabel = {
      nhe   : "Làm nét nhẹ",
      normal: "Làm nét vừa",
      manh  : "Làm nét mạnh",
      ai    : "AI Super-Resolution 4x"
    }[mode];

    await send(`🔧 Đang xử lý: ${modeLabel}...`);

    let inputBuf;
    try {
      inputBuf = await fetchImageBuffer(imgInfo.url);
    } catch (err) {
      logError(`[lamet] fetch ảnh: ${err.message}`);
      return send("❌ Không tải được ảnh. Thử lại hoặc dùng URL ảnh trực tiếp.");
    }

    let outputBuf;
    const tmpOut = path.join("/tmp", `lamet_${Date.now()}.jpg`);

    try {
      if (mode === "ai") {
        if (!HF_TOKEN()) {
          return send("❌ Chưa cấu hình hfToken trong config.json!");
        }
        outputBuf = await hfUpscale(inputBuf);
      } else {
        outputBuf = await sharpSharpen(inputBuf, mode);
      }
    } catch (err) {
      logError(`[lamet] xử lý ảnh: ${err.message}`);
      if (err?.response?.status === 503 || err.message?.includes("503")) {
        return send("⏳ Model AI đang khởi động, thử lại sau 30 giây!");
      }
      if (err?.response?.status === 413 || err.message?.includes("413")) {
        return send("❌ Ảnh quá lớn cho AI upscale! Dùng chế độ normal/manh thay thế.");
      }
      if (err.message?.includes("404") || err.message?.includes("HTTP 404")) {
        return send("❌ Model AI upscale hiện không khả dụng. Dùng chế độ nhe/normal/manh thay thế.");
      }
      return send(`❌ Lỗi xử lý ảnh: ${err.message}`);
    }

    if (!outputBuf) {
      return send("❌ Xử lý ảnh thất bại, không có dữ liệu đầu ra.");
    }

    try {
      fs.writeFileSync(tmpOut, outputBuf);

      const sizeBefore = (inputBuf.length  / 1024).toFixed(0);
      const sizeAfter  = (outputBuf.length / 1024).toFixed(0);

      await send({
        msg        : `✅ ${modeLabel} hoàn tất!\n📏 ${sizeBefore} KB → ${sizeAfter} KB`,
        attachments: [tmpOut]
      });
    } catch (err) {
      logError(`[lamet] gửi ảnh: ${err.message}`);
      return send("❌ Xử lý xong nhưng gửi ảnh thất bại.");
    } finally {
      try { fs.unlinkSync(tmpOut); } catch {}
    }
  }
};

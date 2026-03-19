"use strict";

/**
 * utils/media/uploadImg.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Upload ảnh / file lên host công khai (thay thế catbox.moe bị chặn).
 *
 * uploadImage(input)       — Ảnh (Buffer/path/URL) → ImgBB (key) hoặc freeimage.host
 * uploadFile(input, name)  — Bất kỳ file gì (Buffer/path/stream) → 0x0.st
 *
 * Cấu hình (config.json):
 *   imgbbKey — API key ImgBB (https://imgbb.com/api) — tuỳ chọn
 *              Nếu không có → fallback sang freeimage.host (không cần key)
 */

const fs       = require("fs");
const path     = require("path");
const axios    = require("axios");
const FormData = require("form-data");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getImgbbKey() {
  return global.config?.imgbbKey || null;
}

/** Chuẩn hoá input thành Buffer */
async function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;

  if (typeof input === "string") {
    if (/^https?:\/\//i.test(input)) {
      const res = await axios.get(input, { responseType: "arraybuffer", timeout: 30000 });
      return Buffer.from(res.data);
    }
    return fs.readFileSync(input);
  }

  throw new Error("uploadImg: input phải là Buffer, đường dẫn file hoặc URL");
}

// ─────────────────────────────────────────────────────────────────────────────
// ImgBB (ảnh)
// ─────────────────────────────────────────────────────────────────────────────

async function imgbbUpload(buffer) {
  const key = getImgbbKey();
  if (!key) throw new Error("Thiếu imgbbKey trong config.json");

  const b64 = buffer.toString("base64");
  const form = new URLSearchParams();
  form.append("key", key);
  form.append("image", b64);

  const res = await axios.post("https://api.imgbb.com/1/upload", form, {
    timeout: 30000,
  });

  const url = res.data?.data?.url;
  if (!url) throw new Error("ImgBB không trả về URL");
  return url;
}

// ─────────────────────────────────────────────────────────────────────────────
// freeimage.host (ảnh — không cần key)
// ─────────────────────────────────────────────────────────────────────────────

async function freeimageUpload(buffer) {
  const b64 = buffer.toString("base64");
  const form = new URLSearchParams();
  form.append("key", "6d207e02198a847aa98d0a2a901485a5");
  form.append("source", b64);
  form.append("format", "json");

  const res = await axios.post("https://freeimage.host/api/1/upload", form, {
    timeout: 30000,
  });

  const url = res.data?.image?.url;
  if (!url) throw new Error("freeimage.host không trả về URL");
  return url;
}

// ─────────────────────────────────────────────────────────────────────────────
// 0x0.st (bất kỳ file — không cần key)
// ─────────────────────────────────────────────────────────────────────────────

async function zeroXUpload(input, filename = "file") {
  const fd = new FormData();

  if (Buffer.isBuffer(input)) {
    fd.append("file", input, { filename });
  } else if (typeof input === "string" && fs.existsSync(input)) {
    fd.append("file", fs.createReadStream(input), { filename: path.basename(input) });
  } else if (input && typeof input.pipe === "function") {
    fd.append("file", input, { filename });
  } else {
    const buf = await toBuffer(input);
    fd.append("file", buf, { filename });
  }

  const res = await axios.post("https://0x0.st", fd, {
    headers: fd.getHeaders(),
    timeout: 120000,
    responseType: "text",
  });

  const url = (res.data || "").trim();
  if (!url.startsWith("https://")) throw new Error("0x0.st trả về không hợp lệ: " + url);
  return url;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upload ảnh lên ImgBB (nếu có key) hoặc freeimage.host (không key).
 * @param {Buffer|string} input - Buffer, đường dẫn file, hoặc URL ảnh
 * @returns {Promise<string>} URL công khai
 */
async function uploadImage(input) {
  const buf = await toBuffer(input);

  // Thử ImgBB trước (nếu có key)
  if (getImgbbKey()) {
    try { return await imgbbUpload(buf); } catch (_) {}
  }

  // Fallback freeimage.host
  return freeimageUpload(buf);
}

/**
 * Upload bất kỳ file nào (zip, mp3, v.v.) lên 0x0.st.
 * @param {Buffer|string|Stream} input - Buffer, đường dẫn file, stream
 * @param {string} [filename]          - Tên file (hint)
 * @returns {Promise<string>} URL công khai
 */
async function uploadFile(input, filename = "file") {
  return zeroXUpload(input, filename);
}

module.exports = { uploadImage, uploadFile };

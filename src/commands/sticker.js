"use strict";

/**
 * Module: Sticker
 * Tạo sticker (ảnh động/tĩnh) từ ảnh, video, Pinterest, AI
 *
 * Cách dùng:
 *   !stk               — Reply vào ảnh/video để tạo sticker
 *   !stk pin <từ khóa> — Tìm sticker trên Pinterest (tối đa 5)
 *   !stk spin <từ khóa>— Lấy 1 sticker ngẫu nhiên từ Pinterest
 *   !stk custom <url>  — Tạo sticker từ link ảnh/video
 *   !stk ai <mô tả>    — AI vẽ sticker theo mô tả
 */

const fs            = require("node:fs");
const path          = require("node:path");
const { exec }      = require("node:child_process");
const { promisify } = require("node:util");
const querystring   = require("node:querystring");
const axios         = require("axios");
const FormData      = require("form-data");
const ffmpegPath    = require("ffmpeg-static");
const { log }       = require("../../utils/system/logger");

const execPromise = promisify(exec);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getFileType(url) {
  try {
    const response = await axios.head(url, { timeout: 5000 });
    const ct = (response.headers["content-type"] || "").toLowerCase();
    if (ct.includes("video") || ct.includes("gif")) return "video";
    if (ct.includes("image")) return "image";
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function convertToWebp(inputPath, outputPath, isAnimated) {
  try {
    const scale = `scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000`;
    let cmd;
    if (isAnimated) {
      cmd = `"${ffmpegPath}" -y -i "${inputPath}" -vcodec libwebp -vf "${scale}" -loop 0 -preset default -an -vsync 0 -q:v 60 "${outputPath}"`;
    } else {
      cmd = `"${ffmpegPath}" -y -i "${inputPath}" -vcodec libwebp -vf "${scale}" -q:v 80 "${outputPath}"`;
    }
    await execPromise(cmd);
    return true;
  } catch (e) {
    log.error("[STK] FFmpeg lỗi:", e.stderr || e.message);
    return false;
  }
}

async function uploadToCatbox(filePath) {
  try {
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", fs.createReadStream(filePath), "sticker.webp");

    const response = await axios.post("https://catbox.moe/user/api.php", form, {
      headers: form.getHeaders(),
      timeout: 30000,
    });

    if (response.status === 200 && typeof response.data === "string" && response.data.startsWith("http")) {
      return response.data.trim();
    }
    return null;
  } catch (e) {
    log.error("[STK] Upload Catbox lỗi:", e.message);
    return null;
  }
}

async function downloadFile(url, destPath) {
  const resp = await axios({ url, method: "GET", responseType: "stream", timeout: 20000 });
  const writer = fs.createWriteStream(destPath);
  resp.data.pipe(writer);
  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

function makeTempPath(prefix, ext) {
  return path.join(process.cwd(), `${prefix}_${Date.now()}.${ext}`);
}

function cleanupFiles(...files) {
  for (const f of files) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

// ── Pinterest search ──────────────────────────────────────────────────────────

const PINTEREST_CSRF   = "6044a8a6c65d538760e70c78b3c82bd0";
const PINTEREST_COOKIE = `csrftoken=${PINTEREST_CSRF}; _auth=1; _pinterest_sess=`;

async function searchPinterest(query) {
  const searchUrl = "https://www.pinterest.com/resource/BaseSearchResource/get/";
  const postData = {
    source_url: `/search/pins/?q=${encodeURIComponent(query)}`,
    data: JSON.stringify({
      options: { query, scope: "pins", redux_normalize_feed: true },
      context: {},
    }),
  };

  const res = await axios.post(searchUrl, querystring.stringify(postData), {
    headers: {
      Accept: "application/json, text/javascript, */*",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: PINTEREST_COOKIE,
      "X-Requested-With": "XMLHttpRequest",
      "X-CSRFToken": PINTEREST_CSRF,
      "X-Pinterest-AppState": "active",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    },
    timeout: 15000,
  });

  return res.data?.resource_response?.data?.results || [];
}

function pickImageUrl(pin) {
  return (
    pin.images?.orig?.url ||
    pin.images?.["736x"]?.url ||
    pin.images?.["474x"]?.url ||
    null
  );
}

// ── Sub-command handlers ──────────────────────────────────────────────────────

async function handleStk({ api, event, send, threadID, threadType, reactLoading, reactSuccess, reactError }) {
  const raw = event?.data || {};
  const quoteAttach = raw.quote?.attach;
  if (!raw.quote) {
    return send("⚠️ Hãy reply (phản hồi) vào một ảnh hoặc video để tạo sticker.");
  }

  let attach;
  try {
    attach = typeof quoteAttach === "string" ? JSON.parse(quoteAttach) : quoteAttach;
  } catch {
    return send("⚠️ Dữ liệu đính kèm không hợp lệ.");
  }

  if (!attach) return send("⚠️ Không tìm thấy tệp đính kèm nào trong tin nhắn được reply.");

  let mediaUrl = attach.hdUrl || attach.href || attach.url || attach.thumbnail || attach.thumbUrl;
  if (!mediaUrl) return send("⚠️ Không tìm thấy URL của tệp.");
  mediaUrl = decodeURIComponent(mediaUrl.replace(/\\\//g, "/"));

  const fileType = await getFileType(mediaUrl);
  if (fileType === "unknown") {
    return send("⚠️ Định dạng không được hỗ trợ (chỉ Ảnh/Video/GIF).");
  }

  await reactLoading();

  const tempIn  = makeTempPath("stk_in", "tmp");
  const tempOut = makeTempPath("stk_out", "webp");

  try {
    await downloadFile(mediaUrl, tempIn);

    const isAnimated = fileType === "video";
    const ok = await convertToWebp(tempIn, tempOut, isAnimated);
    if (!ok) throw new Error("Chuyển đổi sang WebP thất bại.");

    const webpUrl = await uploadToCatbox(tempOut);
    if (!webpUrl) throw new Error("Lỗi khi tải sticker lên hosting (Catbox).");

    await api.sendCustomSticker({
      staticImgUrl:    webpUrl,
      animationImgUrl: isAnimated ? webpUrl : undefined,
      threadId:        threadID,
      threadType,
      width:  512,
      height: 512,
    });

    await reactSuccess();
  } catch (e) {
    log.error("[STK] Lỗi:", e.message);
    await reactError();
    await send(`⚠️ Lỗi: ${e.message}`);
  } finally {
    cleanupFiles(tempIn, tempOut);
  }
}

async function handlePin({ api, event, send, threadID, threadType, query, reactLoading, reactSuccess, reactError }) {
  if (!query) return send("⚠️ Vui lòng nhập từ khóa.\nVí dụ: !stk pin mèo cute");

  await reactLoading();

  try {
    const results = await searchPinterest(query);
    if (results.length === 0) throw new Error("Không tìm thấy hình ảnh nào.");

    const pins = results.slice(0, 5);
    await api.sendMessage(`🔍 Đang tạo ${pins.length} sticker từ Pinterest cho "${query}"...`, threadID, threadType);

    for (const pin of pins) {
      const imageUrl = pickImageUrl(pin);
      if (!imageUrl) continue;

      const tempIn  = makeTempPath("pin_in", "tmp");
      const tempOut = makeTempPath("pin_out", "webp");

      try {
        await downloadFile(imageUrl, tempIn);
        const ok = await convertToWebp(tempIn, tempOut, false);
        if (!ok) continue;

        const webpUrl = await uploadToCatbox(tempOut);
        if (!webpUrl) continue;

        await api.sendCustomSticker({
          staticImgUrl: webpUrl,
          threadId: threadID,
          threadType,
          width: 512,
          height: 512,
        });
      } catch (e) {
        log.error("[STK-PIN] Lỗi sticker con:", e.message);
      } finally {
        cleanupFiles(tempIn, tempOut);
      }
    }

    await reactSuccess();
  } catch (e) {
    log.error("[STK-PIN] Lỗi:", e.message);
    await reactError();
    await send(`⚠️ Lỗi: ${e.message}`);
  }
}

async function handleSpin({ api, send, threadID, threadType, query, reactLoading, reactSuccess, reactError }) {
  if (!query) return send("⚠️ Vui lòng nhập từ khóa.\nVí dụ: !stk spin mèo");

  await reactLoading();

  try {
    const results = await searchPinterest(query);
    if (results.length === 0) throw new Error("Không tìm thấy hình ảnh nào.");

    const pin = results[Math.floor(Math.random() * Math.min(results.length, 20))];
    const imageUrl = pickImageUrl(pin);
    if (!imageUrl) throw new Error("Không lấy được link ảnh.");

    const tempIn  = makeTempPath("spin_in", "tmp");
    const tempOut = makeTempPath("spin_out", "webp");

    try {
      await downloadFile(imageUrl, tempIn);
      const ok = await convertToWebp(tempIn, tempOut, false);
      if (!ok) throw new Error("Chuyển đổi sticker thất bại.");

      const webpUrl = await uploadToCatbox(tempOut);
      if (!webpUrl) throw new Error("Upload sticker lỗi.");

      await api.sendCustomSticker({
        staticImgUrl: webpUrl,
        threadId: threadID,
        threadType,
        width: 512,
        height: 512,
      });

      await reactSuccess();
    } finally {
      cleanupFiles(tempIn, tempOut);
    }
  } catch (e) {
    log.error("[STK-SPIN] Lỗi:", e.message);
    await reactError();
    await send(`⚠️ Lỗi: ${e.message}`);
  }
}

async function handleCustom({ api, send, threadID, threadType, url, reactLoading, reactSuccess, reactError }) {
  if (!url || !url.startsWith("http")) {
    return send("⚠️ Vui lòng cung cấp link ảnh/video.\nVí dụ: !stk custom https://example.com/anh.jpg");
  }

  await reactLoading();

  const fileType   = await getFileType(url);
  const isAnimated = fileType === "video" || url.toLowerCase().includes(".gif");
  const tempIn     = makeTempPath("cstk_in", "tmp");
  const tempOut    = makeTempPath("cstk_out", "webp");

  try {
    await downloadFile(url, tempIn);
    const ok = await convertToWebp(tempIn, tempOut, isAnimated);
    if (!ok) throw new Error("Không thể chuyển đổi file này thành sticker.");

    const webpUrl = await uploadToCatbox(tempOut);
    if (!webpUrl) throw new Error("Lỗi upload sticker.");

    await api.sendCustomSticker({
      staticImgUrl:    webpUrl,
      animationImgUrl: isAnimated ? webpUrl : undefined,
      threadId:        threadID,
      threadType,
      width:  512,
      height: 512,
    });

    await reactSuccess();
  } catch (e) {
    log.error("[STK-CUSTOM] Lỗi:", e.message);
    await reactError();
    await send(`⚠️ Lỗi: ${e.message}`);
  } finally {
    cleanupFiles(tempIn, tempOut);
  }
}

async function handleAi({ api, send, threadID, threadType, prompt, reactLoading, reactSuccess, reactError }) {
  if (!prompt) return send("⚠️ Vui lòng nhập mô tả.\nVí dụ: !stk ai mèo phi hành gia");

  await reactLoading();
  await send(`🎨 AI đang vẽ sticker: "${prompt}"... (Đợi xíu nha)`);

  const aiImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Date.now()}`;
  const tempIn  = makeTempPath("ai_in", "tmp");
  const tempOut = makeTempPath("ai_out", "webp");

  try {
    await downloadFile(aiImageUrl, tempIn);
    const ok = await convertToWebp(tempIn, tempOut, false);
    if (!ok) throw new Error("Vẽ xong nhưng đóng gói sticker lỗi.");

    const webpUrl = await uploadToCatbox(tempOut);
    if (!webpUrl) throw new Error("Upload sticker AI lỗi.");

    await api.sendCustomSticker({
      staticImgUrl: webpUrl,
      threadId:     threadID,
      threadType,
      width:  512,
      height: 512,
    });

    await reactSuccess();
  } catch (e) {
    log.error("[STK-AI] Lỗi:", e.message);
    await reactError();
    await send(`⚠️ AI vẽ lỗi rồi: ${e.message}`);
  } finally {
    cleanupFiles(tempIn, tempOut);
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name: "stk",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Tạo sticker từ ảnh, video, Pinterest, AI",
    commandCategory: "Tiện Ích",
    usages: [
      "stk              — Reply ảnh/video để tạo sticker",
      "stk pin <từ khóa>  — Tìm sticker trên Pinterest (5 kết quả)",
      "stk spin <từ khóa> — Lấy 1 sticker ngẫu nhiên từ Pinterest",
      "stk custom <url>   — Tạo sticker từ link ảnh/video",
      "stk ai <mô tả>     — AI vẽ sticker theo mô tả",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({
    api, event, args, send, threadID,
    reactLoading, reactSuccess, reactError,
  }) => {
    const threadType = event.type;
    const sub = (args[0] || "").toLowerCase().trim();
    const restArgs = args.slice(1).join(" ").trim();
    const ctx = { api, event, send, threadID, threadType, reactLoading, reactSuccess, reactError };

    if (!sub) return handleStk(ctx);

    if (sub === "pin" || sub === "pstk") return handlePin({ ...ctx, query: restArgs });
    if (sub === "spin")                  return handleSpin({ ...ctx, query: restArgs });
    if (sub === "custom")                return handleCustom({ ...ctx, url: restArgs });
    if (sub === "ai")                    return handleAi({ ...ctx, prompt: restArgs });

    return handleStk(ctx);
  },
};

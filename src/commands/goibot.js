const path = require("path");
const fs   = require("fs");
const os   = require("os");
const { handleGoibot, handleNewUser, setEnabled } = require("../../utils/ai/goibot");
const { fileHelpers } = require("./file");

// ══════════════════════════════════════════════════════════════════════════════
//  HF IMAGE GENERATION — tích hợp vào goibot
// ══════════════════════════════════════════════════════════════════════════════

const HF_ROUTER = "https://router.huggingface.co/hf-inference/models";
const HF_MODELS = {
  schnell:   { id: "black-forest-labs/FLUX.1-schnell",                label: "FLUX.1 Schnell",           desc: "Nhanh, chất lượng cao — mặc định" },
  sdxl:      { id: "stabilityai/stable-diffusion-xl-base-1.0",        label: "Stable Diffusion XL",       desc: "Chi tiết tốt, phong cách đa dạng" },
  sd3:       { id: "stabilityai/stable-diffusion-3-medium-diffusers", label: "Stable Diffusion 3 Medium", desc: "Cân bằng tốc độ & chất lượng"    },
};
const HF_DEFAULT_MODEL = "schnell";

function getHfToken() {
  return process.env.HF_TOKEN || global.config?.hfToken || "";
}

/** Phát hiện văn bản có tiếng Việt không */
function isVietnamese(text) {
  return /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text);
}

/** Lấy Groq API key từ key.json (giống logic trong utils/ai/goibot.js) */
function getGroqKey() {
  try {
    const KEY_FILE = path.join(process.cwd(), "includes", "data", "key.json");
    const data     = JSON.parse(fs.readFileSync(KEY_FILE, "utf-8"));
    const noBalance = new Set(data.no_balance || []);
    const dead      = new Set(data.dead      || []);
    const live = (data.live || data.keys || []).filter(k => !noBalance.has(k) && !dead.has(k));
    return live[0] || "";
  } catch { return ""; }
}

/** Dịch prompt sang tiếng Anh bằng Groq (model Llama) */
async function translatePrompt(text) {
  if (!isVietnamese(text)) return text;
  try {
    const key = getGroqKey();
    if (!key) return text;
    const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
    const res = await global.axios.post(GROQ_URL, {
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "You are an expert translator for AI image generation prompts. " +
            "Translate the user text from Vietnamese to English. " +
            "Output ONLY the translated prompt — no explanations, no quotes, no extra words. " +
            "Preserve artistic style, details, and mood. Enhance with descriptive adjectives if helpful.",
        },
        { role: "user", content: text },
      ],
      temperature: 0.3,
      max_tokens: 300,
    }, {
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      timeout: 15000,
    });
    const translated = res?.data?.choices?.[0]?.message?.content?.trim();
    return translated || text;
  } catch {
    return text;
  }
}

/** Parse args dòng lệnh img */
function parseHfArgs(argsArr) {
  let raw      = argsArr.join(" ").trim();
  let modelKey = HF_DEFAULT_MODEL;
  let width    = null;
  let height   = null;
  let steps    = null;
  let seed     = null;

  raw = raw
    .replace(/--model\s+(\S+)/i,          (_, v) => { modelKey = v.toLowerCase(); return ""; })
    .replace(/--size\s+(\d+)[xX×](\d+)/i, (_, w, h) => { width = +w; height = +h; return ""; })
    .replace(/--steps\s+(\d+)/i,          (_, v) => { steps = +v; return ""; })
    .replace(/--seed\s+(\d+)/i,           (_, v) => { seed = +v; return ""; })
    .trim();

  const pipeIdx = raw.indexOf("|");
  const prompt  = pipeIdx > -1 ? raw.slice(0, pipeIdx).trim() : raw;
  const neg     = pipeIdx > -1 ? raw.slice(pipeIdx + 1).trim() : null;

  return { prompt, negativePrompt: neg, modelKey, width, height, steps, seed };
}

/** Gọi HF Inference API, trả về Buffer ảnh */
async function generateHfImage({ modelId, prompt, negativePrompt, width, height, steps, seed }) {
  const body = { inputs: prompt, parameters: {} };
  if (negativePrompt) body.parameters.negative_prompt    = negativePrompt;
  if (width)          body.parameters.width               = width;
  if (height)         body.parameters.height              = height;
  if (steps)          body.parameters.num_inference_steps = steps;
  if (seed != null)   body.parameters.seed                = seed;

  try {
    const res = await global.axios.post(`${HF_ROUTER}/${modelId}`, body, {
      headers     : { Authorization: `Bearer ${getHfToken()}`, "Content-Type": "application/json", Accept: "image/jpeg" },
      responseType: "arraybuffer",
      timeout     : 120000,
    });
    return Buffer.from(res.data);
  } catch (err) {
    const status  = err?.response?.status;
    const errText = err?.response?.data ? Buffer.from(err.response.data).toString().slice(0, 400) : "";
    if (status === 503) {
      const est  = errText.match(/estimated_time[":\s]+([\d.]+)/)?.[1];
      const wait = est ? ` (≈${Math.ceil(parseFloat(est))}s)` : "";
      throw new Error(`MODEL_LOADING${wait}`);
    }
    throw new Error(errText || err?.message || "Lỗi không xác định");
  }
}

const {
  buildFolderListing,
  convertBytes,
  sizeFolder,
  zipToStream,
  catboxUpload,
  pastebinUpload,
  extractBody,
} = fileHelpers;

module.exports = {
  config: {
    name: "goibot",
    version: "7.0.0",
    hasPermssion: 0,
    credits: "Lizi / MiZai",
    description: "Mizai AI — chat, tạo ảnh AI, nhạc, tính toán, sticker, reaction + quản lý file",
    commandCategory: "Admin",
    usages: [
      ".goibot on|off                  — Bật/tắt Mizai AI cho nhóm",
      ".goibot tao_anh <mô tả>             — Tạo ảnh AI (tự dịch VN→EN)",
      ".goibot tao_anh <mô tả> | <neg>     — Thêm negative prompt",
      ".goibot tao_anh <mô tả> --model sdxl — Chọn model",
      ".goibot tao_anh --help              — Hướng dẫn chi tiết",
      ".goibot tao_anh models              — Danh sách model",
      ".goibot file [đường dẫn]        — Xem thư mục (admin)",
    ].join("\n"),
    cooldowns: 2,
  },

  run: async ({ api, send, args, event, threadID, senderId, isBotAdmin, registerReply }) => {
    try {
      const sub = (args[0] || "").toLowerCase();

      // ── Tạo ảnh AI (HF Inference) ───────────────────────────────────────
      if (sub === "tao_anh") {
        if (!getHfToken()) {
          return send(
            "⛔ Chưa cấu hình HF Token.\n" +
            "Thêm vào config.json: { \"hfToken\": \"hf_xxx\" }\n" +
            "Hoặc set biến môi trường: HF_TOKEN=hf_xxx"
          );
        }

        const taArgs = args.slice(1);
        const taSub  = (taArgs[0] || "").toLowerCase();

        // ── Help ──────────────────────────────────────────────────────────
        if (!taArgs.length || taSub === "--help" || taSub === "help") {
          const modelList = Object.entries(HF_MODELS)
            .map(([k, m]) => `  • ${k.padEnd(10)} ${m.label}\n              └ ${m.desc}`)
            .join("\n");
          const modelKeys = Object.keys(HF_MODELS).join(" | ");
          return send(
            `╔═══ 🎨 TÍNH NĂNG TẠO ẢNH AI ═══╗\n` +
            `\n` +
            `📌 CÁC LỆNH:\n` +
            `  .goibot tao_anh <mô tả>             Tạo ảnh từ mô tả\n` +
            `  .goibot tao_anh <mô tả> | <neg>     Thêm negative prompt\n` +
            `  .goibot tao_anh models              Xem danh sách model\n` +
            `  .goibot tao_anh --help              Xem hướng dẫn này\n` +
            `\n` +
            `⚙️ TÙY CHỌN:\n` +
            `  --model <key>    Chọn model (${modelKeys})\n` +
            `  --size WxH       Kích thước (vd: 1024x768)\n` +
            `  --steps <n>      Số bước inference (vd: 20)\n` +
            `  --seed <n>       Seed cố định để tái tạo\n` +
            `  | <negative>     Những thứ KHÔNG muốn có trong ảnh\n` +
            `\n` +
            `🤖 MODEL:\n${modelList}\n` +
            `\n` +
            `💡 VÍ DỤ:\n` +
            `  .goibot tao_anh chó corgi dễ thương ngồi trên cỏ\n` +
            `  .goibot tao_anh cô gái anime tóc đỏ | blurry, nsfw\n` +
            `  .goibot tao_anh futuristic city --model sdxl --size 1280x720\n` +
            `  .goibot tao_anh con mèo trắng --steps 25 --seed 42\n` +
            `\n` +
            `🌏 Prompt tiếng Việt sẽ được tự động dịch sang tiếng Anh\n` +
            `   trước khi gửi cho AI để có kết quả tốt hơn.\n` +
            `╚════════════════════════════════╝`
          );
        }

        // ── Danh sách model ───────────────────────────────────────────────
        if (taSub === "models") {
          const list = Object.entries(HF_MODELS)
            .map(([k, m]) =>
              `  🔹 ${k.padEnd(10)} — ${m.label}\n` +
              `              ${m.desc}\n` +
              `              ID: ${m.id}`
            )
            .join("\n\n");
          return send(`🤖 Danh sách model HF:\n\n${list}\n\n⭐ Mặc định: ${HF_DEFAULT_MODEL}`);
        }

        // ── Tạo ảnh ───────────────────────────────────────────────────────
        const { prompt: rawPrompt, negativePrompt, modelKey, width, height, steps, seed } =
          parseHfArgs(taArgs);

        if (!rawPrompt) {
          return send(
            `❌ Thiếu mô tả ảnh.\n` +
            `💡 Dùng: .goibot tao_anh <mô tả>\n` +
            `📖 Xem hướng dẫn: .goibot tao_anh --help`
          );
        }

        const model   = HF_MODELS[modelKey] || HF_MODELS[HF_DEFAULT_MODEL];
        const usedKey = HF_MODELS[modelKey] ? modelKey : HF_DEFAULT_MODEL;

        // Dịch prompt nếu có tiếng Việt
        const isVN     = isVietnamese(rawPrompt);
        const prompt   = await translatePrompt(rawPrompt);
        const isNegVN  = negativePrompt && isVietnamese(negativePrompt);
        const negEn    = negativePrompt ? await translatePrompt(negativePrompt) : null;

        // Hiển thị trạng thái
        let statusMsg =
          `🎨 Đang tạo ảnh AI...\n` +
          `🤖 Model: ${model.label} (${usedKey})\n` +
          `📝 Prompt: "${rawPrompt}"`;
        if (isVN)          statusMsg += `\n🌏 Dịch EN: "${prompt}"`;
        if (negativePrompt) statusMsg += `\n🚫 Negative: "${negativePrompt}"`;
        if (isNegVN)       statusMsg += `\n   → EN: "${negEn}"`;
        if (width && height) statusMsg += `\n📐 Size: ${width}×${height}`;
        if (steps)          statusMsg += ` | Steps: ${steps}`;
        if (seed != null)   statusMsg += ` | Seed: ${seed}`;
        await send(statusMsg);

        try {
          const imgBuf  = await generateHfImage({ modelId: model.id, prompt, negativePrompt: negEn, width, height, steps, seed });
          const tmpFile = path.join(os.tmpdir(), `goibot_tao_anh_${Date.now()}.jpg`);
          fs.writeFileSync(tmpFile, imgBuf);
          try {
            await api.sendMessage(
              { msg: `🖼️ ${rawPrompt}`, attachments: [tmpFile] },
              threadID,
              event.type
            );
          } finally {
            try { fs.unlinkSync(tmpFile); } catch {}
          }
        } catch (err) {
          const msg = err?.message || "";
          if (msg.startsWith("MODEL_LOADING")) {
            return send(
              `⏳ Model đang khởi động${msg.replace("MODEL_LOADING", "")}, thử lại sau vài phút.\n` +
              `💡 Hoặc thử model nhanh hơn: .goibot tao_anh ${rawPrompt} --model schnell`
            );
          }
          logError?.(`[goibot/img] ${msg.slice(0, 300)}`);
          return send(
            `❌ Tạo ảnh thất bại!\n` +
            `📋 Lỗi: ${msg.slice(0, 200)}\n` +
            `💡 Thử model khác: .goibot tao_anh ${rawPrompt} --model sdxl`
          );
        }
        return;
      }

      // ── Bật / Tắt Mizai AI ──────────────────────────────────────────────
      if (sub === "on") {
        setEnabled(event.threadId, true);
        return send("✅ Mizai đã được bật cho nhóm này.");
      }
      if (sub === "off") {
        setEnabled(event.threadId, false);
        return send("☑️ Mizai đã được tắt cho nhóm này.");
      }

      // ── Quản lý file (chỉ admin bot) ────────────────────────────────────
      if (sub === "file") {
        if (!isBotAdmin(senderId)) return send("⛔ Chỉ admin bot mới dùng được tính năng này.");

        const dir = path.join(process.cwd(), args[1] || "");

        const fs = require("fs");
        if (!fs.existsSync(dir))              return send(`❌ Đường dẫn không tồn tại:\n${dir}`);
        if (!fs.statSync(dir).isDirectory())  return send(`❌ Đây không phải thư mục:\n${dir}`);

        let listing;
        try {
          listing = buildFolderListing(dir);
        } catch (err) {
          return send(`❌ Không thể đọc thư mục:\n${err.message}`);
        }

        const msg = await api.sendMessage(
          { msg: `📂 ${dir}\n\n${listing.txt}` },
          threadID,
          event.type
        );

        const messageId = msg?.message?.msgId || msg?.msgId;
        if (messageId) {
          registerReply({
            messageId,
            commandName: "goibot",
            ttl: 15 * 60 * 1000,
            payload: { mode: "file", data: listing.array, directory: dir + path.sep },
          });
        }
        return;
      }

      // ── Không có tham số hợp lệ ─────────────────────────────────────────
      return send(
        "⚙️ Dùng:\n" +
        "  .goibot on                   — Bật Mizai AI\n" +
        "  .goibot off                  — Tắt Mizai AI\n" +
        "  .goibot tao_anh <mô tả>          — Tạo ảnh AI (auto dịch VN→EN)\n" +
        "  .goibot tao_anh --help           — Hướng dẫn chi tiết tạo ảnh\n" +
        "  .goibot tao_anh models           — Danh sách model\n" +
        "  .goibot file [path]          — Xem file máy chủ (admin)"
      );
    } catch (err) {
      global.logError?.("Lỗi goibot: " + (err?.message || err));
      return send("❌ Đã có lỗi xảy ra!");
    }
  },

  // ── Xử lý reply (quản lý file) ────────────────────────────────────────────
  onReply: async ({ api, event, data, send, threadID, registerReply }) => {
    if (data?.mode !== "file") return;

    const fs       = require("fs");
    const raw      = event?.data ?? {};
    const senderId = String(raw?.uidFrom || "");
    const { isBotAdmin } = require("../../utils/bot/botManager");
    if (!isBotAdmin(senderId)) return;

    const body   = extractBody(raw).trim();
    if (!body || body.length < 2) return;

    const parts  = body.split(/\s+/);
    const action = parts[0].toLowerCase();
    const { data: items, directory } = data;

    async function replyAndRegister(text, newPayload) {
      const msg = await api.sendMessage({ msg: text }, threadID, event.type);
      const messageId = msg?.message?.msgId || msg?.msgId;
      if (messageId && newPayload) {
        registerReply({ messageId, commandName: "goibot", ttl: 15 * 60 * 1000, payload: newPayload });
      }
    }

    function getItem(idxStr) {
      const i = parseInt(idxStr, 10) - 1;
      return (!isNaN(i) && items[i]) ? items[i] : null;
    }

    try {
      switch (action) {

        case "open": {
          const item = getItem(parts[1]);
          if (!item) return send("❌ Số thứ tự không hợp lệ.");
          if (!item.info.isDirectory()) return send("⚠️ Mục này không phải thư mục.");
          const listing = buildFolderListing(item.dest);
          await replyAndRegister(
            `📂 ${item.dest}\n\n${listing.txt}`,
            { mode: "file", data: listing.array, directory: item.dest + path.sep }
          );
          break;
        }

        case "del": {
          if (parts.length < 2) return send("❌ Nhập số thứ tự cần xóa. Ví dụ: del 1 3");
          const deleted = [];
          for (const idxStr of parts.slice(1)) {
            const item = getItem(idxStr);
            if (!item) continue;
            const name = path.basename(item.dest);
            if (item.info.isFile())           { fs.unlinkSync(item.dest);                         deleted.push(`📄 ${idxStr}. ${name}`); }
            else if (item.info.isDirectory()) { fs.rmdirSync(item.dest, { recursive: true });      deleted.push(`🗂️ ${idxStr}. ${name}`); }
          }
          send(deleted.length ? `✅ Đã xóa:\n${deleted.join("\n")}` : "❌ Không có mục nào được xóa.");
          break;
        }

        case "view": {
          const item = getItem(parts[1]);
          if (!item) return send("❌ Số thứ tự không hợp lệ.");
          if (!item.info.isFile()) return send("⚠️ Chỉ xem được file.");
          let srcPath = item.dest;
          let tmpPath = null;
          if (/\.js$/i.test(srcPath)) {
            tmpPath = path.join(require("os").tmpdir(), `goibot_view_${Date.now()}.txt`);
            fs.copyFileSync(srcPath, tmpPath);
            srcPath = tmpPath;
          }
          try {
            await api.sendMessage({ msg: "", attachments: [srcPath] }, threadID, event.type);
          } finally {
            if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
          }
          break;
        }

        case "send": {
          const item = getItem(parts[1]);
          if (!item) return send("❌ Số thứ tự không hợp lệ.");
          if (!item.info.isFile()) return send("⚠️ Chỉ gửi được file.");
          const content = fs.readFileSync(item.dest, "utf8");
          const link = await pastebinUpload(content);
          send(link ? `🔗 Link nội dung file:\n${link}` : "❌ Upload thất bại.");
          break;
        }

        case "create": {
          const nameArg = parts[1];
          if (!nameArg) return send("❌ Nhập tên file/folder.\nVí dụ:\n  create tenfolder/\n  create file.txt nội dung");
          const isDir    = nameArg.endsWith("/");
          const fullPath = path.join(directory, nameArg);
          if (isDir) {
            fs.mkdirSync(fullPath, { recursive: true });
            send(`✅ Đã tạo folder: ${nameArg}`);
          } else {
            const content = parts.slice(2).join(" ");
            if (!fs.existsSync(path.dirname(fullPath))) fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content, "utf8");
            send(`✅ Đã tạo file: ${nameArg}`);
          }
          break;
        }

        case "copy": {
          const item = getItem(parts[1]);
          if (!item) return send("❌ Số thứ tự không hợp lệ.");
          if (!item.info.isFile()) return send("⚠️ Chỉ sao chép được file.");
          const ext  = path.extname(item.dest);
          const base = path.basename(item.dest, ext);
          const dest = path.join(path.dirname(item.dest), `${base} (COPY)${ext}`);
          fs.copyFileSync(item.dest, dest);
          send(`✅ Đã sao chép → ${path.basename(dest)}`);
          break;
        }

        case "rename": {
          const item    = getItem(parts[1]);
          const newName = parts[2];
          if (!item)    return send("❌ Số thứ tự không hợp lệ.");
          if (!newName) return send("❌ Nhập tên mới. Ví dụ: rename 2 tenMoi.js");
          const newPath = path.join(path.dirname(item.dest), newName);
          fs.renameSync(item.dest, newPath);
          send(`✅ Đã đổi tên → ${newName}`);
          break;
        }

        case "zip": {
          const indices = parts.slice(1);
          if (indices.length === 0) return send("❌ Nhập số thứ tự cần nén. Ví dụ: zip 1 3");
          const srcPaths = indices.map(i => getItem(i)?.dest).filter(Boolean);
          if (srcPaths.length === 0) return send("❌ Không tìm thấy mục nào hợp lệ.");
          send(`⏳ Đang nén ${srcPaths.length} mục và upload...`);
          try {
            const zipStream = zipToStream(srcPaths);
            const link = await catboxUpload(zipStream);
            send(`✅ Upload xong!\n🔗 Link: ${link}`);
          } catch (err) {
            send(`❌ Lỗi khi zip/upload:\n${err.message}`);
          }
          break;
        }

        // ── Đọc nội dung file (hiển thị inline) ─────────────────────────────
        case "read": {
          const item = getItem(parts[1]);
          if (!item) return send("❌ Số thứ tự không hợp lệ.");
          if (!item.info.isFile()) return send("⚠️ Chỉ đọc được file, không phải thư mục.");
          try {
            const content = fs.readFileSync(item.dest, "utf8");
            const MAX = 2000;
            const trimmed = content.length > MAX
              ? content.slice(0, MAX) + `\n...(còn ${content.length - MAX} ký tự)`
              : content;
            send(`📄 ${path.basename(item.dest)}\n━━━━━━━━━━━━━━━━\n${trimmed}`);
          } catch (err) {
            send(`❌ Không đọc được file:\n${err.message}`);
          }
          break;
        }

        // ── Ghi đè nội dung file ─────────────────────────────────────────────
        case "edit": {
          const item = getItem(parts[1]);
          if (!item) return send("❌ Số thứ tự không hợp lệ.");
          if (!item.info.isFile()) return send("⚠️ Chỉ chỉnh sửa được file.");
          const newContent = parts.slice(2).join(" ");
          if (!newContent) return send("❌ Nhập nội dung mới.\nVí dụ: edit 2 nội dung mới ở đây");
          fs.writeFileSync(item.dest, newContent, "utf8");
          send(`✅ Đã ghi nội dung mới vào: ${path.basename(item.dest)}`);
          break;
        }

        // ── Xem thông tin chi tiết file/folder ──────────────────────────────
        case "info": {
          const item = getItem(parts[1]);
          if (!item) return send("❌ Số thứ tự không hợp lệ.");
          const stat = item.info;
          const size = stat.isDirectory() ? sizeFolder(item.dest) : stat.size;
          const lines = [
            `📋 Thông tin: ${path.basename(item.dest)}`,
            `━━━━━━━━━━━━━━━━`,
            `• Loại     : ${stat.isDirectory() ? "📁 Thư mục" : "📄 File"}`,
            `• Đường dẫn: ${item.dest}`,
            `• Dung lượng: ${convertBytes(size)}`,
            `• Tạo lúc  : ${new Date(stat.birthtimeMs).toLocaleString("vi-VN")}`,
            `• Sửa lúc  : ${new Date(stat.mtimeMs).toLocaleString("vi-VN")}`,
          ];
          send(lines.join("\n"));
          break;
        }

        // ── Tìm kiếm file theo tên ───────────────────────────────────────────
        case "search": {
          const keyword = parts.slice(1).join(" ").toLowerCase();
          if (!keyword) return send("❌ Nhập từ khoá tìm kiếm.\nVí dụ: search config");
          const matched = items
            .map((item, i) => ({ item, idx: i + 1, name: path.basename(item.dest) }))
            .filter(({ name }) => name.toLowerCase().includes(keyword));
          if (!matched.length) return send(`🔍 Không tìm thấy file nào chứa: "${keyword}"`);
          const lines = matched.map(({ item, idx, name }) => {
            const icon = item.info.isDirectory() ? "🗂️" : "📄";
            return `${idx}. ${icon} ${name}`;
          });
          send(`🔍 Kết quả tìm "${keyword}":\n━━━━━━━━━━━━━━━━\n${lines.join("\n")}`);
          break;
        }

        // ── Làm mới danh sách thư mục hiện tại ──────────────────────────────
        case "refresh": {
          const currentDir = directory.endsWith(path.sep)
            ? directory.slice(0, -1)
            : directory;
          if (!fs.existsSync(currentDir)) return send("❌ Thư mục không còn tồn tại.");
          const listing = buildFolderListing(currentDir);
          await replyAndRegister(
            `🔄 ${currentDir}\n\n${listing.txt}`,
            { mode: "file", data: listing.array, directory: currentDir + path.sep }
          );
          break;
        }

        default:
          send(
            "❌ Lệnh không hợp lệ.\n📌 Hỗ trợ:\n" +
            "  open <stt>            — Mở thư mục\n" +
            "  del <stt> [...]       — Xóa file/folder\n" +
            "  view <stt>            — Gửi file đính kèm\n" +
            "  read <stt>            — Đọc nội dung file (text)\n" +
            "  edit <stt> <nội dung> — Ghi đè nội dung file\n" +
            "  info <stt>            — Xem thông tin chi tiết\n" +
            "  search <từ khoá>      — Tìm kiếm theo tên\n" +
            "  refresh               — Làm mới danh sách\n" +
            "  send <stt>            — Upload lên pastebin\n" +
            "  create <tên> [text]   — Tạo file/folder\n" +
            "  copy <stt>            — Sao chép file\n" +
            "  rename <stt> <tên>    — Đổi tên\n" +
            "  zip <stt> [...]       — Nén và upload"
          );
      }
    } catch (err) {
      global.logError?.(`[goibot/file] ${err.message}`);
      send(`❌ Lỗi xử lý:\n${err.message}`);
    }
  },

  onMessage: ({ api, event }) => handleGoibot({ api, event }),
  onNewUser: ({ api, threadId, userId }) => handleNewUser({ api, threadId, userId }),
};

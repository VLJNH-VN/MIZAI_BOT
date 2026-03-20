const fs   = require("fs");
const path = require("path");
const os   = require("os");

const LISTAPI_DIR = path.join(process.cwd(), "includes", "listapi");

// ── Helper: Tải URL về file tạm rồi upload lên GitHub ────────────────────────
async function uploadToGithub(url, fileName) {
  const tmpPath = path.join(os.tmpdir(), `api_upload_${Date.now()}_${fileName}`);
  try {
    const res = await global.axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
    fs.writeFileSync(tmpPath, Buffer.from(res.data));
    const repoPath = `listapi/${Date.now()}_${fileName}`;
    const downloadUrl = await global.githubUpload(tmpPath, repoPath);
    return downloadUrl;
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

// ── Helper: Đảm bảo file JSON tồn tại và trả về mảng hiện có ─────────────────
function loadJsonList(tipName) {
  if (!fs.existsSync(LISTAPI_DIR)) fs.mkdirSync(LISTAPI_DIR, { recursive: true });
  const dataPath = path.join(LISTAPI_DIR, `${tipName}.json`);
  if (!fs.existsSync(dataPath)) fs.writeFileSync(dataPath, "[]", "utf-8");
  return { dataPath, data: JSON.parse(fs.readFileSync(dataPath, "utf-8")) };
}

// ── Helper: Kiểm tra chuỗi có phải URL hợp lệ không ─────────────────────────
function isValidUrl(str) {
  try { return /^https?:\/\/.+/.test(new URL(str).href); } catch { return false; }
}

module.exports = {
  config: {
    name: "api",
    version: "2.1.0",
    hasPermssion: 2,
    credits: "DongDev (converted by MiZai)",
    description: "Quản lý link media trong listapi (GitHub / link trực tiếp / JSON khác)",
    commandCategory: "Admin",
    usages: [
      ".api add <tên>              — Reply ảnh/video để upload lên GitHub",
      ".api add <tên> <link>       — Thêm link trực tiếp vào JSON (không upload)",
      ".api add <tên> <file_json>  — Import link từ file JSON khác trong listapi",
      ".api check                  — Kiểm tra số lượng link còn sống"
    ].join("\n"),
    cooldowns: 5
  },

  run: async ({ event, args, send }) => {
    if (!args[0]) {
      return send(
        "📝 Cách dùng:\n" +
        "  .api add <tên>              — Reply ảnh/video để upload lên GitHub\n" +
        "  .api add <tên> <link>       — Thêm link trực tiếp vào JSON\n" +
        "  .api add <tên> <file_json>  — Import từ file JSON khác trong listapi\n" +
        "  .api check                  — Kiểm tra link còn sống trong listapi"
      );
    }

    const sub = args[0].toLowerCase();

    // ══════════════════════════════════════════════════════
    //  ADD — 3 chế độ: reply đính kèm / link trực tiếp / import JSON
    // ══════════════════════════════════════════════════════
    if (sub === "add") {
      const tipName = args[1];
      if (!tipName) return send("⚠️ Vui lòng nhập tên tệp.\nVí dụ: .api add hinh");

      const thirdArg = args[2]; // link hoặc tên file json khác (tuỳ chọn)

      // ── Chế độ 1: Import từ file JSON khác ─────────────────────────────────
      if (thirdArg && thirdArg.endsWith(".json")) {
        const srcPath = path.join(LISTAPI_DIR, thirdArg);
        if (!fs.existsSync(srcPath)) {
          return send(`❌ Không tìm thấy file: listapi/${thirdArg}`);
        }

        let srcLinks = [];
        try { srcLinks = JSON.parse(fs.readFileSync(srcPath, "utf-8")); } catch {
          return send(`❌ Không đọc được file JSON: ${thirdArg}`);
        }
        if (!Array.isArray(srcLinks) || srcLinks.length === 0) {
          return send(`⚠️ File ${thirdArg} trống hoặc không hợp lệ.`);
        }

        const { dataPath, data } = loadJsonList(tipName);
        const before = data.length;
        const merged = [...new Set([...data, ...srcLinks])]; // loại trùng
        fs.writeFileSync(dataPath, JSON.stringify(merged, null, 2), "utf-8");

        return send(
          `✅ Đã import từ ${thirdArg} → listapi/${tipName}.json\n` +
          `➕ Thêm mới: ${merged.length - before} link\n` +
          `📦 Tổng: ${merged.length} link`
        );
      }

      // ── Chế độ 2: Thêm link trực tiếp (không upload GitHub) ────────────────
      if (thirdArg && isValidUrl(thirdArg)) {
        const { dataPath, data } = loadJsonList(tipName);

        if (data.includes(thirdArg)) {
          return send("⚠️ Link này đã tồn tại trong danh sách, bỏ qua.");
        }

        data.push(thirdArg);
        fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), "utf-8");

        return send(
          `✅ Đã thêm link vào listapi/${tipName}.json\n` +
          `📦 Tổng: ${data.length} link\n` +
          `🔗 ${thirdArg}`
        );
      }

      // ── Chế độ 3: Reply đính kèm → upload lên GitHub ───────────────────────
      const quote = await global.resolveQuote({
        raw: event?.data,
        api: global.api,
        threadId: event?.threadId,
        event
      });

      if (!quote?.mediaUrl) {
        return send(
          "⚠️ Không tìm thấy nội dung hợp lệ. Hãy:\n" +
          "  • Reply vào tin nhắn có ảnh/video/file, hoặc\n" +
          "  • Thêm link trực tiếp: .api add <tên> <https://...>, hoặc\n" +
          "  • Import JSON: .api add <tên> <file.json>"
        );
      }

      if (!global.config?.githubToken || !global.config?.uploadRepo) {
        return send("❌ Chưa cấu hình githubToken hoặc uploadRepo trong config.json");
      }

      await send("⏳ Đang tải lên GitHub...");

      const { dataPath, data } = loadJsonList(tipName);

      try {
        const ext      = quote.ext || "bin";
        const fileName = `${tipName}_${Date.now()}.${ext}`;
        const ghUrl    = await uploadToGithub(quote.mediaUrl, fileName);

        if (!ghUrl) return send("❌ Upload thành công nhưng không lấy được URL từ GitHub.");

        data.push(ghUrl);
        fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), "utf-8");

        return send(
          `✅ Đã tải lên GitHub và lưu vào listapi/${tipName}.json\n` +
          `📦 Tổng: ${data.length} link\n` +
          `🔗 ${ghUrl}`
        );
      } catch (err) {
        return send(`❌ Upload thất bại: ${err.message}`);
      }
    }

    // ══════════════════════════════════════════════════════
    //  CHECK — kiểm tra link còn sống / đã die
    // ══════════════════════════════════════════════════════
    if (sub === "check") {
      if (!fs.existsSync(LISTAPI_DIR)) {
        return send("📂 Thư mục listapi chưa có dữ liệu.");
      }

      const files = fs.readdirSync(LISTAPI_DIR).filter(f => f.endsWith(".json"));
      if (files.length === 0) return send("📂 Chưa có file nào trong listapi.");

      await send(`⏳ Đang kiểm tra ${files.length} file...`);

      const results = [];

      for (const file of files) {
        const filePath = path.join(LISTAPI_DIR, file);
        let links = [];
        try { links = JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { continue; }

        let live = 0, dead = 0;

        await Promise.all(links.map(link =>
          global.axios.head(link, { timeout: 8000 })
            .then(r => { r.status === 200 ? live++ : dead++; })
            .catch(() => dead++)
        ));

        results.push(`📄 ${file}\n  ✅ Live: ${live}  ❎ Die: ${dead}  📝 Tổng: ${links.length}`);
      }

      return send(results.join("\n\n"));
    }

    // ══════════════════════════════════════════════════════
    //  Lệnh con không hợp lệ
    // ══════════════════════════════════════════════════════
    return send("❓ Lệnh con không hợp lệ. Dùng: .api add <tên> | .api check");
  }
};

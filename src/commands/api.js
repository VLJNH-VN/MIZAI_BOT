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

module.exports = {
  config: {
    name: "api",
    version: "2.0.0",
    hasPermssion: 2,
    credits: "DongDev (converted by MiZai)",
    description: "Tải link đính kèm vào src listapi (lưu trữ qua GitHub)",
    commandCategory: "Admin",
    usages: ".api add <tên> | .api check",
    cooldowns: 5
  },

  run: async ({ event, args, send }) => {
    if (!args[0]) {
      return send(
        "📝 Cách dùng:\n" +
        "  .api add <tên>  — Reply ảnh/video để tải lên GitHub & lưu vào listapi\n" +
        "  .api check      — Kiểm tra số lượng link còn sống trong listapi"
      );
    }

    const sub = args[0].toLowerCase();

    // ══════════════════════════════════════════════════════
    //  ADD — tải đính kèm từ reply lên GitHub, lưu URL
    // ══════════════════════════════════════════════════════
    if (sub === "add") {
      const tipName = args[1];
      if (!tipName) return send("⚠️ Vui lòng nhập tên tệp.\nVí dụ: .api add hinh");

      // Lấy thông tin tin nhắn được reply
      const quote = await global.resolveQuote({
        raw: event?.data,
        api: global.api,
        threadId: event?.threadId,
        event
      });

      if (!quote?.mediaUrl) {
        return send("⚠️ Hãy reply vào một tin nhắn có đính kèm ảnh/video/file.");
      }

      if (!global.config?.githubToken || !global.config?.uploadRepo) {
        return send("❌ Chưa cấu hình githubToken hoặc uploadRepo trong config.json");
      }

      await send("⏳ Đang tải lên GitHub...");

      if (!fs.existsSync(LISTAPI_DIR)) fs.mkdirSync(LISTAPI_DIR, { recursive: true });
      const dataPath = path.join(LISTAPI_DIR, `${tipName}.json`);
      if (!fs.existsSync(dataPath)) fs.writeFileSync(dataPath, "[]", "utf-8");
      const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

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

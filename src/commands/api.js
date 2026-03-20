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

// ── Helper: Fetch URL → lấy danh sách link media bên trong ───────────────────
// Ưu tiên: JSON array → file media trực tiếp → scrape HTML
async function extractMediaLinks(url) {
  const VIDEO_EXTS = /\.(mp4|webm|mkv|avi|mov|flv|m4v|3gp|ogg|wmv)(\?.*)?$/i;
  const IMAGE_EXTS = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i;

  // 1. Fetch nội dung URL
  let body, contentType = "";
  try {
    const res = await global.axios.get(url, {
      timeout: 20000,
      responseType: "text",
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    body = res.data || "";
    contentType = (res.headers["content-type"] || "").toLowerCase();
  } catch { return []; }

  // 2. Thử parse JSON trước (file .bin / .json chứa array link)
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) {
      // Lọc ra các phần tử là string URL hợp lệ
      const links = parsed.filter(v => typeof v === "string" && isValidUrl(v));
      if (links.length > 0) return links;
    }
  } catch { /* không phải JSON */ }

  // 3. Nếu là file media trực tiếp → trả về chính nó
  if (
    contentType.startsWith("video/") ||
    contentType.startsWith("image/") ||
    VIDEO_EXTS.test(url.split("?")[0]) ||
    IMAGE_EXTS.test(url.split("?")[0])
  ) {
    return [url];
  }

  // 4. Scrape HTML tìm link media
  const found = new Set();

  const srcMatches = body.matchAll(/(?:src|href)=["']([^"']+)["']/gi);
  for (const m of srcMatches) {
    const link = m[1];
    if (VIDEO_EXTS.test(link) || IMAGE_EXTS.test(link)) {
      try { found.add(new URL(link, url).href); } catch { /* skip */ }
    }
  }

  const rawMatches = body.matchAll(/https?:\/\/[^\s"'<>]+\.(?:mp4|webm|mkv|mov|m4v|flv|ogg|3gp)[^\s"'<>]*/gi);
  for (const m of rawMatches) found.add(m[0]);

  return [...found];
}

// ── Helper: Link đã nằm trên GitHub chưa ─────────────────────────────────────
function isGithubLink(url) {
  return url.includes("raw.githubusercontent.com") || url.includes("github.com");
}

// ── Helper: Lấy extension từ URL ──────────────────────────────────────────────
function extFromUrl(url) {
  try {
    const p = new URL(url).pathname;
    const ext = path.extname(p).replace(".", "").toLowerCase();
    return ext || "bin";
  } catch { return "bin"; }
}

// ── Helper: Kiểm tra & convert 1 file JSON ───────────────────────────────────
async function checkAndConvertFile(filePath, fileName, send) {
  let links = [];
  try { links = JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch {
    return `📄 ${fileName}\n  ❌ Không đọc được file.`;
  }
  if (!Array.isArray(links) || links.length === 0) {
    return `📄 ${fileName}\n  ⚠️ File trống.`;
  }

  let live = 0, dead = 0, converted = 0, failed = 0;
  const newLinks = [];

  for (const link of links) {
    // 1. Kiểm tra link còn sống không
    let alive = false;
    try {
      const r = await global.axios.head(link, { timeout: 8000 });
      alive = r.status === 200;
    } catch { alive = false; }

    if (!alive) {
      dead++;
      continue; // Bỏ link chết ra khỏi danh sách
    }

    // 2. Nếu sống nhưng chưa phải GitHub → convert lên GitHub
    if (!isGithubLink(link)) {
      try {
        const ext      = extFromUrl(link);
        const baseName = path.basename(fileName, ".json");
        const ghUrl    = await uploadToGithub(link, `${baseName}_${Date.now()}.${ext}`);
        if (ghUrl) {
          newLinks.push(ghUrl);
          converted++;
        } else {
          newLinks.push(link); // giữ nguyên nếu không lấy được URL
          failed++;
        }
      } catch {
        newLinks.push(link); // giữ nguyên nếu upload lỗi
        failed++;
      }
    } else {
      newLinks.push(link);
      live++;
    }
  }

  // Lưu lại danh sách đã cập nhật
  fs.writeFileSync(filePath, JSON.stringify(newLinks, null, 2), "utf-8");

  let summary = `📄 ${fileName}\n`;
  summary += `  ✅ GitHub: ${live}  🔄 Converted: ${converted}  ❎ Đã xoá (die): ${dead}`;
  if (failed > 0) summary += `  ⚠️ Convert lỗi: ${failed}`;
  summary += `  📝 Còn lại: ${newLinks.length}`;
  return summary;
}

module.exports = {
  config: {
    name: "api",
    version: "2.2.0",
    hasPermssion: 2,
    credits: "DongDev (converted by MiZai)",
    description: "Quản lý link media trong listapi (GitHub / link trực tiếp / JSON khác)",
    commandCategory: "Admin",
    usages: [
      ".api add <tên>              — Reply ảnh/video để upload lên GitHub",
      ".api add <tên> <url>        — Lấy video trong URL rồi upload lên GitHub",
      ".api add <tên> <file_json>  — Import link từ file JSON khác trong listapi",
      ".api check                  — Kiểm tra & convert TẤT CẢ file lên GitHub",
      ".api check <tên>            — Kiểm tra & convert 1 file cụ thể lên GitHub"
    ].join("\n"),
    cooldowns: 5
  },

  run: async ({ event, args, send }) => {
    if (!args[0]) {
      return send(
        "📝 Cách dùng:\n" +
        "  .api add <tên>              — Reply ảnh/video để upload lên GitHub\n" +
        "  .api add <tên> <url>        — Lấy video trong URL rồi upload lên GitHub\n" +
        "  .api add <tên> <file_json>  — Import từ file JSON khác trong listapi\n" +
        "  .api check                  — Kiểm tra & convert tất cả file lên GitHub\n" +
        "  .api check <tên>            — Kiểm tra & convert 1 file cụ thể"
      );
    }

    const sub = args[0].toLowerCase();

    // ══════════════════════════════════════════════════════
    //  ADD — 3 chế độ: reply đính kèm / link trực tiếp / import JSON
    // ══════════════════════════════════════════════════════
    if (sub === "add") {
      const tipName = args[1];
      if (!tipName) return send("⚠️ Vui lòng nhập tên tệp.\nVí dụ: .api add hinh");

      const thirdArg = args[2];

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
        const merged = [...new Set([...data, ...srcLinks])];
        fs.writeFileSync(dataPath, JSON.stringify(merged, null, 2), "utf-8");
        return send(
          `✅ Đã import từ ${thirdArg} → listapi/${tipName}.json\n` +
          `➕ Thêm mới: ${merged.length - before} link\n` +
          `📦 Tổng: ${merged.length} link`
        );
      }

      // ── Chế độ 2: Nhập URL → tự lấy link video bên trong → upload lên GitHub ─
      if (thirdArg && isValidUrl(thirdArg)) {
        if (!global.config?.githubToken || !global.config?.uploadRepo) {
          return send("❌ Chưa cấu hình githubToken hoặc uploadRepo trong config.json");
        }

        await send(`⏳ Đang phân tích URL...\n🔍 ${thirdArg}`);

        const mediaLinks = await extractMediaLinks(thirdArg);
        if (mediaLinks.length === 0) {
          return send("⚠️ Không tìm thấy link video/ảnh nào trong URL đó.");
        }

        await send(`🎬 Tìm thấy ${mediaLinks.length} link media, đang upload lên GitHub...`);

        const { dataPath, data } = loadJsonList(tipName);
        let success = 0, failed = 0;
        const addedUrls = [];

        for (const mUrl of mediaLinks) {
          if (data.includes(mUrl)) continue; // bỏ qua link trùng đã là GitHub
          try {
            const ext      = extFromUrl(mUrl);
            const fileName = `${tipName}_${Date.now()}.${ext}`;
            const ghUrl    = await uploadToGithub(mUrl, fileName);
            if (ghUrl && !data.includes(ghUrl)) {
              data.push(ghUrl);
              addedUrls.push(ghUrl);
              success++;
            }
          } catch { failed++; }
        }

        fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), "utf-8");

        let msg = `✅ Đã upload ${success} link vào listapi/${tipName}.json\n📦 Tổng: ${data.length} link`;
        if (failed > 0) msg += `\n⚠️ Upload lỗi: ${failed}`;
        if (addedUrls.length <= 5) msg += "\n\n" + addedUrls.map(u => `🔗 ${u}`).join("\n");
        return send(msg);
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
          "  • Nhập URL trang web: .api add <tên> <https://...>, hoặc\n" +
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
    //  CHECK — kiểm tra link & convert link không phải GitHub lên GitHub
    //  .api check          → toàn bộ listapi
    //  .api check <tên>    → chỉ file <tên>.json
    // ══════════════════════════════════════════════════════
    if (sub === "check") {
      if (!global.config?.githubToken || !global.config?.uploadRepo) {
        return send("❌ Chưa cấu hình githubToken hoặc uploadRepo trong config.json\n(Cần để convert link lên GitHub)");
      }

      if (!fs.existsSync(LISTAPI_DIR)) {
        return send("📂 Thư mục listapi chưa có dữ liệu.");
      }

      const targetName = args[1]; // tuỳ chọn: check 1 file cụ thể

      let files = [];
      if (targetName) {
        const targetFile = targetName.endsWith(".json") ? targetName : `${targetName}.json`;
        const targetPath = path.join(LISTAPI_DIR, targetFile);
        if (!fs.existsSync(targetPath)) {
          return send(`❌ Không tìm thấy file: listapi/${targetFile}`);
        }
        files = [targetFile];
      } else {
        files = fs.readdirSync(LISTAPI_DIR).filter(f => f.endsWith(".json"));
        if (files.length === 0) return send("📂 Chưa có file nào trong listapi.");
      }

      await send(
        `⏳ Đang kiểm tra & convert ${files.length} file...\n` +
        `(Link chết sẽ bị xoá, link chưa phải GitHub sẽ được upload lên GitHub)`
      );

      const results = [];
      for (const file of files) {
        const filePath = path.join(LISTAPI_DIR, file);
        const result = await checkAndConvertFile(filePath, file, send);
        results.push(result);
      }

      return send(results.join("\n\n"));
    }

    // ══════════════════════════════════════════════════════
    //  Lệnh con không hợp lệ
    // ══════════════════════════════════════════════════════
    return send("❓ Lệnh con không hợp lệ. Dùng: .api add <tên> | .api check [tên]");
  }
};

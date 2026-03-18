/**
 * utils/system/ytdlpInstaller.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tự động tải và cài đặt yt-dlp binary khi khởi động.
 * Không cần quyền root, không cần pip — tải thẳng binary từ GitHub Releases.
 *
 * Cách dùng:
 *   const { ensureYtDlp } = require('./utils/system/ytdlpInstaller');
 *   await ensureYtDlp();   // gọi 1 lần trong main() trước khi dùng youtube-dl-exec
 */

"use strict";

const fs        = require("fs");
const path      = require("path");
const https     = require("https");
const { execSync, spawnSync } = require("child_process");

// ── Cài binary vào thư mục dự án (không cần quyền hệ thống) ─────────────────
const BIN_DIR  = path.join(process.cwd(), "bin");
const BIN_PATH = path.join(BIN_DIR, "yt-dlp");

// ── URL binary mới nhất (Linux x86_64, standalone - không cần Python) ────────
const RELEASE_URL =
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";

// ── Kiểm tra yt-dlp đã tồn tại và chạy được chưa ───────────────────────────
function isYtDlpReady() {
  // 1. Kiểm tra binary trong thư mục bin/ của dự án
  if (fs.existsSync(BIN_PATH)) {
    const result = spawnSync(BIN_PATH, ["--version"], { timeout: 5000 });
    if (result.status === 0) return BIN_PATH;
  }

  // 2. Kiểm tra trong $PATH hệ thống
  try {
    const sys = execSync("which yt-dlp 2>/dev/null", { timeout: 3000 })
      .toString()
      .trim();
    if (sys) {
      const test = spawnSync(sys, ["--version"], { timeout: 5000 });
      if (test.status === 0) return sys;
    }
  } catch (_) {}

  // 3. Kiểm tra binary trong node_modules/.bin (youtube-dl-exec có thể cài sẵn)
  const nmBin = path.join(process.cwd(), "node_modules", ".bin", "yt-dlp");
  if (fs.existsSync(nmBin)) {
    const result = spawnSync(nmBin, ["--version"], { timeout: 5000 });
    if (result.status === 0) return nmBin;
  }

  return null;
}

// ── Tải file qua HTTPS (tự xử lý redirect) ─────────────────────────────────
function download(url, destPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) return reject(new Error("Quá nhiều redirect"));

    https.get(url, { timeout: 60000 }, (res) => {
      // Xử lý redirect 301/302/303/307/308
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return resolve(download(res.headers.location, destPath, redirectCount + 1));
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} khi tải ${url}`));
      }

      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }).on("error", reject);
  });
}

// ── Hàm chính: đảm bảo yt-dlp sẵn sàng ─────────────────────────────────────
async function ensureYtDlp() {
  // Kiểm tra xem đã có chưa
  const existing = isYtDlpReady();
  if (existing) {
    // YOUTUBE_DL_DIR là biến youtube-dl-exec thực sự dùng (đọc lúc require)
    process.env.YOUTUBE_DL_DIR = path.dirname(existing);
    const version = spawnSync(existing, ["--version"], { timeout: 5000 })
      .stdout.toString().trim();
    console.log(`[yt-dlp] ✅ Đã sẵn sàng (${version}) tại: ${existing}`);
    return existing;
  }

  // Chưa có → tải về
  console.log("[yt-dlp] ⬇️  Không tìm thấy yt-dlp, đang tải binary từ GitHub...");

  if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });

  const tmpPath = BIN_PATH + ".tmp";

  try {
    await download(RELEASE_URL, tmpPath);

    // Đổi tên và cấp quyền thực thi
    fs.renameSync(tmpPath, BIN_PATH);
    fs.chmodSync(BIN_PATH, 0o755);

    // Xác nhận
    const result = spawnSync(BIN_PATH, ["--version"], { timeout: 10000 });
    if (result.status !== 0) {
      throw new Error("Binary tải về nhưng không chạy được: " + (result.stderr?.toString() || ""));
    }

    const version = result.stdout.toString().trim();
    process.env.YOUTUBE_DL_DIR = BIN_DIR;
    console.log(`[yt-dlp] ✅ Đã cài thành công (${version}) tại: ${BIN_PATH}`);
    return BIN_PATH;
  } catch (err) {
    // Dọn file tạm nếu lỗi
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    console.error(`[yt-dlp] ❌ Lỗi khi tải: ${err.message}`);
    console.error("[yt-dlp] ⚠️  AutoDown sẽ không hoạt động cho đến khi yt-dlp được cài.");
    return null;
  }
}

// ── Tự động cập nhật yt-dlp (tuỳ chọn, chạy 1 lần/ngày) ───────────────────
async function updateYtDlp() {
  const binPath = isYtDlpReady();
  if (!binPath) return ensureYtDlp();

  try {
    const result = spawnSync(binPath, ["-U"], {
      timeout: 60000,
      encoding: "utf8",
    });
    const output = (result.stdout || "") + (result.stderr || "");
    if (output.includes("up to date") || output.includes("Updated")) {
      console.log("[yt-dlp] 🔄 " + output.trim().split("\n")[0]);
    }
  } catch (err) {
    console.warn("[yt-dlp] ⚠️  Không thể tự cập nhật:", err.message);
  }
}

module.exports = { ensureYtDlp, updateYtDlp, BIN_PATH };

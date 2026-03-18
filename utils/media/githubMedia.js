/**
 * utils/media/githubMedia.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Mã hóa media (video/ảnh/audio) bằng base64 rồi tải lên GitHub,
 * lưu link raw vào JSON, và giải mã về file/buffer khi cần.
 *
 * Đọc cấu hình từ global.config (config.json):
 *   config.githubToken  - Personal Access Token (scope: repo)
 *   config.uploadRepo   - "owner/repo" dùng để upload media (vd: "VLJNH-VN/UPLOAD_MIZAI")
 *   config.branch       - Nhánh mặc định (mặc định "main")
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  EXPORTS                                                                 │
 * ├──────────────────────────────┬───────────────────────────────────────────┤
 * │  encodeAndUploadToGithub     │ Mã hóa file → upload GitHub → lưu link   │
 * │  decodeFromGithub            │ Tải content base64 từ GitHub → giải mã    │
 * │  getMediaLinks               │ Đọc toàn bộ link đã lưu trong JSON        │
 * └──────────────────────────────┴───────────────────────────────────────────┘
 */

"use strict";

const fs    = require("fs");
const path  = require("path");
const axios = require("axios");
const { githubApiHeaders } = require("./githubConfig");

// ── Đường dẫn file JSON lưu link ─────────────────────────────────────────────
const LINKS_FILE = path.join(process.cwd(), "includes", "data", "githubMediaLinks.json");

// ── Loại file hợp lệ ─────────────────────────────────────────────────────────
const SUPPORTED_EXTS = new Set([
  ".mp4", ".mkv", ".avi", ".mov", ".webm",      // video
  ".jpg", ".jpeg", ".png", ".gif", ".webp",      // ảnh
  ".mp3", ".aac", ".m4a", ".ogg", ".wav",        // audio
]);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers nội bộ
// ─────────────────────────────────────────────────────────────────────────────

function readLinks() {
  try {
    if (fs.existsSync(LINKS_FILE)) {
      return JSON.parse(fs.readFileSync(LINKS_FILE, "utf8"));
    }
  } catch (_) {}
  return {};
}

function writeLinks(data) {
  try {
    const dir = path.dirname(LINKS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LINKS_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    throw new Error(`[githubMedia] Không thể ghi file links: ${e.message}`);
  }
}

/**
 * Đọc config GitHub từ global.config (config.json).
 * uploadRepo: "owner/repo" — ví dụ "VLJNH-VN/UPLOAD_MIZAI"
 */
function getGithubConfig() {
  const cfg = global.config || {};

  const token      = cfg.githubToken;
  const uploadRepo = cfg.uploadRepo;
  const branch     = cfg.branch || "main";

  if (!token)      throw new Error("[githubMedia] Thiếu config.githubToken trong config.json");
  if (!uploadRepo) throw new Error("[githubMedia] Thiếu config.uploadRepo trong config.json (vd: \"VLJNH-VN/UPLOAD_MIZAI\")");

  const parts = uploadRepo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`[githubMedia] config.uploadRepo không đúng định dạng "owner/repo": "${uploadRepo}"`);
  }

  return {
    token,
    owner:  parts[0],
    repo:   parts[1],
    branch,
    fullRepo: uploadRepo,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// Lấy SHA của file (cần khi update file đã tồn tại trên GitHub)
// ─────────────────────────────────────────────────────────────────────────────
async function getFileSha(owner, repo, ghPath, branch, token) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/contents/${ghPath}`,
      {
        headers: githubApiHeaders(token),
        params: { ref: branch },
        timeout: 15000,
      }
    );
    return res.data?.sha || null;
  } catch (_) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: Mã hóa và tải lên GitHub
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Đọc file media, mã hóa base64, tải lên GitHub (uploadRepo), lưu link raw vào JSON.
 *
 * @param {string} filePath       - Đường dẫn file local (video/ảnh/audio)
 * @param {object} [options]
 * @param {string} [options.folder]     - Thư mục con trên GitHub (vd: "media/videos")
 * @param {string} [options.key]        - Khóa lưu trong JSON (mặc định: tên file)
 * @param {boolean} [options.overwrite] - Ghi đè nếu file đã tồn tại (default: true)
 * @returns {Promise<{ key: string, rawUrl: string, apiUrl: string }>}
 */
async function encodeAndUploadToGithub(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[githubMedia] File không tồn tại: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) {
    throw new Error(`[githubMedia] Định dạng không hỗ trợ: ${ext}`);
  }

  const { token, owner, repo, branch } = getGithubConfig();
  const fileName  = path.basename(filePath);
  const folder    = options.folder || "media";
  const key       = options.key    || fileName;
  const ghPath    = `${folder}/${fileName}`;
  const overwrite = options.overwrite !== false;

  // ── Mã hóa base64 ────────────────────────────────────────────────────────
  const buffer     = fs.readFileSync(filePath);
  const b64Content = buffer.toString("base64");

  // ── Lấy SHA nếu file đã tồn tại (để update) ──────────────────────────────
  const existingSha = overwrite
    ? await getFileSha(owner, repo, ghPath, branch, token)
    : null;

  // ── Tải lên GitHub qua API ────────────────────────────────────────────────
  const body = {
    message: `upload media: ${fileName}`,
    content: b64Content,
    branch,
    ...(existingSha ? { sha: existingSha } : {}),
  };

  let uploadRes;
  try {
    uploadRes = await axios.put(
      `https://api.github.com/repos/${owner}/${repo}/contents/${ghPath}`,
      body,
      { headers: githubApiHeaders(token), timeout: 120000 }
    );
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    throw new Error(`[githubMedia] Upload thất bại (${owner}/${repo}): ${msg}`);
  }

  const rawUrl = uploadRes.data?.content?.download_url;
  const apiUrl = uploadRes.data?.content?.url;

  if (!rawUrl) {
    throw new Error("[githubMedia] GitHub không trả về download_url");
  }

  // ── Lưu link vào JSON ─────────────────────────────────────────────────────
  const links = readLinks();
  links[key] = {
    rawUrl,
    apiUrl,
    ghPath,
    owner,
    repo,
    branch,
    uploadedAt: new Date().toISOString(),
    ext,
  };
  writeLinks(links);

  return { key, rawUrl, apiUrl };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: Giải mã từ GitHub
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tải nội dung base64 từ GitHub và giải mã về Buffer hoặc lưu vào file.
 *
 * @param {string} keyOrUrl       - Key trong JSON hoặc GitHub API URL trực tiếp
 * @param {string} [outputPath]   - Nếu có, lưu file vào đường dẫn này
 * @returns {Promise<Buffer>}     - Buffer chứa dữ liệu đã giải mã
 */
async function decodeFromGithub(keyOrUrl, outputPath = null) {
  const { token } = getGithubConfig();

  let apiUrl = keyOrUrl;

  // Nếu là key thì tra trong JSON lấy apiUrl
  if (!keyOrUrl.startsWith("http")) {
    const links = readLinks();
    const entry = links[keyOrUrl];
    if (!entry) {
      throw new Error(`[githubMedia] Không tìm thấy key "${keyOrUrl}" trong githubMediaLinks.json`);
    }
    apiUrl = entry.apiUrl;
  }

  // ── Gọi GitHub API lấy content base64 ────────────────────────────────────
  let res;
  try {
    res = await axios.get(apiUrl, {
      headers: githubApiHeaders(token),
      timeout: 60000,
    });
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    throw new Error(`[githubMedia] Tải file thất bại: ${msg}`);
  }

  const b64 = res.data?.content;
  if (!b64) {
    throw new Error("[githubMedia] GitHub API không trả về content base64");
  }

  // GitHub trả về base64 có ký tự xuống dòng — cần xóa trước khi decode
  const cleanB64 = b64.replace(/\n/g, "");
  const buffer   = Buffer.from(cleanB64, "base64");

  // ── Lưu file nếu có outputPath ────────────────────────────────────────────
  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, buffer);
  }

  return buffer;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: Đọc toàn bộ link đã lưu
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trả về toàn bộ nội dung githubMediaLinks.json.
 * @returns {object}
 */
function getMediaLinks() {
  return readLinks();
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  encodeAndUploadToGithub,
  decodeFromGithub,
  getMediaLinks,
  LINKS_FILE,
};

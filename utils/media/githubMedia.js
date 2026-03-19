/**
 * utils/media/githubMedia.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Upload media lên GitHub qua Contents API, lưu rawUrl vào JSON,
 * và tải về thẳng từ raw.githubusercontent.com khi cần.
 *
 * Đọc cấu hình từ global.config (config.json):
 *   config.githubToken  - Personal Access Token (scope: repo)
 *   config.uploadRepo   - "owner/repo" dùng để upload (vd: "VLJNH-VN/UPLOAD_MIZAI")
 *   config.branch       - Nhánh mặc định (mặc định "main")
 *
 * EXPORTS
 *   encodeAndUploadToGithub  — Đọc file → upload GitHub → lưu rawUrl vào JSON
 *   decodeFromGithub         — Tải thẳng rawUrl về Buffer / file
 *   getMediaLinks            — Đọc toàn bộ link đã lưu
 */

"use strict";

const fs    = require("fs");
const path  = require("path");
const axios = require("axios");

function githubApiHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// ── Đường dẫn file JSON lưu link ─────────────────────────────────────────────
const LINKS_FILE = path.join(process.cwd(), "includes", "data", "githubMediaLinks.json");

// ── Loại file hợp lệ ─────────────────────────────────────────────────────────
const SUPPORTED_EXTS = new Set([
  ".mp4", ".mkv", ".avi", ".mov", ".webm",
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".mp3", ".aac", ".m4a", ".ogg", ".wav",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers nội bộ
// ─────────────────────────────────────────────────────────────────────────────

function readLinks() {
  try {
    if (fs.existsSync(LINKS_FILE)) return JSON.parse(fs.readFileSync(LINKS_FILE, "utf8"));
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

function getGithubConfig() {
  const cfg = global.config || {};
  const token      = cfg.githubToken;
  const uploadRepo = cfg.uploadRepo;
  const branch     = cfg.branch || "main";

  if (!token)      throw new Error("[githubMedia] Thiếu config.githubToken trong config.json");
  if (!uploadRepo) throw new Error("[githubMedia] Thiếu config.uploadRepo trong config.json");

  const parts = uploadRepo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`[githubMedia] config.uploadRepo không đúng định dạng "owner/repo": "${uploadRepo}"`);
  }

  return { token, owner: parts[0], repo: parts[1], branch, fullRepo: uploadRepo };
}

async function getFileSha(owner, repo, ghPath, branch, token) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/contents/${ghPath}`,
      { headers: githubApiHeaders(token), params: { ref: branch }, timeout: 15000 }
    );
    return res.data?.sha || null;
  } catch (_) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: Upload lên GitHub (GitHub API yêu cầu base64 khi PUT)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Đọc file, upload lên GitHub, lưu rawUrl vào JSON.
 * (GitHub Contents API bắt buộc truyền content dưới dạng base64 khi PUT)
 *
 * @param {string} filePath
 * @param {object} [options]
 * @param {string}  [options.folder]     - Thư mục con trên GitHub (mặc định: "media")
 * @param {string}  [options.key]        - Khóa lưu trong JSON (mặc định: tên file)
 * @param {boolean} [options.overwrite]  - Ghi đè nếu đã tồn tại (mặc định: true)
 * @returns {Promise<{ key, rawUrl, apiUrl }>}
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

  const b64Content = fs.readFileSync(filePath).toString("base64");

  const existingSha = overwrite
    ? await getFileSha(owner, repo, ghPath, branch, token)
    : null;

  const body = {
    message: `upload: ${fileName}`,
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

  if (!rawUrl) throw new Error("[githubMedia] GitHub không trả về download_url");

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
// PUBLIC: Tải về thẳng từ rawUrl (bỏ bước decode base64)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tải file thẳng từ raw.githubusercontent.com về Buffer hoặc lưu vào file.
 *
 * @param {string} keyOrUrl     - Key trong JSON hoặc rawUrl trực tiếp
 * @param {string} [outputPath] - Nếu có, lưu file vào đường dẫn này
 * @returns {Promise<Buffer>}
 */
async function decodeFromGithub(keyOrUrl, outputPath = null) {
  let rawUrl = keyOrUrl;

  if (!keyOrUrl.startsWith("http")) {
    const links = readLinks();
    const entry = links[keyOrUrl];
    if (!entry) throw new Error(`[githubMedia] Không tìm thấy key "${keyOrUrl}"`);
    rawUrl = entry.rawUrl;
  }

  if (!rawUrl) throw new Error("[githubMedia] Không có rawUrl để tải");

  let buffer;
  try {
    const res = await axios.get(rawUrl, {
      responseType: "arraybuffer",
      timeout: 120000,
      maxContentLength: 200 * 1024 * 1024,
    });
    buffer = Buffer.from(res.data);
  } catch (e) {
    throw new Error(`[githubMedia] Tải file thất bại: ${e.message}`);
  }

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

"use strict";

const fs   = require("fs");
const path = require("path");
const https = require("https");

// ── Cấu hình từ biến môi trường ──────────────────────────────────────────────
const GITHUB_TOKEN    = process.env.GITHUB_TOKEN || "";
const GITHUB_REPO     = process.env.GITHUB_REPO  || "";   // vd: "username/mizai-backup"
const BACKUP_BRANCH   = process.env.GITHUB_BACKUP_BRANCH || "main";

// ── Danh sách file cần backup ─────────────────────────────────────────────────
const BACKUP_FILES = [
  { local: path.join(process.cwd(), "includes", "data", "key.json"),                          remote: "backup/includes/data/key.json" },
  { local: path.join(process.cwd(), "includes", "data", "users.json"),                        remote: "backup/includes/data/users.json" },
  { local: path.join(process.cwd(), "includes", "data", "groups.json"),                       remote: "backup/includes/data/groups.json" },
  { local: path.join(process.cwd(), "includes", "data", "rentKey.json"),                      remote: "backup/includes/data/rentKey.json" },
  { local: path.join(process.cwd(), "includes", "data", "taixiu", "money.json"),              remote: "backup/includes/data/taixiu/money.json" },
  { local: path.join(process.cwd(), "includes", "data", "taixiu", "txConfig.json"),           remote: "backup/includes/data/taixiu/txConfig.json" },
  { local: path.join(process.cwd(), "includes", "database", "groupsCache.json"),              remote: "backup/includes/database/groupsCache.json" },
  { local: path.join(process.cwd(), "artifacts", "flux-image-gen", "server", "data", "credentials.json"), remote: "backup/flux-server/credentials.json" },
  { local: path.join(process.cwd(), "artifacts", "flux-image-gen", "server", "data", "keys.json"),        remote: "backup/flux-server/keys.json" },
  { local: path.join(process.cwd(), "config.json"),                                           remote: "backup/config.json" },
];

// ── GitHub API helper ─────────────────────────────────────────────────────────
function githubRequest(method, apiPath, body = null) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "api.github.com",
      path:     apiPath,
      method,
      headers: {
        Authorization:   `token ${GITHUB_TOKEN}`,
        "User-Agent":    "MizaiBot-Backup/1.0",
        Accept:          "application/vnd.github.v3+json",
        "Content-Type":  "application/json",
      },
    };
    if (bodyStr) options.headers["Content-Length"] = Buffer.byteLength(bodyStr);

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Lấy SHA file đang có trên GitHub (cần để update thay vì tạo mới)
async function getFileSHA(remotePath) {
  try {
    const res = await githubRequest("GET", `/repos/${GITHUB_REPO}/contents/${remotePath}?ref=${BACKUP_BRANCH}`);
    if (res.status === 200 && res.body?.sha) return res.body.sha;
  } catch {}
  return null;
}

// Upload 1 file lên GitHub
async function uploadFile(localPath, remotePath) {
  if (!fs.existsSync(localPath)) {
    return { skip: true };
  }

  const contentB64 = fs.readFileSync(localPath).toString("base64");
  const sha = await getFileSHA(remotePath);

  const now = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  const payload = {
    message: `[Backup] ${path.basename(remotePath)} — ${now}`,
    content: contentB64,
    branch:  BACKUP_BRANCH,
  };
  if (sha) payload.sha = sha;

  const res = await githubRequest("PUT", `/repos/${GITHUB_REPO}/contents/${remotePath}`, payload);
  const ok  = res.status === 200 || res.status === 201;
  return { ok, status: res.status, commit: res.body?.commit?.sha?.slice(0, 7) };
}

// ── Hàm backup chính ──────────────────────────────────────────────────────────
async function runBackup() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    if (typeof logWarn === "function") {
      logWarn("[Backup] Chưa cấu hình GITHUB_TOKEN hoặc GITHUB_REPO — bỏ qua.");
    }
    return { success: false, reason: "Chưa cấu hình GITHUB_TOKEN / GITHUB_REPO" };
  }

  const results = { ok: 0, skip: 0, fail: 0, details: [] };

  for (const { local, remote } of BACKUP_FILES) {
    const name = path.basename(local);
    try {
      const res = await uploadFile(local, remote);
      if (res.skip) {
        results.skip++;
        results.details.push(`⏭ ${name} (bỏ qua)`);
      } else if (res.ok) {
        results.ok++;
        results.details.push(`✅ ${name}`);
      } else {
        results.fail++;
        results.details.push(`❌ ${name} (HTTP ${res.status})`);
      }
    } catch (err) {
      results.fail++;
      results.details.push(`❌ ${name}: ${err.message}`);
    }
  }

  const now = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  if (typeof logInfo === "function") {
    logInfo(`[Backup] ${now}: ✅${results.ok} ⏭${results.skip} ❌${results.fail} → github.com/${GITHUB_REPO}`);
  }
  results.success = true;
  results.time = now;
  return results;
}

// ── Lên lịch auto backup ──────────────────────────────────────────────────────
function scheduleBackup(intervalMs = 6 * 60 * 60 * 1000) {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    if (typeof logWarn === "function") {
      logWarn("[Backup] GITHUB_TOKEN / GITHUB_REPO chưa đặt → auto backup TẮT. Xem hướng dẫn: .backup help");
    }
    return;
  }
  // Chạy lần đầu sau 1 phút
  setTimeout(() => runBackup(), 60 * 1000);
  // Lên lịch định kỳ
  setInterval(() => runBackup(), intervalMs).unref?.();
  const h = Math.round(intervalMs / 3600000);
  if (typeof logInfo === "function") {
    logInfo(`[Backup] Auto backup mỗi ${h}h → github.com/${GITHUB_REPO}`);
  }
}

module.exports = { runBackup, scheduleBackup, BACKUP_FILES };

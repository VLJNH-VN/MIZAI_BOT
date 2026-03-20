/**
 * Backup dữ liệu quan trọng lên GitHub
 * Usage: node utils/system/githubBackup.js
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const config = require("../../config.json");

const GITHUB_TOKEN = config.githubToken;
const REPO = config.repo;
const BRANCH = config.branch || "main";

if (!GITHUB_TOKEN || !REPO) {
  console.error("❌ Thiếu githubToken hoặc repo trong config.json");
  process.exit(1);
}

const BACKUP_FILES = [
  { local: "includes/database/data/mizai.sqlite", remote: "backup/mizai.sqlite" },
  { local: "includes/data/taixiu/money.json",     remote: "backup/taixiu/money.json" },
  { local: "includes/data/taixiu/phien.json",     remote: "backup/taixiu/phien.json" },
  { local: "includes/data/users.json",            remote: "backup/users.json" },
  { local: "includes/data/key.json",              remote: "backup/key.json" },
];

const BASE_URL = `https://api.github.com/repos/${REPO}/contents`;

async function getFileSha(remotePath) {
  try {
    const res = await axios.get(`${BASE_URL}/${remotePath}?ref=${BRANCH}`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });
    return res.data.sha;
  } catch {
    return null;
  }
}

async function uploadFile(localPath, remotePath) {
  const absPath = path.join(__dirname, "../../", localPath);
  if (!fs.existsSync(absPath)) {
    console.warn(`⚠️  Bỏ qua (không tồn tại): ${localPath}`);
    return;
  }

  const content = fs.readFileSync(absPath).toString("base64");
  const sha = await getFileSha(remotePath);

  const body = {
    message: `backup: ${remotePath} — ${new Date().toISOString()}`,
    content,
    branch: BRANCH,
    ...(sha ? { sha } : {})
  };

  await axios.put(`${BASE_URL}/${remotePath}`, body, {
    headers: { Authorization: `token ${GITHUB_TOKEN}` }
  });

  console.log(`✅ Đã backup: ${localPath} → ${REPO}/${remotePath}`);
}

async function main() {
  console.log(`\n🔄 Đang backup lên GitHub (${REPO})...\n`);
  for (const { local, remote } of BACKUP_FILES) {
    try {
      await uploadFile(local, remote);
    } catch (err) {
      console.error(`❌ Lỗi backup ${local}: ${err?.response?.data?.message || err.message}`);
    }
  }
  console.log("\n✅ Hoàn tất backup!\n");
}

main();

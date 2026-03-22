/**
 * utils/helpers.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared utility helpers dùng chung toàn project.
 * Import từ đây thay vì định nghĩa lại trong từng lệnh.
 */

const fs   = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "../config.json");

// ── Config ────────────────────────────────────────────────────────────────────

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")); }
  catch { return {}; }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
}

// ── Format số tiền ────────────────────────────────────────────────────────────

/**
 * Format số thành chuỗi có dấu chấm ngăn cách hàng nghìn.
 * @param {number} n
 * @param {boolean} withUnit - nếu true thêm "đ" ở cuối
 */
function fmtMoney(n, withUnit = false) {
  const s = parseInt(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return withUnit ? s + "đ" : s;
}

// ── Format thời gian ──────────────────────────────────────────────────────────

/**
 * Trả về chuỗi thời gian hiện tại theo giờ Việt Nam.
 */
function fmtTimeNow() {
  return new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

/**
 * Format timestamp thành HH:MM:SS | DD/MM/YYYY
 * @param {number} ts - unix timestamp (ms)
 */
function fmtTimestamp(ts) {
  const d  = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mi}:${ss} | ${dd}/${mm}/${yy}`;
}

/**
 * Format số giây thành m:ss
 * @param {number} sec
 */
function fmtDurationSec(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Format số milliseconds thành [h:]m:ss
 * @param {number} ms
 */
function fmtDurationMs(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// ── File JSON helpers ─────────────────────────────────────────────────────────

function readJsonFile(filePath, fallback = null) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {}
  return fallback;
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

module.exports = {
  readConfig,
  writeConfig,
  fmtMoney,
  fmtTimeNow,
  fmtTimestamp,
  fmtDurationSec,
  fmtDurationMs,
  readJsonFile,
  writeJsonFile,
};

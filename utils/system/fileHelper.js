"use strict";

/**
 * utils/system/fileHelper.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tiện ích đọc/ghi JSON file dùng chung toàn dự án.
 *
 *   readJsonFile(filePath, fallback?)  →  object | fallback
 *   writeJsonFile(filePath, data)      →  void
 */

const fs = require("fs");

/**
 * Đọc JSON file. Trả về fallback nếu file không tồn tại hoặc lỗi parse.
 * @param {string} filePath
 * @param {*} [fallback=null]
 */
function readJsonFile(filePath, fallback = null) {
  try {
    if (fs.existsSync(filePath))
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {}
  return fallback;
}

/**
 * Ghi object thành JSON file (pretty print 2 spaces).
 * @param {string} filePath
 * @param {*} data
 */
function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

module.exports = { readJsonFile, writeJsonFile };

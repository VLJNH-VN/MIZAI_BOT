/**
 * includes/accessCode.js
 * Hệ thống mã kích hoạt (Access Code) cho bot.
 * - Owner tạo code → chia sẻ cho người dùng
 * - Người dùng dùng lệnh để kích hoạt nhóm/hội thoại
 * - Bot chỉ phản hồi những nhóm/user đã được kích hoạt
 * - Owner & Bot Admin luôn được phép dùng
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ACCESS_FILE = path.join(__dirname, "../data", "access.json");

function loadData() {
  try {
    if (!fs.existsSync(ACCESS_FILE)) {
      const def = { codes: {}, activated: [] };
      fs.writeFileSync(ACCESS_FILE, JSON.stringify(def, null, 2), "utf-8");
      return def;
    }
    const raw = JSON.parse(fs.readFileSync(ACCESS_FILE, "utf-8"));
    if (!raw.codes || typeof raw.codes !== "object") raw.codes = {};
    if (!Array.isArray(raw.activated)) raw.activated = [];
    return raw;
  } catch {
    return { codes: {}, activated: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(ACCESS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Tạo một mã kích hoạt mới.
 * @param {object} options
 * @param {number} [options.uses=1] - Số lần sử dụng (0 = không giới hạn)
 * @param {string} [options.note=""] - Ghi chú
 * @returns {string} code
 */
function generateCode({ uses = 1, note = "" } = {}) {
  const code = crypto.randomBytes(4).toString("hex").toUpperCase();
  const data = loadData();
  data.codes[code] = {
    uses: uses === 0 ? -1 : uses,
    usedBy: [],
    note,
    createdAt: Date.now()
  };
  saveData(data);
  return code;
}

/**
 * Kích hoạt một nhóm/hội thoại bằng code.
 * @param {string} code
 * @param {string} threadId
 * @param {string} userId - Người dùng code
 * @returns {{ success: boolean, message: string }}
 */
function activateByCode(code, threadId, userId) {
  const data = loadData();
  const entry = data.codes[code];

  if (!entry) return { success: false, message: "❌ Mã kích hoạt không hợp lệ." };

  if (entry.uses !== -1 && entry.uses <= 0) {
    return { success: false, message: "❌ Mã kích hoạt đã hết lượt sử dụng." };
  }

  const tid = String(threadId);
  if (data.activated.includes(tid)) {
    return { success: false, message: "✅ Nhóm/hội thoại này đã được kích hoạt rồi." };
  }

  data.activated.push(tid);

  if (entry.uses !== -1) entry.uses -= 1;
  entry.usedBy.push({ threadId: tid, userId: String(userId), at: Date.now() });

  saveData(data);
  return { success: true, message: "✅ Kích hoạt thành công! Bot đã được mở khoá cho nhóm/hội thoại này." };
}

/**
 * Kiểm tra xem threadId có được phép sử dụng bot không.
 * @param {string} threadId
 * @returns {boolean}
 */
function isActivated(threadId) {
  const data = loadData();
  return data.activated.includes(String(threadId));
}

/**
 * Kích hoạt trực tiếp một nhóm/hội thoại (không cần mã, dùng cho Admin).
 * @param {string} threadId
 * @returns {{ success: boolean, message: string }}
 */
function activateDirect(threadId) {
  const data = loadData();
  const tid = String(threadId);
  if (data.activated.includes(tid)) {
    return { success: false, message: "✅ Box này đã được duyệt rồi." };
  }
  data.activated.push(tid);
  saveData(data);
  return { success: true, message: `✅ Đã duyệt box: ${tid}` };
}

/**
 * Huỷ kích hoạt (khoá lại) một nhóm/hội thoại.
 * @param {string} threadId
 * @returns {boolean}
 */
function deactivate(threadId) {
  const data = loadData();
  const tid = String(threadId);
  const idx = data.activated.indexOf(tid);
  if (idx === -1) return false;
  data.activated.splice(idx, 1);
  saveData(data);
  return true;
}

/**
 * Xoá một code.
 * @param {string} code
 * @returns {boolean}
 */
function deleteCode(code) {
  const data = loadData();
  if (!data.codes[code]) return false;
  delete data.codes[code];
  saveData(data);
  return true;
}

/**
 * Lấy danh sách tất cả codes.
 */
function listCodes() {
  return loadData().codes;
}

/**
 * Lấy danh sách đã kích hoạt.
 */
function listActivated() {
  return loadData().activated;
}

module.exports = {
  generateCode,
  activateByCode,
  activateDirect,
  isActivated,
  deactivate,
  deleteCode,
  listCodes,
  listActivated
};

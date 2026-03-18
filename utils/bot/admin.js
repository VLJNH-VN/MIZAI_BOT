/**
 * utils/admin.js
 * Nhận dạng và kiểm tra quyền admin (bot admin & admin nhóm).
 *
 * Globals được đăng ký qua utils/global.js:
 *   global.isBotAdmin(userId)                    → true/false
 *   global.isGroupAdmin({ api, groupId, userId }) → Promise<true/false>
 *   global.getBotAdminIds()                       → Set<string>
 *
 * Trong hàm run() của lệnh, 3 helper này cũng được truyền trực tiếp:
 *   run: async ({ api, event, args, send, isBotAdmin, isGroupAdmin, ... }) => { ... }
 */

const path = require("path");
const fs = require("fs");
const CONFIG_PATH = path.join(__dirname, "../../config.json");

/**
 * Đọc config.json mới nhất mỗi lần gọi (tránh cache cũ).
 */
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Trả về Set chứa ownerId và các adminBotIds từ config.json.
 */
function getBotAdminIds() {
  const cfg = readConfig();
  const ownerId = cfg?.ownerId ? String(cfg.ownerId) : "";
  const extra = Array.isArray(cfg?.adminBotIds) ? cfg.adminBotIds : [];
  return new Set([ownerId, ...extra].filter(Boolean).map(String));
}

/**
 * Kiểm tra xem userId có phải là admin bot không.
 * @param {string|number} userId
 * @returns {boolean}
 */
function isBotAdmin(userId) {
  if (!userId) return false;
  return getBotAdminIds().has(String(userId));
}

/**
 * Kiểm tra xem userId có phải là quản trị viên hoặc chủ nhóm Zalo không.
 * @param {{ api: object, groupId: string|number, userId: string|number }} param
 * @returns {Promise<boolean>}
 */
async function isGroupAdmin({ api, groupId, userId }) {
  try {
    if (!api || !groupId || !userId) return false;
    const res = await api.getGroupInfo(String(groupId));
    const info = res?.gridInfoMap?.[String(groupId)];
    if (!info) return false;
    const adminIds = Array.isArray(info.adminIds) ? info.adminIds.map(String) : [];
    const creatorId = info.creatorId ? String(info.creatorId) : "";
    return adminIds.includes(String(userId)) || (!!creatorId && creatorId === String(userId));
  } catch {
    return false;
  }
}

module.exports = { getBotAdminIds, isBotAdmin, isGroupAdmin };

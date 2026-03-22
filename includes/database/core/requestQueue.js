/**
 * includes/requestQueue.js
 * Hàng đợi yêu cầu chờ duyệt.
 * Mỗi yêu cầu có số thứ tự (stt) tăng dần.
 */

const fs = require("fs");
const path = require("path");

const QUEUE_FILE = path.join(__dirname, "../data", "requestQueue.json");

function loadQueue() {
  try {
    if (!fs.existsSync(QUEUE_FILE)) {
      const def = { counter: 0, pending: [], history: [] };
      fs.writeFileSync(QUEUE_FILE, JSON.stringify(def, null, 2), "utf-8");
      return def;
    }
    const raw = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf-8"));
    if (!Number.isInteger(raw.counter)) raw.counter = 0;
    if (!Array.isArray(raw.pending)) raw.pending = [];
    if (!Array.isArray(raw.history)) raw.history = [];
    return raw;
  } catch {
    return { counter: 0, pending: [], history: [] };
  }
}

function saveQueue(data) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Thêm yêu cầu mới vào hàng đợi.
 * @param {object} opts
 * @param {string} opts.type        - Loại yêu cầu (vd: "naptien", "custom")
 * @param {string} opts.userId      - ID người gửi
 * @param {string} opts.userName    - Tên người gửi
 * @param {string} opts.threadId    - ID nhóm/hội thoại
 * @param {string} [opts.content]   - Nội dung yêu cầu
 * @param {object} [opts.extra]     - Dữ liệu thêm tuỳ loại
 * @param {string} [opts.notifyMsgId] - ID tin nhắn bot đã gửi thông báo (dùng cho reply)
 * @returns {object} item đã thêm
 */
function addRequest({ type, userId, userName, threadId, content = "", extra = {}, notifyMsgId = null }) {
  const data = loadQueue();
  data.counter += 1;
  const item = {
    stt: data.counter,
    type,
    userId: String(userId),
    userName: userName || String(userId),
    threadId: String(threadId),
    content,
    extra,
    notifyMsgId: notifyMsgId ? String(notifyMsgId) : null,
    status: "pending",
    createdAt: Date.now()
  };
  data.pending.push(item);
  saveQueue(data);
  return item;
}

/**
 * Cập nhật notifyMsgId sau khi bot đã gửi thông báo.
 */
function setNotifyMsgId(stt, msgId) {
  const data = loadQueue();
  const item = data.pending.find(r => r.stt === stt);
  if (item) {
    item.notifyMsgId = String(msgId);
    saveQueue(data);
  }
}

/**
 * Tìm yêu cầu theo stt.
 */
function getRequest(stt) {
  const data = loadQueue();
  return data.pending.find(r => r.stt === Number(stt)) || null;
}

/**
 * Tìm yêu cầu theo notifyMsgId (dùng khi admin reply vào tin nhắn thông báo).
 */
function getRequestByMsgId(msgId) {
  const data = loadQueue();
  return data.pending.find(r => r.notifyMsgId === String(msgId)) || null;
}

/**
 * Lấy tất cả yêu cầu đang chờ.
 */
function getPendingList() {
  return loadQueue().pending;
}

/**
 * Xoá yêu cầu khỏi hàng đợi và lưu vào lịch sử.
 * @param {number} stt
 * @param {"approved"|"rejected"} result
 * @param {string} [adminId]
 * @param {string} [reason]
 * @returns {object|null}
 */
function resolveRequest(stt, result, adminId = "", reason = "") {
  const data = loadQueue();
  const idx = data.pending.findIndex(r => r.stt === Number(stt));
  if (idx === -1) return null;

  const item = data.pending.splice(idx, 1)[0];
  item.status = result;
  item.resolvedBy = adminId;
  item.resolvedAt = Date.now();
  item.reason = reason;

  // Giữ tối đa 100 lịch sử
  data.history.unshift(item);
  if (data.history.length > 100) data.history = data.history.slice(0, 100);

  saveQueue(data);
  return item;
}

module.exports = {
  addRequest,
  setNotifyMsgId,
  getRequest,
  getRequestByMsgId,
  getPendingList,
  resolveRequest
};

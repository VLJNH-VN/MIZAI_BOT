const { ThreadType } = require("zca-js");


/**
 * Gửi thông báo khi thành viên rời nhóm hoặc bị xoá khỏi nhóm
 * Được gọi từ includes/handleGroupEvent.js
 *
 * @param {Object} params
 * @param {Object} params.api
 * @param {Object} params.data  // GroupEvent từ zca-js
 * @param {("leave"|"remove"|"unknown")} [params.reason]
 */
async function handleLeaveNoti({ api, data, reason = "unknown" }) {
  try {
    const raw = data || {};
    const payload = raw.data || {};

    const threadId = raw.threadId || payload.groupId;
    if (!threadId) return;

    const members = Array.isArray(payload.updateMembers) ? payload.updateMembers : [];
    if (!members.length) return;

    const groupName = payload.groupName || "nhóm";
    const names = members
      .map((m) => m.dName || m.displayName || m.name || m.id)
      .filter(Boolean)
      .join(", ");

    if (!names) return;

    let msg;
    if (reason === "remove") {
      msg = `⚠️ ${names} đã bị xoá khỏi ${groupName}.`;
    } else if (reason === "leave") {
      msg = `👋 ${names} đã rời khỏi ${groupName}.`;
    } else {
      msg = `👋 ${names} không còn trong ${groupName}.`;
    }

    logEvent(`leaveNoti -> ${msg}`);
    await api.sendMessage({ msg }, String(threadId), ThreadType.Group);
  } catch (err) {
    logError(`Lỗi trong events/leaveNoti: ${err.message}`);
  }
}

module.exports = {
  handleLeaveNoti
};


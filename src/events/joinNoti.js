const { ThreadType } = require("zca-js");


/**
 * Gửi thông báo khi có thành viên tham gia nhóm
 * Được gọi từ includes/handleGroupEvent.js (GroupEventType.JOIN)
 *
 * @param {Object} params
 * @param {Object} params.api
 * @param {Object} params.data  // GroupEvent từ zca-js
 */
async function handleJoinNoti({ api, data }) {
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

    const msg = `🎉 Chào mừng ${names} đã tham gia ${groupName}!`;

    logEvent(`joinNoti -> ${msg}`);
    await api.sendMessage({ msg }, String(threadId), ThreadType.Group);
  } catch (err) {
    logError(`Lỗi trong events/joinNoti: ${err.message}`);
  }
}

module.exports = {
  handleJoinNoti
};


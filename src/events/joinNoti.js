const { ThreadType } = require("zca-js");
const { handleNewUser } = require("../../utils/ai/goibot");

/**
 * Gửi thông báo khi thành viên mới tham gia nhóm
 * Được gọi từ includes/handlers/handleGroupEvent.js
 */
async function handleJoinNoti({ api, data }) {
  try {
    const raw     = data || {};
    const payload = raw.data || {};

    const threadId = raw.threadId || payload.groupId;
    if (!threadId) return;

    const members = Array.isArray(payload.updateMembers) ? payload.updateMembers : [];
    if (!members.length) return;

    const groupName = payload.groupName || "nhóm";

    for (const member of members) {
      const userId = String(member.id || member.uid || "");
      const name   = member.dName || member.displayName || member.name || userId;
      if (!name) continue;

      const msg = `👋 Chào mừng ${name} đã tham gia ${groupName}!`;
      logEvent(`joinNoti -> ${msg}`);

      await api.sendMessage({ msg }, String(threadId), ThreadType.Group).catch(() => {});

      // Goibot chào thành viên mới
      try {
        if (userId) await handleNewUser({ api, threadId, userId });
      } catch {}
    }
  } catch (err) {
    logError(`Lỗi trong events/joinNoti: ${err.message}`);
  }
}

module.exports = { handleJoinNoti };

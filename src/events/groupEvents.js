const { ThreadType } = require("zca-js");
const { handleNewUser } = require("../../utils/ai/goibot");
const { getGroupAnti } = require("../../utils/bot/botManager");

// ── Bot detection keywords ────────────────────────────────────────────────────
const BOT_NAME_PATTERNS = [
  /\bbot\b/i, /\bauto\b/i, /\bspam\b/i, /\bclone\b/i,
  /\bfake\b/i, /\brobot\b/i, /\bscript\b/i,
];

function looksLikeBot(name) {
  if (!name) return false;
  return BOT_NAME_PATTERNS.some(rx => rx.test(name));
}

// ── Join Notification ─────────────────────────────────────────────────────────

async function handleJoinNoti({ api, data }) {
  try {
    const raw     = data || {};
    const payload = raw.data || {};

    const threadId = raw.threadId || payload.groupId;
    if (!threadId) return;

    const members = Array.isArray(payload.updateMembers) ? payload.updateMembers : [];
    if (!members.length) return;

    const groupName = payload.groupName || "nhóm";
    const anti = getGroupAnti(String(threadId));

    for (const member of members) {
      const userId = String(member.id || member.uid || "");
      const name   = member.dName || member.displayName || member.name || userId;
      if (!name) continue;

      // ── Anti-Bot: kick nếu phát hiện bot ─────────────────────────────────
      if (anti.antiBot && looksLikeBot(name)) {
        logEvent(`[anti-bot] Phát hiện bot: ${name} (${userId}) trong nhóm ${threadId}`);
        try {
          await api.removeUserFromGroup(userId, String(threadId));
          await api.sendMessage(
            { msg: `🤖 Anti-Bot: Đã kick tài khoản bot "${name}" ra khỏi nhóm.` },
            String(threadId),
            ThreadType.Group
          ).catch(() => {});
        } catch (e) {
          logWarn(`[anti-bot] Không thể kick ${userId}: ${e?.message}`);
        }
        continue;
      }

      const msg = `👋 Chào mừng ${name} đã tham gia ${groupName}!`;
      logEvent(`joinNoti -> ${msg}`);

      await api.sendMessage({ msg }, String(threadId), ThreadType.Group).catch(() => {});

      try {
        if (userId) await handleNewUser({ api, threadId, userId });
      } catch {}
    }
  } catch (err) {
    logError(`Lỗi trong events/joinNoti: ${err.message}`);
  }
}

// ── Leave Notification ────────────────────────────────────────────────────────

async function handleLeaveNoti({ api, data, reason = "unknown" }) {
  try {
    const raw     = data || {};
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

module.exports = { handleJoinNoti, handleLeaveNoti };

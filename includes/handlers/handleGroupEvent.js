const { GroupEventType, ThreadType } = require("zca-js");
const { handleJoinNoti } = require("../../src/events/joinNoti");
const { handleLeaveNoti } = require("../../src/events/leaveNoti");
const { getGroupAnti, recordJoin } = require("../../utils/bot/antiManager");

// ── Helper ─────────────────────────────────────────────────────────────────────
function getEventLabel(type) {
  const labels = {
    [GroupEventType.JOIN_REQUEST]:  "Yêu cầu tham gia",
    [GroupEventType.JOIN]:          "Thành viên mới",
    [GroupEventType.LEAVE]:         "Rời nhóm",
    [GroupEventType.REMOVE_MEMBER]: "Bị xoá khỏi nhóm",
    [GroupEventType.BLOCK_MEMBER]:  "Bị chặn",
    [GroupEventType.UPDATE_SETTING]:"Cập nhật cài đặt",
    [GroupEventType.UPDATE]:        "Cập nhật nhóm",
    [GroupEventType.NEW_LINK]:      "Link mới",
    [GroupEventType.ADD_ADMIN]:     "Thêm admin",
    [GroupEventType.REMOVE_ADMIN]:  "Xoá admin",
  };
  return labels[type] || `Event(${type ?? "UNKNOWN"})`;
}

// ── Anti-Fake: phát hiện tài khoản ảo dựa vào UID ─────────────────────────────
// Tài khoản Zalo cũ (UID < ~1e16) thường là thật, UID rất dài/mới dễ là fake
// Đây là heuristic đơn giản — không hoàn toàn chính xác
function isSuspectedFake(userId) {
  if (!userId || userId === "unknown") return false;
  const id = String(userId).replace(/\D/g, "");
  // UID quá ngắn hoặc toàn số 0 là bất thường
  if (id.length < 5) return true;
  if (/^0+$/.test(id)) return true;
  return false;
}

// ── Main handler ───────────────────────────────────────────────────────────────
async function handleGroupEvent({ api, data }) {
  try {
    const groupId = data?.threadId   || data?.groupId   || "unknown";
    const label   = getEventLabel(data?.type);

    logEvent(`[ GROUP:${label.toUpperCase()} ] box=${groupId}`);

    switch (data?.type) {
      // ── Tham gia ──────────────────────────────────────────────────────────
      case GroupEventType.JOIN_REQUEST:
        break;

      case GroupEventType.JOIN: {
        const payload = data?.data || {};
        const members = Array.isArray(payload.updateMembers) ? payload.updateMembers : [];
        const anti = getGroupAnti(groupId);

        for (const member of members) {
          const userId = String(member.id || member.uid || "");
          if (!userId) continue;

          // ── Anti-Fake ──────────────────────────────────────────────────
          if (anti.antiFake && isSuspectedFake(userId)) {
            try {
              await api.removeUserFromGroup({ groupId, memberId: userId });
              await api.sendMessage(
                { msg: `🤖 Anti-Fake: Đã kick tài khoản nghi ngờ là ảo (UID: ${userId}).` },
                groupId,
                ThreadType.Group
              );
              logWarn(`[anti-fake] Kicked suspected fake account: ${userId} from group ${groupId}`);
              continue;
            } catch (err) {
              logWarn(`[anti-fake] Không thể kick ${userId}: ${err?.message}`);
            }
          }

          // ── Anti-Out ──────────────────────────────────────────────────
          if (anti.antiOut) {
            const joinCount = recordJoin(groupId, userId);
            const maxRejoins = anti.antiOutMaxRejoins || 3;
            const name = member.dName || member.displayName || member.name || userId;

            if (joinCount > maxRejoins) {
              try {
                await api.removeUserFromGroup({ groupId, memberId: userId });
                await api.sendMessage(
                  { msg: `🚫 Anti-Out: Đã kick ${name} vì vào nhóm quá ${maxRejoins} lần (lần ${joinCount}).` },
                  groupId,
                  ThreadType.Group
                );
                logWarn(`[anti-out] Kicked ${userId} (join #${joinCount}) from group ${groupId}`);
                continue;
              } catch (err) {
                logWarn(`[anti-out] Không thể kick ${userId}: ${err?.message}`);
                await api.sendMessage(
                  { msg: `⚠️ Anti-Out: ${name} đã vào nhóm ${joinCount} lần. Hãy xem xét xử lý.` },
                  groupId,
                  ThreadType.Group
                ).catch(() => {});
              }
            } else if (joinCount >= 2) {
              await api.sendMessage(
                { msg: `⚠️ Anti-Out: ${name} đã vào nhóm ${joinCount} lần. (Giới hạn: ${maxRejoins})` },
                groupId,
                ThreadType.Group
              ).catch(() => {});
            }
          }
        }

        await handleJoinNoti({ api, data });
        break;
      }

      // ── Rời / bị xoá ──────────────────────────────────────────────────────
      case GroupEventType.LEAVE:
        await handleLeaveNoti({ api, data, reason: "leave" });
        break;

      case GroupEventType.REMOVE_MEMBER:
        await handleLeaveNoti({ api, data, reason: "remove" });
        break;

      case GroupEventType.BLOCK_MEMBER:
        await handleLeaveNoti({ api, data, reason: "block" }).catch(() => {});
        break;

      // ── Admin ──────────────────────────────────────────────────────────────
      case GroupEventType.ADD_ADMIN:
        break;

      case GroupEventType.REMOVE_ADMIN:
        break;

      // ── Thông tin nhóm ────────────────────────────────────────────────────
      case GroupEventType.UPDATE_SETTING:
      case GroupEventType.UPDATE:
        break;

      case GroupEventType.NEW_LINK:
        break;

      default:
        break;
    }
  } catch (err) {
    logError(`Lỗi handleGroupEvent: ${err?.message || err}`);
  }
}

module.exports = { handleGroupEvent };

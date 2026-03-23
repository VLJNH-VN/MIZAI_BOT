/**
 * Fetch và replay các tin nhắn nhóm bị bỏ lỡ khi bot offline
 *
 * Giới hạn:
 *  - Chỉ hoạt động với tin nhắn NHÓM (zca-js chưa có API history cho tin riêng)
 *  - Chỉ lấy tối đa MAX_FETCH tin nhắn gần nhất mỗi nhóm
 *  - Nếu bot offline quá lâu, các tin nhắn cũ hơn sẽ không được fetch
 */

const fs = require("fs");
const path = require("path");
const { loadLastSeen } = require("./lastSeen");

const { getAllGroupIds } = require("../../includes/database/group/groupSettings");
const MAX_FETCH = 50;

const GROUP_DELAY_MS = 800;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadGroupIds() {
  return getAllGroupIds();
}

/**
 * Kiểm tra tin nhắn bỏ lỡ khi bot offline — chỉ đếm, không replay
 *
 * @param {object} api - Zalo API instance
 */
async function fetchMissedMessages(api) {
  const lastSeenTs = loadLastSeen();

  if (!lastSeenTs) return;

  const offlineDuration = Math.round((Date.now() - lastSeenTs) / 1000);
  const offlineStr =
    offlineDuration < 60
      ? `${offlineDuration}s`
      : offlineDuration < 3600
      ? `${Math.floor(offlineDuration / 60)}m ${offlineDuration % 60}s`
      : `${Math.floor(offlineDuration / 3600)}h ${Math.floor((offlineDuration % 3600) / 60)}m`;

  logInfo(`[DataBase] Bot đã offline ${offlineStr}. Đang kiểm tra tin nhắn bỏ lỡ...`);

  const groupIds = await loadGroupIds();
  if (groupIds.length === 0) return;

  const botId = global.botId ? String(global.botId) : null;
  let totalMissed = 0;

  for (const groupId of groupIds) {
    try {
      const result = await api.getGroupChatHistory(groupId, MAX_FETCH);
      const msgs = result?.groupMsgs ?? [];

      const missed = msgs.filter(msg => {
        const msgTs = parseInt(msg?.data?.ts ?? "0", 10);
        const tsMs = msgTs > 1e12 ? msgTs : msgTs * 1000;
        return tsMs > lastSeenTs && (!botId || String(msg?.data?.uidFrom) !== botId);
      });

      if (missed.length > 0) totalMissed += missed.length;

      await sleep(GROUP_DELAY_MS);
    } catch {
      // Nhóm không còn truy cập được → bỏ qua
    }
  }

  if (totalMissed > 0) {
    logInfo(`[DataBase] Bỏ qua ${totalMissed} tin nhắn trong lúc offline.`);
  } else {
    logInfo(`[DataBase] Không có tin nhắn bỏ lỡ.`);
  }
}

module.exports = { fetchMissedMessages };

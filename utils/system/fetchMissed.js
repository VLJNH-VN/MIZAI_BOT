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

const GROUPS_CACHE_PATH = path.join(__dirname, "../../includes/database/groupsCache.json");
const MAX_FETCH = 50;

// Delay nhỏ giữa các nhóm để tránh rate limit
const GROUP_DELAY_MS = 800;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadGroupIds() {
  try {
    if (!fs.existsSync(GROUPS_CACHE_PATH)) return [];
    const cache = JSON.parse(fs.readFileSync(GROUPS_CACHE_PATH, "utf-8"));
    return Object.keys(cache);
  } catch {
    return [];
  }
}

/**
 * Fetch tin nhắn bỏ lỡ và replay qua handleMessage
 *
 * @param {object} api - Zalo API instance
 * @param {Map}    commands - Map lệnh đã load
 * @param {string} prefix - Prefix lệnh
 */
async function fetchMissedMessages(api, commands, prefix) {
  const lastSeenTs = loadLastSeen();

  if (!lastSeenTs) {
    logInfo("[fetchMissed] Không có dữ liệu lastSeen — bỏ qua fetch tin nhắn bỏ lỡ.");
    return;
  }

  const offlineDuration = Math.round((Date.now() - lastSeenTs) / 1000);
  const offlineStr =
    offlineDuration < 60
      ? `${offlineDuration}s`
      : offlineDuration < 3600
      ? `${Math.floor(offlineDuration / 60)}m ${offlineDuration % 60}s`
      : `${Math.floor(offlineDuration / 3600)}h ${Math.floor((offlineDuration % 3600) / 60)}m`;

  logInfo(`[fetchMissed] Bot đã offline ${offlineStr}. Đang kiểm tra tin nhắn bỏ lỡ...`);

  const groupIds = loadGroupIds();
  if (groupIds.length === 0) {
    logInfo("[fetchMissed] Không có nhóm nào trong cache.");
    return;
  }

  const { handleMessage } = require("../../src/events/message");

  let totalReplayed = 0;

  for (const groupId of groupIds) {
    try {
      const result = await api.getGroupChatHistory(groupId, MAX_FETCH);
      const msgs = result?.groupMsgs ?? [];

      // Lọc tin nhắn sau khi bot offline VÀ không phải của chính bot
      const botId = global.botId ? String(global.botId) : null;
      const missed = msgs.filter(msg => {
        const msgTs = parseInt(msg?.data?.ts ?? "0", 10);
        // ts trong zca-js là milliseconds
        const tsMs = msgTs > 1e12 ? msgTs : msgTs * 1000;
        const isMissed = tsMs > lastSeenTs;
        const isNotBot = !botId || String(msg?.data?.uidFrom) !== botId;
        return isMissed && isNotBot;
      });

      if (missed.length === 0) continue;

      // Replay từ cũ đến mới (sort tăng dần theo timestamp)
      missed.sort((a, b) => {
        const ta = parseInt(a?.data?.ts ?? "0", 10);
        const tb = parseInt(b?.data?.ts ?? "0", 10);
        return ta - tb;
      });

      logInfo(`[fetchMissed] Nhóm ${groupId}: replay ${missed.length} tin nhắn bỏ lỡ`);

      for (const msg of missed) {
        try {
          await handleMessage({ api, event: msg, commands, prefix });
          totalReplayed++;
          await sleep(150);
        } catch (err) {
          logError(`[fetchMissed] Lỗi replay tin nhắn: ${err?.message}`);
        }
      }

      await sleep(GROUP_DELAY_MS);
    } catch (err) {
      // Một số nhóm bot không còn trong đó nữa → bỏ qua
      logWarn(`[fetchMissed] Không thể fetch nhóm ${groupId}: ${err?.message}`);
    }
  }

  if (totalReplayed > 0) {
    logInfo(`[fetchMissed] Hoàn tất: đã replay ${totalReplayed} tin nhắn bỏ lỡ từ ${groupIds.length} nhóm.`);
  } else {
    logInfo(`[fetchMissed] Không có tin nhắn bỏ lỡ cần replay.`);
  }
}

module.exports = { fetchMissedMessages };

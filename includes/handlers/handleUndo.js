/**
 * handleUndo – xử lý sự kiện thu hồi tin nhắn:
 * - Log chi tiết vào console
 * - Gọi onUndo của các command đã đăng ký theo dõi tin nhắn bị thu hồi
 */

const { ThreadType } = require("zca-js");
const { isAntiUndoEnabled } = require("../../utils/bot/botManager");

const { createTtlStore } = require('./ttlStore');

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const undoStore      = createTtlStore(DEFAULT_TTL_MS);


/**
 * Đăng ký một message đang theo dõi sự kiện thu hồi.
 * @param {Object} opts
 * @param {string} opts.messageId   - ID tin nhắn bot đã gửi
 * @param {string} opts.commandName - Tên command sẽ nhận sự kiện undo
 * @param {Object} [opts.payload]   - Dữ liệu tuỳ ý truyền sang onUndo
 * @param {number} [opts.ttl]       - Thời gian sống (ms), mặc định 10 phút
 */
function registerUndo({ messageId, commandName, payload = {}, ttl = DEFAULT_TTL_MS }) {
  if (!messageId || !commandName) return;

  undoStore.set(String(messageId), {
    commandName,
    payload,
    expireAt: ttl > 0 ? Date.now() + ttl : null
  });
}

function findTrackedUndo(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const candidates = [
    raw?.content?.globalMsgId, raw?.content?.cliMsgId,
    raw.realMsgId, raw.msgId, raw.cliMsgId,
  ].filter(Boolean).map((id) => String(id));
  for (const id of candidates) {
    const entry = undoStore.find(id);
    if (entry) return entry;
  }
  return null;
}

// ── Main handler ───────────────────────────────────────────────────────────────
async function handleUndo({ api, undo, commands }) {
  try {
    const isGroup    = !!undo?.isGroup;
    const threadType = isGroup ? "nhóm" : "PM";
    const selfLabel  = undo?.isSelf  ? " (tự thu hồi)" : "";
    const threadID   = undo?.threadId || "?";
    const type       = isGroup ? ThreadType.Group : ThreadType.User;
    const raw        = undo?.data || {};
    const undoerUid  = raw?.uidFrom ? String(raw.uidFrom) : null;
    const botId      = global.botId ? String(global.botId) : null;

    logEvent(`[ UNDO ] Thu hồi tại ${threadType}:${threadID}${selfLabel}`);

    // ── Anti-Undo: Nếu người dùng (không phải bot) thu hồi tin nhắn và antiUndo bật
    if (isGroup && undoerUid && undoerUid !== botId && isAntiUndoEnabled(threadID)) {
      try {
        await api.sendMessage(
          { msg: `⚠️ Nhóm này đã bật Anti-Undo. Việc thu hồi tin nhắn bị ghi nhận.` },
          threadID,
          type
        );
      } catch {}
    }

    // Gọi onUndo của command đang theo dõi tin nhắn bị thu hồi (nếu có)
    if (!commands) return;

    const tracked = findTrackedUndo(raw);
    if (!tracked) return;

    const command = commands.get(tracked.commandName);
    if (!command || typeof command.onUndo !== "function") return;

    const send = async (message) => {
      if (!threadID || threadID === "?") return;
      const payload =
        typeof message === "string" ? { msg: message } : message;
      return api.sendMessage(payload, threadID, type);
    };

    undoStore.del(tracked._key);

    await command.onUndo({
      api,
      undo,
      data: tracked.payload,
      send,
      commands,
      commandName: tracked.commandName,
      threadID,
      registerUndo
    });
  } catch (err) {
    logError(`Lỗi handleUndo: ${err?.message || err}`);
  }
}

module.exports = { handleUndo, registerUndo };

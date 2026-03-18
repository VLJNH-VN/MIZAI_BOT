/**
 * handleReaction – xử lý sự kiện cảm xúc (reaction):
 * - Log chi tiết reaction vào console
 * - Tự động gỡ tin nhắn khi bị thả reaction phẫn nộ (😡)
 * - Gọi onReaction của các command đã đăng ký theo dõi tin nhắn đó
 */

const { ThreadType, Reactions } = require("zca-js");

// Map<messageId, { commandName, payload, expireAt }>
const reactionStore = new Map();

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 phút

// Zalo reaction code cho cảm xúc phẫn nộ (dùng Reactions enum từ zca-js)
const ANGRY_ICONS = new Set([Reactions.ANGRY, Reactions.ANGRY_FACE]);

// Dọn entry hết hạn định kỳ
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of reactionStore) {
    if (entry.expireAt && now > entry.expireAt) {
      reactionStore.delete(key);
    }
  }
}, 60 * 1000);

/**
 * Đăng ký một message đang chờ reaction.
 * @param {Object} opts
 * @param {string} opts.messageId   - ID tin nhắn bot đã gửi
 * @param {string} opts.commandName - Tên command sẽ nhận reaction
 * @param {Object} [opts.payload]   - Dữ liệu tuỳ ý truyền sang onReaction
 * @param {number} [opts.ttl]       - Thời gian sống (ms), mặc định 10 phút
 */
function registerReaction({ messageId, commandName, payload = {}, ttl = DEFAULT_TTL_MS }) {
  if (!messageId || !commandName) return;

  reactionStore.set(String(messageId), {
    commandName,
    payload,
    expireAt: ttl > 0 ? Date.now() + ttl : null
  });
}

function findTrackedReaction(raw) {
  if (!raw || typeof raw !== "object") return null;

  // TReaction.content.rMsg chứa danh sách tin nhắn gốc bị react
  // gMsgID = global message ID (khớp với msg.message.msgId khi bot gửi)
  // cMsgID = client message ID
  const rMsgs = raw?.content?.rMsg || [];
  const rMsgCandidates = rMsgs.flatMap((r) => [r?.gMsgID, r?.cMsgID].filter(Boolean));

  const candidates = [
    ...rMsgCandidates,          // ID tin nhắn gốc bị react — ưu tiên cao nhất
    raw.msgId,                  // ID của event reaction (fallback)
    raw.cliMsgId,
    raw.messageId,
    raw.globalMsgId,
    raw?.content?.msgId
  ]
    .filter(Boolean)
    .map((id) => String(id));

  for (const id of candidates) {
    const entry = reactionStore.get(id);
    if (!entry) continue;
    if (entry.expireAt && Date.now() > entry.expireAt) {
      reactionStore.delete(id);
      continue;
    }
    return { ...entry, _key: id };
  }

  return null;
}

/**
 * Lấy msgId của tin nhắn gốc bị react từ dữ liệu reaction.
 * Ưu tiên gMsgID (global), fallback cMsgID.
 */
function extractReactedMsgId(raw) {
  const rMsgs = raw?.content?.rMsg || [];
  for (const r of rMsgs) {
    const id = r?.gMsgID || r?.cMsgID;
    if (id) return String(id);
  }
  return null;
}

/**
 * Tự động thu hồi (undo) tin nhắn bị thả reaction phẫn nộ.
 * @param {Object} opts
 * @param {Object} opts.api        - Zalo API instance
 * @param {string} opts.msgId      - ID tin nhắn cần gỡ
 * @param {string} opts.threadID   - ID thread chứa tin nhắn
 * @param {*}      opts.type       - ThreadType.Group | ThreadType.User
 * @param {string} opts.icon       - Emoji đã react (để log)
 */
async function autoRemoveAngryMessage({ api, msgId, threadID, type, icon }) {
  if (!msgId || !threadID) return;
  try {
    await api.undo(msgId, threadID, type);
    logEvent(`[ REACT-AUTO-REMOVE ] Đã gỡ tin nhắn ${msgId} tại thread ${threadID} (react: ${icon})`);
  } catch (err) {
    logError(`[ REACT-AUTO-REMOVE ] Không thể gỡ tin nhắn ${msgId}: ${err?.message || err}`);
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────
async function handleReaction({ api, reaction, commands }) {
  try {
    const raw = reaction?.data || {};
    const icon = raw?.content?.rIcon || raw?.rIcon || "";
    const uid = raw?.uidFrom || "?";
    const threadID = reaction.threadId || "?";
    const isGroup = !!reaction.isGroup;
    const threadType = isGroup ? "nhóm" : "PM";
    const type = isGroup ? ThreadType.Group : ThreadType.User;

    if (icon) {
      logEvent(`[ REACT ] ${threadType}:${threadID} | uid:${uid} → ${icon}`);
    }

    // ── Tự động gỡ tin nhắn khi bị thả cảm xúc phẫn nộ ──────────────────────
    const autoUndo = global.config?.autoUndoOnAngry !== false;
    if (autoUndo && icon && ANGRY_ICONS.has(icon) && threadID !== "?") {
      const reactedMsgId = extractReactedMsgId(raw);
      if (reactedMsgId) {
        await autoRemoveAngryMessage({ api, msgId: reactedMsgId, threadID, type, icon });
      }
    }

    // ── Gọi onReaction của command đang theo dõi tin nhắn này (nếu có) ────────
    if (!commands) return;

    const tracked = findTrackedReaction(raw);
    if (!tracked) return;

    const command = commands.get(tracked.commandName);
    if (!command || typeof command.onReaction !== "function") return;

    const send = async (message) => {
      if (!threadID || threadID === "?") return;
      const payload =
        typeof message === "string" ? { msg: message } : message;
      return api.sendMessage(payload, threadID, type);
    };

    await command.onReaction({
      api,
      reaction,
      data: tracked.payload,
      send,
      commands,
      commandName: tracked.commandName,
      icon,
      uid,
      threadID,
      isGroup,
      type,
      registerReaction
    });
  } catch (err) {
    logError(`Lỗi handleReaction: ${err?.message || err}`);
  }
}

module.exports = { handleReaction, registerReaction };

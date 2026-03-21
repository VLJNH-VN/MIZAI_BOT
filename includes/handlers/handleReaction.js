/**
 * handleReaction – xử lý sự kiện cảm xúc (reaction):
 * - Log chi tiết reaction vào console
 * - Tự động gỡ tin nhắn bot khi bị thả reaction phẫn nộ (😡)
 * - Gọi onReaction của các command đã đăng ký theo dõi tin nhắn đó
 */

const { ThreadType, Reactions } = require("zca-js");

// ── Icon reaction constants ────────────────────────────────────────────────────
const ICON_ERROR   = "❎";
const ICON_SUCCESS = "✅";
const ICON_LOADING = "⏳";

/**
 * React icon lên tin nhắn của người dùng (event.data)
 * @param {object} api
 * @param {object} event  – event chứa type, threadId, data
 * @param {string} icon   – emoji icon
 */
async function reactToEvent(api, event, icon) {
  try {
    await api.addReaction(icon, {
      type    : event.type,
      threadId: event.threadId,
      data    : event.data,
    });
  } catch (_) {}
}

const reactError   = (api, event) => reactToEvent(api, event, ICON_ERROR);
const reactSuccess = (api, event) => reactToEvent(api, event, ICON_SUCCESS);
const reactLoading = (api, event) => reactToEvent(api, event, ICON_LOADING);

const { createTtlStore } = require('./ttlStore');

const DEFAULT_TTL_MS  = 10 * 60 * 1000;
const reactionStore  = createTtlStore(DEFAULT_TTL_MS);

// Zalo reaction code cho cảm xúc phẫn nộ (dùng Reactions enum từ zca-js)
// Reactions.ANGRY = ":-h" — đây là giá trị hợp lệ duy nhất trong zca-js
const ANGRY_ICONS = new Set(
  [Reactions.ANGRY].filter(Boolean)
);


/**
 * Đăng ký một message đang chờ reaction.
 */
function registerReaction({ messageId, commandName, payload = {}, ttl = DEFAULT_TTL_MS }) {
  if (!messageId || !commandName) return;
  reactionStore.register({ messageId, commandName, payload, ttl });
}

function findTrackedReaction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const rMsgs = raw?.content?.rMsg || [];
  const rMsgCandidates = rMsgs.flatMap((rr) => [rr?.gMsgID, rr?.cMsgID].filter(Boolean));
  const candidates = [
    ...rMsgCandidates,
    raw.msgId, raw.cliMsgId, raw.messageId, raw.globalMsgId, raw?.content?.msgId,
  ].filter(Boolean).map((id) => String(id));
  for (const id of candidates) {
    const entry = reactionStore.find(id);
    if (entry) return entry;
  }
  return null;
}

/**
 * Lấy { msgId, senderUid } của tin nhắn gốc bị react.
 * Ưu tiên gMsgID (global), fallback cMsgID.
 * uidFrom: người gửi tin nhắn gốc (nếu có trong event data).
 */
function extractReactedMsg(raw) {
  const rMsgs = raw?.content?.rMsg || [];
  for (const r of rMsgs) {
    const msgId = r?.gMsgID || r?.cMsgID;
    if (msgId) {
      return {
        msgId    : String(msgId),
        senderUid: r?.uidFrom ? String(r.uidFrom) : null,
      };
    }
  }
  return null;
}

/**
 * Tự động thu hồi (undo) tin nhắn bot bị thả reaction phẫn nộ.
 * Chỉ undo nếu tin nhắn đó do bot gửi.
 */
async function autoRemoveAngryMessage({ api, msgId, senderUid, threadID, type, icon }) {
  if (!msgId || !threadID) return;

  const botId = global.botId ? String(global.botId) : null;

  // Nếu biết người gửi tin gốc mà không phải bot → bỏ qua hoàn toàn
  if (senderUid && botId && senderUid !== botId) {
    logDebug?.(`[ REACT-AUTO-REMOVE ] Bỏ qua — tin nhắn ${msgId} không phải của bot (uid: ${senderUid})`);
    return;
  }

  try {
    await api.undo(msgId, threadID, type);
    logEvent(`[ REACT-AUTO-REMOVE ] Đã gỡ tin nhắn ${msgId} tại thread ${threadID} (react: ${icon})`);
  } catch (err) {
    const detail = err?.message || err?.error || err?.data?.error
      || (typeof err === "object" ? JSON.stringify(err) : String(err));
    // Downgrade sang WARN — undo thất bại không phải lỗi nghiêm trọng
    logWarn?.(`[ REACT-AUTO-REMOVE ] Không thể gỡ tin nhắn ${msgId}: ${detail}`);
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────
async function handleReaction({ api, reaction, commands }) {
  try {
    const raw      = reaction?.data || {};
    const icon     = raw?.content?.rIcon || raw?.rIcon || "";
    const uid      = raw?.uidFrom || "?";
    const threadID = reaction.threadId || "?";
    const isGroup  = !!reaction.isGroup;
    const threadType = isGroup ? "nhóm" : "PM";
    const type     = isGroup ? ThreadType.Group : ThreadType.User;

    if (icon) {
      //logEvent(`[ REACT ] ${threadType}:${threadID} | uid:${uid} → ${icon}`);
    }

    // ── Tự động gỡ tin nhắn khi bị thả cảm xúc phẫn nộ ──────────────────────
    const autoUndo = global.config?.autoUndoOnAngry !== false;
    if (autoUndo && icon && ANGRY_ICONS.has(icon) && threadID !== "?") {
      const reacted = extractReactedMsg(raw);
      if (reacted) {
        await autoRemoveAngryMessage({
          api, threadID, type, icon,
          msgId    : reacted.msgId,
          senderUid: reacted.senderUid,
        });
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
      const payload = typeof message === "string" ? { msg: message } : message;
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

module.exports = {
  handleReaction,
  registerReaction,
  reactError,
  reactSuccess,
  reactLoading,
  ICON_ERROR,
  ICON_SUCCESS,
  ICON_LOADING,
};

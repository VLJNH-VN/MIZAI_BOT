/**
 * handleReaction – xử lý sự kiện cảm xúc (reaction):
 * - sendReaction: gửi reaction dạng text/icon tự do (rType 75 = custom)
 * - reactLoading / reactSuccess / reactError dùng text/icon import được từ lệnh
 * - Tự động gỡ tin nhắn bot khi bị thả reaction phẫn nộ (😡)
 * - Gọi onReaction của các command đã đăng ký theo dõi tin nhắn đó
 */

const { ThreadType, Reactions } = require("zca-js");
const { createTtlStore }        = require("./ttlStore");

// ══════════════════════════════════════════════════════════════════════════════
// REACT TEXT / ICON CONSTANTS  —  import từ lệnh để dùng thống nhất
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Bộ text/icon reaction dùng với sendReaction (rType 75 – custom).
 * Lệnh có thể import và dùng:
 *
 *   const { REACT, sendReaction } = require("../../includes/handlers/handleReaction");
 *   await sendReaction(api, event, REACT.OK);
 */
const REACT = {
  // Trạng thái xử lý
  LOADING : "⏳",
  SUCCESS : "✅",
  ERROR   : "❌",

  // Phản hồi vui / thân thiện
  OK      : "ok",
  NICE    : "👍",
  LOVE    : "❤️",
  WOW     : "wow",
  LOL     : "hihi",
  AKOI    : "akoi",
  LOI     : "lỏ r hihi",

  // Emoji khác
  FIRE    : "🔥",
  SAD     : "😢",
  ANGRY   : "😡",
  STAR    : "⭐",
  MONEY   : "💰",
  MUSIC   : "🎵",
  THINK   : "🤔",
  SLEEP   : "😴",
  PARTY   : "🎉",
};

// rType mặc định cho custom text/icon reaction (Zalo protocol)
const CUSTOM_RTYPE  = 75;
const CUSTOM_SOURCE = 6;

// ══════════════════════════════════════════════════════════════════════════════
// sendReaction  –  thay thế addReaction(Reactions.XXX)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Gửi reaction text/icon tự do lên một tin nhắn.
 *
 * Tương đương Python:
 *   self.client.sendReaction(message_object, icon, thread_id, thread_type, reactionType=75)
 *
 * @param {object} api        - Zalo API instance
 * @param {object} event      - event object (chứa type, threadId, data)
 * @param {string} iconOrText - Text hoặc emoji (vd: "ok", "✅", REACT.LOADING)
 * @param {number} rType      - Reaction type (mặc định 75 = custom text/icon)
 */
async function sendReaction(api, event, iconOrText, rType = CUSTOM_RTYPE) {
  try {
    const raw      = event?.data ?? {};
    const msgId    = raw?.msgId    ?? raw?.cliMsgId    ?? raw?.clientMsgId ?? null;
    const cliMsgId = raw?.cliMsgId ?? raw?.clientMsgId ?? raw?.msgId       ?? null;
    if (!msgId && !cliMsgId) return;

    await api.addReaction(
      {
        rType : Number(rType),
        source: CUSTOM_SOURCE,
        icon  : String(iconOrText),
      },
      {
        type    : event.type,
        threadId: String(event.threadId),
        data    : {
          msgId   : String(msgId    || cliMsgId),
          cliMsgId: String(cliMsgId || msgId),
        },
      }
    );
  } catch (_) {}
}

/**
 * Xóa reaction khỏi một tin nhắn (gửi rType = -1).
 */
async function removeReaction(api, event) {
  try {
    const raw      = event?.data ?? {};
    const msgId    = raw?.msgId    ?? raw?.cliMsgId    ?? raw?.clientMsgId ?? null;
    const cliMsgId = raw?.cliMsgId ?? raw?.clientMsgId ?? raw?.msgId       ?? null;
    if (!msgId && !cliMsgId) return;

    await api.addReaction(
      {
        rType : -1,
        source: CUSTOM_SOURCE,
        icon  : "",
      },
      {
        type    : event.type,
        threadId: String(event.threadId),
        data    : {
          msgId   : String(msgId    || cliMsgId),
          cliMsgId: String(cliMsgId || msgId),
        },
      }
    );
  } catch (_) {}
}

// ── Tiện ích nhanh (dùng trong bot nội bộ) ────────────────────────────────────
const reactLoading = (api, event) => sendReaction(api, event, REACT.LOADING);
const reactSuccess = (api, event) => sendReaction(api, event, REACT.SUCCESS);
const reactError   = (api, event) => sendReaction(api, event, REACT.ERROR);

// Backward-compat: vẫn export ICON_* để lệnh cũ không bị lỗi
const ICON_LOADING = REACT.LOADING;
const ICON_SUCCESS = REACT.SUCCESS;
const ICON_ERROR   = REACT.ERROR;

// ══════════════════════════════════════════════════════════════════════════════
// REACTION STORE  –  theo dõi tin nhắn chờ reaction
// ══════════════════════════════════════════════════════════════════════════════

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const reactionStore  = createTtlStore(DEFAULT_TTL_MS);

/** Zalo reaction icon cho cảm xúc phẫn nộ (rType 20 trong zca-js) */
const ANGRY_ICONS = new Set([Reactions.ANGRY].filter(Boolean));

/**
 * Đăng ký một message đang chờ reaction.
 */
function registerReaction({ messageId, commandName, payload = {}, ttl = DEFAULT_TTL_MS }) {
  if (!messageId || !commandName) return;
  reactionStore.register({ messageId, commandName, payload, ttl });
}

function findTrackedReaction(raw) {
  if (!raw || typeof raw !== "object") return null;
  const rMsgs = raw?.content?.rMsg || [];
  const rMsgCandidates = rMsgs
    .flatMap((rr) => [rr?.gMsgID, rr?.cMsgID].filter(Boolean));
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
 */
async function autoRemoveAngryMessage({ api, msgId, senderUid, threadID, type, icon }) {
  if (!msgId || !threadID) return;
  const botId = global.botId ? String(global.botId) : null;
  if (senderUid && botId && senderUid !== botId) {
    logDebug?.(`[ REACT-AUTO-REMOVE ] Bỏ qua — tin nhắn ${msgId} không phải của bot (uid: ${senderUid})`);
    return;
  }
  try {
    await api.undo(msgId, threadID, type);
    logEvent(`[ REACT-AUTO-REMOVE ] Đã gỡ tin nhắn ${msgId} tại thread ${threadID} (react: ${icon})`);
  } catch (err) {
    const detail =
      err?.message || err?.error || err?.data?.error ||
      (typeof err === "object" ? JSON.stringify(err) : String(err));
    logWarn?.(`[ REACT-AUTO-REMOVE ] Không thể gỡ tin nhắn ${msgId}: ${detail}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════════════

async function handleReaction({ api, reaction, commands }) {
  try {
    const raw        = reaction?.data || {};
    const icon       = raw?.content?.rIcon || raw?.rIcon || "";
    const uid        = raw?.uidFrom || "?";
    const threadID   = reaction.threadId || "?";
    const isGroup    = !!reaction.isGroup;
    const type       = isGroup ? ThreadType.Group : ThreadType.User;
    const threadType = isGroup ? "nhóm" : "PM";

    if (icon) {
      // logEvent(`[ REACT ] ${threadType}:${threadID} | uid:${uid} → ${icon}`);
    }

    // ── Tự động gỡ tin nhắn khi bị thả phẫn nộ ────────────────────────────
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

    // ── Gọi onReaction của command đang theo dõi tin nhắn này ──────────────
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
      data       : tracked.payload,
      send,
      commands,
      commandName: tracked.commandName,
      icon,
      uid,
      threadID,
      isGroup,
      type,
      registerReaction,
      sendReaction,
      REACT,
    });
  } catch (err) {
    logError(`Lỗi handleReaction: ${err?.message || err}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {
  // Core
  handleReaction,
  registerReaction,
  sendReaction,
  removeReaction,

  // Tiện ích nhanh
  reactLoading,
  reactSuccess,
  reactError,

  // Constants (import ở lệnh)
  REACT,
  CUSTOM_RTYPE,

  // Backward-compat
  ICON_LOADING,
  ICON_SUCCESS,
  ICON_ERROR,
};

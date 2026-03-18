/**
 * handleReply – cơ chế giống Mirai:
 * - Lưu lại các message mà command muốn "theo dõi"
 * - Khi user reply lại message đó, sẽ gọi vào onReply của command tương ứng
 * - Tự động dọn sạch các entry hết hạn sau TTL (mặc định 10 phút)
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 phút

// Map<messageId, { commandName, payload, expireAt }>
const replyStore = new Map();

// ── Dọn entry hết hạn định kỳ ─────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of replyStore) {
    if (entry.expireAt && now > entry.expireAt) {
      replyStore.delete(key);
    }
  }
}, 60 * 1000); // chạy mỗi 1 phút

/**
 * Đăng ký một message đang chờ reply.
 * @param {Object} opts
 * @param {string} opts.messageId   - ID tin nhắn bot đã gửi, đang chờ reply
 * @param {string} opts.commandName - Tên command sẽ nhận reply
 * @param {Object} [opts.payload]   - Dữ liệu tuỳ ý truyền sang onReply
 * @param {number} [opts.ttl]       - Thời gian sống (ms), mặc định 10 phút
 */
function registerReply({ messageId, commandName, payload = {}, ttl = DEFAULT_TTL_MS }) {
  if (!messageId || !commandName) return;

  replyStore.set(String(messageId), {
    commandName,
    payload,
    expireAt: ttl > 0 ? Date.now() + ttl : null
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickReplyTarget(raw) {
  if (!raw || typeof raw !== "object") return null;
  return raw.quote || raw.msgReply || raw.replyTo || raw.replyMessage || raw.reply || null;
}

function findTrackedFromTarget(target) {
  if (!target || typeof target !== "object") return null;

  const candidates = [
    target.msgId,
    target.messageId,
    target.globalMsgId,
    target.cliMsgId
  ]
    .filter(Boolean)
    .map((id) => String(id));

  for (const id of candidates) {
    const entry = replyStore.get(id);
    if (!entry) continue;

    // Kiểm tra TTL
    if (entry.expireAt && Date.now() > entry.expireAt) {
      replyStore.delete(id);
      continue;
    }

    return { ...entry, _key: id };
  }

  return null;
}

// ── Main handler ───────────────────────────────────────────────────────────────
async function handleReply({ api, event, commands, prefix }) {
  try {
    const raw = event?.data ?? null;
    if (!raw) return;

    const replyTo = pickReplyTarget(raw);
    if (!replyTo) return;

    const tracked = findTrackedFromTarget(replyTo);
    if (!tracked) return;

    const command = commands.get(tracked.commandName);
    if (!command || typeof command.onReply !== "function") return;

    const threadID = event.threadId;
    const send = async (message) => {
      if (!threadID) return;
      const payload =
        typeof message === "string"
          ? { msg: message, quote: raw }
          : message;
      return api.sendMessage(payload, threadID, event.type);
    };

    // Xoá khỏi store sau khi đã xử lý (one-shot), trừ khi command muốn giữ lại
    replyStore.delete(tracked._key);

    await command.onReply({
      api,
      event,
      data: tracked.payload,
      send,
      commands,
      prefix,
      commandName: tracked.commandName,
      // Cho phép command tái đăng ký nếu muốn tiếp tục lắng nghe
      registerReply
    });
  } catch (err) {
    logError(`Lỗi handleReply: ${err?.message || err}`);
  }
}

module.exports = { handleReply, registerReply };

const { handleCommand } = require("../../includes/handlers/handleCommand");
const { handleReply } = require("../../includes/handlers/handleReply");
const { isGroupRented } = require("../../includes/database/rent");

async function handleListen({ api, event, commands, prefix }) {
  if (!commands || typeof commands.forEach !== "function") return;
  for (const [commandName, command] of commands) {
    if (!command || typeof command.onMessage !== "function") continue;
    const threadID = event.threadId;
    const raw = event?.data || {};
    const send = async (message) => {
      if (!threadID) return;
      const payload = typeof message === "string" ? { msg: message, quote: raw } : message;
      return api.sendMessage(payload, threadID, event.type);
    };
    try {
      await command.onMessage({ api, event, args: [], send, commands, prefix, commandName });
    } catch (err) {
      logError(`Lỗi onMessage của command '${commandName}': ${err?.message || err}`);
    }
  }
}
const { warmupFromEvent } = require("../../includes/database/infoCache");
const { isBotAdmin, isGroupAdmin } = require("../../utils/bot/botManager");
const { getGroupAnti, recordMessage, clearSpam } = require("../../utils/bot/botManager");
const { extractBody } = require("../../utils/bot/messageUtils");
const { store: storeMsgCache } = require("../../includes/database/messageCache");
const { ThreadType } = require("zca-js");
let _tuongTacRecord = null;
function getTuongTacRecord() {
  if (!_tuongTacRecord) {
    try { _tuongTacRecord = require("./tuongTac").recordMessage; } catch {}
  }
  return _tuongTacRecord;
}

// ── Từ ngữ NSFW cơ bản (có thể mở rộng) ──────────────────────────────────────
const NSFW_WORDS = [
  "địt", "lồn", "cặc", "buồi", "đụ", "đéo", "vãi lồn", "vãi cặc",
  "chịch", "sex", "porn", "đm", "dm ", "đmm", "đmcs", "clm", "clgt",
  "fuck", "bitch", "motherfucker", "dick", "pussy", "ass hole",
];

// ── Regex nhận dạng link ───────────────────────────────────────────────────────
const LINK_REGEX = /(?:https?:\/\/|www\.)[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/gi;

// ── Whitelist domain mặc định ─────────────────────────────────────────────────
const DEFAULT_LINK_WHITELIST = ["zalo.me", "zalo.vn", "zalovideo.com"];

function extractMsgId(raw) {
  return raw?.msgId || raw?.cliMsgId || raw?.clientMsgId || null;
}

function hasLink(text, whitelist = []) {
  const allWhitelist = [...DEFAULT_LINK_WHITELIST, ...whitelist];
  const matches = text.match(LINK_REGEX) || [];
  return matches.some(link => {
    const lower = link.toLowerCase();
    return !allWhitelist.some(w => lower.includes(w.toLowerCase()));
  });
}

function hasNsfw(text) {
  const lower = text.toLowerCase();
  return NSFW_WORDS.some(word => lower.includes(word));
}

function extractLinkCardUrl(raw) {
  const content = raw?.content;
  if (!content || typeof content !== "object") return null;
  return content.href || content.url || content.link || null;
}

function isLinkCardBlocked(raw, whitelist = []) {
  const url = extractLinkCardUrl(raw);
  if (!url) return false;
  const allWhitelist = [...DEFAULT_LINK_WHITELIST, ...whitelist];
  const lower = url.toLowerCase();
  return !allWhitelist.some(w => lower.includes(w.toLowerCase()));
}

async function tryDeleteMessage(api, raw, threadID, type) {
  try {
    const msgId   = raw?.msgId || null;
    const cliId   = raw?.cliMsgId || raw?.clientMsgId || msgId || null;
    const uidFrom = raw?.uidFrom ? String(raw.uidFrom) : "";
    if (!msgId || !cliId) return false;
    await api.deleteMessage(
      { data: { cliMsgId: cliId, msgId, uidFrom }, threadId: threadID, type },
      false
    );
    return true;
  } catch (err) {
    logWarn(`[anti] Không thể xóa tin nhắn: ${err?.message}`);
    return false;
  }
}

async function handleMessage(params) {
  const { api, event, commands, prefix } = params;

  // ── Guard: bỏ qua nếu không có data ───────────────────────────────────────
  const raw = event?.data ?? null;
  if (!raw) return;

  const threadID = event?.threadId ? String(event.threadId) : null;
  if (!threadID) return;

  const senderId = raw?.uidFrom ? String(raw.uidFrom) : null;

  // ── Guard: bỏ qua tin nhắn của chính bot (tránh self-reply loop) ───────────
  const botId = global.botId ? String(global.botId) : null;
  if (botId && senderId && senderId === botId) return;

  // ── Lưu tin nhắn vào MessageCache (phục vụ resolveQuote) ──────────────────
  try { storeMsgCache(event); } catch (_) {}

  // ── Warm cache chạy nền, không block pipeline ──────────────────────────────
  warmupFromEvent({ api, event }).catch(() => {});

  const isAdmin = senderId && isBotAdmin(senderId);

  // ── Anti features (chỉ áp dụng trong nhóm) ────────────────────────────────
  if (event.type === ThreadType.Group && senderId && !isAdmin) {
    const isGAdmin = await isGroupAdmin({ api, groupId: threadID, userId: senderId }).catch(() => false);

    if (!isGAdmin) {
      const body = extractBody(raw);
      const anti = getGroupAnti(threadID);

      // ── Anti-Spam ──────────────────────────────────────────────────────────
      if (anti.antiSpam && body) {
        const times = recordMessage(threadID, senderId);
        const windowMs = (anti.antiSpamWindow || 5) * 1000;
        const threshold = anti.antiSpamThreshold || 5;
        const now = Date.now();
        const recent = times.filter(t => t >= now - windowMs);
        if (recent.length >= threshold) {
          clearSpam(threadID, senderId);
          await api.sendMessage(
            { msg: `⚠️ @${senderId} Bạn đang gửi tin quá nhanh! Vui lòng chậm lại.`, mention: [{ uid: senderId, length: String(senderId).length + 1, offset: 3 }] },
            threadID,
            event.type
          ).catch(() => {});
        }
      }

      // ── Anti-Link ──────────────────────────────────────────────────────────
      if (anti.antiLink) {
        const whitelist = anti.antiLinkWhitelist || [];
        const linkInText = body && hasLink(body, whitelist);
        const linkInCard = isLinkCardBlocked(raw, whitelist);
        if (linkInText || linkInCard) {
          const deleted = await tryDeleteMessage(api, raw, threadID, event.type);
          const msg = deleted
            ? `🔗 Đã xóa tin nhắn có link của @${senderId}.\n⛔ Nhóm không cho phép chia sẻ link.`
            : `⛔ @${senderId} Không được phép chia sẻ link trong nhóm này!`;
          await api.sendMessage({ msg }, threadID, event.type).catch(() => {});
        }
      }

      // ── Anti-NSFW ──────────────────────────────────────────────────────────
      if (anti.antiNsfw && body) {
        if (hasNsfw(body)) {
          const deleted = await tryDeleteMessage(api, raw, threadID, event.type);
          const msg = deleted
            ? `🚫 Đã xóa tin nhắn có ngôn ngữ không phù hợp của @${senderId}.`
            : `🚫 @${senderId} Vui lòng không dùng ngôn ngữ không phù hợp trong nhóm!`;
          await api.sendMessage({ msg }, threadID, event.type).catch(() => {});
        }
      }
    }
  }

  // ── Ghi nhận tương tác cho thống kê (nhóm, không phải bot) ────────────────
  if (event.type === ThreadType.Group && senderId && senderId !== botId) {
    try {
      const rec = getTuongTacRecord();
      if (rec) rec(threadID, senderId, raw?.senderName || raw?.dName || senderId);
    } catch {}
  }

  // ── Log lệnh đến (luôn hiện senderId để debug quyền admin) ────────────────
  const body = extractBody(raw);
  if (body.startsWith(prefix)) {
    const safeCmd = body.replace(/(\.(key|token)\s+\S+\s+)(\S{6})\S+(\S{4})/gi, "$1$3...$4").slice(0, 80);
    logInfo(`[CMD] senderId=${senderId} | isAdmin=${isAdmin} | cmd=${safeCmd}`);
  }

  // ── Lắng nghe onMessage của các command ───────────────────────────────────
  try {
    await handleListen(params);
  } catch (err) {
    logError(`Lỗi handleListen: ${err?.message || err}`);
  }

  // ── Xử lý reply ────────────────────────────────────────────────────────────
  try {
    await handleReply(params);
  } catch (err) {
    logError(`Lỗi handleReply: ${err?.message || err}`);
  }

  // ── Xử lý command ──────────────────────────────────────────────────────────
  try {
    await handleCommand(params);
  } catch (err) {
    logError(`Lỗi handleCommand: ${err?.message || err}`);
  }
}

module.exports = { handleMessage };

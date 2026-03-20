const { ThreadType } = require("zca-js");
const { resolveSenderName, resolveGroupName } = require('../../includes/database/infoCache');
const { extractBody } = require('../../utils/bot/messageUtils');

async function logToConsole({ api, event }) {
  const raw = event?.data || {};

  const senderId = raw?.uidFrom ? String(raw.uidFrom) : null;

  const senderName = senderId
    ? await resolveSenderName({ api, userId: senderId, fallbackName: raw?.sender?.name })
    : "Unknown";

  const threadId = event?.threadId ? String(event.threadId) : null;
  const isGroup = Number(event?.type) === ThreadType.Group;

  let threadName = "PM";
  if (threadId && isGroup) {
    threadName = await resolveGroupName({ api, groupId: threadId, fallbackName: raw?.thread?.name });
  }

  let content = extractBody(raw).replace(/(\.(key|token)\s+\S+\s+)(\S{6})\S+(\S{4})/gi, "$1$3...$4").slice(0, 120).replace(/\n/g, " ").trim();
  if (!content && raw.content && typeof raw.content === "object") {
    const c = raw.content;
    const extra = c.url || c.normalUrl || c.href || c.fileUrl || c.title || c.action || "";
    content = `[${c.type || "media"}] ${String(extra).slice(0, 80)}`.trim();
  }

  logDebug(`[MSG] ${threadName} | ${senderName} [${senderId}]: ${content || "(no text)"}`);
}

module.exports = {
  config: {
    name: "console",
    version: "1.0.0",
    hasPermssion: 2,
    credits: "MiZai",
    description: "Log thông tin tin nhắn nhận được ra console",
    commandCategory: "System",
    usages: "console",
    cooldowns: 1
  },

  run: async ({ api, event, send }) => {
    await logToConsole({ api, event });
    await send("✅ Đã log thông tin tin nhắn hiện tại vào console.");
  },

  onMessage: async ({ api, event }) => {
    await logToConsole({ api, event });
  }
};

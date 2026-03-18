const { ThreadType } = require("zca-js");
const { resolveSenderName, resolveGroupName } = require("../../includes/database/infoCache");

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

  let content = "";
  if (typeof raw.content === "string") {
    content = raw.content.slice(0, 120).replace(/\n/g, " ").trim();
  } else if (raw.content && typeof raw.content === "object") {
    const t = raw.content.title || raw.content.href || raw.content.action || "";
    content = `[${raw.content.type || "object"}] ${String(t).slice(0, 80)}`.trim();
  }

  logInfo(`[MSG] ${threadName} | ${senderName} [${senderId}]: ${content || "(no text)"}`);
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

const { promisify } = require("util");
const { exec }     = require("child_process");
const { ThreadType } = require("zca-js");
const { resolveSenderName, resolveGroupName } = require("../../includes/database/infoCache");
const { extractBody } = require("../../utils/bot/messageUtils");

const execAsync = promisify(exec);

async function logToConsole({ api, event }) {
  const raw = event?.data || {};

  const senderId   = raw?.uidFrom ? String(raw.uidFrom) : null;
  const senderName = senderId
    ? await resolveSenderName({ api, userId: senderId, fallbackName: raw?.sender?.name })
    : "Unknown";

  const threadId = event?.threadId ? String(event.threadId) : null;
  const isGroup  = Number(event?.type) === ThreadType.Group;
  let threadName = "PM";
  if (threadId && isGroup) {
    threadName = await resolveGroupName({ api, groupId: threadId, fallbackName: raw?.thread?.name });
  }

  let content = extractBody(raw)
    .replace(/(\.(key|token)\s+\S+\s+)(\S{6})\S+(\S{4})/gi, "$1$3...$4")
    .slice(0, 120).replace(/\n/g, " ").trim();

  if (!content && raw.content && typeof raw.content === "object") {
    const c = raw.content;
    const extra = c.url || c.normalUrl || c.href || c.fileUrl || c.title || c.action || "";
    content = `[${c.type || "media"}] ${String(extra).slice(0, 80)}`.trim();
  }

  logDebug(`[MSG] ${threadName} | ${senderName} [${senderId}]: ${content || "(no text)"}`);
}

module.exports = {
  config: {
    name: "shell",
    aliases: ["console"],
    version: "1.1.0",
    hasPermssion: 2,
    credits: "Lizi / MiZai",
    description: "Chạy lệnh terminal | Log thông tin tin nhắn ra console",
    commandCategory: "Quản Trị",
    usages: ".shell <lệnh terminal> | .console (log tin nhắn hiện tại)",
    cooldowns: 5,
  },

  run: async ({ api, event, args, send, event: ev, isBotAdmin, senderId, commandName }) => {
    // ── .console — log tin nhắn hiện tại ─────────────────────────────────────
    if (commandName === "console") {
      await logToConsole({ api, event });
      return send("✅ Đã log thông tin tin nhắn hiện tại vào console.");
    }

    // ── .shell — chạy lệnh terminal ──────────────────────────────────────────
    if (!isBotAdmin(senderId)) {
      return send("❌ Chỉ admin bot mới dùng được lệnh này.");
    }

    const command = args.join(" ");
    if (!command) {
      return send("⚠️ Nhập lệnh cần chạy.\nVí dụ: .shell ls");
    }

    await send("💻 Đang chạy lệnh...");

    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 20000 });

      if (stderr) {
        return send("⚠️ STDERR:\n" + stderr.substring(0, 1900));
      }

      const result = stdout || "Không có output.";
      return send("📟 Kết quả:\n" + result.substring(0, 1900));
    } catch (error) {
      return send("❌ Lỗi:\n" + (error.message || String(error)).substring(0, 1900));
    }
  },

  // ── onMessage: log mọi tin nhắn khi console đang active ──────────────────
  onMessage: async ({ api, event }) => {
    await logToConsole({ api, event });
  },
};

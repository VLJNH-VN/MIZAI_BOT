/**
 * src/commands/lichsu.js
 * Xem lịch sử tin nhắn của user trong nhóm / toàn bot.
 *
 * Cú pháp:
 *   .lichsu                      — lịch sử 20 tin gần nhất của bạn trong nhóm này
 *   .lichsu @mention             — lịch sử của người được tag (admin)
 *   .lichsu top                  — top 10 người nói nhiều nhất trong nhóm
 *   .lichsu stats                — thống kê tổng toàn bot (admin)
 *   .lichsu tim <từ khoá>        — tìm kiếm tin nhắn có từ khoá trong nhóm
 */

const {
  getUserMessages,
  getThreadMessages,
  searchMessages,
  getTopSenders,
  getMessageStats
} = require('../../includes/database/messageLog');

const { resolveSenderName } = require('../../includes/database/infoCache');

module.exports = {
  config: {
    name           : "lichsu",
    version        : "1.0.0",
    hasPermssion   : 0,
    credits        : "Mizai",
    description    : "Xem lịch sử tin nhắn của user trong nhóm",
    commandCategory: "Tiện Ích",
    usages         : ".lichsu | .lichsu @mention | .lichsu top | .lichsu tim <từ khoá>",
    cooldowns      : 5
  },

  run: async ({ api, event, args, send }) => {
    const raw      = event?.data || {};
    const threadId = event?.threadId ? String(event.threadId) : null;
    const senderId = raw?.uidFrom ? String(raw.uidFrom) : null;
    const isGroup  = Number(event?.type) === 1;
    const isAdmin  = senderId && global.isBotAdmin?.(senderId);

    const sub = (args[0] || "").toLowerCase();

    // ── .lichsu top ──────────────────────────────────────────────────────────
    if (sub === "top") {
      if (!isGroup || !threadId) return send("⚠️ Lệnh này chỉ dùng được trong nhóm.");
      const topList = await getTopSenders(threadId, { limit: 10 });
      if (!topList.length) return send("📭 Chưa có dữ liệu tin nhắn nào trong nhóm này.");

      let text = "🏆 TOP 10 NGƯỜI NÓI NHIỀU NHẤT\n" + "─".repeat(30) + "\n";
      let rank = 1;
      for (const item of topList) {
        const name = await resolveSenderName(item.userId, api, threadId) || item.userId;
        text += `${rank}. ${name} — ${item.count.toLocaleString()} tin\n`;
        rank++;
      }
      return send(text.trim());
    }

    // ── .lichsu stats ────────────────────────────────────────────────────────
    if (sub === "stats") {
      if (!isAdmin) return send("⛔ Chỉ admin bot mới dùng được lệnh này.");
      const s   = await getMessageStats();
      const fmt = ts => ts ? new Date(ts).toLocaleString("vi-VN") : "N/A";
      return send(
        `📊 THỐNG KÊ TIN NHẮN TOÀN BOT\n` +
        `─────────────────────────────\n` +
        `Tổng tin nhắn: ${s.total.toLocaleString()}\n` +
        `User khác nhau: ${s.uniqueUsers.toLocaleString()}\n` +
        `Nhóm/Cuộc trò chuyện: ${s.uniqueThreads.toLocaleString()}\n` +
        `Tin đầu tiên: ${fmt(s.firstTs)}\n` +
        `Tin gần nhất: ${fmt(s.lastTs)}`
      );
    }

    // ── .lichsu tim <từ khoá> ────────────────────────────────────────────────
    if (sub === "tim") {
      const keyword = args.slice(1).join(" ").trim();
      if (!keyword) return send("⚠️ Cú pháp: .lichsu tim <từ khoá>");
      const results = await searchMessages(keyword, { threadId: threadId || undefined, limit: 10 });
      if (!results.length) return send(`🔍 Không tìm thấy tin nhắn nào có từ khoá: "${keyword}"`);

      let text = `🔍 KẾT QUẢ TÌM KIẾM: "${keyword}"\n` + "─".repeat(30) + "\n";
      for (const m of results) {
        const name = await resolveSenderName(m.userId, api, m.threadId) || m.userId;
        const time = new Date(m.ts).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
        const preview = m.content ? (m.content.length > 80 ? m.content.slice(0, 80) + "…" : m.content) : "[Đính kèm]";
        text += `▸ [${time}] ${name}:\n  ${preview}\n`;
      }
      return send(text.trim());
    }

    // ── .lichsu @mention (admin) ─────────────────────────────────────────────
    const mentionedUser = raw?.mentionUids?.[0] || null;
    if (mentionedUser) {
      if (!isAdmin) return send("⛔ Chỉ admin bot mới xem lịch sử người khác.");
      return await showHistory(api, send, String(mentionedUser), threadId, isGroup, "mention");
    }

    // ── .lichsu (bản thân) ───────────────────────────────────────────────────
    if (!senderId) return send("⚠️ Không xác định được người dùng.");
    return await showHistory(api, send, senderId, threadId, isGroup, "self");
  }
};

// ─────────────────────────────────────────────────────────────────────────────

async function showHistory(api, send, userId, threadId, isGroup, mode) {
  const LIMIT = 20;
  const msgs  = await getUserMessages(userId, {
    threadId : isGroup ? threadId : undefined,
    limit    : LIMIT,
    newestFirst: false
  });

  if (!msgs.length) {
    return send(mode === "self"
      ? "📭 Bạn chưa có tin nhắn nào được lưu."
      : "📭 Người này chưa có tin nhắn nào được lưu.");
  }

  const name    = await resolveSenderName(userId, api, threadId) || userId;
  const scope   = isGroup ? "nhóm này" : "toàn bot";
  let text      = `📋 LỊCH SỬ TIN NHẮN — ${name}\n` +
                  `Phạm vi: ${scope} | ${msgs.length} tin gần nhất\n` +
                  "─".repeat(34) + "\n";

  for (const m of msgs) {
    const time    = new Date(m.ts).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
    const content = m.content
      ? (m.content.length > 100 ? m.content.slice(0, 100) + "…" : m.content)
      : (m.attach?.length ? `[${m.attach.length} đính kèm]` : "[Không rõ]");
    text += `[${time}] ${content}\n`;
  }

  return send(text.trim());
}

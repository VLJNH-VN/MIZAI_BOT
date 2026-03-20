const { ThreadType } = require("zca-js");

module.exports = {
  config: {
    name: "forward",
    aliases: ["fw"],
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Chuyển tiếp tin nhắn được tag (quote) đến nhóm hoặc người dùng khác",
    commandCategory: "Tiện Ích",
    usages:
      "forward <threadId> (reply/tag tin nhắn cần chuyển)\n" +
      "forward me (chuyển về chat riêng với bot)",
    cooldowns: 5
  },

  run: async ({ api, event, args, send, threadID, isGroup }) => {
    const raw   = event?.data || {};
    const quote = raw?.quote || raw?.replyMsg || null;

    if (!quote) {
      return send(
        "📨 Lệnh Chuyển Tiếp Tin Nhắn\n" +
        "━━━━━━━━━━━━━━━━━━━━\n" +
        "Cách dùng: Reply/tag vào tin nhắn cần chuyển tiếp, sau đó gõ:\n\n" +
        "• .forward <threadId>\n" +
        "  Chuyển tiếp đến nhóm hoặc người dùng cụ thể\n\n" +
        "• .forward me\n" +
        "  Chuyển tiếp về chat riêng với bot\n\n" +
        "📌 Ví dụ:\n" +
        "  Reply tin nhắn → .forward 123456789\n" +
        "  Reply tin nhắn → .forward me"
      );
    }

    const targetRaw = (args[0] || "").trim();
    if (!targetRaw) {
      return send("❌ Thiếu threadId đích. Dùng: .forward <threadId> hoặc .forward me");
    }

    // Xác định targetId và loại luồng đích
    let targetId, targetType;
    if (targetRaw.toLowerCase() === "me") {
      targetId   = String(raw?.uidFrom || "");
      targetType = ThreadType.User;
      if (!targetId) return send("❌ Không xác định được người gửi.");
    } else {
      targetId   = targetRaw;
      // Heuristic: ID nhóm Zalo thường dài hơn 10 ký tự; user ID ngắn hơn
      // Nhưng không chắc chắn, nên dùng Group làm mặc định khi trong nhóm
      targetType = isGroup ? ThreadType.Group : ThreadType.User;
    }

    // Trích nội dung text từ quote
    const c       = quote.content;
    let msgText   = typeof c === "string" ? c
                  : (c?.text || c?.msg || c?.title || c?.description || "");

    const msgId   = quote.msgId || quote.globalMsgId || null;
    const msgTs   = quote.ts || quote.msgTs || quote.cliMsgId || null;

    if (!msgText && !msgId) {
      return send("❌ Không trích được nội dung từ tin nhắn được tag.");
    }

    // Nếu nội dung rỗng nhưng có msgId (media), dùng placeholder
    const forwardContent = msgText || "[Media message]";

    try {
      const payload = { message: forwardContent };

      // Đính kèm reference nếu có đủ thông tin
      if (msgId && msgTs) {
        payload.reference = {
          id        : String(msgId),
          ts        : Number(msgTs),
          logSrcType: 1,
          fwLvl     : 1
        };
      }

      const result = await api.forwardMessage(payload, [targetId], targetType);

      const successCount = result?.success?.length || 0;
      const failCount    = result?.fail?.length || 0;

      if (successCount > 0) {
        const dest = targetRaw.toLowerCase() === "me" ? "chat riêng với bot" : `ID: ${targetId}`;
        return send(`✅ Đã chuyển tiếp tin nhắn đến ${dest} thành công!`);
      } else {
        return send(`❌ Chuyển tiếp thất bại. ${failCount > 0 ? `Lỗi: ${result?.fail?.[0]?.error_code}` : ""}`);
      }
    } catch (err) {
      return send(`❌ Chuyển tiếp thất bại: ${err?.message || err}`);
    }
  }
};

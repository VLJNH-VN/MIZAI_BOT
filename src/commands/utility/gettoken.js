"use strict";

/**
 * src/commands/gettoken.js
 * Lấy token Facebook từ cookie (multi-step)
 * Credits: Dũngkon||Vtuan — converted MiZai
 */

const { registerReply } = require('../../../includes/handlers/handleReply');

const TOKEN_TYPES = {
  "1":  "350685531728",
  "2":  "256002347743983",
  "3":  "6628568379",
  "4":  "237759909591655",
  "5":  "275254692598279",
  "6":  "202805033077166",
  "7":  "200424423651082",
  "8":  "438142079694454",
  "9":  "1479723375646806",
  "10": "165907476854626",
  "11": "121876164619130",
  "12": "1174099472704185",
  "13": "436761779744620",
  "14": "522404077880990",
  "15": "184182168294603",
  "16": "173847642670370",
  "17": "1348564698517390",
  "18": "628551730674460",
};

const TOKEN_MENU =
  `Reply tin nhắn này và nhập cookie hoặc URL chứa cookie.\n` +
  `📋 Các loại token:\n` +
  `1. EAAAAU    2. EAAD      3. EAAAAAY   4. EAADYP\n` +
  `5. EAAD6V7   6. EAAC2SPKT 7. EAAGOfO   8. EAAVB\n` +
  `9. EAAC4     10. EAACW5F  11. EAAB     12. EAAQ\n` +
  `13. EAAGNO4  14. EAAH     15. EAAC     16. EAAClA\n` +
  `17. EAATK    18. EAAI7`;

module.exports = {
  config: {
    name:            "gettoken",
    version:         "1.1.0",
    hasPermssion:    0,
    credits:         "Dũngkon||Vtuan — converted MiZai",
    description:     "Lấy token Facebook từ cookie",
    commandCategory: "Tiện Ích",
    usages:          "gettoken (nhập cookie khi được hỏi)",
    cooldowns:       5,
  },

  run: async ({ api, event, send, senderId, threadID }) => {
    const sent  = await send(TOKEN_MENU);
    const msgId = sent?.message?.msgId ?? sent?.msgId ?? sent?.data?.msgId;
    if (msgId) {
      registerReply({
        messageId:   String(msgId),
        commandName: "gettoken",
        payload:     { step: 1, senderId, cookie: [] },
        ttl:         10 * 60 * 1000,
      });
    }
  },

  // ── onReply: xử lý multi-step ─────────────────────────────────────────────
  onReply: async ({ api, event, data, send }) => {
    const raw  = event?.data || {};
    const body = (typeof raw.content === "string" ? raw.content : (raw.content?.text || "")).trim();

    const { step, senderId } = data || {};

    // Chỉ người đã gọi lệnh mới được reply
    const replyerId = String(raw.ownerId || raw.fromId || "");
    if (replyerId && senderId && replyerId !== String(senderId)) return;

    // ── Step 1: nhận cookie / URL ─────────────────────────────────────────
    if (step === 1) {
      let cookies = [];
      try {
        new URL(body);
        // Là URL → tải nội dung
        const res = await global.axios.get(body, { timeout: 15000 });
        const txt = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
        cookies   = txt.split("\n").map(l => l.trim()).filter(Boolean);
      } catch {
        cookies = body.split("\n").map(l => l.trim()).filter(Boolean);
      }

      if (!cookies.length) return send("❌ Không tìm thấy cookie hợp lệ.");

      const sent  = await send(
        `✅ Đã nhận ${cookies.length} cookie.\n\n` +
        `Chọn loại token (1-18):\n` +
        `1. EAAAAU    2. EAAD      3. EAAAAAY   4. EAADYP\n` +
        `5. EAAD6V7   6. EAAC2SPKT 7. EAAGOfO   8. EAAVB\n` +
        `9. EAAC4     10. EAACW5F  11. EAAB     12. EAAQ\n` +
        `13. EAAGNO4  14. EAAH     15. EAAC     16. EAAClA\n` +
        `17. EAATK    18. EAAI7`
      );
      const msgId = sent?.message?.msgId ?? sent?.msgId ?? sent?.data?.msgId;
      if (msgId) {
        registerReply({
          messageId:   String(msgId),
          commandName: "gettoken",
          payload:     { step: 2, senderId, cookie: cookies },
          ttl:         10 * 60 * 1000,
        });
      }
      return;
    }

    // ── Step 2: nhận lựa chọn loại token ─────────────────────────────────
    if (step === 2) {
      const appId = TOKEN_TYPES[body];
      if (!appId) return send("❌ Lựa chọn không hợp lệ (1–18). Vui lòng thử lại.");

      const cookies = data.cookie || [];
      await send(`⌛ Đang lấy token cho ${cookies.length} cookie...`);

      const tokens = [];
      for (const cc of cookies) {
        try {
          const res = await global.axios.get(
            `https://apibot.sumiproject.io.vn/facebook/gettokentocookie?id=${appId}&cookie=${encodeURIComponent(cc)}&apikey=DUNGKON_2002`,
            { timeout: 20000 }
          );
          if (res.data?.access_token) tokens.push(res.data.access_token);
        } catch {}
      }

      if (!tokens.length) return send("❌ Không lấy được token nào. Kiểm tra lại cookie.");
      return send(`✅ Lấy được ${tokens.length} token:\n\n${tokens.join("\n\n")}`);
    }
  },
};

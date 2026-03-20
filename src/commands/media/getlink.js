"use strict";

/**
 * src/commands/getlink.js
 * Lấy URL download từ video, audio, ảnh được reply trong nhóm
 * Credits: Niiozic — converted MiZai
 */

module.exports = {
  config: {
    name:            "getlink",
    version:         "1.1.0",
    hasPermssion:    0,
    credits:         "Niiozic — converted MiZai",
    description:     "Lấy URL download từ video, audio, ảnh được reply",
    commandCategory: "Tiện Ích",
    usages:          "getlink (reply vào media)",
    cooldowns:       5,
  },

  run: async ({ api, event, send, threadID }) => {
    const raw = event?.data || {};

    const ctx = await global.resolveQuote({ raw, api, threadId: threadID, event });

    if (!ctx || !ctx.isMedia) {
      return send(
        "❎ Hãy reply vào một tin nhắn có ảnh, video hoặc audio!" +
        (ctx?.isText ? "\n💬 Tin nhắn được reply là text, không phải media." : "")
      );
    }

    const attachments = ctx.attach?.length > 0
      ? ctx.attach
      : [{ url: ctx.mediaUrl }];

    const urls = attachments
      .map((a, i) => {
        const url = a.url || a.normalUrl || a.hdUrl || a.href || a.fileUrl || a.downloadUrl;
        return url ? `${i + 1}. ${url}` : null;
      })
      .filter(Boolean);

    if (!urls.length) return send("❎ Không tìm thấy URL nào trong media được reply.");

    return send(
      `🔗 Có ${urls.length} tệp đính kèm:\n` +
      urls.join("\n")
    );
  },
};

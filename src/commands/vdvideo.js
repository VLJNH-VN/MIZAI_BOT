"use strict";

/**
 * src/commands/vdvideo.js
 * Gửi video gái hoặc anime ngẫu nhiên từ global.Ljzi
 *
 * Cách dùng:
 *   .vdvideo         → video gái ngẫu nhiên
 *   .vdvideo anime   → video anime ngẫu nhiên
 */

module.exports = {
  config: {
    name:            "vdvideo",
    version:         "3.0.0",
    hasPermssion:    2,
    credits:         "Bat + GPT",
    description:     "Gửi video gái hoặc anime ngẫu nhiên",
    commandCategory: "Giải Trí",
    usages:          "vdvideo [anime]",
    cooldowns:       5,
  },

  run: async ({ api, event, send }) => {
    const body    = (event.body || "").toLowerCase().trim();
    const isAnime = body.includes("anime");
    const tipName = isAnime ? "vdani" : "vdgai";

    const list = global.Ljzi?.[tipName];
    if (!list || !list.length)
      return send("⏳ Đợi một lát nhé, video đang được chuẩn bị...");

    try {
      await global.Ljzi.send(api, event, tipName);
    } catch (err) {
      global.logWarn?.(`[vdvideo] Lỗi: ${err?.message}`);
      await send(`❌ Gửi video thất bại: ${err?.message || "Lỗi không xác định"}`);
    }
  },
};

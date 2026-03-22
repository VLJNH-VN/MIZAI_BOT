"use strict";

/**
 * src/commands/vd.js
 * Gửi video gái hoặc anime ngẫu nhiên từ global.Ljzi
 *
 * Cách dùng:
 *   .vd         → video gái ngẫu nhiên
 *   .vd anime   → video anime ngẫu nhiên
 */

module.exports = {
  config: {
    name:            "vd",
    version:         "3.0.0",
    hasPermssion:    2,
    credits:         "Ljzi",
    description:     "Gửi video gái hoặc anime ngẫu nhiên",
    commandCategory: "Giải Trí",
    usages:          "vd [anime]",
    cooldowns:       5,
  },

  run: async function({ api, event, send }) {
    var body    = (event.body || "").toLowerCase().trim();
    var isAnime = body.includes("anime");
    var tipName = isAnime ? "vdani" : "vdgai";

    var ljzi = global.Ljzi;
    var list  = ljzi && ljzi[tipName];
    if (!list || !list.length)
      return send("⏳ Đợi một lát nhé, video đang được chuẩn bị...");

    try {
      await ljzi.send(api, event, tipName);
    } catch (err) {
      var msg = err && err.message ? err.message : "Lỗi không xác định";
      if (global.logWarn) global.logWarn("[vd] Lỗi: " + msg);
      await send("❌ Gửi video thất bại: " + msg);
    }
  },
};

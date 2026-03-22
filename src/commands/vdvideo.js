"use strict";

/**
 * src/commands/vdvideo.js
 * Gửi video gái hoặc anime ngẫu nhiên từ global.Ljzi
 * Credits: Bat + GPT (deobfuscated & converted by MiZai)
 *
 * Cách dùng:
 *   .vdvideo         → video gái ngẫu nhiên
 *   .vdvideo anime   → video anime ngẫu nhiên
 */

module.exports = {
  config: {
    name:            "vdvideo",
    version:         "2.0.1",
    hasPermssion:    2,
    credits:         "Bat + GPT",
    description:     "Gửi video gái hoặc anime ngẫu nhiên",
    commandCategory: "Giải Trí",
    usages:          "vdvideo [anime]",
    cooldowns:       5,
  },

  run: async ({ api, event }) => {
    const send = (msg) => new Promise(resolve =>
      api.sendMessage(msg, event.threadId, (err, res) => resolve(res || err), event.type)
    );

    const body = (event.body || "").toLowerCase().trim();
    const isAnime = body.includes("anime");

    const list    = isAnime ? global.Ljzi?.vdani : global.Ljzi?.vdgai;
    const tipName = isAnime ? "vdani" : "vdgai";

    if (!list || !list.length)
      return send("⏳ Đợi một lát nhé, video đang được chuẩn bị...");

    const videoUrl = list.splice(0, 1)[0];
    if (!videoUrl)
      return send("❌ Lỗi video, thử lại sau!");

    return send({ body: `🎬 Gửi video từ nhóm **${tipName}**`, attachment: videoUrl });
  },
};

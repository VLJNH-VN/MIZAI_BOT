const sendVideo = require("./utils/sendVideo");
const sendVoice = require("./utils/sendVoice");

module.exports = {
  name: "test",
  run: async ({ api, event }) => {
    const cookie = global.config.COOKIE;

    // gửi video
    await sendVideo(api, event.threadID, "./video.mp4", cookie);

    // gửi voice
    await sendVoice(api, event.threadID, "./voice.mp3", cookie);
  },
};
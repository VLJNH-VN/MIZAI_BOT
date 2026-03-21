"use strict";

const uploadAttachment = require("./uploadAttachment");

/**
 * Gửi video
 */
module.exports = async function sendVideo(api, threadID, filePath, cookie) {
  try {
    const attachment_id = await uploadAttachment(filePath, cookie);

    return api.sendMessage(
      {
        msg: "📹 Video của bạn đây",
        attachments: [
          {
            type: "video",
            attachment_id,
          },
        ],
      },
      threadID
    );
  } catch (err) {
    console.error("Send video error:", err);
  }
};
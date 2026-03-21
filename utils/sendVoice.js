"use strict";

const uploadAttachment = require("./uploadAttachment");

/**
 * Gửi voice
 */
module.exports = async function sendVoice(api, threadID, filePath, cookie) {
  try {
    const attachment_id = await uploadAttachment(filePath, cookie);

    return api.sendMessage(
      {
        msg: "🎤 Voice đây",
        attachments: [
          {
            type: "audio",
            attachment_id,
          },
        ],
      },
      threadID
    );
  } catch (err) {
    console.error("Send voice error:", err);
  }
};

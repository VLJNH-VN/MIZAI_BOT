"use strict";

const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");

/**
 * Upload attachment lên Zalo
 * @param {string} filePath - đường dẫn file
 * @param {string} cookie - cookie Zalo
 * @returns {Promise<string>} attachment_id
 */
module.exports = async function uploadAttachment(filePath, cookie) {
  try {
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));

    const res = await axios.post(
      "https://chat.zalo.me/api/message/uploadAttachment",
      form,
      {
        headers: {
          ...form.getHeaders(),
          cookie: cookie,
        },
      }
    );

    if (res.data.error_code !== 0) {
      throw new Error(res.data.error_message);
    }

    return res.data.data.attachment_id;
  } catch (err) {
    console.error("Upload error:", err.message);
    throw err;
  }
};

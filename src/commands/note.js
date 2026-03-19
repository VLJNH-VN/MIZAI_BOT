const axios = require("axios");
const fs = require("fs");
const { loadCommandFromFile } = require("../../utils/system/loader");

const COMMANDS_DIR = __dirname;

module.exports = {
  config: {
    name: "note",
    version: "2.0.0",
    hasPermssion: 2,
    credits: "Ljzi",
    description: "Tải & cài lệnh từ URL vào bot",
    commandCategory: "Admin",
    usages: ".note <file.js> <url>",
    cooldowns: 3
  },

  run: async function({ args, send, senderId, registerReaction }) {
    if (!args[0]) {
      return send(
        "❌ Thiếu tên file!\n" +
        "📌 Cách dùng: .note <tên_lệnh.js> <url>\n" +
        "Ví dụ: .note ping.js https://..."
      );
    }

    const fileName = args[0].endsWith(".js") ? args[0] : `${args[0]}.js`;
    const filePath = `${COMMANDS_DIR}/${fileName}`;
    const url = args[1] || null;

    if (!url || !/^https?:\/\//.test(url)) {
      return send(
        "❌ Thiếu hoặc sai URL!\n" +
        "📌 Cách dùng: .note <tên_lệnh.js> <url>"
      );
    }

    const msg = await send(
      `[ 📝 CODE IMPORT ]\n─────────────────\n` +
      `📁 File: src/commands/${fileName}\n\n` +
      `🔗 Nguồn:\n${url}\n` +
      `─────────────────\n` +
      `📌 Thả cảm xúc để tải & ghi đè file`
    );

    const messageId = msg?.message?.msgId || msg?.msgId || msg?.data?.msgId;
    if (!messageId) return send("⚠️ Không thể đăng ký xác nhận.");

    registerReaction({
      messageId,
      commandName: "note",
      ttl: 5 * 60 * 1000,
      payload: { action: "import", fileName, filePath, url, senderId }
    });
  },

  onReaction: async function({ data, send, commands, uid }) {
    const { action, fileName, filePath, url, senderId } = data;

    if (String(uid) !== String(senderId)) return;

    if (action === "import") {
      try {
        const fetchUrl = url.includes("?raw=true") ? url : `${url}?raw=true`;
        const res = await axios.get(fetchUrl, { responseType: "text" });
        const newCode = res.data;

        if (!newCode.includes("module.exports")) {
          return send("❎ Code không đúng format command.");
        }

        fs.writeFileSync(filePath, newCode, "utf8");

        const loaded = loadCommandFromFile(filePath);
        if (loaded && commands) commands.set(loaded.name, loaded.command);

        // Backup lên GitHub
        let ghUrl = "";
        try {
          ghUrl = await global.githubUpload(filePath, `commands/${fileName}`);
        } catch (e) { /* không báo lỗi github */ }

        return send(
          `[ 📝 CODE IMPORT ]\n─────────────────\n` +
          `📁 File: src/commands/${fileName}\n` +
          `─────────────────\n` +
          `✅ Đã tải, ghi đè & reload!` +
          (ghUrl ? `\n☁️ GitHub: ${ghUrl}` : "")
        );
      } catch (err) {
        return send(`❌ Lỗi import:\n${err?.response?.data || err.message}`);
      }
    }
  }
};

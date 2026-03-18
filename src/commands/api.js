const fs   = require("fs");
const path = require("path");

const LIST_API_DIR = path.join(__dirname, "../../includes/listapi");

module.exports = {

  config: {
    name: "api",
    version: "1.2.9",
    hasPermssion: 2,
    credits: "DongDev",
    description: "Tải link vào src api",
    commandCategory: "Admin",
    usages: ".api <add|check> [tên]",
    cooldowns: 5
  },

  run: async ({ api, event, args, send, threadID, registerReaction }) => {
    try {
      const raw = event?.data || {};

      if (!fs.existsSync(LIST_API_DIR)) fs.mkdirSync(LIST_API_DIR, { recursive: true });

      switch (args[0]) {

        case "add": {
          if (args.length < 2) {
            return send("⚠️ Vui lòng nhập tên tệp\nVí dụ: .api add <tên>");
          }

          const replyMsg = raw?.msgReply;
          if (!replyMsg) {
            return send("⚠️ Hãy reply vào một tin nhắn có ảnh/file để tải lên!");
          }

          // Trong zca-js, attachments của tin reply nằm ở replyMsg.attach (mảng)
          const attachments = Array.isArray(replyMsg.attach) ? replyMsg.attach : [];
          if (attachments.length === 0) {
            return send("⚠️ Tin nhắn được reply không có ảnh/file đính kèm!");
          }

          const tip      = args[1];
          const dataPath = path.join(LIST_API_DIR, `${tip}.json`);
          if (!fs.existsSync(dataPath)) fs.writeFileSync(dataPath, "[]", "utf-8");

          const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

          for (const item of attachments) {
            const url = item.url || item.href || item.fileUrl;
            if (!url) continue;
            const res = await global.axios.get(
              `https://catbox-mnib.onrender.com/upload?url=${encodeURIComponent(url)}`
            );
            if (Array.isArray(res.data)) {
              data.push(...res.data.map(obj => obj.url));
            } else {
              data.push(res.data.url);
            }
          }

          fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), "utf-8");
          return send("☑️ Tải link lên api thành công");
        }

        case "check": {
          if (!fs.existsSync(LIST_API_DIR)) {
            return send("📂 Chưa có file nào trong thư mục api.");
          }

          const files = fs.readdirSync(LIST_API_DIR);
          if (files.length === 0) {
            return send("📂 Chưa có file nào trong thư mục api.");
          }

          const results = [];

          for (const file of files) {
            const filePath    = path.join(LIST_API_DIR, file);
            const linksArray  = JSON.parse(fs.readFileSync(filePath, "utf-8"));
            const totalLinks  = linksArray.length;
            let liveCount = 0;
            let deadCount = 0;

            await Promise.all(linksArray.map(link =>
              global.axios.head(link)
                .then(r => { r.status === 200 ? liveCount++ : deadCount++; })
                .catch(() => { deadCount++; })
            ));

            results.push(
              `File: ${file}\n📝 Total: ${totalLinks}\n✅ Live: ${liveCount}\n❎ Die: ${deadCount}`
            );
          }

          const msg = await send(
            `${results.join("\n\n")}\n\n📌 Thả cảm xúc để tiến hành lọc các link die`
          );
          const msgId = msg?.message?.msgId || msg?.msgId || msg?.data?.msgId;
          if (msgId) {
            registerReaction({
              messageId: msgId,
              commandName: "api",
              ttl: 5 * 60 * 1000,
              payload: { action: "filter_dead" }
            });
          }
          break;
        }

        default:
          return send("📝 Sử dụng:\n• .api add <tên> — reply ảnh/file để tải lên\n• .api check — kiểm tra tình trạng link");
      }
    } catch (err) {
      logError(`[api] ${err?.message || err}`);
      return send(`❎ Đã xảy ra lỗi: ${err?.message || err}`);
    }
  },

  onReaction: async ({ send, data, icon }) => {
    if (data.action !== "filter_dead") return;
    await send(`🔄 Đang lọc link die... (chức năng lọc chưa được triển khai)`);
  }

};

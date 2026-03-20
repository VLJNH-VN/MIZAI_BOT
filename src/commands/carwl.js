const axios = require("axios");
const fs = require("fs");
const path = require("path");

module.exports = {
  config: {
    name: "crawl",
    version: "2.1.0",
    hasPermssion: 2,
    credits: "L.V.Bằng | Fix by Lizi",
    description: "Crawl dữ liệu từ API",
    commandCategory: "Admin",
    usages: ".crawl <url> <amount> <field>",
    cooldowns: 5
  },

  run: async function ({ api, event, args, send }) {

    try {

      if (!event) return;

      const threadID = event.threadID || event.threadId;
      const threadType = event.type;

      if (!threadID) {
        logError("[crawl] Missing threadID");
        return;
      }

      const url = args[0];
      const amount = parseInt(args[1]);
      const field = args[2];

      if (!url || !amount || !field) {
        return send("❌ Dùng: .crawl <url> <amount> <field>");
      }

      const delay = (ms) => new Promise(r => setTimeout(r, ms));

      await api.sendMessage(
        {
          msg: `🚀 Bắt đầu crawl\n🌐 URL: ${url}\n🔢 Số request: ${amount}`
        },
        threadID,
        threadType
      );

      let results = new Set();
      let errors = 0;

      async function fetchData() {
        try {
          const res = await axios.get(url, {
            timeout: 10000,
            headers: { "User-Agent": global.userAgent }
          });
          if (res.status !== 200) return;
          const data = res.data[field];
          if (data) results.add(data);
        } catch {
          errors++;
        }
      }

      const concurrency = 5;
      let queue = [];

      for (let i = 0; i < amount; i++) {
        queue.push(fetchData());
        if (queue.length >= concurrency) {
          await Promise.all(queue);
          queue = [];
          await delay(800);
        }
      }

      await Promise.all(queue);

      const resultArray = Array.from(results);
      const cacheDir = require("path").join(process.cwd(), "includes", "cache");
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

      const fileName = `crawl_${Date.now()}.json`;
      const filePath = path.join(cacheDir, fileName);

      fs.writeFileSync(filePath, JSON.stringify(resultArray, null, 2));

      await api.sendMessage(
        {
          msg: `✅ Crawl xong\n📦 Data: ${resultArray.length}\n⚠️ Errors: ${errors}\n💾 File: cache/${fileName}`
        },
        threadID,
        threadType
      );

      try {
        const upload = await axios.post(
          "https://api.mocky.io/api/mock",
          {
            status: 200,
            content: JSON.stringify(resultArray),
            content_type: "application/json",
            charset: "UTF-8",
            secret: "bot",
            expiration: "never"
          },
          { timeout: 15000 }
        );

        if (upload?.data?.link) {
          await api.sendMessage(
            { msg: `🔗 Link kết quả:\n${upload.data.link}` },
            threadID,
            threadType
          );
        }
      } catch (err) {
        logWarn(`[crawl] Upload lỗi: ${err.message}`);
      }

    } catch (error) {

      logError(`[crawl] ${error.message}`);

      try {
        const threadID = event?.threadID || event?.threadId;
        const threadType = event?.type;
        if (threadID) {
          await api.sendMessage(
            { msg: `⚠️ Lỗi: ${error.message}` },
            threadID,
            threadType
          );
        }
      } catch {}

    }

  }
};

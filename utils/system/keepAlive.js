const axios = require("axios");

const SERVERS = [
  "https://yt-dlp-hwys.onrender.com/"
];

const INTERVAL_MS = 10 * 60 * 1000; // 10 phút

function startKeepAlive() {
  async function ping() {
    for (const url of SERVERS) {
      try {
        const res = await axios.get(url, { timeout: 15000 });
        logInfo(`[UPTIME] Ping ${url} → ${res.status}`);
      } catch (err) {
        logWarn(`[UPTIME] Ping ${url} thất bại: ${err?.message}`);
      }
    }
  }

  ping();
  setInterval(ping, INTERVAL_MS);
  logInfo(`[UPYIME] Đã khởi động, ping mỗi ${INTERVAL_MS / 60000} phút.`);
}

module.exports = { startKeepAlive };

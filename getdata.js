/**
 * getdata.js
 * Script CLI — Chạy: node getdata.js
 * Logic xử lý nằm trong utils/bot/processGaiData.js (tái sử dụng được).
 */

const { processGaiData } = require("./utils/bot/processGaiData");

processGaiData({
  sleepMs: 300000, // 5 phút giữa mỗi video khi chạy CLI (tránh block 429)
  onLog  : (msg) => console.log(msg),
}).catch(err => console.error("Lỗi:", err));

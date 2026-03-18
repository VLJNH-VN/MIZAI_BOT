/**
 * utils/system/keepAlive.js
 * Tự động ping yt-dlp API server (Render.com) mỗi 14 phút
 * để tránh server bị sleep (free tier tự tắt sau 15 phút idle).
 * Hoạt động giống UptimeRobot — duy trì server luôn sẵn sàng.
 */

"use strict";

const axios = require("axios");

const YTDLP_API_URL  = "https://yt-dlp-hwys.onrender.com";
const HEALTH_ENDPOINT = `${YTDLP_API_URL}/api/healthz`;
const PING_INTERVAL_MS = 14 * 60 * 1000;

let _timer = null;
let _failCount = 0;

async function pingServer() {
    try {
        const res = await axios.get(HEALTH_ENDPOINT, {
            timeout: 30000,
            validateStatus: () => true,
        });

        if (res.status === 200) {
            _failCount = 0;
            logInfo?.(`[KeepAlive] ✅ yt-dlp API OK (${res.status})`);
        } else {
            _failCount++;
            logWarn?.(`[KeepAlive] ⚠️  yt-dlp API trả về ${res.status} (lần ${_failCount})`);
        }
    } catch (err) {
        _failCount++;
        logWarn?.(`[KeepAlive] ❌ Ping thất bại: ${err?.message || err} (lần ${_failCount})`);
    }
}

function startKeepAlive() {
    if (_timer) return;

    logInfo?.(`[KeepAlive] Bắt đầu giữ server tỉnh — ping mỗi ${PING_INTERVAL_MS / 60000} phút.`);

    pingServer();

    _timer = setInterval(pingServer, PING_INTERVAL_MS);

    if (_timer.unref) _timer.unref();
}

function stopKeepAlive() {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
        logInfo?.("[KeepAlive] Đã dừng.");
    }
}

module.exports = { startKeepAlive, stopKeepAlive, pingServer };

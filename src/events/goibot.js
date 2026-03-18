/**
 * src/events/goibot.js
 * Khởi động module gọi bot AI (Mizai) — lắng nghe message event.
 */

const { handleGoibot } = require("../../utils/ai/goibot");

function startGoibot(api) {
    logInfo("[Goibot] Đã khởi động AI Mizai.");

    api.listener.on("message", async (event) => {
        try {
            await handleGoibot({ api, event });
        } catch (err) {
            logWarn(`[Goibot] Lỗi xử lý: ${err?.message}`);
        }
    });
}

module.exports = { startGoibot };

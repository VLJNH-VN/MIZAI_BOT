const fs   = require("fs");
const path = require("path");

const OUTPUT_PATH = path.join(__dirname, "../../includes/data/VideoCosplay.json");
const RAW_PATH    = path.join(__dirname, "../../includes/data/gai.json");

// Theo dõi tiến trình đang chạy (tránh chạy 2 lần cùng lúc)
let _running = false;

module.exports = {
  config: {
    name           : "getdat",
    aliases        : ["ket", "ketdata"],
    version        : "1.0.0",
    hasPermssion   : 2,
    credits        : "Bot",
    description    : "Xử lý danh sách link trong gai.json → lấy metadata video → lưu vào VideoCosplay.json.",
    commandCategory: "Admin",
    usages         : ".getdat | .getdat status",
    cooldowns      : 5
  },

  run: async ({ args, send }) => {
    const sub = (args[0] || "").toLowerCase();

    // ── .getdat status ────────────────────────────────────────────────────────
    if (sub === "status") {
      const raw    = (() => { try { return JSON.parse(fs.readFileSync(RAW_PATH, "utf8")); } catch { return []; } })();
      const cooked = (() => { try { return JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8")); } catch { return []; } })();
      const rawUrls    = raw.map(x => (typeof x === "string" ? x : x.url)).filter(Boolean);
      const cookedUrls = new Set(cooked.map(x => x.url));
      const pending    = rawUrls.filter(u => !cookedUrls.has(u)).length;

      return send(
        `📊 Trạng thái kho gai:\n` +
        `• Tổng link raw     : ${rawUrls.length}\n` +
        `• Đã xử lý         : ${cooked.length}\n` +
        `• Chờ xử lý        : ${pending}\n` +
        `• Đang chạy getdat : ${_running ? "✅ Đang chạy" : "❌ Không"}`
      );
    }

    // ── .getdat — chạy xử lý ─────────────────────────────────────────────────
    if (_running) {
      return send("⚠️ Tiến trình xử lý đang chạy rồi! Dùng .getdat status để xem tiến độ.");
    }

    // Kiểm tra nhanh có link cần xử lý không
    const raw    = (() => { try { return JSON.parse(fs.readFileSync(RAW_PATH, "utf8")); } catch { return []; } })();
    const cooked = (() => { try { return JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8")); } catch { return []; } })();
    const rawUrls    = raw.map(x => (typeof x === "string" ? x : x.url)).filter(Boolean);
    const cookedUrls = new Set(cooked.map(x => x.url));
    const pending    = rawUrls.filter(u => !cookedUrls.has(u));

    if (pending.length === 0) {
      return send(`✅ Không có link nào mới cần xử lý.\nKho đã có: ${cooked.length} video.`);
    }

    await send(
      `🚀 Bắt đầu xử lý ${pending.length} link mới...\n` +
      `⚠️ Không có nghỉ giữa các video (chạy lệnh, không phải CLI).\n` +
      `💬 Dùng .getdat status để theo dõi tiến độ.`
    );

    _running = true;
    const logs = [];

    // Chạy nền — không await để không block
    global.processGaiData({
      sleepMs    : 0,
      onLog      : (msg) => {
        logInfo?.(`[getdat] ${msg}`);
        logs.push(msg);
      },
      onProgress : ({ done, total, success, fail }) => {
        logInfo?.(`[getdat] Tiến độ: ${done}/${total} | ✅ ${success} | ❌ ${fail}`);
      },
    })
      .then(({ success, fail, total, saved }) => {
        _running = false;
        logInfo?.(`[getdat] ✅ Hoàn tất: ${success}/${total} | Tổng kho: ${saved}`);
      })
      .catch(err => {
        _running = false;
        logError?.(`[getdat] Lỗi: ${err?.message || err}`);
      });
  }
};

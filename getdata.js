/**
 * getdata.js
 * Script CLI — Chạy: node getdata.js [--force]
 *
 * Giải mã tất cả file media (video/ảnh/audio) đã upload lên GitHub (base64)
 * về filecache local và lưu metadata vào includes/data/dataCache.json.
 *
 * Dùng: node getdata.js           — chỉ decode entry mới
 *       node getdata.js --force   — decode lại toàn bộ
 */

// Load config vào global trước (để mediaCache.js dùng global.config)
global.config = require("./config.json");

const { processAll } = require("./utils/media/mediaCache");

const force = process.argv.includes("--force");

console.log("═══════════════════════════════════════════");
console.log("  GETDATA — Giải mã GitHub Media → Cache  ");
console.log("═══════════════════════════════════════════");
if (force) console.log("⚠️  Chế độ --force: decode lại toàn bộ\n");

processAll({
  force,
  onLog: (msg) => console.log(msg),
  onProgress: ({ done, total, success, fail }) => {
    process.stdout.write(`\r  Tiến độ: ${done}/${total} | ✅ ${success} | ❌ ${fail}   `);
    if (done === total) process.stdout.write("\n");
  },
})
  .then(({ success, fail, total, saved }) => {
    console.log("\n───────────────────────────────────────────");
    console.log(`  Kết quả: ✅ ${success} thành công | ❌ ${fail} lỗi`);
    console.log(`  Tổng cache hiện tại: ${saved} file`);
    console.log("═══════════════════════════════════════════");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Lỗi nghiêm trọng:", err.message);
    process.exit(1);
  });

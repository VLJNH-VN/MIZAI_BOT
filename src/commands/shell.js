const { exec } = require("child_process");

module.exports = {
  config: {
    name: "shell",
    version: "1.0.0",
    hasPermssion: 2,
    credits: "Lizi",
    description: "Chạy lệnh terminal",
    commandCategory: "Quản Trị",
    usages: ".shell <command>",
    cooldowns: 5
  },

  run: async ({
    args,
    send,
    event,
    isBotAdmin
  }) => {

    const senderId = String(event.data?.uidFrom || "");

    if (!isBotAdmin(senderId)) {
      return send("❌ Chỉ admin bot mới dùng được lệnh này.");
    }

    const command = args.join(" ");

    if (!command) {
      return send("⚠️ Nhập lệnh cần chạy.\nVí dụ: .shell ls");
    }

    send("💻 Đang chạy lệnh...");

    exec(command, { timeout: 20000 }, (error, stdout, stderr) => {

      if (error) {
        return send("❌ Lỗi:\n" + error.message);
      }

      if (stderr) {
        return send("⚠️ STDERR:\n" + stderr);
      }

      const result = stdout || "Không có output.";

      if (result.length > 2000) {
        return send("📄 Output quá dài.");
      }

      send("📟 Kết quả:\n" + result);

    });

  }
};
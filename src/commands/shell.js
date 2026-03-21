const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);

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

  run: async ({ args, send, event, isBotAdmin }) => {
    const senderId = String(event.data?.uidFrom || "");

    if (!isBotAdmin(senderId)) {
      return send("❌ Chỉ admin bot mới dùng được lệnh này.");
    }

    const command = args.join(" ");
    if (!command) {
      return send("⚠️ Nhập lệnh cần chạy.\nVí dụ: .shell ls");
    }

    await send("💻 Đang chạy lệnh...");

    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 20000 });

      if (stderr) {
        return send("⚠️ STDERR:\n" + stderr.substring(0, 1900));
      }

      const result = stdout || "Không có output.";
      return send("📟 Kết quả:\n" + result.substring(0, 1900));
    } catch (error) {
      return send("❌ Lỗi:\n" + (error.message || String(error)).substring(0, 1900));
    }
  }
};
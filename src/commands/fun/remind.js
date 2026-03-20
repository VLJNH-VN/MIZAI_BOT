const { ThreadType } = require("zca-js");

// ReminderRepeatMode: None=0, Daily=1, Weekly=2, Monthly=3
const REPEAT_MODE = { "khong": 0, "none": 0, "ngay": 1, "daily": 1, "tuan": 2, "weekly": 2, "thang": 3, "monthly": 3 };

function parseDateTime(str) {
  // Định dạng: HH:MM DD/MM/YYYY hoặc HH:MM DD/MM hoặc HH:MM
  const now = new Date();
  const patterns = [
    // HH:MM DD/MM/YYYY
    { re: /^(\d{1,2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/, fn: (m) => new Date(+m[5], +m[4]-1, +m[3], +m[1], +m[2]) },
    // HH:MM DD/MM
    { re: /^(\d{1,2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})$/, fn: (m) => new Date(now.getFullYear(), +m[4]-1, +m[3], +m[1], +m[2]) },
    // HH:MM (hôm nay)
    { re: /^(\d{1,2}):(\d{2})$/, fn: (m) => { const d = new Date(); d.setHours(+m[1], +m[2], 0, 0); return d; } }
  ];
  for (const { re, fn } of patterns) {
    const m = str.match(re);
    if (m) return fn(m);
  }
  return null;
}

function formatDateTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
}

function repeatLabel(mode) {
  return ["Không lặp","Mỗi ngày","Mỗi tuần","Mỗi tháng"][mode] || "Không lặp";
}

module.exports = {
  config: {
    name: "remind",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Tạo và xem nhắc nhở trong nhóm hoặc chat riêng",
    commandCategory: "Tiện Ích",
    usages:
      "remind tao <tiêu đề> | <HH:MM DD/MM/YYYY> [lap: ngay/tuan/thang]\n" +
      "remind ds",
    cooldowns: 5
  },

  run: async ({ api, event, args, send, isGroup, threadID }) => {
    const sub = (args[0] || "").toLowerCase();
    const type = isGroup ? ThreadType.Group : ThreadType.User;

    if (!sub) {
      return send(
        "⏰ Lệnh Nhắc Nhở\n" +
        "━━━━━━━━━━━━━━━━━━━━\n" +
        "• .remind tao <tiêu đề> | <HH:MM DD/MM/YYYY> [lap: ngay|tuan|thang]\n" +
        "  Tạo nhắc nhở mới\n\n" +
        "• .remind ds\n" +
        "  Xem danh sách nhắc nhở hiện tại\n\n" +
        "📌 Ví dụ:\n" +
        "  .remind tao Họp nhóm | 09:00 25/12/2025\n" +
        "  .remind tao Uống nước | 08:00 lap: ngay\n" +
        "  .remind tao Nộp báo cáo | 17:00 30/01"
      );
    }

    // ── Tạo nhắc nhở ──────────────────────────────────────────────────────────
    if (sub === "tao") {
      const rest = args.slice(1).join(" ");
      if (!rest) return send("❌ Thiếu nội dung. Dùng: .remind tao <tiêu đề> | <HH:MM DD/MM/YYYY>");

      // Tách tiêu đề và phần thời gian
      const pipeIdx = rest.indexOf("|");
      if (pipeIdx === -1) return send("❌ Thiếu ký tự | để tách tiêu đề và thời gian.\nVí dụ: .remind tao Họp nhóm | 09:00 25/12/2025");

      const title   = rest.slice(0, pipeIdx).trim();
      let   timeStr = rest.slice(pipeIdx + 1).trim();
      if (!title)   return send("❌ Tiêu đề không được để trống.");

      // Phát hiện lặp
      let repeat = 0;
      const lapMatch = timeStr.match(/lap\s*:\s*(\w+)/i);
      if (lapMatch) {
        const key = lapMatch[1].toLowerCase();
        repeat  = REPEAT_MODE[key] ?? 0;
        timeStr = timeStr.replace(lapMatch[0], "").trim();
      }

      // Chỉ có giờ:phút (không có ngày) → nếu không có timeStr còn lại, dùng ngay
      const dateTime = parseDateTime(timeStr);
      if (!dateTime || isNaN(dateTime.getTime())) {
        return send(
          "❌ Định dạng thời gian không hợp lệ.\n" +
          "Dùng: HH:MM DD/MM/YYYY hoặc HH:MM DD/MM hoặc HH:MM"
        );
      }

      if (dateTime.getTime() < Date.now()) {
        return send("❌ Thời gian nhắc nhở phải ở tương lai.");
      }

      try {
        await api.createReminder(
          { title, startTime: dateTime.getTime(), repeat },
          threadID,
          type
        );

        return send(
          `✅ Đã tạo nhắc nhở!\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📌 Tiêu đề : ${title}\n` +
          `⏰ Thời gian: ${formatDateTime(dateTime.getTime())}\n` +
          `🔁 Lặp lại : ${repeatLabel(repeat)}`
        );
      } catch (err) {
        return send(`❌ Tạo nhắc nhở thất bại: ${err?.message || err}`);
      }
    }

    // ── Danh sách nhắc nhở ────────────────────────────────────────────────────
    if (sub === "ds" || sub === "danhsach" || sub === "list") {
      try {
        const list = await api.getListReminder({ page: 1, count: 10 }, threadID, type);

        if (!list || list.length === 0) {
          return send("📭 Không có nhắc nhở nào.");
        }

        const lines = list.map((r, i) => {
          const ts  = r.startTime || r.start_time || 0;
          const rep = repeatLabel(r.repeat || 0);
          return `${i + 1}. 📌 ${r.title}\n   ⏰ ${ts ? formatDateTime(ts) : "Không rõ"} | 🔁 ${rep}`;
        });

        return send(
          `⏰ Danh Sách Nhắc Nhở (${list.length})\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          lines.join("\n\n")
        );
      } catch (err) {
        return send(`❌ Không lấy được danh sách: ${err?.message || err}`);
      }
    }

    return send("❓ Sub-command không hợp lệ. Gõ .remind để xem hướng dẫn.");
  }
};

"use strict";

/**
 * cmd: tempmail
 * Tạo và quản lý email tạm thời qua temp-mail.org (api.internal.temp-mail.io)
 *
 * Cách dùng:
 *   .tempmail              → tạo email mới
 *   .tempmail new          → tạo email mới (alias)
 *   .tempmail check        → kiểm tra hộp thư
 *   .tempmail read <số>    → đọc nội dung email thứ <số>
 *   .tempmail del          → xoá email hiện tại
 */

const axios = require("axios");

const BASE = "https://api.internal.temp-mail.io/api/v3";
const HEADERS = { "Content-Type": "application/json" };

const sessions = new Map();

function getSession(uid) {
  return sessions.get(String(uid)) || null;
}

function setSession(uid, data) {
  sessions.set(String(uid), data);
}

function clearSession(uid) {
  sessions.delete(String(uid));
}

async function createEmail() {
  const res = await axios.post(`${BASE}/email/new`, {}, { headers: HEADERS, timeout: 10000 });
  return res.data;
}

async function getMessages(email) {
  const res = await axios.get(`${BASE}/email/${email}/messages`, { timeout: 10000 });
  return Array.isArray(res.data) ? res.data : [];
}

async function deleteEmail(token) {
  await axios.delete(`${BASE}/email/${token}`, { timeout: 10000 });
}

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 800);
}

module.exports = {
  config: {
    name: "mail",
    aliases: ["tempmail"],
    version: "1.0.0",
    hasPermssion: 0,
    credits: "Ljzi",
    description: "Tạo & quản lý email tạm thời (temp-mail.org)",
    commandCategory: "Tiện Ích",
    usages: ".tempmail | .tempmail check | .tempmail read <số> | .tempmail del",
    cooldowns: 5,
  },

  run: async ({ args, send, senderId }) => {
    const FLAG_MAP = { "-n": "new", "-c": "check", "-r": "read", "-d": "del" };
    const sub = FLAG_MAP[args[0]] || (args[0] || "").toLowerCase();

    if (!sub || sub === "new") {
      await send("⏳ Đang tạo email tạm thời...");
      try {
        const data = await createEmail();
        setSession(senderId, { email: data.email, token: data.token, createdAt: Date.now() });
        return send(
          `[ 📧 TEMP MAIL ]\n` +
          `─────────────────\n` +
          `✅ Email của bạn:\n${data.email}\n\n` +
          `📌 Lệnh:\n` +
          `• .tempmail check — kiểm tra thư\n` +
          `• .tempmail read <số> — đọc thư\n` +
          `• .tempmail del — xoá email\n` +
          `─────────────────\n` +
          `⚠️ Email chỉ tồn tại trong phiên bot chạy.`
        );
      } catch (err) {
        logError?.(`[tempmail] Tạo email lỗi: ${err?.message}`);
        return send(`❌ Không thể tạo email: ${err?.message || "lỗi không xác định"}`);
      }
    }

    if (sub === "check") {
      const session = getSession(senderId);
      if (!session) {
        return send('⚠️ Bạn chưa có email. Dùng ".tempmail" để tạo.');
      }

      await send(`⏳ Đang kiểm tra hộp thư...\n📧 ${session.email}`);
      try {
        const messages = await getMessages(session.email);
        if (!messages.length) {
          return send(
            `[ 📬 HỘP THƯ ]\n` +
            `─────────────────\n` +
            `📧 ${session.email}\n\n` +
            `📭 Chưa có thư nào.\n` +
            `─────────────────\n` +
            `Thử lại sau vài giây nếu vừa đăng ký.`
          );
        }

        const list = messages.slice(0, 10).map((m, i) => {
          const from = m.from || "Không rõ";
          const subject = m.subject || "(Không có tiêu đề)";
          const date = m.created_at
            ? new Date(m.created_at * 1000).toLocaleString("vi-VN")
            : "";
          return `${i + 1}. 📩 ${subject}\n   Từ: ${from}${date ? `\n   ${date}` : ""}`;
        }).join("\n\n");

        return send(
          `[ 📬 HỘP THƯ ]\n` +
          `─────────────────\n` +
          `📧 ${session.email}\n` +
          `📨 ${messages.length} thư\n\n` +
          `${list}\n` +
          `─────────────────\n` +
          `Dùng ".tempmail read <số>" để đọc thư.`
        );
      } catch (err) {
        logError?.(`[tempmail] Check lỗi: ${err?.message}`);
        return send(`❌ Không thể kiểm tra thư: ${err?.message || "lỗi không xác định"}`);
      }
    }

    if (sub === "read") {
      const session = getSession(senderId);
      if (!session) {
        return send('⚠️ Bạn chưa có email. Dùng ".tempmail" để tạo.');
      }

      const idx = parseInt(args[1], 10);
      if (!args[1] || isNaN(idx) || idx < 1) {
        return send('❓ Cú pháp: .tempmail read <số>\nVD: .tempmail read 1');
      }

      await send("⏳ Đang tải nội dung thư...");
      try {
        const messages = await getMessages(session.email);
        if (!messages.length) {
          return send("📭 Hộp thư trống.");
        }
        if (idx > messages.length) {
          return send(`❌ Chỉ có ${messages.length} thư. Nhập số từ 1–${messages.length}.`);
        }

        const m = messages[idx - 1];
        const from = m.from || "Không rõ";
        const subject = m.subject || "(Không có tiêu đề)";
        const date = m.created_at
          ? new Date(m.created_at * 1000).toLocaleString("vi-VN")
          : "";
        const body = stripHtml(m.body_html || m.body_text || m.text || "");

        return send(
          `[ 📩 THƯ #${idx} ]\n` +
          `─────────────────\n` +
          `📧 Đến: ${session.email}\n` +
          `👤 Từ: ${from}\n` +
          `📌 Tiêu đề: ${subject}\n` +
          (date ? `🕐 ${date}\n` : "") +
          `─────────────────\n` +
          `${body || "(Nội dung trống)"}` +
          (body.length >= 800 ? "\n...(nội dung quá dài, đã cắt bớt)" : "")
        );
      } catch (err) {
        logError?.(`[tempmail] Read lỗi: ${err?.message}`);
        return send(`❌ Không thể đọc thư: ${err?.message || "lỗi không xác định"}`);
      }
    }

    if (sub === "del" || sub === "delete" || sub === "xoa") {
      const session = getSession(senderId);
      if (!session) {
        return send("⚠️ Bạn không có email nào đang dùng.");
      }

      try {
        await deleteEmail(session.token);
      } catch (_) {}

      clearSession(senderId);
      return send(
        `[ 🗑️ ĐÃ XOÁ ]\n` +
        `─────────────────\n` +
        `✅ Đã xoá email: ${session.email}\n\n` +
        `Dùng ".tempmail" để tạo email mới.`
      );
    }

    return send(
      `[ 📧 TEMP MAIL ]\n` +
      `─────────────────\n` +
      `Cách dùng:\n` +
      `• .tempmail — tạo email mới\n` +
      `• .tempmail check — kiểm tra hộp thư\n` +
      `• .tempmail read <số> — đọc thư\n` +
      `• .tempmail del — xoá email`
    );
  },
};

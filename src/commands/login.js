"use strict";

const fs   = require("fs");
const path = require("path");
const { Zalo }       = require("zca-js");
const { imageSize }  = require("image-size");
const {
  looksLikeZaloImei,
  generateImei,
  persistImeiToConfig,
  saveCookieFile,
} = require("../../utils/system/client");
const {
  isActive, enableAccount, disableAccount,
  connectExtraAccount, disconnectExtraAccount,
  ACCOUNTS_DIR,
} = require("../../utils/system/multiAccount");
const { readConfig } = require("../../utils/media/helpers");

const QR_TIMEOUT_MS = 5 * 60 * 1000;

function cleanCookies(raw) {
  const arr = Array.isArray(raw) ? raw : (raw?.cookies || []);
  return arr.map(c => ({
    key:      c.key || c.name || "",
    value:    String(c.value ?? ""),
    domain:   c.domain   || ".zalo.me",
    path:     c.path     || "/",
    secure:   c.secure   ?? true,
    httpOnly: c.httpOnly ?? true,
  })).filter(c => c.key && c.value);
}

function cookieToString(cleaned) {
  return cleaned.map(c => `${c.key}=${c.value}`).join("; ");
}

function ensureAccountsDir() {
  if (!fs.existsSync(ACCOUNTS_DIR)) fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
}

function listAccounts() {
  ensureAccountsDir();
  return fs.readdirSync(ACCOUNTS_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      const cookiePath = path.join(ACCOUNTS_DIR, f);
      return { name: f.replace(".json", ""), active: isActive(cookiePath), cookiePath };
    });
}

module.exports = {
  config: {
    name:            "login",
    version:         "1.1.0",
    hasPermssion:    2,
    credits:         "MiZai",
    description:     "Đăng nhập Zalo qua QR, đổi/lưu/chạy đồng thời nhiều tài khoản",
    commandCategory: "Quản Trị",
    usages: [
      "login               — Gửi QR đổi tài khoản chính",
      "login save <tên>    — Đăng nhập + lưu tài khoản",
      "login use <tên>     — Chuyển sang tài khoản (restart)",
      "login active <tên>  — Bật tài khoản chạy đồng thời",
      "login inactive <tên>— Tắt tài khoản chạy đồng thời",
      "login list          — Xem danh sách + trạng thái",
      "login del <tên>     — Xóa tài khoản đã lưu",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ api, event, args, send, threadID }) => {
    const sub  = (args[0] || "").toLowerCase().trim();
    const name = (args[1] || "").trim().replace(/[^a-zA-Z0-9_\-]/g, "");

    ensureAccountsDir();

    // ── list ──────────────────────────────────────────────────────────────────
    if (sub === "list") {
      const accounts = listAccounts();
      if (!accounts.length) {
        return send(
          `📭 Chưa có tài khoản nào được lưu.\n` +
          `💡 Dùng: login save <tên>  để đăng nhập và lưu tài khoản.`
        );
      }
      const lines = accounts.map((a, i) =>
        `  ${i + 1}. ${a.name}  ${a.active ? "🟢 đang chạy" : "⚫ không chạy"}`
      );
      return send(
        `📋 Danh sách tài khoản (${accounts.length}):\n` +
        lines.join("\n") + "\n\n" +
        `🟢 Bật đồng thời: login active <tên>\n` +
        `⚫ Tắt:           login inactive <tên>\n` +
        `🔀 Chuyển chính:  login use <tên>`
      );
    }

    // ── del ───────────────────────────────────────────────────────────────────
    if (sub === "del" || sub === "delete") {
      if (!name) return send("❌ Nhập tên tài khoản cần xóa.\nVí dụ: login del acc1");
      const filePath = path.join(ACCOUNTS_DIR, `${name}.json`);
      if (!fs.existsSync(filePath)) return send(`❌ Không tìm thấy tài khoản "${name}".`);
      disableAccount(filePath);
      disconnectExtraAccount(name);
      fs.unlinkSync(filePath);
      return send(`🗑️ Đã xóa tài khoản "${name}" thành công.`);
    }

    // ── use / switch ──────────────────────────────────────────────────────────
    if (sub === "use" || sub === "switch") {
      if (!name) return send("❌ Nhập tên tài khoản muốn dùng.\nVí dụ: login use acc1");
      const filePath = path.join(ACCOUNTS_DIR, `${name}.json`);
      if (!fs.existsSync(filePath)) return send(`❌ Không tìm thấy tài khoản "${name}".`);
      const cfg = readConfig();
      const cookiePath = path.join(process.cwd(), cfg.cookiePath || "./cookie.json");
      fs.copyFileSync(filePath, cookiePath);
      await send(`✅ Đã chuyển sang tài khoản "${name}"!\n🔄 Bot đang restart...`);
      setTimeout(() => global.restartBot?.(`Chuyển tài khoản → ${name}`, 2000), 500);
      return;
    }

    // ── active (bật chạy đồng thời) ──────────────────────────────────────────
    if (sub === "active") {
      if (!name) return send("❌ Nhập tên tài khoản muốn bật.\nVí dụ: login active acc1");
      const filePath = path.join(ACCOUNTS_DIR, `${name}.json`);
      if (!fs.existsSync(filePath)) return send(`❌ Không tìm thấy tài khoản "${name}".`);
      if (isActive(filePath)) return send(`✅ Tài khoản "${name}" đã đang chạy rồi.`);
      enableAccount(filePath);
      await send(`🔄 Đang kết nối tài khoản "${name}"...`);
      const ok = await connectExtraAccount(filePath);
      if (ok) return send(`🟢 Tài khoản "${name}" đã kết nối và đang chạy đồng thời!`);
      return send(`❌ Không thể kết nối tài khoản "${name}". Kiểm tra cookie còn hạn không.`);
    }

    // ── inactive (tắt chạy đồng thời) ────────────────────────────────────────
    if (sub === "inactive") {
      if (!name) return send("❌ Nhập tên tài khoản muốn tắt.\nVí dụ: login inactive acc1");
      const filePath = path.join(ACCOUNTS_DIR, `${name}.json`);
      if (!fs.existsSync(filePath)) return send(`❌ Không tìm thấy tài khoản "${name}".`);
      disableAccount(filePath);
      disconnectExtraAccount(name);
      return send(`⚫ Đã tắt tài khoản "${name}" khỏi chế độ đồng thời.`);
    }

    // ── login / login save <tên> ──────────────────────────────────────────────
    const saveName = (sub === "save" && name) ? name : null;
    if (sub === "save" && !name) return send("❌ Nhập tên tài khoản muốn lưu.\nVí dụ: login save acc1");

    const cfg        = readConfig();
    const userAgent  = (cfg.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64)").trim();
    const qrPath     = path.join(process.cwd(), cfg.qrPath || "./qr.png");
    const cookiePath = path.join(process.cwd(), cfg.cookiePath || "./cookie.json");
    const imei       = looksLikeZaloImei(cfg.imei) ? cfg.imei : generateImei(userAgent);

    await send(
      `🔐 Đang tạo mã QR đăng nhập Zalo...\n` +
      `⏳ Vui lòng chờ trong giây lát.`
    );

    let loginDone = false;

    const timer = setTimeout(async () => {
      if (!loginDone) {
        await send("⏰ Hết thời gian chờ QR (5 phút). Vui lòng thử lại.").catch(() => {});
      }
    }, QR_TIMEOUT_MS);

    try {
      const zalo = new Zalo({
        selfListen:  true,
        checkUpdate: false,
        logging:     false,
        imageMetadataGetter: async (fp) => {
          const buf  = await fs.promises.readFile(fp);
          const dim  = imageSize(buf);
          const stat = await fs.promises.stat(fp);
          return { width: dim?.width, height: dim?.height, size: stat?.size ?? buf.length };
        },
      });

      zalo.loginQR({ userAgent, qrPath }, async (qrEvent) => {
        const { type, data, actions } = qrEvent;

        if (type === 0) {
          await actions.saveToFile(qrPath);
          try {
            await api.sendMessage(
              {
                msg:
                  `📱 Quét mã QR để đăng nhập Zalo` +
                  (saveName ? ` (lưu thành "${saveName}")` : "") + `:\n` +
                  `📌 Zalo → Cá nhân → Đăng nhập thiết bị khác → Quét mã\n` +
                  `⏱️ Mã hết hạn sau ~60 giây`,
                attachments: [qrPath],
              },
              threadID,
              event.type
            );
          } catch {}
        } else if (type === 1) {
          actions.retry();
          await send("🔄 Mã QR đã hết hạn, đang tạo mã mới...").catch(() => {});
        } else if (type === 2) {
          await send("✅ Đã quét mã QR!\n📲 Vui lòng xác nhận trên điện thoại...").catch(() => {});
        } else if (type === 3) {
          await send("❌ Đăng nhập bị từ chối. Đang thử lại...").catch(() => {});
          actions.retry();
        } else if (type === 4) {
          clearTimeout(timer);
          loginDone = true;

          if (data?.cookie) {
            const cleaned  = cleanCookies(data.cookie);
            const newImei  = data.imei || imei;
            persistImeiToConfig(newImei);

            // Lưu dạng "key=value; key=value" (dễ copy-paste)
            const cookieStr = cookieToString(cleaned);

            if (saveName) {
              const savePath = path.join(ACCOUNTS_DIR, `${saveName}.json`);
              fs.writeFileSync(savePath, JSON.stringify(cookieStr, null, 2), "utf-8");
            }

            // Ghi đè cookie chính
            fs.writeFileSync(cookiePath, JSON.stringify(cookieStr, null, 2), "utf-8");

            const msg = saveName
              ? `✅ Đăng nhập thành công!\n💾 Đã lưu tài khoản "${saveName}".\n🔄 Bot đang restart...`
              : `✅ Đăng nhập thành công!\n🔄 Bot đang restart với tài khoản mới...`;

            await send(msg).catch(() => {});
            setTimeout(() => global.restartBot?.("Đổi tài khoản qua lệnh login", 2000), 500);
          }
        }
      }).catch(async (err) => {
        clearTimeout(timer);
        if (!loginDone) {
          await send(`❌ Lỗi đăng nhập: ${err?.message || err}`).catch(() => {});
        }
      });
    } catch (err) {
      clearTimeout(timer);
      await send(`❌ Lỗi khởi tạo: ${err?.message || err}`).catch(() => {});
    }
  },
};

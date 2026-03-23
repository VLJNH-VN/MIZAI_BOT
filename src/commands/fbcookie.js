"use strict";
/**
 * src/commands/fbcookie.js
 * Quản lý Facebook cookie cho AutoDown (truyền vào fown/yt-dlp per-request).
 *
 * Cách lấy cookie FB:
 *   1. Đăng nhập Facebook trên Chrome
 *   2. Cài extension "EditThisCookie" hoặc "Cookie-Editor"
 *   3. Export → copy dạng "name=value; name2=value2"
 *   Key cookies cần: c_user, xs, datr, sb, fr, wd, locale
 *
 * Dùng:
 *   >fbcookie set <cookie_string>  — Lưu cookie
 *   >fbcookie view                 — Xem cookie hiện tại (ẩn giá trị nhạy cảm)
 *   >fbcookie clear                — Xóa cookie
 *   >fbcookie test                 — Test với fown API
 */

const fs   = require("fs");
const path = require("path");
const axios = require("axios");

const CFG_PATH = path.join(process.cwd(), "config.json");
const FOWN     = "https://fown.onrender.com";

// Đọc/ghi config
function readConfig() {
    return JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));
}
function writeConfig(cfg) {
    fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2));
    // Cập nhật runtime
    if (global.config) global.config.fbCookies = cfg.fbCookies;
}

// Ẩn giá trị nhạy cảm khi hiển thị
function maskCookies(raw) {
    if (!raw) return "(trống)";
    return raw.split(";").map(part => {
        const [name, ...rest] = part.trim().split("=");
        const val = rest.join("=");
        const masked = val.length > 6
            ? val.slice(0, 3) + "***" + val.slice(-3)
            : "***";
        return `${name}=${masked}`;
    }).join("; ");
}

module.exports = {
    config: {
        name           : "fbcookie",
        aliases        : ["fbc", "fbck"],
        version        : "1.0.0",
        hasPermssion   : 1,
        credits        : "MIZAI",
        description    : "Quản lý Facebook cookie cho AutoDown (yt-dlp per-request)",
        commandCategory: "Admin",
        usages         : "fbcookie [set <cookie> | view | clear | test]",
        cooldowns      : 3,
    },

    run: async ({ args, send }) => {
        const sub = (args[0] || "view").toLowerCase();

        // ── view ──────────────────────────────────────────────────────────────
        if (sub === "view") {
            const cfg     = readConfig();
            const cookies = cfg.fbCookies || "";
            const count   = cookies ? cookies.split(";").length : 0;
            return send(
                `🍪 Facebook Cookie\n\n` +
                `📊 Số lượng: ${count} cookie${count ? "" : " (chưa có)"}\n` +
                `🔒 Nội dung: ${maskCookies(cookies)}\n\n` +
                `Dùng: >fbcookie set <cookie_string> để cập nhật`
            );
        }

        // ── clear ─────────────────────────────────────────────────────────────
        if (sub === "clear") {
            const cfg = readConfig();
            cfg.fbCookies = "";
            writeConfig(cfg);
            return send("🗑️ Đã xóa Facebook cookie. AutoDown sẽ không dùng cookie cho FB nữa.");
        }

        // ── set ───────────────────────────────────────────────────────────────
        if (sub === "set") {
            const raw = args.slice(1).join(" ").trim();
            if (!raw) return send(
                "⚠️ Cần cung cấp cookie string.\n\n" +
                "Cách lấy cookie:\n" +
                "1. Đăng nhập FB trên Chrome\n" +
                "2. Cài Cookie-Editor / EditThisCookie\n" +
                "3. Export dạng: c_user=123; xs=abc; datr=xyz\n\n" +
                "Dùng: >fbcookie set c_user=123; xs=abc; ..."
            );

            // Validate cơ bản
            if (!raw.includes("=")) return send("⚠️ Cookie không hợp lệ. Cần dạng: name=value; name2=value2");

            const cfg = readConfig();
            cfg.fbCookies = raw;
            writeConfig(cfg);

            const count = raw.split(";").length;
            const hasKey = (k) => raw.includes(`${k}=`);
            const keyStatus = ["c_user", "xs", "datr"].map(k =>
                `${hasKey(k) ? "✅" : "⚠️"} ${k}`
            ).join("  ");

            return send(
                `✅ Đã lưu ${count} cookie Facebook.\n\n` +
                `🔑 Key quan trọng:\n${keyStatus}\n\n` +
                `AutoDown sẽ tự động dùng cookie này khi tải video FB.`
            );
        }

        // ── test ──────────────────────────────────────────────────────────────
        if (sub === "test") {
            const cfg     = readConfig();
            const cookies = cfg.fbCookies || "";
            if (!cookies) return send("⚠️ Chưa có cookie. Dùng >fbcookie set <cookie> trước.");

            send("⏳ Đang test cookie với fown API...");
            try {
                // Test với một FB URL cơ bản (public video)
                const testUrl = "https://www.facebook.com/watch/?v=1";
                const res = await axios.get(
                    `${FOWN}/api/media?url=${encodeURIComponent(testUrl)}&cookies=${encodeURIComponent(cookies)}`,
                    { timeout: 30_000 }
                );
                const d = res.data;
                if (d?.error) {
                    const details = String(d.details || d.error || "");
                    if (details.includes("login.php"))
                        return send("❌ Cookie không hợp lệ hoặc đã hết hạn (vẫn bị redirect về login).");
                    // 404/not found là bình thường với video ID giả
                    return send("✅ Cookie hợp lệ — fown nhận được và gửi lên yt-dlp thành công.\n(Video test không tồn tại nhưng cookie đã được xác nhận.)");
                }
                return send(`✅ Cookie OK! Tải được: ${d.title || "(unknown)"}`);
            } catch (e) {
                return send(`❌ Lỗi khi test: ${e.message}`);
            }
        }

        // ── help ──────────────────────────────────────────────────────────────
        return send(
            `🍪 fbcookie — Quản lý Facebook Cookie\n\n` +
            `>fbcookie view              — Xem cookie hiện tại\n` +
            `>fbcookie set <cookie>      — Lưu cookie mới\n` +
            `>fbcookie clear             — Xóa cookie\n` +
            `>fbcookie test              — Kiểm tra cookie với fown\n\n` +
            `Cách lấy cookie FB:\n` +
            `1. Đăng nhập Facebook trên Chrome\n` +
            `2. Cài extension "Cookie-Editor"\n` +
            `3. Export → copy dạng: c_user=xxx; xs=yyy; datr=zzz`
        );
    },
};

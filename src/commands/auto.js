/**
 * src/commands/auto.js
 * Quản lý AutoSend + Bật/tắt Mizai AI (auto bot) + AutoDown per-nhóm
 */

const fs   = require("fs");
const path = require("path");
const { ThreadType } = require("zca-js");
const { setEnabled, isEnabled } = require('../../utils/ai/goibot');
const { setSetting, getSetting } = require('../../includes/database/group/groupSettings');

const AUTOSEND_FILE = path.join(process.cwd(), "includes", "data", "config", "autoSend.json");
const AUTO_JSON     = path.join(process.cwd(), "includes", "data", "config", "auto.json");

// ─── One-time migration: auto.json → groups.settings ─────────────────────────
(function _migrateAutoJson() {
    try {
        if (!fs.existsSync(AUTO_JSON)) return;
        const raw = JSON.parse(fs.readFileSync(AUTO_JSON, "utf-8"));
        for (const [gid, cfg] of Object.entries(raw)) {
            if (cfg && typeof cfg.autodown === "boolean") {
                setSetting(String(gid), "autodown", cfg.autodown).catch(() => {});
            }
        }
    } catch {}
})();

// ─── AutoSend helpers ────────────────────────────────────────────────────────
function readAutoSend() {
    try {
        if (!fs.existsSync(AUTOSEND_FILE)) return [];
        return JSON.parse(fs.readFileSync(AUTOSEND_FILE, "utf-8"));
    } catch { return []; }
}

function writeAutoSend(data) {
    fs.mkdirSync(path.dirname(AUTOSEND_FILE), { recursive: true });
    fs.writeFileSync(AUTOSEND_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function validateTime(t) {
    return /^\d{1,2}:\d{2}$/.test(t) && (() => {
        const [h, m] = t.split(":").map(Number);
        return h >= 0 && h <= 23 && m >= 0 && m <= 59;
    })();
}

// ─── Main export ─────────────────────────────────────────────────────────────
module.exports = {
    config: {
        name: "auto",
        version: "1.1.0",
        hasPermssion: 1,
        credits: "MiZai",
        description: "Quản lý AutoSend + Bật/tắt Mizai AI + AutoDown",
        commandCategory: "Quản Trị",
        usages: [
            "auto bot on|off                              — Bật/tắt Mizai AI cho nhóm",
            "auto down on|off                             — Bật/tắt tự động tải video (AutoDown)",
            "auto list                                    — Danh sách lịch gửi tự động",
            "auto add <HH:MM> <nội dung>                 — Thêm lịch gửi text",
            "auto add <HH:MM> --vd <key>                 — Thêm lịch gửi video",
            "auto add <HH:MM> --vd <key> --text <nội dung> — Thêm lịch gửi video + text",
            "auto on|off|remove <stt>                    — Bật/tắt/xoá lịch theo số thứ tự",
        ].join("\n"),
        cooldowns: 3,
    },

    run: async ({ api, event, args, send, prefix, threadID }) => {
        const FLAG_MAP = { "-b": "bot", "-l": "list", "-a": "add", "-d": "down" };
        const sub = FLAG_MAP[args[0]] || (args[0] || "").toLowerCase().trim();

        if (event.type !== ThreadType.Group && ["bot", "down"].includes(sub)) {
            return send("⛔ Lệnh này chỉ dùng được trong nhóm.");
        }

        // ── Không có sub-command → hướng dẫn ────────────────────────────────
        if (!sub) {
            return send(
                `╔══ LỆNH AUTO ══╗\n` +
                `╚════════════════════╝\n` +
                `🤖 Mizai AI:\n` +
                `  ${prefix}auto bot on|off      — Bật/tắt Mizai AI\n` +
                `\n` +
                `📥 AutoDown:\n` +
                `  ${prefix}auto down on|off     — Bật/tắt tự tải video\n` +
                `\n` +
                `📤 AutoSend:\n` +
                `  ${prefix}auto list\n` +
                `  ${prefix}auto add <HH:MM> <nội dung>\n` +
                `  ${prefix}auto add <HH:MM> --vd <key>\n` +
                `  ${prefix}auto add <HH:MM> --vd <key> --text <nội dung>\n` +
                `  ${prefix}auto on <STT>\n` +
                `  ${prefix}auto off <STT>\n` +
                `  ${prefix}auto remove <STT>`
            );
        }

        // ── auto bot on/off ───────────────────────────────────────────────────
        if (sub === "bot") {
            const action = (args[1] || "").toLowerCase();
            if (action === "on") {
                setEnabled(threadID, true);
                return send("✅ Mizai AI đã được bật cho nhóm này.");
            }
            if (action === "off") {
                setEnabled(threadID, false);
                return send("☑️ Mizai AI đã được tắt cho nhóm này.");
            }
            const status = isEnabled(threadID) ? "✅ Đang BẬT" : "❌ Đang TẮT";
            return send(
                `🤖 Mizai AI — ${status}\n` +
                `  ${prefix}auto bot on   — Bật\n` +
                `  ${prefix}auto bot off  — Tắt`
            );
        }

        // ── auto down on/off ──────────────────────────────────────────────────
        if (sub === "down") {
            const action = (args[1] || "").toLowerCase();
            if (action === "on") {
                await setSetting(threadID, "autodown", true);
                return send("✅ AutoDown đã được BẬT cho nhóm này.\nBot sẽ tự tải video khi có link TikTok/YouTube/FB/...");
            }
            if (action === "off") {
                await setSetting(threadID, "autodown", false);
                return send("☑️ AutoDown đã được TẮT cho nhóm này.");
            }
            const current = await getSetting(threadID, "autodown", true);
            return send(
                `📥 AutoDown — ${current ? "✅ Đang BẬT" : "❌ Đang TẮT"}\n` +
                `  ${prefix}auto down on   — Bật tự tải video\n` +
                `  ${prefix}auto down off  — Tắt tự tải video`
            );
        }

        const configs = readAutoSend();
        const isGroup = event.type === ThreadType.Group;

        // ── list ─────────────────────────────────────────────────────────────
        if (sub === "list") {
            if (configs.length === 0) {
                return send(`📭 Chưa có lịch gửi tự động nào.\nDùng: ${prefix}auto add <HH:MM> <nội dung>`);
            }

            let msg = `╔══ DANH SÁCH AUTOSEND ══╗\n`;
            configs.forEach((c, i) => {
                const st = c.enabled !== false ? "✅" : "❌";
                const targets = Array.isArray(c.threadIds) && c.threadIds.length > 0
                    ? `${c.threadIds.length} nhóm cụ thể`
                    : "Tất cả nhóm";
                const preview = String(c.content || "").slice(0, 40) + (String(c.content || "").length > 40 ? "..." : "");
                msg += `  ${st} [${i + 1}] ${c.time}`;
                if (preview) msg += ` — 📝 ${preview}`;
                if (c.listapi) msg += `\n       🎬 Video: ${c.listapi}`;
                msg += `\n       📡 ${targets}\n`;
            });
            msg += `╚════════════════════════╝\n`;
            msg += `💡 ${prefix}auto on/off/remove <STT>`;
            return send(msg);
        }

        // ── add ──────────────────────────────────────────────────────────────
        if (sub === "add") {
            if (!isGroup) return send("⛔ Lệnh này chỉ dùng được trong nhóm.");

            const timeArg = args[1] || "";

            if (!timeArg) {
                return send(
                    `❌ Thiếu giờ gửi.\n` +
                    `Dùng:\n` +
                    `  ${prefix}auto add <HH:MM> <nội dung>\n` +
                    `  ${prefix}auto add <HH:MM> --vd <key>\n` +
                    `  ${prefix}auto add <HH:MM> --vd <key> --text <nội dung>\n` +
                    `Ví dụ: ${prefix}auto add 08:00 --vd gaixinh --text Chào buổi sáng!`
                );
            }
            if (!validateTime(timeArg)) {
                return send(`❌ Giờ không hợp lệ: "${timeArg}".\nDùng định dạng HH:MM (24h), ví dụ: 08:00, 20:30`);
            }

            // Parse --vd <key> và --text <nội dung> từ phần còn lại
            const rest = args.slice(2);
            let listapi = null;
            let content = "";

            const vdIdx = rest.indexOf("--vd");
            const textIdx = rest.indexOf("--text");

            if (vdIdx !== -1) {
                listapi = rest[vdIdx + 1] || null;
                if (!listapi) return send(`❌ Thiếu tên key video sau --vd.\nVí dụ: ${prefix}auto add 08:00 --vd gaixinh`);
            }

            if (textIdx !== -1) {
                // Lấy tất cả token sau --text (cho đến --vd hoặc hết)
                const textTokens = [];
                for (let i = textIdx + 1; i < rest.length; i++) {
                    if (rest[i] === "--vd") break;
                    textTokens.push(rest[i]);
                }
                content = textTokens.join(" ").trim();
                if (!content) return send(`❌ Thiếu nội dung sau --text.\nVí dụ: ${prefix}auto add 08:00 --text Chào buổi sáng!`);
            } else if (vdIdx === -1) {
                // Không có flag nào → toàn bộ là text (hành vi cũ)
                content = rest.join(" ").trim();
            }

            if (!listapi && !content) {
                return send(
                    `❌ Cần ít nhất nội dung text hoặc video.\n` +
                    `  ${prefix}auto add ${timeArg} <nội dung>\n` +
                    `  ${prefix}auto add ${timeArg} --vd <key>\n` +
                    `  ${prefix}auto add ${timeArg} --vd <key> --text <nội dung>`
                );
            }

            const newEntry = {
                time: timeArg,
                content,
                threadIds: [threadID],
                enabled: true
            };
            if (listapi) newEntry.listapi = listapi;

            configs.push(newEntry);
            writeAutoSend(configs);

            let confirmMsg = `✅ Đã thêm lịch gửi tự động!\n  ⏰ Giờ: ${timeArg}\n  📌 Nhóm: nhóm này\n`;
            if (content) confirmMsg += `  📝 Text: ${content.slice(0, 60)}${content.length > 60 ? "..." : ""}\n`;
            if (listapi) confirmMsg += `  🎬 Video: ${listapi}\n`;
            confirmMsg += `  STT: [${configs.length}]`;

            return send(confirmMsg);
        }

        // ── on / off / remove ─────────────────────────────────────────────────
        if (["on", "off", "remove", "rm", "del"].includes(sub)) {
            const idxRaw = parseInt(args[1]);
            if (isNaN(idxRaw) || idxRaw < 1 || idxRaw > configs.length) {
                return send(
                    `❌ Số thứ tự không hợp lệ: "${args[1] || ""}".\n` +
                    `Dùng: ${prefix}auto list để xem STT hiện có.`
                );
            }

            const idx = idxRaw - 1;

            if (sub === "on") {
                configs[idx].enabled = true;
                writeAutoSend(configs);
                const c = configs[idx];
                let info = `${c.time}`;
                if (c.content) info += ` — 📝 ${String(c.content).slice(0, 40)}`;
                if (c.listapi) info += ` 🎬 ${c.listapi}`;
                return send(`✅ Đã bật lịch gửi [${idxRaw}]: ${info}`);
            }

            if (sub === "off") {
                configs[idx].enabled = false;
                writeAutoSend(configs);
                const c = configs[idx];
                let info = `${c.time}`;
                if (c.content) info += ` — 📝 ${String(c.content).slice(0, 40)}`;
                if (c.listapi) info += ` 🎬 ${c.listapi}`;
                return send(`❌ Đã tắt lịch gửi [${idxRaw}]: ${info}`);
            }

            if (["remove", "rm", "del"].includes(sub)) {
                const removed = configs.splice(idx, 1)[0];
                writeAutoSend(configs);
                let info = `${removed.time}`;
                if (removed.content) info += ` — 📝 ${String(removed.content).slice(0, 40)}`;
                if (removed.listapi) info += ` 🎬 ${removed.listapi}`;
                return send(`🗑️ Đã xóa lịch gửi [${idxRaw}]: ${info}`);
            }
        }

        return send(
            `❌ Lệnh không hợp lệ: "${sub}"\n` +
            `💡 Dùng: ${prefix}auto để xem danh sách lệnh.`
        );
    }
};

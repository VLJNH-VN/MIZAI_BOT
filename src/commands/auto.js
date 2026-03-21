/**
 * src/commands/auto.js
 * Quản lý AutoSend + Bật/tắt Mizai AI (auto bot)
 */

const fs   = require("fs");
const path = require("path");
const { ThreadType } = require("zca-js");
const { setEnabled, isEnabled } = require('../../utils/ai/goibot');

const AUTOSEND_FILE = path.join(process.cwd(), "includes", "data", "autoSend.json");

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
        version: "1.0.0",
        hasPermssion: 1,
        credits: "MiZai",
        description: "Quản lý AutoSend + Bật/tắt Mizai AI",
        commandCategory: "Quản Trị",
        usages: [
            "auto bot on/off                   — Bật/tắt Mizai AI cho nhóm",
            "auto list                         — Xem danh sách lịch gửi tự động",
            "auto add <HH:MM> <nội dung>        — Thêm lịch gửi mới (nhóm hiện tại)",
            "auto on <số thứ tự>               — Bật lịch gửi theo số thứ tự",
            "auto off <số thứ tự>              — Tắt lịch gửi theo số thứ tự",
            "auto remove <số thứ tự>           — Xóa lịch gửi theo số thứ tự",
        ].join("\n"),
        cooldowns: 3,
    },

    run: async ({ api, event, args, send, prefix, threadID }) => {
        const FLAG_MAP = { "-b": "bot", "-l": "list", "-a": "add" };
        const sub = FLAG_MAP[args[0]] || (args[0] || "").toLowerCase().trim();

        // ── Không có sub-command → hướng dẫn ────────────────────────────────
        if (!sub) {
            return send(
                `╔══ LỆNH AUTO ══╗\n` +
                `╚════════════════════╝\n` +
                `🤖 Mizai AI:\n` +
                `  ${prefix}auto bot on       — Bật Mizai AI\n` +
                `  ${prefix}auto bot off      — Tắt Mizai AI\n` +
                `\n` +
                `📤 AutoSend:\n` +
                `  ${prefix}auto list\n` +
                `  ${prefix}auto add <HH:MM> <nội dung>\n` +
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
                msg += `  ${st} [${i + 1}] ${c.time} — ${preview}\n       📡 ${targets}\n`;
            });
            msg += `╚════════════════════════╝\n`;
            msg += `💡 ${prefix}auto on/off/remove <STT>`;
            return send(msg);
        }

        // ── add ──────────────────────────────────────────────────────────────
        if (sub === "add") {
            if (!isGroup) return send("⛔ Lệnh này chỉ dùng được trong nhóm.");

            const timeArg = args[1] || "";
            const content = args.slice(2).join(" ").trim();

            if (!timeArg) {
                return send(`❌ Thiếu giờ gửi.\nDùng: ${prefix}auto add <HH:MM> <nội dung>\nVí dụ: ${prefix}auto add 08:00 Chào buổi sáng!`);
            }
            if (!validateTime(timeArg)) {
                return send(`❌ Giờ không hợp lệ: "${timeArg}".\nDùng định dạng HH:MM (24h), ví dụ: 08:00, 20:30`);
            }
            if (!content) {
                return send(`❌ Thiếu nội dung tin nhắn.\nDùng: ${prefix}auto add ${timeArg} <nội dung>`);
            }

            configs.push({
                time: timeArg,
                content,
                threadIds: [threadID],
                enabled: true
            });
            writeAutoSend(configs);

            return send(
                `✅ Đã thêm lịch gửi tự động!\n` +
                `  ⏰ Giờ: ${timeArg}\n` +
                `  📌 Nhóm: nhóm này\n` +
                `  📝 Nội dung: ${content.slice(0, 60)}${content.length > 60 ? "..." : ""}\n` +
                `  STT: [${configs.length}]`
            );
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
                return send(`✅ Đã bật lịch gửi [${idxRaw}]: ${configs[idx].time} — ${String(configs[idx].content).slice(0, 40)}`);
            }

            if (sub === "off") {
                configs[idx].enabled = false;
                writeAutoSend(configs);
                return send(`❌ Đã tắt lịch gửi [${idxRaw}]: ${configs[idx].time} — ${String(configs[idx].content).slice(0, 40)}`);
            }

            if (["remove", "rm", "del"].includes(sub)) {
                const removed = configs.splice(idx, 1)[0];
                writeAutoSend(configs);
                return send(`🗑️ Đã xóa lịch gửi [${idxRaw}]: ${removed.time} — ${String(removed.content).slice(0, 40)}`);
            }
        }

        return send(
            `❌ Lệnh không hợp lệ: "${sub}"\n` +
            `💡 Dùng: ${prefix}auto để xem danh sách lệnh.`
        );
    }
};

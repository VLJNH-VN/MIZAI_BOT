/**
 * src/commands/auto.js
 * Quản lý AutoDown và AutoSend
 */

const fs   = require("fs");
const path = require("path");
const { ThreadType } = require("zca-js");

const AUTODOWN_FILE  = path.join(process.cwd(), "includes", "data", "autojson");
const AUTOSEND_FILE  = path.join(process.cwd(), "includes", "data", "autoSend.json");

// ─── AutoDown helpers ────────────────────────────────────────────────────────
function readAutoDown() {
    try {
        if (!fs.existsSync(AUTODOWN_FILE)) return {};
        return JSON.parse(fs.readFileSync(AUTODOWN_FILE, "utf-8"));
    } catch { return {}; }
}

function writeAutoDown(data) {
    fs.mkdirSync(path.dirname(AUTODOWN_FILE), { recursive: true });
    fs.writeFileSync(AUTODOWN_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function isAutoDownEnabled(data, threadId) {
    if (data[threadId] && data[threadId].autodown !== undefined) {
        return data[threadId].autodown !== false;
    }
    if (data["__global"] && data["__global"].autodown !== undefined) {
        return data["__global"].autodown !== false;
    }
    return true;
}

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
        description: "Quản lý AutoDown và AutoSend",
        commandCategory: "Quản Trị",
        usages: [
            "auto down on              — Bật AutoDown cho nhóm này",
            "auto down off             — Tắt AutoDown cho nhóm này",
            "auto down status          — Xem trạng thái AutoDown",
            "auto send list            — Xem danh sách lịch gửi tự động",
            "auto send add <HH:MM> <nội dung>  — Thêm lịch gửi mới (nhóm hiện tại)",
            "auto send on <số thứ tự>  — Bật lịch gửi theo số thứ tự",
            "auto send off <số thứ tự> — Tắt lịch gửi theo số thứ tự",
            "auto send remove <số thứ tự>     — Xóa lịch gửi theo số thứ tự",
        ].join("\n"),
        cooldowns: 3,
    },

    run: async ({ api, event, args, send, prefix, threadID }) => {
        const sub  = (args[0] || "").toLowerCase().trim();
        const sub2 = (args[1] || "").toLowerCase().trim();

        // ── Không có sub-command → hướng dẫn ────────────────────────────────
        if (!sub) {
            return send(
                `╔══ LỆNH AUTO ══╗\n` +
                `  ${prefix}auto\n` +
                `╚════════════════╝\n` +
                `📥 AutoDown:\n` +
                `  ${prefix}auto down on\n` +
                `  ${prefix}auto down off\n` +
                `  ${prefix}auto down status\n` +
                `\n` +
                `📤 AutoSend:\n` +
                `  ${prefix}auto send list\n` +
                `  ${prefix}auto send add <HH:MM> <nội dung>\n` +
                `  ${prefix}auto send on <STT>\n` +
                `  ${prefix}auto send off <STT>\n` +
                `  ${prefix}auto send remove <STT>`
            );
        }

        // ════════════════ AUTO DOWN ════════════════════════════════════════
        if (sub === "down") {
            const data = readAutoDown();
            const isGroup = event.type === ThreadType.Group;

            // status
            if (sub2 === "status" || !sub2) {
                const globalEnabled = isAutoDownEnabled(data, "__global_check__");
                const threadEnabled = isAutoDownEnabled(data, threadID);

                let msg = `╔══ AUTODOWN STATUS ══╗\n`;
                msg += `  🌐 Global: ${globalEnabled ? "✅ BẬT" : "❌ TẮT"}\n`;
                if (isGroup) {
                    const hasOverride = data[threadID] && data[threadID].autodown !== undefined;
                    msg += `  📌 Nhóm này: ${hasOverride ? (data[threadID].autodown ? "✅ BẬT" : "❌ TẮT") : "(theo global)"}\n`;
                }
                msg += `╚═════════════════════╝`;
                return send(msg);
            }

            if (!isGroup) {
                return send("⛔ Lệnh này chỉ dùng được trong nhóm.");
            }

            // on
            if (sub2 === "on") {
                if (!data[threadID]) data[threadID] = {};
                data[threadID].autodown = true;
                writeAutoDown(data);
                return send(`✅ Đã bật AutoDown cho nhóm này.\nBot sẽ tự tải media khi có link chia sẻ.`);
            }

            // off
            if (sub2 === "off") {
                if (!data[threadID]) data[threadID] = {};
                data[threadID].autodown = false;
                writeAutoDown(data);
                return send(`❌ Đã tắt AutoDown cho nhóm này.\nBot sẽ không tự tải link trong nhóm này nữa.`);
            }

            return send(`❌ Lệnh không hợp lệ.\nDùng: ${prefix}auto down on | off | status`);
        }

        // ════════════════ AUTO SEND ════════════════════════════════════════
        if (sub === "send") {
            const configs = readAutoSend();
            const isGroup = event.type === ThreadType.Group;

            // list
            if (sub2 === "list" || !sub2) {
                if (configs.length === 0) {
                    return send(`📭 Chưa có lịch gửi tự động nào.\nDùng: ${prefix}auto send add <HH:MM> <nội dung>`);
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
                msg += `💡 ${prefix}auto send on/off/remove <STT>`;
                return send(msg);
            }

            // add
            if (sub2 === "add") {
                if (!isGroup) return send("⛔ Lệnh này chỉ dùng được trong nhóm.");

                const timeArg    = args[2] || "";
                const content    = args.slice(3).join(" ").trim();

                if (!timeArg) {
                    return send(`❌ Thiếu giờ gửi.\nDùng: ${prefix}auto send add <HH:MM> <nội dung>\nVí dụ: ${prefix}auto send add 08:00 Chào buổi sáng!`);
                }
                if (!validateTime(timeArg)) {
                    return send(`❌ Giờ không hợp lệ: "${timeArg}".\nDùng định dạng HH:MM (24h), ví dụ: 08:00, 20:30`);
                }
                if (!content) {
                    return send(`❌ Thiếu nội dung tin nhắn.\nDùng: ${prefix}auto send add ${timeArg} <nội dung>`);
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

            // on / off / remove — cần chỉ số
            if (["on", "off", "remove", "rm", "del"].includes(sub2)) {
                const idxRaw = parseInt(args[2]);
                if (isNaN(idxRaw) || idxRaw < 1 || idxRaw > configs.length) {
                    return send(
                        `❌ Số thứ tự không hợp lệ: "${args[2] || ""}".\n` +
                        `Dùng: ${prefix}auto send list để xem STT hiện có.`
                    );
                }

                const idx = idxRaw - 1;

                if (sub2 === "on") {
                    configs[idx].enabled = true;
                    writeAutoSend(configs);
                    return send(`✅ Đã bật lịch gửi [${idxRaw}]: ${configs[idx].time} — ${String(configs[idx].content).slice(0, 40)}`);
                }

                if (sub2 === "off") {
                    configs[idx].enabled = false;
                    writeAutoSend(configs);
                    return send(`❌ Đã tắt lịch gửi [${idxRaw}]: ${configs[idx].time} — ${String(configs[idx].content).slice(0, 40)}`);
                }

                if (["remove", "rm", "del"].includes(sub2)) {
                    const removed = configs.splice(idx, 1)[0];
                    writeAutoSend(configs);
                    return send(`🗑️ Đã xóa lịch gửi [${idxRaw}]: ${removed.time} — ${String(removed.content).slice(0, 40)}`);
                }
            }

            return send(
                `❌ Lệnh con không hợp lệ: "${sub2}"\n` +
                `💡 Dùng: ${prefix}auto send list | add | on | off | remove`
            );
        }

        // ── Sub-command không hợp lệ ────────────────────────────────────────
        return send(
            `❌ Lệnh không hợp lệ: "${sub}"\n` +
            `💡 Dùng: ${prefix}auto down ... hoặc ${prefix}auto send ...`
        );
    }
};

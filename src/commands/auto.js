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
            "auto add <HH:MM> <nội dung>                    — Thêm lịch gửi text",
            "auto add <HH:MM> --vd <key>                    — Thêm lịch gửi video",
            "auto add <HH:MM> --joke                                  — Joke ngẫu nhiên",
            "auto add <HH:MM> --joke --joke-cat Programming,Misc      — Joke theo category (có thể kết hợp)",
            "auto add <HH:MM> --joke --joke-lang de                   — Joke theo ngôn ngữ (en/de/cs/es/fr/pt)",
            "auto add <HH:MM> --joke --joke-flags nsfw,racist         — Blacklist nội dung không muốn",
            "auto add <HH:MM> --joke --text <nội dung>                — Joke + text",
            "auto add <HH:MM> --vd <key> --text <nội dung>  — Thêm lịch gửi video + text",
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
                `  ${prefix}auto add <HH:MM> --joke\n` +
                `  ${prefix}auto add <HH:MM> --joke --joke-cat Programming,Misc\n` +
                `  ${prefix}auto add <HH:MM> --joke --joke-lang de\n` +
                `  ${prefix}auto add <HH:MM> --joke --joke-flags nsfw,racist\n` +
                `  ${prefix}auto add <HH:MM> --joke --text <nội dung>\n` +
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
                if (c.joke) {
                    let jokeInfo = `😂 Joke: bật`;
                    if (c.jokeCategory) jokeInfo += ` | 📂 ${c.jokeCategory}`;
                    if (c.jokeLang) jokeInfo += ` | 🌐 ${c.jokeLang}`;
                    if (c.jokeFlags) jokeInfo += ` | 🚫 ${c.jokeFlags}`;
                    msg += `\n       ${jokeInfo}`;
                }
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

            // Parse flags từ phần còn lại
            const rest = args.slice(2);
            const VALID_CATS  = new Set(["Programming", "Misc", "Dark", "Pun", "Spooky", "Christmas"]);
            const VALID_LANGS = new Set(["en", "de", "cs", "es", "fr", "pt"]);
            const VALID_FLAGS = new Set(["nsfw", "religious", "political", "racist", "sexist", "explicit"]);
            const ALL_FLAGS   = new Set(["--vd", "--text", "--joke", "--joke-cat", "--joke-lang", "--joke-flags"]);

            let listapi      = null;
            let content      = "";
            let joke         = false;
            let jokeCategory = null;
            let jokeLang     = null;
            let jokeFlags    = null;

            const vdIdx        = rest.indexOf("--vd");
            const textIdx      = rest.indexOf("--text");
            const jokeIdx      = rest.indexOf("--joke");
            const jokeCatIdx   = rest.indexOf("--joke-cat");
            const jokeLangIdx  = rest.indexOf("--joke-lang");
            const jokeFlagIdx  = rest.indexOf("--joke-flags");

            if (jokeIdx !== -1) joke = true;

            if (vdIdx !== -1) {
                listapi = rest[vdIdx + 1] || null;
                if (!listapi || ALL_FLAGS.has(listapi)) return send(`❌ Thiếu tên key video sau --vd.\nVí dụ: ${prefix}auto add 08:00 --vd gaixinh`);
            }

            if (jokeCatIdx !== -1) {
                // Hỗ trợ nhiều category: Programming,Misc
                const catRaw = rest[jokeCatIdx + 1] || null;
                if (!catRaw || ALL_FLAGS.has(catRaw)) return send(`❌ Thiếu category sau --joke-cat.\nCác category: Programming, Misc, Dark, Pun, Spooky, Christmas\nVí dụ: --joke-cat Programming,Misc`);
                const validCats = catRaw.split(",").map(c => c.trim()).filter(c => VALID_CATS.has(c));
                if (!validCats.length) return send(`❌ Category không hợp lệ: "${catRaw}".\nCác category hợp lệ: Programming, Misc, Dark, Pun, Spooky, Christmas`);
                jokeCategory = validCats.join(",");
                joke = true;
            }

            if (jokeLangIdx !== -1) {
                const lang = rest[jokeLangIdx + 1] || null;
                if (!lang || ALL_FLAGS.has(lang)) return send(`❌ Thiếu ngôn ngữ sau --joke-lang.\nCác ngôn ngữ: en, de, cs, es, fr, pt`);
                if (!VALID_LANGS.has(lang)) return send(`❌ Ngôn ngữ không hợp lệ: "${lang}".\nCác ngôn ngữ hợp lệ: en, de, cs, es, fr, pt`);
                jokeLang = lang;
                joke = true;
            }

            if (jokeFlagIdx !== -1) {
                // Hỗ trợ blacklist flags: nsfw,racist,sexist,...
                const flagRaw = rest[jokeFlagIdx + 1] || null;
                if (!flagRaw || ALL_FLAGS.has(flagRaw)) return send(`❌ Thiếu flags sau --joke-flags.\nCác flags: nsfw, religious, political, racist, sexist, explicit\nVí dụ: --joke-flags nsfw,racist`);
                const validFlags = flagRaw.split(",").map(f => f.trim()).filter(f => VALID_FLAGS.has(f));
                if (!validFlags.length) return send(`❌ Flags không hợp lệ: "${flagRaw}".\nCác flags hợp lệ: nsfw, religious, political, racist, sexist, explicit`);
                jokeFlags = validFlags.join(",");
                joke = true;
            }

            if (textIdx !== -1) {
                const STOP_FLAGS = new Set(["--vd", "--joke", "--joke-cat", "--joke-lang", "--joke-flags"]);
                const textTokens = [];
                for (let i = textIdx + 1; i < rest.length; i++) {
                    if (STOP_FLAGS.has(rest[i])) break;
                    textTokens.push(rest[i]);
                }
                content = textTokens.join(" ").trim();
                if (!content) return send(`❌ Thiếu nội dung sau --text.\nVí dụ: ${prefix}auto add 08:00 --text Chào buổi sáng!`);
            } else if (vdIdx === -1 && !joke) {
                // Không có flag nào → toàn bộ là text (hành vi cũ)
                content = rest.join(" ").trim();
            }

            if (!listapi && !content && !joke) {
                return send(
                    `❌ Cần ít nhất một trong: text, video, hoặc joke.\n` +
                    `  ${prefix}auto add ${timeArg} <nội dung>\n` +
                    `  ${prefix}auto add ${timeArg} --vd <key>\n` +
                    `  ${prefix}auto add ${timeArg} --joke\n` +
                    `  ${prefix}auto add ${timeArg} --joke --joke-cat Programming,Misc\n` +
                    `  ${prefix}auto add ${timeArg} --joke --joke-lang de\n` +
                    `  ${prefix}auto add ${timeArg} --joke --joke-flags nsfw,racist`
                );
            }

            const newEntry = {
                time: timeArg,
                content,
                threadIds: [threadID],
                enabled: true
            };
            if (listapi) newEntry.listapi = listapi;
            if (joke) newEntry.joke = true;
            if (jokeCategory) newEntry.jokeCategory = jokeCategory;
            if (jokeLang) newEntry.jokeLang = jokeLang;
            if (jokeFlags) newEntry.jokeFlags = jokeFlags;

            configs.push(newEntry);
            writeAutoSend(configs);

            let confirmMsg = `✅ Đã thêm lịch gửi tự động!\n  ⏰ Giờ: ${timeArg}\n  📌 Nhóm: nhóm này\n`;
            if (content) confirmMsg += `  📝 Text: ${content.slice(0, 60)}${content.length > 60 ? "..." : ""}\n`;
            if (listapi) confirmMsg += `  🎬 Video: ${listapi}\n`;
            if (joke) {
                confirmMsg += `  😂 Joke: bật`;
                if (jokeCategory) confirmMsg += ` | 📂 ${jokeCategory}`;
                if (jokeLang) confirmMsg += ` | 🌐 ${jokeLang}`;
                if (jokeFlags) confirmMsg += ` | 🚫 ${jokeFlags}`;
                confirmMsg += `\n`;
            }
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

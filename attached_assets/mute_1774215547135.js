/**
 * Module: Mute
 * Quản lý danh sách cấm chat, tự động dùng deleteMessage xóa tin nhắn
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

export const name = "mute";
export const description = "Lệnh cấm chat/tắt tiếng người dùng (yêu cầu admin bot)";

// ─── Tải danh sách muted ───
const MUTE_FILE = path.join(process.cwd(), "src", "modules", "cache", "mutes.json");

function loadMutes() {
    try {
        if (!existsSync(MUTE_FILE)) return [];
        return JSON.parse(readFileSync(MUTE_FILE, "utf-8")).filter(id => /^\d+$/.test(String(id)));
    } catch {
        return [];
    }
}

function saveMutes(arr) {
    const cleanArr = [...new Set(arr.filter(id => /^\d+$/.test(String(id))))];
    writeFileSync(MUTE_FILE, JSON.stringify(cleanArr, null, 2), "utf-8");
}

let mutedUsers = loadMutes();

async function reply(ctx, text) {
    await ctx.api.sendMessage(
        { msg: text, quote: ctx.message.data },
        ctx.threadId,
        ctx.threadType
    );
}

function getTargetId(ctx, input) {
    // 1. Lấy từ Mentions (@tag)
    if (ctx.message.data.mentions && ctx.message.data.mentions.length > 0) {
        // Lấy tag đầu tiên hông phải @all (-1)
        const mention = ctx.message.data.mentions.find(m => m.uid !== "-1" && m.uid !== -1);
        if (mention) return String(mention.uid);
    }
    // 2. Lấy từ Quote (Reply tin nhắn)
    if (ctx.message.data.quote) {
        return String(ctx.message.data.quote.uidFrom || ctx.message.data.quote.ownerId);
    }
    // 3. Lấy từ input (nếu là số)
    if (input && /^\d+$/.test(String(input))) {
        return String(input);
    }
    return null;
}

export const commands = {

    mute: async (ctx) => {
        if (!ctx.adminIds.includes(String(ctx.senderId))) {
            return reply(ctx, "⚠️ Phải là Admin Bot mới được dùng lệnh !mute.");
        }

        const { args, prefix } = ctx;
        const sub = args[0]?.toLowerCase();

        if (!sub) {
            let help = `[ 🔇 QUẢN LÝ MUTE ]\n`;
            help += `─────────────────\n`;
            help += ` ❯ ${prefix}mute add [id/tag] ➥ Chặn chat\n`;
            help += ` ❯ ${prefix}mute del [id/tag] ➥ Bỏ chặn\n`;
            help += ` ❯ ${prefix}mute list         ➥ Danh sách\n`;
            help += `─────────────────\n`;
            help += `💡 Có thể tag hoặc reply tin nhắn để dùng.`;
            return reply(ctx, help);
        }

        mutedUsers = loadMutes(); // Reload cho chắc

        if (sub === "list") {
            if (mutedUsers.length === 0) return reply(ctx, "✦ Danh sách Mute đang trống.");
            let msg = `[ 🔇 DANH SÁCH BỊ MUTE ]\n`;
            msg += `─────────────────\n`;
            msg += mutedUsers.map(uid => `• ${uid}`).join("\n");
            msg += `\n─────────────────`;
            return reply(ctx, msg);
        }

        if (sub === "add") {
            const targetId = getTargetId(ctx, args[1]);
            if (!targetId) return reply(ctx, `⚠️ Vui lòng tag người dùng, reply hoặc nhập ID số. VD: ${prefix}mute add @Quý`);
            
            if (mutedUsers.includes(targetId)) return reply(ctx, `◈ User ID ${targetId} đã bị mute rồi.`);
            mutedUsers.push(targetId);
            saveMutes(mutedUsers);
            return reply(ctx, `✦ Đã MIỄN QUYỀN CHAT (MUTE) người dùng ID: ${targetId}.`);
        }

        if (sub === "del" || sub === "remove" || sub === "unmute") {
            const targetId = getTargetId(ctx, args[1]);
            if (!targetId) return reply(ctx, `⚠️ Vui lòng tag người dùng, reply hoặc nhập ID số. VD: ${prefix}mute del @Quý`);

            if (!mutedUsers.includes(targetId)) return reply(ctx, `◈ User ID ${targetId} hông có bị mute.`);
            mutedUsers = mutedUsers.filter(id => id !== targetId);
            saveMutes(mutedUsers);
            return reply(ctx, `✦ Đã MỞ KHOÁ CHAT (UNMUTE) người dùng ID: ${targetId}.`);
        }

        // Backward compatibility: !mute [tag/reply/id]
        const directId = getTargetId(ctx, sub);
        if (directId) {
            if (mutedUsers.includes(directId)) {
                // Nếu đang mute thì unmute (toggle) - hoặc chỉ thông báo tùy ý
                // Ở đây mình cứ để là Add cho giống hành vi cũ của user
                return reply(ctx, `◈ User ID ${directId} đã bị mute rồi. Dùng "${prefix}mute del" để mở nhé.`);
            }
            mutedUsers.push(directId);
            saveMutes(mutedUsers);
            return reply(ctx, `✦ Đã MIỄN QUYỀN CHAT (MUTE) người dùng ID: ${directId}.`);
        } else {
            return reply(ctx, `⚠️ Lệnh hông hợp lệ. Dùng "${prefix}mute" để xem hướng dẫn nha.`);
        }
    },

    unmute: async (ctx) => {
        return commands.mute({ ...ctx, args: ["del", ...ctx.args] });
    },

    mutelist: async (ctx) => {
        return commands.mute({ ...ctx, args: ["list"] });
    },

    unlock: async (ctx) => {
        return commands.mute({ ...ctx, args: ["del", ...ctx.args] });
    }
};

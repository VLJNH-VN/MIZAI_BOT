"use strict";

/**
 * src/commands/stk.js  v3.0.0
 * Tìm & gửi STICKER ZALO THẬT từ catalog Zalo qua searchSticker + sendSticker
 *
 * Cách dùng:
 *   stk <từ khoá>       → Tìm sticker Zalo theo từ khoá
 *   stk random          → Gửi sticker Zalo ngẫu nhiên
 *   stk list <từ khoá>  → Liệt kê tên sticker tìm được (debug)
 *
 * LƯU Ý: Zalo API không hỗ trợ upload sticker tùy chỉnh.
 * Chỉ có thể gửi sticker từ catalog Zalo (có sticker_id, cate_id).
 */

const RANDOM_KEYWORDS = [
  "vui", "buồn", "cười", "tức", "love", "mèo", "chó", "gấu",
  "ok", "hi", "bye", "cute", "haha", "wow", "sad", "angry",
];

// ── Lấy danh sách sticker theo từ khoá ───────────────────────────────────────

function extractStickerList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.data))    return raw.data;
  if (Array.isArray(raw.items))   return raw.items;
  if (Array.isArray(raw.stickers)) return raw.stickers;
  return [];
}

async function searchStickers(api, keyword, limit = 20) {
  try {
    const raw  = await api.searchSticker(keyword, limit);
    const list = extractStickerList(raw);
    return list.filter(s => s && (s.sticker_id || s.id));
  } catch (_) {
    return [];
  }
}

// ── Gửi một sticker Zalo thật ─────────────────────────────────────────────────

async function sendOneSticker(api, sticker, threadID, threadType) {
  const id     = Number(sticker.sticker_id ?? sticker.id);
  const cateId = Number(sticker.cate_id    ?? sticker.cateId ?? 0);
  const type   = Number(sticker.type)  || 1;

  if (!id) throw new Error("sticker_id không hợp lệ");

  await api.sendSticker({ id, cateId, type }, threadID, threadType);
}

// ── Tìm theo từ khoá và gửi ngẫu nhiên 1 sticker ─────────────────────────────

async function sendZaloSticker(api, keyword, threadID, threadType) {
  const list = await searchStickers(api, keyword, 20);
  if (!list.length) return false;

  const sticker = list[Math.floor(Math.random() * list.length)];
  await sendOneSticker(api, sticker, threadID, threadType);
  return true;
}

// ── Fallback: thử nhiều từ khoá cho đến khi được ─────────────────────────────

async function sendWithFallback(api, keywords, threadID, threadType) {
  for (const kw of keywords) {
    const ok = await sendZaloSticker(api, kw, threadID, threadType);
    if (ok) return { ok: true, keyword: kw };
  }
  return { ok: false };
}

// ── HELP ─────────────────────────────────────────────────────────────────────

const HELP_MSG =
  "🎭 STICKER ZALO\n" +
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
  "• stk <từ khoá>       → Tìm & gửi sticker Zalo\n" +
  "• stk random          → Sticker ngẫu nhiên\n" +
  "• stk list <từ khoá>  → Xem danh sách sticker tìm được\n" +
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
  "💡 Ví dụ: .stk mèo | .stk buồn | .stk cute | .stk love";

// ── COMMAND ───────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name:            "stk",
    aliases:         ["sticker", "nhanhstk"],
    version:         "3.0.0",
    hasPermssion:    0,
    credits:         "MIZAI",
    description:     "Tìm & gửi sticker Zalo thật theo từ khoá",
    commandCategory: "Tiện Ích",
    usages:          HELP_MSG,
    cooldowns:       4,
  },

  run: async ({ api, event, args, send, threadID }) => {
    const sub  = (args[0] || "").toLowerCase().trim();
    const rest = args.slice(1).join(" ").trim();

    // ── stk (không args) → help ───────────────────────────────────────────────
    if (!sub) return send(HELP_MSG);

    // ── stk random ────────────────────────────────────────────────────────────
    if (sub === "random" || sub === "ngaunhien" || sub === "rand") {
      const kw = RANDOM_KEYWORDS[Math.floor(Math.random() * RANDOM_KEYWORDS.length)];
      const ok = await sendZaloSticker(api, kw, threadID, event.type);
      if (!ok) await send("❌ Không tìm thấy sticker nào. Thử lại sau nhé!");
      return;
    }

    // ── stk list <từ khoá> → liệt kê sticker tìm được ───────────────────────
    if (sub === "list" || sub === "ds" || sub === "xem") {
      const keyword = rest || "mèo";
      const list    = await searchStickers(api, keyword, 10);
      if (!list.length) return send(`❌ Không tìm thấy sticker nào cho: "${keyword}"`);
      const lines = list.map((s, i) =>
        `${i + 1}. ID=${s.sticker_id ?? s.id} | CateID=${s.cate_id ?? s.cateId} | Type=${s.type}`
      );
      return send(
        `🔍 Tìm thấy ${list.length} sticker cho "${keyword}":\n` + lines.join("\n")
      );
    }

    // ── stk <từ khoá> → tìm & gửi sticker Zalo ───────────────────────────────
    const keyword = args.join(" ").trim();
    if (!keyword) return send(HELP_MSG);

    // Xây dựng danh sách từ khoá fallback (thử từ đầy đủ rồi từng từ)
    const words    = keyword.split(/\s+/).filter(Boolean);
    const fallback = words.length > 1 ? words : [];
    const keywords = [keyword, ...fallback];

    try {
      const result = await sendWithFallback(api, keywords, threadID, event.type);
      if (!result.ok) {
        await send(
          `❌ Không tìm thấy sticker Zalo nào cho: "${keyword}"\n` +
          `💡 Thử từ khoá khác như: .stk mèo | .stk vui | .stk cute`
        );
      }
    } catch (e) {
      await send(`❌ Lỗi gửi sticker: ${e.message}`);
    }
  },
};

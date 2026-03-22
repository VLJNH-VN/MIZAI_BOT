"use strict";

/**
 * src/commands/stk.js  v4.0.0
 * Lệnh sticker CHUẨN — Combo Pack + API
 *
 * Cách dùng:
 *   stk <từ khoá>          → Tìm & gửi sticker qua API search
 *   stk random             → Sticker ngẫu nhiên từ pack ngẫu nhiên
 *   stk pack               → Xem danh sách pack có sẵn
 *   stk pack <số|tên>      → Gửi sticker ngẫu nhiên từ pack đó
 *   stk list <từ khoá>     → Liệt kê sticker tìm được (debug)
 *
 * Kiến trúc combo:
 *   - Pack offline : STICKER_PACKS (cateId cố định) → getStickerCategoryDetail
 *   - API search   : searchSticker(keyword)          → sendSticker
 */

// ═══════════════════════════════════════════════════════════════════════════
//  COMBO PACK — Danh sách pack sticker Zalo phổ biến (cateId thật)
// ═══════════════════════════════════════════════════════════════════════════

const STICKER_PACKS = [
  { id:  1,  name: "Mèo Dễ Thương",   cateId: 22,   keywords: ["mèo", "cat", "cute"] },
  { id:  2,  name: "Gấu Bống",         cateId: 10,   keywords: ["gấu", "bear", "teddy"] },
  { id:  3,  name: "Thỏ Nâu",          cateId: 3,    keywords: ["thỏ", "rabbit", "bunny"] },
  { id:  4,  name: "Emoji Cảm Xúc",   cateId: 5,    keywords: ["cảm xúc", "emotion", "face"] },
  { id:  5,  name: "Trái Tim Tình Yêu",cateId: 7,    keywords: ["love", "tim", "heart"] },
  { id:  6,  name: "Chó Cún",          cateId: 30,   keywords: ["chó", "dog", "puppy"] },
  { id:  7,  name: "Vui Vẻ & Cười",   cateId: 8,    keywords: ["vui", "cười", "haha", "lol"] },
  { id:  8,  name: "Buồn & Khóc",      cateId: 9,    keywords: ["buồn", "khóc", "sad", "cry"] },
  { id:  9,  name: "Tức Giận",         cateId: 11,   keywords: ["tức", "giận", "angry", "mad"] },
  { id: 10,  name: "Chào Hỏi",         cateId: 13,   keywords: ["hi", "hello", "chào", "bye"] },
  { id: 11,  name: "Ăn Uống",          cateId: 14,   keywords: ["ăn", "đói", "food", "eat"] },
  { id: 12,  name: "Học Tập",          cateId: 18,   keywords: ["học", "study", "sách"] },
  { id: 13,  name: "Lễ Tết",           cateId: 26,   keywords: ["tết", "lễ", "festival", "new year"] },
  { id: 14,  name: "Hoa & Thiên Nhiên",cateId: 28,   keywords: ["hoa", "flower", "nature"] },
  { id: 15,  name: "Đồ Ăn Vặt",        cateId: 32,   keywords: ["snack", "ăn vặt", "bánh"] },
];

// ═══════════════════════════════════════════════════════════════════════════
//  UTILS — Tìm pack theo tên hoặc số
// ═══════════════════════════════════════════════════════════════════════════

function findPackByQuery(query) {
  const q = query.trim().toLowerCase();
  // Tìm theo số (1-15)
  const num = parseInt(q, 10);
  if (!isNaN(num) && num >= 1 && num <= STICKER_PACKS.length) {
    return STICKER_PACKS[num - 1];
  }
  // Tìm theo tên pack
  const byName = STICKER_PACKS.find(p =>
    p.name.toLowerCase().includes(q) ||
    p.keywords.some(k => k.includes(q) || q.includes(k))
  );
  return byName || null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  LAYER 1 — Pack-based: getStickerCategoryDetail
// ═══════════════════════════════════════════════════════════════════════════

async function sendStickerFromPack(api, cateId, threadID, threadType) {
  const detail = await api.getStickerCategoryDetail(cateId);

  // Phân tích response từ getStickerCategoryDetail
  let stickers = [];
  if (detail) {
    const d = detail.data ?? detail;
    stickers =
      d.stickers     ??
      d.items        ??
      d.listSticker  ??
      (Array.isArray(d) ? d : []);
  }

  if (!stickers.length) return false;

  const s = stickers[Math.floor(Math.random() * stickers.length)];

  const stickerObj = {
    id:     Number(s.stickerId ?? s.sticker_id ?? s.id),
    cateId: Number(s.cateId   ?? s.cate_id    ?? cateId),
    type:   Number(s.type)    || 1,
  };

  if (!stickerObj.id) return false;

  await api.sendSticker(stickerObj, threadID, threadType);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
//  LAYER 2 — API search: searchSticker → sendSticker
// ═══════════════════════════════════════════════════════════════════════════

function extractStickerList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw))          return raw;
  if (Array.isArray(raw.data))     return raw.data;
  if (Array.isArray(raw.items))    return raw.items;
  if (Array.isArray(raw.stickers)) return raw.stickers;
  return [];
}

async function searchAndSend(api, keyword, threadID, threadType) {
  const raw  = await api.searchSticker(keyword, 30).catch(() => null);
  const list = extractStickerList(raw).filter(s => s && (s.sticker_id || s.id));
  if (!list.length) return false;

  const s = list[Math.floor(Math.random() * list.length)];

  const stickerObj = {
    id:     Number(s.sticker_id ?? s.id),
    cateId: Number(s.cate_id    ?? s.cateId ?? 0),
    type:   Number(s.type)      || 1,
  };

  if (!stickerObj.id) return false;

  await api.sendSticker(stickerObj, threadID, threadType);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
//  COMBO ENGINE — Ưu tiên pack → fallback sang API search
// ═══════════════════════════════════════════════════════════════════════════

async function sendCombo(api, keyword, threadID, threadType) {
  // Bước 1: Tìm pack phù hợp theo keyword
  const pack = findPackByQuery(keyword);
  if (pack) {
    const ok = await sendStickerFromPack(api, pack.cateId, threadID, threadType)
      .catch(() => false);
    if (ok) return { ok: true, source: `pack "${pack.name}"` };
  }

  // Bước 2: Fallback sang API search với keyword đầy đủ
  const ok1 = await searchAndSend(api, keyword, threadID, threadType)
    .catch(() => false);
  if (ok1) return { ok: true, source: "API search" };

  // Bước 3: Thử từng từ trong keyword
  const words = keyword.split(/\s+/).filter(Boolean);
  for (const w of words) {
    if (w === keyword) continue;
    const ok2 = await searchAndSend(api, w, threadID, threadType).catch(() => false);
    if (ok2) return { ok: true, source: `API search "${w}"` };
  }

  return { ok: false };
}

// ═══════════════════════════════════════════════════════════════════════════
//  HELP
// ═══════════════════════════════════════════════════════════════════════════

const HELP_MSG =
  "🎭 STICKER — COMBO PACK + API\n" +
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
  "• stk <từ khoá>      → Gửi sticker theo từ khoá\n" +
  "• stk random         → Sticker ngẫu nhiên\n" +
  "• stk pack           → Xem danh sách pack\n" +
  "• stk pack <số|tên>  → Gửi sticker từ pack đó\n" +
  "• stk list <từ khoá> → Liệt kê sticker tìm được\n" +
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
  "💡 Ví dụ:\n" +
  "  .stk mèo  |  .stk random  |  .stk pack 1  |  .stk pack gấu";

// ═══════════════════════════════════════════════════════════════════════════
//  COMMAND
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  config: {
    name:            "stk",
    aliases:         ["sticker", "nhanhstk"],
    version:         "4.0.0",
    hasPermssion:    0,
    credits:         "MIZAI",
    description:     "Gửi sticker Zalo chuẩn — Combo Pack + API",
    commandCategory: "Tiện Ích",
    usages:          HELP_MSG,
    cooldowns:       4,
  },

  run: async ({ api, event, args, send, threadID }) => {
    const sub  = (args[0] || "").toLowerCase().trim();
    const rest = args.slice(1).join(" ").trim();

    // ── Không có args → help ─────────────────────────────────────────────
    if (!sub) return send(HELP_MSG);

    // ── stk pack ─────────────────────────────────────────────────────────
    if (sub === "pack") {

      // stk pack (không thêm gì) → list packs
      if (!rest) {
        const lines = STICKER_PACKS.map(p =>
          `${String(p.id).padStart(2)}. ${p.name}  [cateId: ${p.cateId}]`
        );
        return send(
          "📦 DANH SÁCH STICKER PACKS\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          lines.join("\n") +
          "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          "💡 Dùng: .stk pack <số hoặc tên>"
        );
      }

      // stk pack <số|tên> → gửi sticker từ pack
      const pack = findPackByQuery(rest);
      if (!pack) {
        return send(
          `❌ Không tìm thấy pack: "${rest}"\n` +
          `💡 Gõ .stk pack để xem danh sách.`
        );
      }

      try {
        const ok = await sendStickerFromPack(api, pack.cateId, threadID, event.type);
        if (!ok) {
          // Fallback sang API search bằng keywords của pack
          const fallbackKw = pack.keywords[0];
          const ok2 = await searchAndSend(api, fallbackKw, threadID, event.type)
            .catch(() => false);
          if (!ok2) await send(`❌ Pack "${pack.name}" hiện không có sticker. Thử lại sau!`);
        }
      } catch (e) {
        await send(`❌ Lỗi: ${e.message}`);
      }
      return;
    }

    // ── stk random ───────────────────────────────────────────────────────
    if (sub === "random" || sub === "rand" || sub === "ngaunhien") {
      const pack = STICKER_PACKS[Math.floor(Math.random() * STICKER_PACKS.length)];
      try {
        const ok = await sendStickerFromPack(api, pack.cateId, threadID, event.type);
        if (!ok) {
          const ok2 = await searchAndSend(api, pack.keywords[0], threadID, event.type)
            .catch(() => false);
          if (!ok2) await send("❌ Không lấy được sticker ngẫu nhiên. Thử lại sau!");
        }
      } catch (e) {
        await send(`❌ Lỗi: ${e.message}`);
      }
      return;
    }

    // ── stk list <từ khoá> → debug ───────────────────────────────────────
    if (sub === "list" || sub === "ds" || sub === "xem") {
      const keyword = rest || "mèo";
      try {
        const raw  = await api.searchSticker(keyword, 10);
        const list = extractStickerList(raw).filter(s => s && (s.sticker_id || s.id));
        if (!list.length) return send(`❌ Không tìm thấy sticker nào cho: "${keyword}"`);
        const lines = list.map((s, i) =>
          `${i + 1}. ID=${s.sticker_id ?? s.id} | CateID=${s.cate_id ?? s.cateId ?? "?"} | Type=${s.type ?? 1}`
        );
        return send(
          `🔍 ${list.length} sticker cho "${keyword}":\n` + lines.join("\n")
        );
      } catch (e) {
        return send(`❌ Lỗi tìm kiếm: ${e.message}`);
      }
    }

    // ── stk <từ khoá> → combo pack + API search ──────────────────────────
    const keyword = args.join(" ").trim();
    try {
      const result = await sendCombo(api, keyword, threadID, event.type);
      if (!result.ok) {
        await send(
          `❌ Không tìm thấy sticker cho: "${keyword}"\n` +
          `💡 Thử: .stk pack | .stk random | .stk mèo`
        );
      }
    } catch (e) {
      await send(`❌ Lỗi gửi sticker: ${e.message}`);
    }
  },
};

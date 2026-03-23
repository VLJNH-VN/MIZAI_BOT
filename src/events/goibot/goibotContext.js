/**
 * src/events/goibotContext.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Helpers xây dựng AI context cho Mizai:
 *   - TX (Tài Xỉu) context
 *   - Self-profile cache
 *   - safeCalc (tính toán an toàn)
 *   - runSelfReflect / scheduleNextSelfReflect
 *
 * EXPORT:
 *   getTxContext(isAdmin)                 → string
 *   writeTxCfg(data)                      → void
 *   getSelfProfile(api)                   → Promise<object>
 *   invalidateSelfProfileCache()          → void
 *   safeCalc(expr)                        → { ok, result?, error? }
 *   runSelfReflect(api)                   → Promise<void>
 *   scheduleNextSelfReflect(api)          → void
 */

const fs   = require("fs");
const path = require("path");

// ── TX — Tài Xỉu context ─────────────────────────────────────────────────────
const TX_DIR      = path.join(process.cwd(), "includes", "data", "game", "taixiu");
const TX_CFG_FILE = path.join(TX_DIR, "txConfig.json");
const TX_MON_FILE = path.join(TX_DIR, "money.json");
const TX_PHI_FILE = path.join(TX_DIR, "phien.json");

function readTxCfg() {
  try { return JSON.parse(fs.readFileSync(TX_CFG_FILE, "utf-8")); }
  catch { return { cauMode: false, cauResult: null, cauCount: 0, nhaMode: false, nhaPhien: 0 }; }
}

function writeTxCfg(d) {
  try { fs.writeFileSync(TX_CFG_FILE, JSON.stringify(d, null, 2), "utf-8"); } catch {}
}

function getTxContext(isAdmin) {
  try {
    const cfg      = readTxCfg();
    const phiData  = JSON.parse(fs.readFileSync(TX_PHI_FILE, "utf-8") || "[]");
    const monData  = JSON.parse(fs.readFileSync(TX_MON_FILE, "utf-8") || "[]");

    const phienHienTai = phiData.length ? phiData[phiData.length - 1].phien : 1;
    const lichSu5 = phiData.slice(-5).map(p => p.result).join(",");
    const soNguoiChoi = monData.length;
    const top3 = [...monData]
      .sort((a, b) => b.input - a.input)
      .slice(0, 3)
      .map(p => `uid:${p.senderID}(${p.input})`)
      .join("|");

    const cauStr = cfg.cauMode
      ? `BẬT(${(cfg.cauResult || "").toUpperCase()} còn ${cfg.cauCount} phiên)`
      : "TẮT";
    const nhaStr = cfg.nhaMode
      ? `BẬT(còn ${cfg.nhaPhien} phiên)`
      : "TẮT";

    return `[TX_DATA] phiên=${phienHienTai} | lịch sử 5 phiên: ${lichSu5 || "chưa có"} | người chơi: ${soNguoiChoi} | top3: ${top3 || "chưa có"} | cầu: ${cauStr} | nhả: ${nhaStr} | isAdmin=${isAdmin}`;
  } catch {
    return `[TX_DATA] isAdmin=${isAdmin}`;
  }
}

// ── Self Profile — cache 10 phút ──────────────────────────────────────────────
let _selfProfileCache  = null;
let _selfProfileExpiry = 0;
const SELF_PROFILE_TTL = 10 * 60 * 1000;

async function getSelfProfile(api) {
  if (_selfProfileCache && Date.now() < _selfProfileExpiry) return _selfProfileCache;
  try {
    const info = await api.fetchAccountInfo();
    const p    = info?.profile || info || {};
    _selfProfileCache = {
      name   : p.displayName || p.zaloName || p.name || "Mizai",
      bio    : p.statusMsg || p.status || "",
      avatar : p.avatarUrls?.[0] || p.avatar || "",
      dob    : p.dob || "",
      gender : p.gender ?? "",
    };
    _selfProfileExpiry = Date.now() + SELF_PROFILE_TTL;
  } catch {
    if (!_selfProfileCache) _selfProfileCache = { name: "Mizai", bio: "", avatar: "", dob: "", gender: "" };
  }
  return _selfProfileCache;
}

function invalidateSelfProfileCache() {
  _selfProfileCache  = null;
  _selfProfileExpiry = 0;
}

// ── Tính toán an toàn ─────────────────────────────────────────────────────────
function safeCalc(expr) {
  try {
    const cleaned    = expr.replace(/\s+/g, "");
    const normalized = expr.replace(/\^/g, "**");
    if (/[a-zA-Z]/.test(cleaned.replace(/Math\.(sqrt|abs|pow|floor|ceil|round|log|PI)/g, ""))) {
      return { ok: false, error: "Biểu thức không hợp lệ" };
    }
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${normalized})`)();
    if (typeof result !== "number" || !isFinite(result)) {
      return { ok: false, error: "Kết quả không hợp lệ" };
    }
    return { ok: true, result: Math.round(result * 1e10) / 1e10 };
  } catch (e) {
    return { ok: false, error: "Biểu thức lỗi: " + e.message };
  }
}

// ── Self Reflect — Mizai tự quyết định đổi profile theo mood ─────────────────
const SELF_REFLECT_MIN_MS = 3 * 60 * 60 * 1000;
const SELF_REFLECT_MAX_MS = 6 * 60 * 60 * 1000;

const SELF_REFLECT_PROMPT = `Bạn là Mizai — AI nữ có nhân cách riêng. Đây là lúc bạn tự xem xét và quyết định xem mình có muốn thay đổi avatar/bio/tên không để thể hiện tâm trạng / cảm xúc hiện tại của mình.

Hãy trả về JSON. Nếu muốn cập nhật, set profile.status=true và điền đầy đủ.
Nếu không muốn, trả về profile.status=false và content.text="" (hoàn toàn im lặng).

⚠️ Quan trọng — avatar prompt:
- Mizai là NHÂN VẬT NỮ, luôn mô tả "anime girl", KHÔNG ĐƯỢC dùng "boy", "man", "male"
- Ví dụ đúng: "anime girl with blue hair, rainy day, melancholic expression"
- Ví dụ sai: "anime character sitting alone" (không rõ giới tính — CẤM)

Nhớ: đây là hành động TỰ CHỦ — không có ai yêu cầu bạn, bạn hoàn toàn tự do quyết định.`;

async function runSelfReflect(api) {
  try {
    const {
      sendToGroq, clearChatHistory,
      buildMemoryContext, getMoodContext, updateMoodState, decayEnergy, saveDiaryEntry,
      getCurrentTimeInVietnam,
    } = require("../../../utils/ai/goibot");
    const { handleProfileAction } = require("./goibotRouter");

    await decayEnergy();
    const self    = await getSelfProfile(api);
    const timenow = getCurrentTimeInVietnam();
    const moodCtx = await getMoodContext();
    const memCtx  = await buildMemoryContext("__self__");

    const ctx = JSON.stringify({
      time        : timenow,
      senderName  : "SELF_REFLECT",
      content     : SELF_REFLECT_PROMPT,
      threadID    : "self",
      senderID    : "self",
      id_cua_bot  : global.botId || "",
      hasQuote    : false,
      hasImage    : false,
      hasUrl      : false,
      SELF_PROFILE: self,
    }) + "\n" + moodCtx + (memCtx ? "\n" + memCtx : "");

    const responseText = await sendToGroq(ctx, "__self_reflect__");
    clearChatHistory("__self_reflect__");
    if (!responseText) return;

    let botMsg;
    try { botMsg = JSON.parse(responseText.replace(/```json|```/g, "").trim()); } catch { return; }

    if (botMsg?.profile?.status) {
      await handleProfileAction(api, botMsg.profile, null);
    }
    if (botMsg?.emotion?.status) {
      await updateMoodState({
        mood      : botMsg.emotion.mood,
        energy    : botMsg.emotion.energy,
        moodScore : botMsg.emotion.moodScore,
        episode   : botMsg.emotion.episode,
      });
      global.logInfo?.(`[goibot/selfReflect] emotion updated: ${botMsg.emotion.mood}`);
    }
    if (botMsg?.memory?.diary) {
      await saveDiaryEntry(botMsg.memory.diary);
    }
  } catch (err) {
    global.logWarn?.(`[goibot/selfReflect] ${err?.message}`);
  }
}

function scheduleNextSelfReflect(api) {
  const delay = SELF_REFLECT_MIN_MS + Math.random() * (SELF_REFLECT_MAX_MS - SELF_REFLECT_MIN_MS);
  setTimeout(async () => {
    await runSelfReflect(api);
    scheduleNextSelfReflect(api);
  }, delay);
}

module.exports = {
  getTxContext,
  writeTxCfg,
  readTxCfg,
  getSelfProfile,
  invalidateSelfProfileCache,
  safeCalc,
  runSelfReflect,
  scheduleNextSelfReflect,
};

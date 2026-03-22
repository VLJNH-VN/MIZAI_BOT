/**
 * src/events/goibot.js
 * Mizai AI — main event handler.
 * Logic được tách vào 3 module con:
 *   goibotThrottle.js  — anti-spam & cooldown state
 *   goibotContext.js   — TX data, self-profile, safeCalc, self-reflect
 *   goibotRouter.js    — action dispatch, image gen, file ops, reaction
 */

const {
  sendToGroq, isEnabled, getBody,
  getCurrentTimeInVietnam, TRIGGER_KEYWORDS,
  fetchImageAsBase64, extractImageUrl, extractUrls,
  buildMemoryContext, saveUserNote, saveDiaryEntry, saveGlobalNote,
  getMoodContext, updateMoodState, decayEnergy,
} = require("../../../utils/ai/goibot");

const { isTracked, registerReply } = require("../../../includes/handlers/handleReply");

const {
  isUserProcessing, setUserProcessing,
  getUserLastCall, setUserLastCall,
  getLastAutoReply, setLastAutoReply,
  isAutoReplied,
  USER_AI_COOLDOWN_MS, AUTO_REPLY_COOLDOWN_MS, AUTO_REPLY_CHANCE, AUTO_REPLY_MIN_LEN,
} = require("./goibotThrottle");

const {
  getTxContext, getSelfProfile,
  scheduleNextSelfReflect,
} = require("./goibotContext");

const {
  handleFileAction, routeBotActions,
} = require("./goibotRouter");

const SEARCH_KEYWORDS = [
  "tin tức", "tin mới", "mới nhất", "hôm nay", "hôm qua",
  "thời tiết", "giá", "tỉ giá", "tỷ giá", "kết quả",
  "bóng đá", "lịch thi", "thể thao", "sự kiện",
  "news", "latest", "weather", "price", "score",
  "vừa xảy ra", "gần đây", "hiện tại", "bây giờ",
];

// ── Main handler ───────────────────────────────────────────────────────────────
async function handleGoibot({ api, event }) {
  const threadId = event.threadId;
  const raw      = event?.data || {};
  const senderId = String(raw.uidFrom || "");
  const botId    = global.botId || "";

  if (senderId === botId) return;
  if (!(await isEnabled(threadId))) return;

  const body = getBody(event);
  if (!body) return;

  const prefix      = global.prefix || ".";
  const trimmedBody = body.trimStart();
  if (trimmedBody.startsWith(prefix)) return;
  const prefixIdx = trimmedBody.indexOf(prefix);
  if (prefixIdx > 0 && /^@/.test(trimmedBody.slice(0, prefixIdx).trim())) return;

  const bodyLower    = body.toLowerCase();
  const quoteUidFrom = String(raw.quote?.ownerId || raw.quote?.uidFrom || "");
  const isReplyToBot = !!botId && quoteUidFrom === botId;
  const isTriggered  = TRIGGER_KEYWORDS.some(kw => bodyLower.includes(kw));

  // ── Watch mode ────────────────────────────────────────────────────────────
  let isWatchMode = false;
  if (!isTriggered && !isReplyToBot) {
    if (isAutoReplied(bodyLower)) return;
    const lastAuto    = getLastAutoReply(threadId);
    const passChance  = Math.random() < AUTO_REPLY_CHANCE;
    const passCooldown = Date.now() - lastAuto > AUTO_REPLY_COOLDOWN_MS;
    const passLen     = body.trim().length >= AUTO_REPLY_MIN_LEN;
    if (!passChance || !passCooldown || !passLen) return;
    isWatchMode = true;
  }

  const quoteMsgId = raw?.quote?.msgId || raw?.quote?.globalMsgId || "";
  if (quoteMsgId && isTracked(String(quoteMsgId))) return;

  const userKey = `${threadId}:${senderId}`;
  if (isUserProcessing(userKey)) return;

  const now      = Date.now();
  const lastCall = getUserLastCall(userKey);

  if (!isWatchMode && now - lastCall < USER_AI_COOLDOWN_MS) {
    const waitSec = Math.ceil((USER_AI_COOLDOWN_MS - (now - lastCall)) / 1000);
    try {
      await api.sendMessage({ msg: `⏳ Bạn gọi Mizai quá nhanh! Chờ ${waitSec}s nhé.`, quote: raw }, threadId, event.type);
    } catch {
      await api.sendMessage({ msg: `⏳ Bạn gọi Mizai quá nhanh! Chờ ${waitSec}s nhé.` }, threadId, event.type);
    }
    return;
  }

  setUserProcessing(userKey, true);
  if (!isWatchMode) setUserLastCall(userKey, now);

  const send = async (msg) => {
    try {
      return await api.sendMessage({ msg, quote: raw }, threadId, event.type);
    } catch {
      return await api.sendMessage({ msg }, threadId, event.type);
    }
  };

  try {
    await decayEnergy();

    const timenow  = getCurrentTimeInVietnam();
    const nameUser = await api.getUserInfo(senderId)
      .then(info => info?.changed_profiles?.[senderId]?.displayName || senderId)
      .catch(() => senderId);

    const hasQuote = !!raw.quote;

    const { isBotAdmin } = require("../../../utils/bot/botManager");
    const isAdmin = isBotAdmin(senderId);

    const imageParts   = [];
    const imgUrlCurrent = extractImageUrl(raw);
    const imgUrlQuote   = raw.quote ? extractImageUrl(raw.quote) : null;
    const imgUrlToUse   = imgUrlCurrent || imgUrlQuote;

    if (raw.quote) {
      global.logInfo?.(`[goibot/debug] cliMsgType=${raw.quote.cliMsgType} attach_type=${typeof raw.quote.attach}`);
      global.logInfo?.(`[goibot/debug] attach: ${String(raw.quote.attach).slice(0, 400)}`);
      global.logInfo?.(`[goibot/debug] fromD: ${String(raw.quote.fromD).slice(0, 400)}`);
      global.logInfo?.(`[goibot/debug] imgUrlQuote=${imgUrlQuote}`);
    }

    if (imgUrlToUse) {
      try {
        const imgData = await fetchImageAsBase64(imgUrlToUse);
        imageParts.push(imgData);
      } catch (imgErr) {
        global.logWarn?.(`[goibot] Không tải được ảnh: ${imgErr?.message}`);
      }
    }

    const urls      = extractUrls(body);
    const useSearch = urls.length === 0 && SEARCH_KEYWORDS.some(kw => bodyLower.includes(kw));

    const hasImage = imageParts.length > 0;
    const hasUrl   = urls.length > 0;

    const selfProfile = await getSelfProfile(api);
    const moodCtx     = await getMoodContext();
    const memoryCtx   = await buildMemoryContext(senderId);

    await saveUserNote(senderId, nameUser, null);

    const watchModeNote = isWatchMode
      ? "\n[WATCH_MODE] Mizai đang tự đọc tin nhắn này mà KHÔNG được gọi. Mizai tự quyết định có muốn chen vào không. Nếu tin nhắn không thú vị, không liên quan, hoặc Mizai không có gì để nói — hãy để content.text TRỐNG và KHÔNG làm gì. Chỉ phản hồi khi thật sự muốn. KHÔNG cần giải thích lý do im lặng."
      : "";

    const userMessage = JSON.stringify({
      time: timenow, senderName: nameUser, content: body,
      threadID: threadId, senderID: senderId,
      id_cua_bot: botId, hasQuote, hasImage, hasUrl,
      SELF_PROFILE: selfProfile,
    }) + "\n" + moodCtx + (memoryCtx ? "\n" + memoryCtx : "") + (isAdmin ? `\n${getTxContext(true)}` : "") + watchModeNote;

    const responseText = await sendToGroq(userMessage, threadId, {
      imageParts,
      useSearch,
      urls,
    });

    if (!responseText) return;

    let botMsg;
    try {
      botMsg = JSON.parse(responseText.replace(/```json|```/g, "").trim());
    } catch {
      return send(responseText.trim() || "❌ Không có phản hồi.");
    }

    await routeBotActions(botMsg, {
      api, raw, threadId, type: event.type, send,
      senderId, nameUser, hasQuote, isAdmin,
      registerReply,
      isWatchMode,
      updateMoodState, saveUserNote, saveDiaryEntry, saveGlobalNote,
      getLastAutoReply, setLastAutoReply,
    });

  } catch (err) {
    const msg      = err?.response?.data?.error?.message || err?.stderr || err?.message || String(err);
    const msgLower = msg.toLowerCase();
    global.logError?.(`[goibot] Lỗi: ${msg}`);

    if (msgLower.includes("không có") && msgLower.includes("key")) return;
    if (msgLower.includes("no key") || msgLower.includes("chưa có")) return;

    if (msgLower.includes("rate-limit") || msgLower.includes("rate_limit") || msgLower.includes("too many") || msgLower.includes("cooldown"))
      await send("⏳ Mizai đang bận, thử lại sau ít giây nhé.");
    else if (msgLower.includes("hết quota") || msgLower.includes("resource_exhausted") || msgLower.includes("quota"))
      await send("💳 Key AI hết quota rồi. Thêm key mới bằng .key add nhé!");
    else if (msgLower.includes("401") || msgLower.includes("invalid_api_key") || msgLower.includes("invalid key"))
      await send("🔑 API key không hợp lệ. Kiểm tra lại bằng .key check nhé.");
    else
      await send("❌ Lỗi Mizai: " + msg.slice(0, 120));
  } finally {
    setUserProcessing(userKey, false);
  }
}

// ── Khởi động ─────────────────────────────────────────────────────────────────
function startGoibot(api) {
  api.listener.on("message", async (event) => {
    try {
      await handleGoibot({ api, event });
    } catch (err) {
      global.logWarn?.(`[Goibot] Lỗi xử lý: ${err?.message}`);
    }
  });

  // Lên lịch self-reflect (Mizai tự cập nhật profile theo mood 3-6h/lần)
  scheduleNextSelfReflect(api);
}

module.exports = { startGoibot, handleGoibot, handleFileAction };

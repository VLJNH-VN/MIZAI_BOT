const { ThreadType } = require("zca-js");
const { resolveSenderName, resolveGroupName } = require("../database/message/infoCache");
const { isBotAdmin, isGroupAdmin } = require("../../utils/bot/botManager");
const { extractBody } = require("../../utils/bot/messageUtils");
const stringSimilarity = require("string-similarity");
const { registerReply } = require("./handleReply");
const { registerReaction, reactError, reactSuccess, reactLoading } = require("./handleReaction");
const { registerUndo } = require("./handleUndo");
const { readConfig } = require("../../utils/media/helpers");
const { getRentInfo, isRentExpired } = require("../database/moderation/rent");
const { checkAndSet: checkCooldownDb } = require("../database/user/cooldown");

// ── Ghi nhớ nhóm vào bảng groups (SQLite, thay cho groupsCache.json) ─────────
async function trackGroupForBroadcast(threadID) {
  if (!threadID) return;
  try {
    const { getDb, run } = require("../database/core/sqlite");
    const db  = await getDb();
    const now = Date.now();
    await run(db,
      `INSERT INTO groups (group_id, name, first_seen, updated_at)
       VALUES (?, '', ?, ?)
       ON CONFLICT(group_id) DO NOTHING`,
      [String(threadID), now, now]
    );
  } catch {}
}

// ── Permission check ───────────────────────────────────────────────────────────
async function checkPermission({ permLevel, senderId, event, threadID, send, api }) {
  const level = Number(permLevel ?? 0);

  if (level === 2) {
    if (!isBotAdmin(senderId)) {
      const { getBotAdminIds } = require("../../utils/bot/botManager");
      const adminSet = getBotAdminIds();
      logWarn(`[PERM] Từ chối lệnh admin. senderId="${senderId}" | adminIds=${JSON.stringify([...adminSet])}`);
      await send(
        "⛔ Bạn không đủ quyền để dùng lệnh này.\n" +
        "👑 Chỉ Admin bot mới được sử dụng."
      );
      return false;
    }
  }

  if (level === 1) {
    if (event.type !== ThreadType.Group) {
      await send("⛔ Lệnh này chỉ dùng được trong nhóm bởi Quản Trị Viên.");
      return false;
    }
    const ok = await isGroupAdmin({ api, groupId: threadID, userId: senderId });
    if (!ok) {
      await send(
        "⛔ Bạn không đủ quyền.\n" +
        "🛡️ Chỉ Quản Trị Viên nhóm mới được dùng lệnh này."
      );
      return false;
    }
  }

  return true;
}

// ── Cooldown check (persistent SQLite) ────────────────────────────────────────
async function checkCooldown({ canonicalName, senderId, cooldownSec, send }) {
  const { ok, waitSec } = await checkCooldownDb(canonicalName, senderId, cooldownSec);
  if (!ok) {
    await send(`⏳ Vui lòng chờ ${waitSec}s rồi dùng lại lệnh \`${canonicalName}\`.`);
    return false;
  }
  return true;
}

function getSenderId(raw) {
  return raw?.uidFrom ? String(raw.uidFrom) : "unknown";
}

function formatUptime() {
  const totalSec = Math.floor(process.uptime());
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${m}m ${s}s`;
}

function buildSend(api, raw, threadID, eventType) {
  return async (message) => {
    if (!threadID) return null;
    try {
      const payload = typeof message === "string" ? { msg: message, quote: raw } : message;
      return await api.sendMessage(payload, threadID, eventType);
    } catch {
      try {
        const fallback = typeof message === "string" ? { msg: message } : message;
        return await api.sendMessage(fallback, threadID, eventType);
      } catch {
        return null;
      }
    }
  };
}

// ── Main handler ───────────────────────────────────────────────────────────────
async function handleCommand({ api, event, commands, prefix }) {
  try {
    const raw = event?.data ?? null;
    if (!raw) return;

    let body = extractBody(raw);
    if (!body) return;

    // ── Lấy prefix riêng nhóm ─────────────────────────────────────────────
    const isGroupMsg = event.type === ThreadType.Group;
    let effectivePrefix = prefix;
    if (isGroupMsg && event.threadId && global.Threads) {
      try { effectivePrefix = await global.Threads.getPrefix(event.threadId); } catch (_) {}
    }

    // ── Strip leading @mention(s) ─────────────────────────────────────────
    if (!body.startsWith(effectivePrefix)) {
      const idx = body.indexOf(effectivePrefix);
      if (idx > 0 && /^@/.test(body.slice(0, idx).trim())) body = body.slice(idx);
    }

    if (!body.startsWith(effectivePrefix)) return;

    const withoutPrefix = body.slice(effectivePrefix.length).trim();

    const senderId = getSenderId(raw);
    const threadID = event.threadId;
    const isGroup  = event.type === ThreadType.Group;
    const send     = buildSend(api, raw, threadID, event.type);

    // ── Kiểm tra thuê bot (từ in-memory cache, O(1)) ─────────────────────
    if (isGroup && threadID && !isBotAdmin(senderId)) {
      const rentInfo = getRentInfo(threadID);

      const sendRentBlock = async (msg) => {
        const sentMsg = await api.sendMessage({ msg }, threadID, event.type);
        const msgId   = sentMsg?.msgId || sentMsg?.messageId || sentMsg?.cliMsgId;
        if (msgId) {
          registerReply({ messageId: String(msgId), commandName: "rent", payload: { type: "RentKey", threadID, senderId } });
        }
      };

      if (!rentInfo) {
        const cfg     = readConfig();
        const fbAdmin = cfg.FACEBOOK_ADMIN || cfg.facebookAdmin || "";
        await sendRentBlock(
          `❎ Nhóm của bạn chưa thuê bot!\n` +
          `💡 Reply tin nhắn này và nhập key thuê bot để kích hoạt.\n` +
          (fbAdmin ? `📩 Liên hệ admin để lấy key: ${fbAdmin}` : `📩 Liên hệ admin bot để lấy key thuê.`)
        );
        return;
      }

      if (isRentExpired(threadID)) {
        const cfg     = readConfig();
        const fbAdmin = cfg.FACEBOOK_ADMIN || cfg.facebookAdmin || "";
        await sendRentBlock(
          `⚠️ Thời hạn thuê bot của nhóm đã hết (${rentInfo.time_end})!\n` +
          `💡 Reply tin nhắn này và nhập key gia hạn để tiếp tục sử dụng.\n` +
          (fbAdmin ? `📩 Liên hệ admin để lấy key: ${fbAdmin}` : `📩 Liên hệ admin bot để lấy key thuê.`)
        );
        return;
      }
    }

    const parts       = withoutPrefix.split(/\s+/);
    const commandName = parts.shift().toLowerCase();
    const args        = parts;

    if (commandName && !/[a-z0-9]/i.test(commandName)) return;

    // ── Ghi nhớ nhóm cho broadcast (async, không block) ──────────────────
    if (isGroup && threadID) trackGroupForBroadcast(threadID).catch(() => {});

    const command = commandName ? commands.get(commandName) : undefined;

    // ── Lệnh không tồn tại → gợi ý ───────────────────────────────────────
    if (!command) {
      const seen      = new Set();
      const mainNames = [];
      for (const [, cmd] of commands) {
        const n = cmd?.config?.name;
        if (n && !seen.has(n)) { seen.add(n); mainNames.push(n); }
      }
      if (!mainNames.length) return;

      const { bestMatch } = commandName
        ? stringSimilarity.findBestMatch(commandName, mainNames)
        : { bestMatch: { rating: 0, target: "help" } };
      const suggestion    = bestMatch.rating >= 0.3
        ? `${effectivePrefix}${bestMatch.target}`
        : `${effectivePrefix}help`;

      let userName = senderId;
      try { userName = await resolveSenderName({ api, userId: senderId }); } catch {}

      const notFoundText =
        `❓ Không tìm thấy lệnh: ${effectivePrefix}${commandName}\n` +
        `👤 ${userName}\n` +
        `💡 Ý bạn là: ${suggestion} ?\n` +
        `📋 Gõ ${effectivePrefix}help để xem danh sách lệnh.\n` +
        `⏰ Uptime: ${formatUptime()}`;

      if (global.Ljzi?.cacheSize("vdgai") > 0) {
        await global.Ljzi.send(api, event, "vdgai", notFoundText).catch(() => send(notFoundText));
      } else {
        await send(notFoundText);
      }
      return;
    }

    const cfg          = command.config || {};
    const canonicalName = cfg.name ? String(cfg.name).toLowerCase() : commandName;

    // ── Permission ─────────────────────────────────────────────────────────
    const allowed = await checkPermission({ permLevel: cfg.hasPermssion, senderId, event, threadID, send, api });
    if (!allowed) return;

    // ── Cooldown (persistent SQLite) ───────────────────────────────────────
    const cooldownOk = await checkCooldown({ canonicalName, senderId, cooldownSec: Number(cfg.cooldowns ?? 0), send });
    if (!cooldownOk) return;

    // ── Thực thi lệnh ─────────────────────────────────────────────────────
    const startTime = Date.now();
    await command.run({
      api, event, args, send, commands,
      prefix: effectivePrefix, commandName: canonicalName,
      senderId, threadID, isGroup,
      isBotAdmin, isGroupAdmin,
      registerReply, registerReaction, registerUndo,
      reactError, reactSuccess, reactLoading,
    });
    const execTime = Date.now() - startTime;

    // ── Log ────────────────────────────────────────────────────────────────
    let userName  = senderId;
    let groupName = isGroup ? String(threadID) : "Nhắn riêng";
    try { userName  = await resolveSenderName({ api, userId: senderId }); } catch {}
    try { if (isGroup && threadID) groupName = await resolveGroupName({ api, groupId: threadID }); } catch {}

    const argsStr = args.length > 0 ? args.join(" ") : "(không có)";
    logEvent(`[ CMD:${canonicalName.toUpperCase()} ] ${userName} | ${groupName} | args: ${argsStr} | ${execTime}ms`);
  } catch (err) {
    logError(`❎ Lỗi thực thi lệnh: ${err?.message || err}`);
  }
}

module.exports = { handleCommand };

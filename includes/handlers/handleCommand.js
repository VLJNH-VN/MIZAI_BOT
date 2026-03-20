const { ThreadType } = require("zca-js");
const { resolveSenderName, resolveGroupName } = require("../database/infoCache");
const { isBotAdmin, isGroupAdmin } = require("../../utils/bot/botManager");
const { extractBody } = require("../../utils/bot/messageUtils");
const stringSimilarity = require("string-similarity");
const { registerReply } = require("./handleReply");
const { registerReaction } = require("./handleReaction");
const { registerUndo } = require("./handleUndo");
const fs = require("fs");
const path = require("path");

// ── Ghi nhớ nhóm cho broadcast ────────────────────────────────────────────────
const GROUPS_CACHE_PATH = path.join(__dirname, "../../includes/database/groupsCache.json");

function trackGroupForBroadcast(threadID) {
  if (!threadID) return;
  try {
    let cache = {};
    try { cache = JSON.parse(fs.readFileSync(GROUPS_CACHE_PATH, "utf-8")); } catch {}
    if (!cache[threadID]) {
      cache[threadID] = { addedAt: Date.now() };
      fs.writeFileSync(GROUPS_CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
    }
  } catch {}
}

// ── Cooldown store ─────────────────────────────────────────────────────────────
const cooldownStore = new Map();

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
    if (!threadID) {
      logError("Không tìm thấy threadId để gửi tin nhắn.");
      return;
    }
    const payload =
      typeof message === "string"
        ? { msg: message, quote: raw }
        : message;
    return api.sendMessage(payload, threadID, eventType);
  };
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

// ── Cooldown check ─────────────────────────────────────────────────────────────
// canonicalName: tên gốc của command (cfg.name), không phải alias
// Đảm bảo alias chia sẻ cùng cooldown với lệnh gốc
async function checkCooldown({ canonicalName, senderId, cooldownSec, send }) {
  if (!Number.isFinite(cooldownSec) || cooldownSec <= 0) return true;

  const key = `${canonicalName}:${senderId}`;
  const last = cooldownStore.get(key) || 0;
  const elapsed = Date.now() - last;
  const waitMs = cooldownSec * 1000 - elapsed;

  if (waitMs > 0) {
    const waitSec = Math.ceil(waitMs / 1000);
    await send(`⏳ Vui lòng chờ ${waitSec}s rồi dùng lại lệnh \`${canonicalName}\`.`);
    return false;
  }

  cooldownStore.set(key, Date.now());
  return true;
}

// ── Main handler ───────────────────────────────────────────────────────────────
async function handleCommand({ api, event, commands, prefix }) {
  try {
    const raw = event?.data ?? null;
    if (!raw) return;

    let body = extractBody(raw);
    if (!body) return;

    // ── Lấy prefix riêng nhóm (nếu là tin nhắn nhóm) ─────────────────────────
    const isGroupMsg = event.type === ThreadType.Group;
    let effectivePrefix = prefix;
    if (isGroupMsg && event.threadId && global.Threads) {
      try {
        effectivePrefix = await global.Threads.getPrefix(event.threadId);
      } catch (_) {}
    }

    // ── Strip leading @mention(s): "@Tên người !lệnh" → "!lệnh" ──────────────
    if (!body.startsWith(effectivePrefix)) {
      const idx = body.indexOf(effectivePrefix);
      if (idx > 0 && /^@/.test(body.slice(0, idx).trim())) {
        body = body.slice(idx);
      }
    }

    if (!body.startsWith(effectivePrefix)) return;

    const withoutPrefix = body.slice(effectivePrefix.length).trim();

    const senderId = getSenderId(raw);
    const threadID = event.threadId;
    const isGroup = event.type === ThreadType.Group;
    const send = buildSend(api, raw, threadID, event.type);

    // ── Prefix một mình (gõ "!" hoặc "@Bot !") → hiện help ───────────────────
    if (!withoutPrefix) {
      if (isGroup && threadID) trackGroupForBroadcast(threadID);
      const helpCmd = commands.get("help") || commands.get("menu");
      if (helpCmd) {
        await helpCmd.run({
          api, event, args: [], send, commands, prefix: effectivePrefix,
          commandName: "help", senderId, threadID, isGroup,
          isBotAdmin, isGroupAdmin, registerReply, registerReaction, registerUndo
        });
      }
      return;
    }

    const parts = withoutPrefix.split(/\s+/);
    const commandName = parts.shift().toLowerCase();
    const args = parts;

    if (isGroup && threadID) trackGroupForBroadcast(threadID);

    const command = commands.get(commandName);

    // ── Lệnh không tồn tại → gợi ý ───────────────────────────────────────────
    if (!command) {
      // Chỉ gợi ý từ tên lệnh chính (cfg.name), không include alias
      const seen = new Set();
      const mainNames = [];
      for (const [, cmd] of commands) {
        const n = cmd?.config?.name;
        if (n && !seen.has(n)) { seen.add(n); mainNames.push(n); }
      }
      if (mainNames.length === 0) return;

      const { bestMatch } = stringSimilarity.findBestMatch(commandName, mainNames);
      const suggestion =
        bestMatch.rating >= 0.3
          ? `${effectivePrefix}${bestMatch.target}`
          : `${effectivePrefix}help`;

      let userName = senderId;
      try { userName = await resolveSenderName({ api, userId: senderId }); } catch {}

      await send(
        `❓ Không tìm thấy lệnh: ${effectivePrefix}${commandName}\n` +
        `👤 ${userName}\n` +
        `💡 Ý bạn là: ${suggestion} ?\n` +
        `📋 Gõ ${effectivePrefix}help để xem danh sách lệnh.\n` +
        `⏰ Uptime: ${formatUptime()}`
      );
      return;
    }

    const cfg          = command.config || {};
    const canonicalName = cfg.name ? String(cfg.name).toLowerCase() : commandName;

    // ── Permission ─────────────────────────────────────────────────────────────
    const allowed = await checkPermission({
      permLevel: cfg.hasPermssion,
      senderId,
      event,
      threadID,
      send,
      api
    });
    if (!allowed) return;

    // ── Cooldown — dùng canonicalName để alias chia sẻ cooldown với lệnh gốc ──
    const cooldownOk = await checkCooldown({
      canonicalName,
      senderId,
      cooldownSec: Number(cfg.cooldowns ?? 0),
      send
    });
    if (!cooldownOk) return;

    // ── Thực thi lệnh ─────────────────────────────────────────────────────────
    const startTime = Date.now();
    await command.run({
      api,
      event,
      args,
      send,
      commands,
      prefix: effectivePrefix,
      commandName: canonicalName,
      senderId,
      threadID,
      isGroup,
      isBotAdmin,
      isGroupAdmin,
      registerReply,
      registerReaction,
      registerUndo
    });
    const execTime = Date.now() - startTime;

    // ── Log ────────────────────────────────────────────────────────────────────
    let userName = senderId;
    let groupName = isGroup ? String(threadID) : "Nhắn riêng";
    try { userName = await resolveSenderName({ api, userId: senderId }); } catch {}
    try {
      if (isGroup && threadID) groupName = await resolveGroupName({ api, groupId: threadID });
    } catch {}

    const argsStr = args.length > 0 ? args.join(" ") : "(không có)";
    logEvent(
      `[ CMD:${canonicalName.toUpperCase()} ] ${userName} | ${groupName} | args: ${argsStr} | ${execTime}ms`
    );
  } catch (err) {
    logError(`❎ Lỗi thực thi lệnh: ${err?.message || err}`);
  }
}

module.exports = { handleCommand };

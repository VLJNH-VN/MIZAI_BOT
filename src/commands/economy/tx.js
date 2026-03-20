"use strict";

/**
 * src/commands/tx.js
 * Game Tài Xỉu — đặt cược, nạp/rút tiền, bảng xếp hạng
 */

const fs   = require("fs");
const path = require("path");
const { registerReply } = require("../../includes/handlers/handleReply");
const { getUserMoney, updateUserMoney } = require("../../includes/database/economy");
const { resolveSenderName }             = require("../../includes/database/infoCache");
const { isBotAdmin, isGroupAdmin }      = require("../../utils/bot/botManager");
const { parseMentionIds }               = require("../../utils/bot/messageUtils");

const ROOT       = process.cwd();
const TX_DIR     = path.join(ROOT, "includes", "data", "taixiu");
const BET_DIR    = path.join(TX_DIR, "betHistory");
const LSGD_DIR   = path.join(TX_DIR, "lichsuGD");
const PHIEN_FILE = path.join(TX_DIR, "phien.json");
const MONEY_FILE = path.join(TX_DIR, "money.json");
const CHECK_FILE = path.join(TX_DIR, "fileCheck.json");

for (const d of [TX_DIR, BET_DIR, LSGD_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
for (const f of [PHIEN_FILE, MONEY_FILE, CHECK_FILE]) {
  if (!fs.existsSync(f)) fs.writeFileSync(f, "[]", "utf-8");
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function readJson(f)    { try { return JSON.parse(fs.readFileSync(f, "utf-8")); } catch { return []; } }
function writeJson(f,d) { fs.writeFileSync(f, JSON.stringify(d, null, 2), "utf-8"); }
function fmtMoney(n)    { return parseInt(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function fmtTime()      { return new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }); }
function fmtTimeFull(ts){ return new Date(ts).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }); }
function fmtClock()     { return new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }); }

function getPlayer(senderID) {
  const checkmn = readJson(MONEY_FILE);
  return { checkmn, player: checkmn.find(e => String(e.senderID) === String(senderID)) };
}

function ensurePlayer(checkmn, senderID) {
  let p = checkmn.find(e => String(e.senderID) === String(senderID));
  if (!p) {
    p = { senderID: String(senderID), input: 0 };
    checkmn.push(p);
  }
  return p;
}

function addHistory(uid, entry) {
  const f = path.join(LSGD_DIR, `${uid}.json`);
  const arr = fs.existsSync(f) ? readJson(f) : [];
  arr.push(entry);
  writeJson(f, arr);
}

function getTargetId(raw) {
  // Parse mentionInfo (Zalo format: JSON string array of {uid, length, offset})
  const mentionInfo = raw?.mentionInfo;
  if (mentionInfo) {
    try {
      const arr = typeof mentionInfo === "string" ? JSON.parse(mentionInfo) : mentionInfo;
      if (Array.isArray(arr)) {
        const ids = arr.map(m => String(m.uid || "")).filter(uid => uid && uid !== "0");
        if (ids.length > 0) return ids[0];
      }
    } catch {}
  }
  const quote = raw?.quote || raw?.replyMsg || null;
  if (quote?.ownerId) return String(quote.ownerId);
  return null;
}

function rigDice(side) {
  let d1, d2, d3, att = 0;
  do {
    d1 = Math.floor(Math.random() * 6) + 1;
    d2 = Math.floor(Math.random() * 6) + 1;
    d3 = Math.floor(Math.random() * 6) + 1;
    if (++att > 500) break;
  } while ((d1 + d2 + d3 <= 10 ? "xỉu" : "tài") !== side);
  const total = d1 + d2 + d3;
  return { dice1: d1, dice2: d2, dice3: d3, total, result: total <= 10 ? "xỉu" : "tài" };
}

function isAdminAutoWin(uid) {
  try {
    const cfgPath = path.join(TX_DIR, "txConfig.json");
    const txCfg   = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf-8")) : {};
    if (txCfg.autoAdminWin === false) return false;
    const adminIds = new Set([
      ...(global.config?.adminBotIds || []).map(String),
      global.config?.ownerId ? String(global.config.ownerId) : "",
    ].filter(Boolean));
    return adminIds.has(String(uid));
  } catch { return false; }
}

// ── Command ────────────────────────────────────────────────────────────────────
module.exports = {
  config: {
    name:            "tx",
    version:         "1.0.0",
    hasPermssion:    0,
    credits:         "Niio-team (Vtuan) — converted MiZai",
    description:     "Game Tài Xỉu — đặt cược, nạp/rút, bảng xếp hạng",
    commandCategory: "Game",
    usages: [
      "tx                — Xem hướng dẫn",
      "tx tài/xỉu <tiền>— Đặt cược",
      "tx nap <tiền>     — Nạp tiền từ ví vào game",
      "tx rut <tiền>     — Rút tiền từ game về ví",
      "tx pay @/reply <tiền> — Chuyển tiền cho người khác",
      "tx check [@/reply]    — Xem số dư",
      "tx his [@/reply]      — Lịch sử giao dịch",
      "tx top            — Bảng xếp hạng",
      "tx on/off         — Bật/tắt phòng game nhóm [Admin]",
      "tx set me/uid/all <tiền> — Admin: set tiền",
      "tx reset [@/uid]  — Admin: reset tiền",
    ].join("\n"),
    cooldowns: 2,
  },

  run: async ({ api, event, args, send, senderId, threadID, prefix }) => {
    const raw    = event?.data ?? {};
    const sub    = (args[0] || "").toLowerCase().trim();

    if (!sub) {
      return send(
        `🎲 [ TÀI XỈU ]\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `${prefix}tx on/off           — Bật/tắt server game\n` +
        `${prefix}tx tài/xỉu <tiền>  — Đặt cược (all, %, số)\n` +
        `${prefix}tx nap <tiền>       — Nạp từ ví vào game\n` +
        `${prefix}tx rut <tiền>       — Rút từ game về ví\n` +
        `${prefix}tx pay @/reply <$>  — Chuyển tiền\n` +
        `${prefix}tx check            — Xem số dư game\n` +
        `${prefix}tx his              — Lịch sử giao dịch\n` +
        `${prefix}tx top              — Bảng xếp hạng\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `⚠️ Server liên kết toàn bộ nhóm!\n` +
        `💡 Đặt cược đơn nếu phòng chưa bật.`
      );
    }

    // ── on / off ───────────────────────────────────────────────────────────────
    if (sub === "on" || sub === "off") {
      const isAdmin  = isBotAdmin(senderId);
      const isGrAdm  = await isGroupAdmin({ api, groupId: threadID, userId: senderId });
      if (!isAdmin && !isGrAdm) return send("❌ Bạn cần là Admin nhóm hoặc Admin bot để dùng lệnh này!");

      const checkData = readJson(CHECK_FILE);
      if (sub === "on") {
        if (checkData.includes(threadID)) return send("⚠️ Game đã được bật trong nhóm này rồi!");
        checkData.push(threadID);
        writeJson(CHECK_FILE, checkData);
        return send("✅ Đã bật game Tài Xỉu cho nhóm này!");
      } else {
        const idx = checkData.indexOf(threadID);
        if (idx === -1) return send("⚠️ Game chưa được bật trong nhóm này.");
        checkData.splice(idx, 1);
        writeJson(CHECK_FILE, checkData);
        return send("🔕 Đã tắt game Tài Xỉu cho nhóm này!");
      }
    }

    // ── set (admin) ────────────────────────────────────────────────────────────
    if (sub === "set") {
      if (!isBotAdmin(senderId)) return send("⛔ Chỉ Admin bot mới dùng được lệnh này!");
      const second = (args[1] || "").toLowerCase();
      const checkmn = readJson(MONEY_FILE);

      if (second === "all") {
        const input = parseInt(args[2]);
        if (isNaN(input)) return send("❌ Số tiền không hợp lệ!");
        const members = raw?.participantIDs || [];
        for (const id of members) {
          const p = ensurePlayer(checkmn, id);
          const old = p.input;
          p.input += input;
          addHistory(id, { senderID: id, time: Date.now(), input, historic_input: old });
        }
        writeJson(MONEY_FILE, checkmn);
        return send(`💰 Đã thêm ${fmtMoney(input)} VNĐ cho ${members.length} thành viên!`);
      }

      let uid, input;
      if (second === "me") {
        uid   = senderId;
        input = parseInt(args[2]);
      } else {
        uid   = getTargetId(raw) || (isNaN(parseInt(args[1])) ? null : args[1]);
        input = parseInt(args[2] ?? args[1]);
      }

      if (!uid) return send("❌ Không xác định được người dùng! Tag, reply hoặc nhập UID.");
      if (isNaN(input)) return send("❌ Số tiền không hợp lệ!");

      const p   = ensurePlayer(checkmn, uid);
      const old = p.input;
      p.input  += input;
      writeJson(MONEY_FILE, checkmn);
      addHistory(uid, { senderID: uid, time: Date.now(), input, historic_input: old });

      const name = await resolveSenderName({ api, userId: uid }).catch(() => uid);
      return send(
        `💰 Đã set tiền thành công!\n` +
        `👤 ${name} (${uid})\n` +
        `➕ ${fmtMoney(input)} VNĐ\n` +
        `🕒 ${fmtTime()}`
      );
    }

    // ── nap (nạp) ──────────────────────────────────────────────────────────────
    if (sub === "nap" || sub === "nạp") {
      const walletMoney = await getUserMoney(senderId);
      let input = args[1]?.toLowerCase() === "all" ? walletMoney : parseInt(args[1]);
      if (!input || isNaN(input) || input <= 0) return send(`❌ Nhập số tiền cần nạp.\nVí dụ: ${prefix}tx nap 100000`);
      if (input > walletMoney) return send(`❌ Ví không đủ tiền!\n💰 Ví: ${fmtMoney(walletMoney)} VNĐ`);

      const result = await updateUserMoney(senderId, input, "sub");
      if (result === false) return send("❌ Trừ tiền ví thất bại!");

      const gameInput = Math.round(input / 10);
      const checkmn   = readJson(MONEY_FILE);
      const p         = ensurePlayer(checkmn, senderId);
      const old       = p.input;
      p.input        += gameInput;
      writeJson(MONEY_FILE, checkmn);
      addHistory(senderId, { senderID: senderId, time: Date.now(), input: gameInput, historic_input: old });

      const name = await resolveSenderName({ api, userId: senderId }).catch(() => senderId);
      return send(
        `✅ Nạp tiền thành công!\n` +
        `👤 ${name}\n` +
        `💰 Ví: ${fmtMoney(input)} VNĐ → Game: ${fmtMoney(gameInput)} VNĐ\n` +
        `📌 Tỉ lệ: 10 ví = 1 game\n` +
        `🕒 ${fmtTime()}`
      );
    }

    // ── rut (rút) ──────────────────────────────────────────────────────────────
    if (sub === "rut" || sub === "rút") {
      const checkmn = readJson(MONEY_FILE);
      const p = checkmn.find(e => String(e.senderID) === senderId);
      if (!p || p.input <= 0) return send("❌ Bạn không có tiền trong game!");

      let input = args[1]?.toLowerCase() === "all" ? p.input : parseInt(args[1]);
      if (!input || isNaN(input) || input <= 0) return send(`❌ Nhập số tiền cần rút.\nVí dụ: ${prefix}tx rut 1000`);
      if (input > p.input) return send(`❌ Không đủ tiền game!\n💰 Game: ${fmtMoney(p.input)} VNĐ`);

      p.input -= input;
      writeJson(MONEY_FILE, checkmn);
      const walletAdd = input * 8;
      await updateUserMoney(senderId, walletAdd, "add");

      return send(
        `✅ Rút tiền thành công!\n` +
        `💸 Game: -${fmtMoney(input)} VNĐ → Ví: +${fmtMoney(walletAdd)} VNĐ\n` +
        `📌 Tỉ lệ: 1 game = 8 ví`
      );
    }

    // ── pay ────────────────────────────────────────────────────────────────────
    if (sub === "pay") {
      const targetId = getTargetId(raw);
      if (!targetId) return send(`❌ Tag hoặc reply người nhận!\nVí dụ: ${prefix}tx pay @Bạn 5000`);
      if (targetId === senderId) return send("❌ Không thể tự chuyển cho mình!");

      const input = parseInt(args[args.length - 1]);
      if (isNaN(input) || input <= 0) return send("❌ Số tiền không hợp lệ!");

      const checkmn = readJson(MONEY_FILE);
      const sender  = checkmn.find(e => String(e.senderID) === senderId);
      if (!sender || sender.input < input) return send("❌ Không đủ tiền game để chuyển!");

      const receiver = ensurePlayer(checkmn, targetId);
      const oldS = sender.input, oldR = receiver.input;
      sender.input   -= input;
      receiver.input += input;
      writeJson(MONEY_FILE, checkmn);

      addHistory(senderId, { senderID: senderId, time: Date.now(), input: -input, historic_input: oldS });
      addHistory(targetId, { senderID: targetId, time: Date.now(), input,          historic_input: oldR });

      const sName = await resolveSenderName({ api, userId: senderId  }).catch(() => senderId);
      const rName = await resolveSenderName({ api, userId: targetId }).catch(() => targetId);
      return send(
        `💸 Chuyển tiền thành công!\n` +
        `👤 ${sName} → ${rName}\n` +
        `💰 ${fmtMoney(input)} VNĐ\n` +
        `🕒 ${fmtTime()}`
      );
    }

    // ── check ──────────────────────────────────────────────────────────────────
    if (sub === "check") {
      const uid     = getTargetId(raw) || senderId;
      const checkmn = readJson(MONEY_FILE);
      const p       = checkmn.find(e => String(e.senderID) === String(uid));
      if (!p) return send("⚠️ Người dùng chưa có tiền trong game!");

      const name = await resolveSenderName({ api, userId: uid }).catch(() => uid);
      return send(
        `💰 Số dư game\n` +
        `👤 ${name}\n` +
        `💵 ${fmtMoney(p.input)} VNĐ\n` +
        `🕒 ${fmtTime()}`
      );
    }

    // ── his (lịch sử) ──────────────────────────────────────────────────────────
    if (sub === "his") {
      const uid  = getTargetId(raw) || senderId;
      const file = path.join(LSGD_DIR, `${uid}.json`);
      if (!fs.existsSync(file)) return send("⚠️ Không có lịch sử giao dịch nào!");

      const history = readJson(file).slice(-5).reverse();
      const name    = await resolveSenderName({ api, userId: uid }).catch(() => uid);

      let msg = `📋 Lịch sử giao dịch\n👤 ${name}\n━━━━━━━━━━━━━━\n`;
      for (const e of history) {
        msg += `🕒 ${fmtTimeFull(e.time)}\n`;
        msg += `${e.input >= 0 ? "+" : ""}${fmtMoney(e.input)} VNĐ → Số dư: ${fmtMoney(e.historic_input + e.input)} VNĐ\n`;
        msg += `───────────────\n`;
      }
      return send(msg);
    }

    // ── reset (admin) ──────────────────────────────────────────────────────────
    if (sub === "reset") {
      if (!isBotAdmin(senderId)) return send("⛔ Chỉ Admin bot mới dùng được lệnh này!");

      const uid     = getTargetId(raw) || (args[1] && !isNaN(parseInt(args[1])) ? args[1] : null);
      const checkmn = readJson(MONEY_FILE);

      if (uid) {
        const idx = checkmn.findIndex(e => String(e.senderID) === String(uid));
        if (idx === -1) return send("⚠️ Người dùng không tồn tại trong hệ thống!");
        checkmn.splice(idx, 1);
        writeJson(MONEY_FILE, checkmn);
        const lsgd = path.join(LSGD_DIR, `${uid}.json`);
        if (fs.existsSync(lsgd)) fs.unlinkSync(lsgd);
        const name = await resolveSenderName({ api, userId: uid }).catch(() => uid);
        return send(`✅ Đã reset tiền của ${name}!`);
      } else {
        checkmn.splice(0, checkmn.length);
        writeJson(MONEY_FILE, checkmn);
        for (const f of fs.readdirSync(LSGD_DIR)) fs.unlinkSync(path.join(LSGD_DIR, f));
        return send("✅ Đã reset tiền tất cả người dùng!");
      }
    }

    // ── top ────────────────────────────────────────────────────────────────────
    if (sub === "top") {
      const checkmn  = readJson(MONEY_FILE);
      const topUsers = checkmn.filter(e => e.input > 0).sort((a, b) => b.input - a.input).slice(0, 10);
      if (!topUsers.length) return send("⚠️ Chưa có ai có tiền trong game!");

      let msg = `🏆 Top 10 Tài Xỉu\n━━━━━━━━━━━━━━\n`;
      for (let i = 0; i < topUsers.length; i++) {
        const name = await resolveSenderName({ api, userId: topUsers[i].senderID }).catch(() => topUsers[i].senderID);
        msg += `${i + 1}. ${name}: ${fmtMoney(topUsers[i].input)} VNĐ\n`;
      }
      return send(msg);
    }

    // ── tài / xỉu ─────────────────────────────────────────────────────────────
    if (sub === "tài" || sub === "xỉu") {
      const checkmn   = readJson(MONEY_FILE);
      const checkData = readJson(CHECK_FILE);
      const player    = checkmn.find(e => String(e.senderID) === senderId);

      if (!player) return send("⚠️ Bạn chưa có tiền trong game! Dùng lệnh nạp để nạp tiền.");
      if (player.input <= 0) return send("⚠️ Tiền game bằng 0! Dùng lệnh nạp để nạp tiền.");

      let betAmount;
      const betArg = (args[1] || "").toLowerCase();
      if (betArg === "all") {
        betAmount = player.input;
      } else if (betArg.includes("%")) {
        const pct = parseInt(betArg);
        if (isNaN(pct) || pct <= 0) return send("❌ Phần trăm không hợp lệ!");
        betAmount = Math.round(player.input * pct / 100);
      } else {
        betAmount = parseInt(betArg);
      }

      if (isNaN(betAmount) || betAmount <= 0) return send("❌ Số tiền cược không hợp lệ!");
      if (betAmount < 1000 && betArg !== "all") return send("❌ Cược tối thiểu 1,000 VNĐ!");
      if (betAmount > player.input) return send("❌ Không đủ tiền game!");
      betAmount = Math.round(betAmount);

      // ── Mode đơn (nhóm chưa bật game) ────────────────────────────────────
      if (!checkData.includes(threadID)) {
        let ket_qua = isAdminAutoWin(senderId)
          ? rigDice(sub)
          : (() => {
              const d = {
                dice1: Math.floor(Math.random() * 6) + 1,
                dice2: Math.floor(Math.random() * 6) + 1,
                dice3: Math.floor(Math.random() * 6) + 1,
              };
              d.total  = d.dice1 + d.dice2 + d.dice3;
              d.result = d.total <= 10 ? "xỉu" : "tài";
              return d;
            })();

        const win = ket_qua.result === sub;
        if (win) player.input += betAmount;
        else     player.input -= betAmount;
        writeJson(MONEY_FILE, checkmn);

        const sent = await send(
          `🎲 KẾT QUẢ:\n` +
          `━━━━━━━━━━━━━━\n` +
          `🎲 [ ${ket_qua.dice1} | ${ket_qua.dice2} | ${ket_qua.dice3} ] — ${ket_qua.result.toUpperCase()} (${ket_qua.total})\n` +
          `🎯 Bạn chọn: ${sub}\n` +
          `${win ? `🏆 THẮNG +${fmtMoney(betAmount)} VNĐ` : `💀 THUA -${fmtMoney(betAmount)} VNĐ`}\n` +
          `💰 Số dư: ${fmtMoney(player.input)} VNĐ\n` +
          `💬 Reply: tài/xỉu <tiền> để đặt tiếp`
        );
        const msgId = sent?.message?.msgId ?? sent?.attachment?.[0]?.msgId;
        if (msgId) registerReply({ messageId: msgId, commandName: "tx", payload: { senderId } });
        return;
      }

      // ── Mode phòng (nhóm đã bật game) ─────────────────────────────────────
      if (global.txTime >= 45) return send("⌛ Hết thời gian đặt cược! Chờ phiên mới.");
      if (global.txTime > 50)  return send(`⏳ Chờ phiên mới — còn ${60 - global.txTime}s`);

      const phienData = readJson(PHIEN_FILE);
      const phien     = phienData.length ? phienData[phienData.length - 1].phien : 1;
      const betFile   = path.join(BET_DIR, `${senderId}.json`);
      const betData   = fs.existsSync(betFile) ? readJson(betFile) : [];

      const existing = betData.find(e => String(e.senderID) === senderId && e.phien === phien);
      if (existing) {
        if (existing.choice !== sub) return send("⚠️ Chỉ được đặt 1 lựa chọn (tài hoặc xỉu) trong 1 phiên!");
        existing.betAmount += betAmount;
        player.input       -= betAmount;
        writeJson(MONEY_FILE, checkmn);
        writeJson(betFile, betData);
        return send(
          `[PHIÊN ${phien}]\n✅ Đặt thêm: ${sub.toUpperCase()}\n` +
          `➕ Thêm: ${fmtMoney(betAmount)} | Tổng cược: ${fmtMoney(existing.betAmount)} VNĐ\n` +
          `⏳ Còn lại: ${50 - global.txTime}s`
        );
      }

      player.input -= betAmount;
      betData.push({ senderID: senderId, choice: sub, betAmount, phien, time: Date.now() });
      writeJson(MONEY_FILE, checkmn);
      writeJson(betFile, betData);
      return send(
        `[PHIÊN ${phien}]\n✅ Đặt cược: ${sub.toUpperCase()}\n` +
        `💰 ${fmtMoney(betAmount)} VNĐ | Còn: ${fmtMoney(player.input)} VNĐ\n` +
        `⏳ Còn lại: ${50 - global.txTime}s\n` +
        `🕒 ${fmtClock()}`
      );
    }

    return send(`❌ Lệnh không hợp lệ!\nDùng ${prefix}tx để xem hướng dẫn.`);
  },

  // ── Xử lý reply đặt cược nhanh ─────────────────────────────────────────────
  onReply: async ({ api, event, data, send }) => {
    const raw      = event?.data ?? {};
    const body     = typeof raw.content === "string"
      ? raw.content
      : (raw.content?.text || raw.content?.msg || "");
    const parts    = body.trim().toLowerCase().split(/\s+/);
    const sub      = parts[0];
    const betArg   = parts[1] || "";
    const senderId = String(raw.ownerId || raw.fromId || data?.senderId || "");
    const threadID = event.threadId;

    if (sub !== "tài" && sub !== "xỉu") {
      return send(`❌ Reply bằng: tài <tiền> hoặc xỉu <tiền>`);
    }

    const checkmn = readJson(MONEY_FILE);
    const player  = checkmn.find(e => String(e.senderID) === senderId);
    if (!player)        return send("⚠️ Bạn chưa có tiền trong game! Dùng lệnh nạp để nạp tiền.");
    if (player.input <= 0) return send("⚠️ Tiền game bằng 0! Dùng lệnh nạp để nạp tiền.");

    let betAmount;
    if (betArg === "all") {
      betAmount = player.input;
    } else if (betArg.includes("%")) {
      const pct = parseInt(betArg);
      if (isNaN(pct) || pct <= 0) return send("❌ Phần trăm không hợp lệ!");
      betAmount = Math.round(player.input * pct / 100);
    } else {
      betAmount = parseInt(betArg);
    }

    if (isNaN(betAmount) || betAmount <= 0) return send("❌ Số tiền cược không hợp lệ!");
    if (betAmount < 1000 && betArg !== "all") return send("❌ Cược tối thiểu 1,000 VNĐ!");
    if (betAmount > player.input) return send("❌ Không đủ tiền game!");
    betAmount = Math.round(betAmount);

    const ket_qua = {
      dice1: Math.floor(Math.random() * 6) + 1,
      dice2: Math.floor(Math.random() * 6) + 1,
      dice3: Math.floor(Math.random() * 6) + 1,
    };
    ket_qua.total  = ket_qua.dice1 + ket_qua.dice2 + ket_qua.dice3;
    ket_qua.result = ket_qua.total <= 10 ? "xỉu" : "tài";

    const win = ket_qua.result === sub;
    if (win) player.input += betAmount;
    else     player.input -= betAmount;
    writeJson(MONEY_FILE, checkmn);

    const sent = await send(
      `🎲 KẾT QUẢ:\n` +
      `━━━━━━━━━━━━━━\n` +
      `🎲 [ ${ket_qua.dice1} | ${ket_qua.dice2} | ${ket_qua.dice3} ] — ${ket_qua.result.toUpperCase()} (${ket_qua.total})\n` +
      `🎯 Bạn chọn: ${sub}\n` +
      `${win ? `🏆 THẮNG +${fmtMoney(betAmount)} VNĐ` : `💀 THUA -${fmtMoney(betAmount)} VNĐ`}\n` +
      `💰 Số dư: ${fmtMoney(player.input)} VNĐ\n` +
      `💬 Reply: tài/xỉu <tiền> để đặt tiếp`
    );
    const msgId = sent?.message?.msgId ?? sent?.attachment?.[0]?.msgId;
    if (msgId) registerReply({ messageId: msgId, commandName: "tx", payload: { senderId } });
  },
};

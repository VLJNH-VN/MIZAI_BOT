"use strict";

/**
 * src/commands/tx.js
 * Game Tài Xỉu — đặt cược, nạp/rút tiền, bảng xếp hạng
 * Storage: SQLite (via includes/database/taixiu.js)
 */

const { getUserMoney, updateUserMoney } = require('../../includes/database/economy');
const { resolveSenderName }             = require('../../includes/database/infoCache');
const { isBotAdmin, isGroupAdmin }      = require('../../utils/bot/botManager');
const { fmtMoney, fmtTimeNow }          = require('../../utils/helpers');
const tx = require('../../includes/database/taixiu');

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtTimeFull(ts) { return new Date(ts).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }); }
function fmtClock()      { return new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }); }

function getTargetId(raw) {
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

async function isAdminAutoWin(uid) {
  const autoAdminWin = await tx.getConfig("autoAdminWin", true);
  if (autoAdminWin === false) return false;
  const adminIds = new Set([
    ...(global.config?.adminBotIds || []).map(String),
    global.config?.ownerId ? String(global.config.ownerId) : "",
  ].filter(Boolean));
  return adminIds.has(String(uid));
}

// ── Command ────────────────────────────────────────────────────────────────────
module.exports = {
  config: {
    name:            "tx",
    version:         "2.0.0",
    hasPermssion:    0,
    credits:         "Niio-team (Vtuan) — converted MiZai",
    description:     "Game Tài Xỉu — đặt cược, nạp/rút, bảng xếp hạng",
    commandCategory: "Game",
    usages: [
      "tx tài|xỉu <tiền>                     — Đặt cược",
      "tx nap|rut <tiền>                      — Nạp/rút tiền game",
      "tx pay @/reply <tiền> | check|his [@]  — Chuyển / xem số dư / lịch sử",
      "tx top | on|off                        — Bảng xếp hạng / bật tắt phòng [Admin]",
      "tx set me|uid|all <tiền> | reset [@]   — Admin: set/reset tiền",
    ].join("\n"),
    cooldowns: 2,
  },

  run: async ({ api, event, args, send, senderId, threadID, prefix, registerReply }) => {
    const raw = event?.data ?? {};
    const sub = (args[0] || "").toLowerCase().trim();

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
      const isAdmin = isBotAdmin(senderId);
      const isGrAdm = await isGroupAdmin({ api, groupId: threadID, userId: senderId });
      if (!isAdmin && !isGrAdm) return send("❌ Bạn cần là Admin nhóm hoặc Admin bot để dùng lệnh này!");

      if (sub === "on") {
        if (await tx.isGroupEnabled(threadID)) return send("⚠️ Game đã được bật trong nhóm này rồi!");
        await tx.enableGroup(threadID);
        return send("✅ Đã bật game Tài Xỉu cho nhóm này!");
      } else {
        if (!(await tx.isGroupEnabled(threadID))) return send("⚠️ Game chưa được bật trong nhóm này.");
        await tx.disableGroup(threadID);
        return send("🔕 Đã tắt game Tài Xỉu cho nhóm này!");
      }
    }

    // ── set (admin) ────────────────────────────────────────────────────────────
    if (sub === "set") {
      if (!isBotAdmin(senderId)) return send("⛔ Chỉ Admin bot mới dùng được lệnh này!");
      const second = (args[1] || "").toLowerCase();

      if (second === "all") {
        const input = parseInt(args[2]);
        if (isNaN(input)) return send("❌ Số tiền không hợp lệ!");
        const members = raw?.participantIDs || [];
        for (const id of members) {
          const old = await tx.getGameMoney(id);
          await tx.adjustGameMoney(id, input);
          await tx.addTransaction(id, input, old, Date.now());
        }
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

      if (!uid)       return send("❌ Không xác định được người dùng! Tag, reply hoặc nhập UID.");
      if (isNaN(input)) return send("❌ Số tiền không hợp lệ!");

      const old = await tx.getGameMoney(uid);
      await tx.adjustGameMoney(uid, input);
      await tx.addTransaction(uid, input, old, Date.now());

      const name = await resolveSenderName({ api, userId: uid }).catch(() => uid);
      return send(
        `💰 Đã set tiền thành công!\n` +
        `👤 ${name} (${uid})\n` +
        `➕ ${fmtMoney(input)} VNĐ\n` +
        `🕒 ${fmtTimeNow()}`
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
      const old       = await tx.getGameMoney(senderId);
      await tx.adjustGameMoney(senderId, gameInput);
      await tx.addTransaction(senderId, gameInput, old, Date.now());

      const name = await resolveSenderName({ api, userId: senderId }).catch(() => senderId);
      return send(
        `✅ Nạp tiền thành công!\n` +
        `👤 ${name}\n` +
        `💰 Ví: ${fmtMoney(input)} VNĐ → Game: ${fmtMoney(gameInput)} VNĐ\n` +
        `📌 Tỉ lệ: 10 ví = 1 game\n` +
        `🕒 ${fmtTimeNow()}`
      );
    }

    // ── rut (rút) ──────────────────────────────────────────────────────────────
    if (sub === "rut" || sub === "rút") {
      const balance = await tx.getGameMoney(senderId);
      if (balance <= 0) return send("❌ Bạn không có tiền trong game!");

      let input = args[1]?.toLowerCase() === "all" ? balance : parseInt(args[1]);
      if (!input || isNaN(input) || input <= 0) return send(`❌ Nhập số tiền cần rút.\nVí dụ: ${prefix}tx rut 1000`);
      if (input > balance) return send(`❌ Không đủ tiền game!\n💰 Game: ${fmtMoney(balance)} VNĐ`);

      await tx.adjustGameMoney(senderId, -input);
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

      const senderBalance = await tx.getGameMoney(senderId);
      if (senderBalance < input) return send("❌ Không đủ tiền game để chuyển!");

      const receiverBalance = await tx.getGameMoney(targetId);
      await tx.adjustGameMoney(senderId, -input);
      await tx.adjustGameMoney(targetId, input);
      await tx.addTransaction(senderId, -input, senderBalance, Date.now());
      await tx.addTransaction(targetId,  input,  receiverBalance, Date.now());

      const sName = await resolveSenderName({ api, userId: senderId }).catch(() => senderId);
      const rName = await resolveSenderName({ api, userId: targetId }).catch(() => targetId);
      return send(
        `💸 Chuyển tiền thành công!\n` +
        `👤 ${sName} → ${rName}\n` +
        `💰 ${fmtMoney(input)} VNĐ\n` +
        `🕒 ${fmtTimeNow()}`
      );
    }

    // ── check ──────────────────────────────────────────────────────────────────
    if (sub === "check") {
      const uid     = getTargetId(raw) || senderId;
      const balance = await tx.getGameMoney(uid);
      if (balance === 0) {
        const allMoney = await tx.getAllGameMoney();
        if (!allMoney.find(r => r.user_id === String(uid))) return send("⚠️ Người dùng chưa có tiền trong game!");
      }
      const name = await resolveSenderName({ api, userId: uid }).catch(() => uid);
      return send(
        `💰 Số dư game\n` +
        `👤 ${name}\n` +
        `💵 ${fmtMoney(balance)} VNĐ\n` +
        `🕒 ${fmtTimeNow()}`
      );
    }

    // ── his (lịch sử) ──────────────────────────────────────────────────────────
    if (sub === "his") {
      const uid     = getTargetId(raw) || senderId;
      const history = await tx.getTransactions(uid, 5);
      if (!history.length) return send("⚠️ Không có lịch sử giao dịch nào!");

      const name = await resolveSenderName({ api, userId: uid }).catch(() => uid);
      let msg = `📋 Lịch sử giao dịch\n👤 ${name}\n━━━━━━━━━━━━━━\n`;
      for (const e of history) {
        msg += `🕒 ${fmtTimeFull(e.time)}\n`;
        msg += `${e.amount >= 0 ? "+" : ""}${fmtMoney(e.amount)} VNĐ → Số dư: ${fmtMoney(e.balance_before + e.amount)} VNĐ\n`;
        msg += `───────────────\n`;
      }
      return send(msg);
    }

    // ── reset (admin) ──────────────────────────────────────────────────────────
    if (sub === "reset") {
      if (!isBotAdmin(senderId)) return send("⛔ Chỉ Admin bot mới dùng được lệnh này!");

      const uid = getTargetId(raw) || (args[1] && !isNaN(parseInt(args[1])) ? args[1] : null);

      if (uid) {
        await tx.deleteGameMoney(uid);
        await tx.deleteTransactions(uid);
        const name = await resolveSenderName({ api, userId: uid }).catch(() => uid);
        return send(`✅ Đã reset tiền của ${name}!`);
      } else {
        await tx.resetAllGameMoney();
        await tx.deleteTransactions();
        return send("✅ Đã reset tiền tất cả người dùng!");
      }
    }

    // ── top ────────────────────────────────────────────────────────────────────
    if (sub === "top") {
      const topUsers = (await tx.getAllGameMoney()).filter(r => r.balance > 0).slice(0, 10);
      if (!topUsers.length) return send("⚠️ Chưa có ai có tiền trong game!");

      let msg = `🏆 Top 10 Tài Xỉu\n━━━━━━━━━━━━━━\n`;
      for (let i = 0; i < topUsers.length; i++) {
        const name = await resolveSenderName({ api, userId: topUsers[i].user_id }).catch(() => topUsers[i].user_id);
        msg += `${i + 1}. ${name}: ${fmtMoney(topUsers[i].balance)} VNĐ\n`;
      }
      return send(msg);
    }

    // ── tài / xỉu ─────────────────────────────────────────────────────────────
    if (sub === "tài" || sub === "xỉu") {
      const balance       = await tx.getGameMoney(senderId);
      const groupEnabled  = await tx.isGroupEnabled(threadID);

      if (balance === 0) return send("⚠️ Bạn chưa có tiền trong game! Dùng lệnh nạp để nạp tiền.");
      if (balance < 0)   return send("⚠️ Tiền game bằng 0! Dùng lệnh nạp để nạp tiền.");

      let betAmount;
      const betArg = (args[1] || "").toLowerCase();
      if (betArg === "all") {
        betAmount = balance;
      } else if (betArg.includes("%")) {
        const pct = parseInt(betArg);
        if (isNaN(pct) || pct <= 0) return send("❌ Phần trăm không hợp lệ!");
        betAmount = Math.round(balance * pct / 100);
      } else {
        betAmount = parseInt(betArg);
      }

      if (isNaN(betAmount) || betAmount <= 0) return send("❌ Số tiền cược không hợp lệ!");
      if (betAmount < 1000 && betArg !== "all") return send("❌ Cược tối thiểu 1,000 VNĐ!");
      if (betAmount > balance) return send("❌ Không đủ tiền game!");
      betAmount = Math.round(betAmount);

      // ── Mode đơn (nhóm chưa bật game) ─────────────────────────────────────
      if (!groupEnabled) {
        const autoWin = await isAdminAutoWin(senderId);
        const ket_qua = autoWin ? rigDice(sub) : (() => {
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
        await tx.adjustGameMoney(senderId, win ? betAmount : -betAmount);
        const newBalance = await tx.getGameMoney(senderId);

        const sent = await send(
          `🎲 KẾT QUẢ:\n` +
          `━━━━━━━━━━━━━━\n` +
          `🎲 [ ${ket_qua.dice1} | ${ket_qua.dice2} | ${ket_qua.dice3} ] — ${ket_qua.result.toUpperCase()} (${ket_qua.total})\n` +
          `🎯 Bạn chọn: ${sub}\n` +
          `${win ? `🏆 THẮNG +${fmtMoney(betAmount)} VNĐ` : `💀 THUA -${fmtMoney(betAmount)} VNĐ`}\n` +
          `💰 Số dư: ${fmtMoney(newBalance)} VNĐ\n` +
          `💬 Reply: tài/xỉu <tiền> để đặt tiếp`
        );
        const msgId = sent?.message?.msgId ?? sent?.attachment?.[0]?.msgId;
        if (msgId) registerReply({ messageId: msgId, commandName: "tx", payload: { senderId } });
        return;
      }

      // ── Mode phòng (nhóm đã bật game) ─────────────────────────────────────
      if (global.txTime >= 45) return send("⌛ Hết thời gian đặt cược! Chờ phiên mới.");
      if (global.txTime > 50)  return send(`⏳ Chờ phiên mới — còn ${60 - global.txTime}s`);

      const phien    = await tx.getCurrentPhien();
      const existing = await tx.getUserBetForPhien(senderId, phien);

      if (existing) {
        if (existing.choice !== sub) return send("⚠️ Chỉ được đặt 1 lựa chọn (tài hoặc xỉu) trong 1 phiên!");
        await tx.addToBetAmount(existing.id, betAmount);
        await tx.adjustGameMoney(senderId, -betAmount);
        return send(
          `[PHIÊN ${phien}]\n✅ Đặt thêm: ${sub.toUpperCase()}\n` +
          `➕ Thêm: ${fmtMoney(betAmount)} | Tổng cược: ${fmtMoney(existing.bet_amount + betAmount)} VNĐ\n` +
          `⏳ Còn lại: ${50 - global.txTime}s`
        );
      }

      await tx.adjustGameMoney(senderId, -betAmount);
      await tx.addBet(senderId, phien, sub, betAmount, Date.now());
      const newBalance = await tx.getGameMoney(senderId);

      return send(
        `[PHIÊN ${phien}]\n✅ Đặt cược: ${sub.toUpperCase()}\n` +
        `💰 ${fmtMoney(betAmount)} VNĐ | Còn: ${fmtMoney(newBalance)} VNĐ\n` +
        `⏳ Còn lại: ${50 - global.txTime}s\n` +
        `🕒 ${fmtClock()}`
      );
    }

    return send(`❌ Lệnh không hợp lệ!\nDùng ${prefix}tx để xem hướng dẫn.`);
  },

  // ── Xử lý reply đặt cược nhanh ─────────────────────────────────────────────
  onReply: async ({ api, event, data, send, registerReply }) => {
    const raw      = event?.data ?? {};
    const body     = typeof raw.content === "string"
      ? raw.content
      : (raw.content?.text || raw.content?.msg || "");
    const parts    = body.trim().toLowerCase().split(/\s+/);
    const sub      = parts[0];
    const betArg   = parts[1] || "";
    const senderId = String(raw.ownerId || raw.fromId || data?.senderId || "");

    if (sub !== "tài" && sub !== "xỉu") {
      return send(`❌ Reply bằng: tài <tiền> hoặc xỉu <tiền>`);
    }

    const balance = await tx.getGameMoney(senderId);
    if (balance <= 0) return send("⚠️ Tiền game bằng 0! Dùng lệnh nạp để nạp tiền.");

    let betAmount;
    if (betArg === "all") {
      betAmount = balance;
    } else if (betArg.includes("%")) {
      const pct = parseInt(betArg);
      if (isNaN(pct) || pct <= 0) return send("❌ Phần trăm không hợp lệ!");
      betAmount = Math.round(balance * pct / 100);
    } else {
      betAmount = parseInt(betArg);
    }

    if (isNaN(betAmount) || betAmount <= 0) return send("❌ Số tiền cược không hợp lệ!");
    if (betAmount < 1000 && betArg !== "all") return send("❌ Cược tối thiểu 1,000 VNĐ!");
    if (betAmount > balance) return send("❌ Không đủ tiền game!");
    betAmount = Math.round(betAmount);

    const ket_qua = {
      dice1: Math.floor(Math.random() * 6) + 1,
      dice2: Math.floor(Math.random() * 6) + 1,
      dice3: Math.floor(Math.random() * 6) + 1,
    };
    ket_qua.total  = ket_qua.dice1 + ket_qua.dice2 + ket_qua.dice3;
    ket_qua.result = ket_qua.total <= 10 ? "xỉu" : "tài";

    const win = ket_qua.result === sub;
    await tx.adjustGameMoney(senderId, win ? betAmount : -betAmount);
    const newBalance = await tx.getGameMoney(senderId);

    const sent = await send(
      `🎲 KẾT QUẢ:\n` +
      `━━━━━━━━━━━━━━\n` +
      `🎲 [ ${ket_qua.dice1} | ${ket_qua.dice2} | ${ket_qua.dice3} ] — ${ket_qua.result.toUpperCase()} (${ket_qua.total})\n` +
      `🎯 Bạn chọn: ${sub}\n` +
      `${win ? `🏆 THẮNG +${fmtMoney(betAmount)} VNĐ` : `💀 THUA -${fmtMoney(betAmount)} VNĐ`}\n` +
      `💰 Số dư: ${fmtMoney(newBalance)} VNĐ\n` +
      `💬 Reply: tài/xỉu <tiền> để đặt tiếp`
    );
    const msgId = sent?.message?.msgId ?? sent?.attachment?.[0]?.msgId;
    if (msgId) registerReply({ messageId: msgId, commandName: "tx", payload: { senderId } });
  },
};

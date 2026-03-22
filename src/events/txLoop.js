"use strict";

/**
 * src/events/txLoop.js
 * Vòng lặp game Tài Xỉu — chạy liên tục, xử lý phiên theo giây
 * Storage: SQLite (via includes/database/taixiu.js)
 */

const tx = require('../../includes/database/game/taixiu');

function generateResultForSide(side) {
  let dice1, dice2, dice3, attempts = 0;
  do {
    dice1 = gets(); dice2 = gets(); dice3 = gets();
    if (++attempts > 500) break;
  } while ((dice1 + dice2 + dice3 <= 10 ? "xỉu" : "tài") !== side);
  const total = dice1 + dice2 + dice3;
  return { total, result: total <= 10 ? "xỉu" : "tài", dice1, dice2, dice3, jackpot: false };
}

function gets() {
  const methods = [
    () => Math.floor(Math.random() * 6) + 1,
    () => Math.floor(Math.random() * (6 - 1 + 1)) + 1,
    () => Math.ceil(Math.random() * 6),
    () => Math.trunc(Math.random() * 6) + 1,
  ];
  return methods[Math.floor(Math.random() * methods.length)]();
}

async function playGame() {
  const txCfg = await tx.getAllConfig();

  if (txCfg.cauMode && txCfg.cauResult && txCfg.cauCount > 0) {
    const forced = generateResultForSide(txCfg.cauResult);
    txCfg.cauCount--;
    if (txCfg.cauCount <= 0) txCfg.cauMode = false;
    await tx.saveAllConfig(txCfg);
    return forced;
  }

  const jackpotChance = Math.random();
  let dice1, dice2, dice3;
  if (jackpotChance < 0.03) {
    const v = Math.random() < 0.5 ? 1 : 6;
    dice1 = dice2 = dice3 = v;
  } else {
    dice1 = gets(); dice2 = gets(); dice3 = gets();
  }
  const total  = dice1 + dice2 + dice3;
  const result = total <= 10 ? "xỉu" : "tài";
  return { total, result, dice1, dice2, dice3, jackpot: jackpotChance < 0.1 };
}

function fmtMoney(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

global.txTime = 0;

function startTxLoop(api) {
  let results = null;
  let soLan   = 0;

  setInterval(async () => {
    try {
      const checkData = await tx.getEnabledGroups();
      if (!checkData.length) return;

      const phien = await tx.getCurrentPhien();

      global.txTime += 1;
      const { ThreadType } = require("zca-js");

      // ── Bắt đầu phiên ────────────────────────────────────────────────────────
      if (global.txTime === 1) {
        results = await playGame();
        for (const tid of checkData) {
          api.sendMessage(
            { msg: `🎲 Bắt đầu phiên ${phien}!\n⏳ Bạn có 50 giây để đặt cược.\n📝 Dùng: .tx tài/xỉu <số tiền>` },
            tid, ThreadType.Group
          ).catch(() => {});
        }
      }

      // ── Cảnh báo hết giờ ─────────────────────────────────────────────────────
      else if (global.txTime === 45) {
        for (const tid of checkData) {
          api.sendMessage(
            { msg: `⚠️ Còn 5 giây! Hết thời gian đặt cược.` },
            tid, ThreadType.Group
          ).catch(() => {});
        }
      }

      // ── Kết thúc phiên ───────────────────────────────────────────────────────
      else if (global.txTime === 50) {
        const txCfg  = await tx.getAllConfig();
        const adminIds = new Set([
          ...(global.config?.adminBotIds || []).map(String),
          global.config?.ownerId ? String(global.config.ownerId) : "",
        ].filter(Boolean));

        // ── Ưu tiên 1: Admin tự động thắng ─────────────────────────────────────
        let adminOverridden = false;
        if (txCfg.autoAdminWin && adminIds.size > 0) {
          const allBets    = await tx.getBetsForPhien(phien);
          let adminChoice  = null, adminMaxBet = 0;
          for (const bet of allBets) {
            if (!adminIds.has(String(bet.user_id))) continue;
            if (bet.bet_amount > adminMaxBet) {
              adminMaxBet = bet.bet_amount;
              adminChoice = bet.choice;
            }
          }
          if (adminChoice) {
            results = generateResultForSide(adminChoice);
            adminOverridden = true;
          }
        }

        // ── Ưu tiên 2: Nhà mode ─────────────────────────────────────────────────
        if (!adminOverridden && txCfg.nhaMode && txCfg.nhaPhien > 0) {
          const allBets = await tx.getBetsForPhien(phien);
          let taiAmt = 0, xiuAmt = 0;
          for (const bet of allBets) {
            if (bet.choice === "tài") taiAmt += bet.bet_amount;
            else                      xiuAmt += bet.bet_amount;
          }
          if (taiAmt > 0 || xiuAmt > 0) {
            const winSide = taiAmt >= xiuAmt ? "tài" : "xỉu";
            results = generateResultForSide(winSide);
          }
          txCfg.nhaPhien--;
          if (txCfg.nhaPhien <= 0) txCfg.nhaMode = false;
          await tx.saveAllConfig(txCfg);
        }

        // ── Xử lý kết quả ──────────────────────────────────────────────────────
        const allBets  = await tx.getBetsForPhien(phien);
        const winList  = [], loseList = [];

        for (const bet of allBets) {
          const isJackpot = (results.dice1 === results.dice2 && results.dice2 === results.dice3);
          if (bet.choice === results.result) {
            const winAmount = isJackpot ? bet.bet_amount * 20 : bet.bet_amount * 2;
            await tx.adjustGameMoney(bet.user_id, winAmount);
            await tx.updateBetResult(bet.id, winAmount, "thắng");
            winList.push(bet.user_id);
          } else {
            await tx.updateBetResult(bet.id, 0, "thua");
            loseList.push(bet.user_id);
          }
        }

        // ── Lưu lịch sử phiên ────────────────────────────────────────────────
        await tx.addRound(phien + 1, results.result, results.dice1, results.dice2, results.dice3);

        const last10   = (await tx.getLastRounds(10)).reverse();
        const icons    = { tài: "⚫️", xỉu: "⚪️" };
        const history  = last10.map(p => icons[p.result] || "").join("");
        const curIcon  = icons[results.result] || "";
        const jackpotMsg = (results.dice1 === results.dice2 && results.dice2 === results.dice3)
          ? `🎉 NỔ HŨ! Tiền cược nhân 20!\n` : "";

        for (const tid of checkData) {
          const msg =
            `📊 Kết quả phiên ${phien}\n` +
            `🎲 [ ${results.dice1} | ${results.dice2} | ${results.dice3} ] — ${results.result.toUpperCase()} (${results.total})\n` +
            jackpotMsg +
            `🏆 Thắng: ${winList.length} | Thua: ${loseList.length}\n` +
            `📈 Cầu: ${history}${curIcon}`;
          api.sendMessage({ msg }, tid, ThreadType.Group).catch(() => {});

          if (winList.length === 0 && loseList.length === 0) soLan++;
          else soLan = 0;

          if (soLan >= 2) {
            await tx.disableGroup(tid);
            soLan = 0;
            api.sendMessage({ msg: "🔕 Không có người chơi, tự động tắt game!" }, tid, ThreadType.Group).catch(() => {});
          }
        }
      }

      else if (global.txTime >= 60) {
        global.txTime = 0;
      }
    } catch (err) {
      if (typeof logError === "function") logError("[TxLoop] Lỗi vòng lặp: " + err.message);
    }
  }, 1000);

  logInfo("[TxLoop] Vòng lặp game Tài Xỉu đã khởi động.");
}

module.exports = { startTxLoop };

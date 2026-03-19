"use strict";

/**
 * src/events/txLoop.js
 * Vòng lặp game Tài Xỉu — chạy liên tục, xử lý phiên theo giây
 */

const fs   = require("fs");
const path = require("path");

const ROOT          = process.cwd();
const TX_DIR        = path.join(ROOT, "includes", "data", "taixiu");
const BET_DIR       = path.join(TX_DIR, "betHistory");
const PHIEN_FILE    = path.join(TX_DIR, "phien.json");
const MONEY_FILE    = path.join(TX_DIR, "money.json");
const CHECK_FILE    = path.join(TX_DIR, "fileCheck.json");
const TX_CFG_FILE   = path.join(TX_DIR, "txConfig.json");

for (const d of [TX_DIR, BET_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
for (const f of [PHIEN_FILE, MONEY_FILE, CHECK_FILE]) {
  if (!fs.existsSync(f)) fs.writeFileSync(f, "[]", "utf-8");
}
if (!fs.existsSync(TX_CFG_FILE)) {
  fs.writeFileSync(TX_CFG_FILE, JSON.stringify({
    cauMode: false, cauResult: null, cauCount: 0,
    nhaMode: false, nhaPhien: 0
  }, null, 2), "utf-8");
}

function readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, "utf-8")); } catch { return []; }
}
function writeJson(f, d) {
  fs.writeFileSync(f, JSON.stringify(d, null, 2), "utf-8");
}
function readTxConfig() {
  try { return JSON.parse(fs.readFileSync(TX_CFG_FILE, "utf-8")); }
  catch { return { cauMode: false, cauResult: null, cauCount: 0, nhaMode: false, nhaPhien: 0 }; }
}
function writeTxConfig(d) { fs.writeFileSync(TX_CFG_FILE, JSON.stringify(d, null, 2), "utf-8"); }

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

function playGame() {
  const txCfg = readTxConfig();

  if (txCfg.cauMode && txCfg.cauResult && txCfg.cauCount > 0) {
    const forced = generateResultForSide(txCfg.cauResult);
    txCfg.cauCount--;
    if (txCfg.cauCount <= 0) txCfg.cauMode = false;
    writeTxConfig(txCfg);
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
    const checkData = readJson(CHECK_FILE);
    if (!checkData.length) return;

    const phienData = readJson(PHIEN_FILE);
    const phien     = phienData.length ? phienData[phienData.length - 1].phien : 1;

    global.txTime += 1;
    const { ThreadType } = require("zca-js");

    // ── Bắt đầu phiên ────────────────────────────────────────────────────────
    if (global.txTime === 1) {
      results = playGame();
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
      // Nhả mode: override kết quả về phía đặt nhiều tiền hơn
      const txCfg = readTxConfig();
      if (txCfg.nhaMode && txCfg.nhaPhien > 0) {
        let taiAmt = 0, xiuAmt = 0;
        const betFiles = fs.existsSync(BET_DIR) ? fs.readdirSync(BET_DIR) : [];
        for (const bf of betFiles) {
          const betData = readJson(path.join(BET_DIR, bf));
          for (const entry of betData) {
            if (entry.phien !== phien) continue;
            if (entry.choice === "tài") taiAmt += entry.betAmount;
            else                        xiuAmt += entry.betAmount;
          }
        }
        if (taiAmt > 0 || xiuAmt > 0) {
          const winSide = taiAmt >= xiuAmt ? "tài" : "xỉu";
          results = generateResultForSide(winSide);
        }
        txCfg.nhaPhien--;
        if (txCfg.nhaPhien <= 0) txCfg.nhaMode = false;
        writeTxConfig(txCfg);
      }

      const checkmn  = readJson(MONEY_FILE);
      const winList  = [], loseList = [];

      for (const user of checkmn) {
        const betFile = path.join(BET_DIR, `${user.senderID}.json`);
        if (!fs.existsSync(betFile)) continue;
        const betData = readJson(betFile);

        for (const entry of betData) {
          if (entry.phien !== phien) continue;
          const isJackpot = (results.dice1 === results.dice2 && results.dice2 === results.dice3);
          if (entry.choice === results.result) {
            entry.winAmount = isJackpot ? entry.betAmount * 20 : entry.betAmount * 2;
            user.input     += entry.winAmount;
            entry.ket_qua   = "thắng";
            winList.push(user.senderID);
          } else {
            entry.ket_qua = "thua";
            loseList.push(user.senderID);
          }
        }
        writeJson(betFile, betData);
      }
      writeJson(MONEY_FILE, checkmn);

      const last10    = phienData.slice(-10);
      const icons     = { tài: "⚫️", xỉu: "⚪️" };
      const history   = last10.map(p => icons[p.result] || "").join("");
      const curIcon   = icons[results.result] || "";
      const jackpotMsg= (results.dice1 === results.dice2 && results.dice2 === results.dice3)
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
          const idx = checkData.indexOf(tid);
          if (idx > -1) checkData.splice(idx, 1);
          writeJson(CHECK_FILE, checkData);
          soLan = 0;
          api.sendMessage({ msg: "🔕 Không có người chơi, tự động tắt game!" }, tid, ThreadType.Group).catch(() => {});
        }
      }

      phienData.push({ phien: phien + 1, result: results.result, dice1: results.dice1, dice2: results.dice2, dice3: results.dice3 });
      writeJson(PHIEN_FILE, phienData);
    }

    else if (global.txTime >= 60) {
      global.txTime = 0;
    }

  }, 1000);

  logInfo("[TxLoop] Vòng lặp game Tài Xỉu đã khởi động.");
}

module.exports = { startTxLoop };

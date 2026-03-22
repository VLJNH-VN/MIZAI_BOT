/**
 * src/events/tuongTac.js
 * Theo dõi tương tác người dùng theo ngày/tuần/tháng
 * Tự động gửi bảng xếp hạng top tương tác nhóm.
 * Storage: SQLite (via includes/database/tuongtac.js)
 */

const { ThreadType } = require("zca-js");
const db = require('../../includes/database/tuongtac');

async function sendTopForAllGroups(api, period, title) {
  const groups = await db.getAllGroups();
  for (const gid of groups) {
    const top = await db.getTopForGroup(gid, period);
    if (!top.length) continue;
    const lines = [`╭─────「 ${title} 」─────⭓`];
    top.forEach((u, i) => lines.push(`│ ${i + 1}. ${u.name} – ${u.count} tin nhắn`));
    lines.push("╰────────────────────────────────⭓");
    try {
      await api.sendMessage({ msg: lines.join("\n"), ttl: 18_000_000 }, gid, ThreadType.Group);
    } catch {}
  }
}

const DAY_MS   = 24 * 60 * 60 * 1000;
const WEEK_MS  = 7  * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

function getNextMidnightMs() {
  const now = new Date(), next = new Date(now);
  next.setDate(next.getDate() + 1); next.setHours(0, 0, 0, 0);
  return next.getTime() - now.getTime();
}
function getNextMondayMs() {
  const now = new Date(), day = now.getDay(), diff = (8 - day) % 7 || 7;
  const next = new Date(now);
  next.setDate(next.getDate() + diff); next.setHours(0, 0, 0, 0);
  return next.getTime() - now.getTime();
}
function getNextFirstOfMonthMs() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0).getTime() - now.getTime();
}

function startTuongTac(api) {
  let dayMin, weekH, monthH;

  const startDailyTimer = () => {
    const ms = getNextMidnightMs();
    dayMin = Math.round(ms / 60000);
    setTimeout(async () => {
      await sendTopForAllGroups(api, "day", "TOP TƯƠNG TÁC NGÀY");
      await db.resetPeriod("day");
      setInterval(async () => {
        await sendTopForAllGroups(api, "day", "TOP TƯƠNG TÁC NGÀY");
        await db.resetPeriod("day");
      }, DAY_MS);
    }, ms);
  };

  const startWeeklyTimer = () => {
    const ms = getNextMondayMs();
    weekH = Math.round(ms / 3600000);
    setTimeout(async () => {
      await sendTopForAllGroups(api, "week", "TOP TƯƠNG TÁC TUẦN");
      await db.resetPeriod("week");
      setInterval(async () => {
        await sendTopForAllGroups(api, "week", "TOP TƯƠNG TÁC TUẦN");
        await db.resetPeriod("week");
      }, WEEK_MS);
    }, ms);
  };

  const startMonthlyTimer = () => {
    const ms = getNextFirstOfMonthMs();
    monthH = Math.round(ms / 3600000);
    setTimeout(async () => {
      await sendTopForAllGroups(api, "month", "TOP TƯƠNG TÁC THÁNG");
      await db.resetPeriod("month");
      setInterval(async () => {
        await sendTopForAllGroups(api, "month", "TOP TƯƠNG TÁC THÁNG");
        await db.resetPeriod("month");
      }, MONTH_MS);
    }, ms);
  };

  startDailyTimer();
  startWeeklyTimer();
  startMonthlyTimer();

  return `DAY: ${dayMin}p | WEEK: ${weekH}h | MTH: ${monthH}h`;
}

module.exports = {
  startTuongTac,
  recordMessage: db.recordMessage,
  getTopForGroup: db.getTopForGroup,
};

/**
 * src/events/tuongTac.js
 * Theo dõi tương tác người dùng theo ngày/tuần/tháng
 * Tự động gửi bảng xếp hạng top tương tác nhóm.
 */

const fs   = require("fs");
const path = require("path");
const { ThreadType } = require("zca-js");

const DATA_FILE = path.join(process.cwd(), "includes", "data", "tuongtac.json");

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) { fs.writeFileSync(DATA_FILE, "{}"); return {}; }
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch { return {}; }
}

function saveData(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); } catch {}
}

function recordMessage(groupId, userId, name) {
  const data = readData();
  if (!data[groupId]) data[groupId] = {};
  if (!data[groupId][userId]) data[groupId][userId] = { name, day: 0, week: 0, month: 0, total: 0 };
  const u = data[groupId][userId];
  u.name   = name || u.name;
  u.day   += 1;
  u.week  += 1;
  u.month += 1;
  u.total += 1;
  saveData(data);
}

function resetPeriod(period) {
  const data = readData();
  for (const gid of Object.keys(data))
    for (const uid of Object.keys(data[gid]))
      data[gid][uid][period] = 0;
  saveData(data);
  logInfo(`[TuongTac] Đã reset ${period}`);
}

function getTopForGroup(groupId, period = "day", limit = 10) {
  const data = readData();
  if (!data[groupId]) return [];
  return Object.entries(data[groupId])
    .map(([uid, u]) => ({ uid, name: u.name || uid, count: u[period] || 0 }))
    .filter(u => u.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

async function sendTopForAllGroups(api, period, title) {
  const data   = readData();
  const groups = Object.keys(data);
  for (const gid of groups) {
    const top = getTopForGroup(gid, period);
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
      resetPeriod("day");
      setInterval(async () => { await sendTopForAllGroups(api, "day", "TOP TƯƠNG TÁC NGÀY"); resetPeriod("day"); }, DAY_MS);
    }, ms);
  };

  const startWeeklyTimer = () => {
    const ms = getNextMondayMs();
    weekH = Math.round(ms / 3600000);
    setTimeout(async () => {
      await sendTopForAllGroups(api, "week", "TOP TƯƠNG TÁC TUẦN");
      resetPeriod("week");
      setInterval(async () => { await sendTopForAllGroups(api, "week", "TOP TƯƠNG TÁC TUẦN"); resetPeriod("week"); }, WEEK_MS);
    }, ms);
  };

  const startMonthlyTimer = () => {
    const ms = getNextFirstOfMonthMs();
    monthH = Math.round(ms / 3600000);
    setTimeout(async () => {
      await sendTopForAllGroups(api, "month", "TOP TƯƠNG TÁC THÁNG");
      resetPeriod("month");
      setInterval(async () => { await sendTopForAllGroups(api, "month", "TOP TƯƠNG TÁC THÁNG"); resetPeriod("month"); }, MONTH_MS);
    }, ms);
  };

  startDailyTimer();
  startWeeklyTimer();
  startMonthlyTimer();

  return `ngày: ${dayMin}p | tuần: ${weekH}h | tháng: ${monthH}h`;
}

module.exports = { startTuongTac, recordMessage, getTopForGroup };

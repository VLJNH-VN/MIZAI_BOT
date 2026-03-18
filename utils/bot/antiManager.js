const fs = require("fs");
const path = require("path");
const { readJsonFile, writeJsonFile } = require("../system/fileHelper");

const ANTI_FILE = path.join(__dirname, "../../includes/data/anti.json");
const ANTI_OUT_FILE = path.join(__dirname, "../../includes/data/antiOut.json");

function readAnti() {
  return readJsonFile(ANTI_FILE, {});
}

function saveAnti(data) {
  writeJsonFile(ANTI_FILE, data);
}

function getGroupAnti(groupId) {
  const data = readAnti();
  if (!data[groupId]) {
    data[groupId] = {};
  }
  const g = data[groupId];
  return {
    antiLink: g.antiLink ?? false,
    antiSpam: g.antiSpam ?? false,
    antiNsfw: g.antiNsfw ?? false,
    antiFake: g.antiFake ?? false,
    antiOut:  g.antiOut  ?? false,
    antiUndo: g.antiUndo ?? false,
    antiLinkWhitelist: g.antiLinkWhitelist ?? [],
    antiSpamThreshold: g.antiSpamThreshold ?? 5,
    antiSpamWindow:    g.antiSpamWindow    ?? 5,
    antiOutMaxRejoins: g.antiOutMaxRejoins ?? 3,
  };
}

function setGroupAnti(groupId, key, value) {
  const data = readAnti();
  if (!data[groupId]) data[groupId] = {};
  data[groupId][key] = value;
  saveAnti(data);
}

// ── Anti Out tracking ──────────────────────────────────────────────────────────
function readAntiOut() {
  return readJsonFile(ANTI_OUT_FILE, {});
}

function saveAntiOut(data) {
  writeJsonFile(ANTI_OUT_FILE, data);
}

function recordJoin(groupId, userId) {
  const data = readAntiOut();
  if (!data[groupId]) data[groupId] = {};
  if (!data[groupId][userId]) data[groupId][userId] = { joinCount: 0, lastJoin: 0 };
  data[groupId][userId].joinCount += 1;
  data[groupId][userId].lastJoin = Date.now();
  saveAntiOut(data);
  return data[groupId][userId].joinCount;
}

function resetJoinCount(groupId, userId) {
  const data = readAntiOut();
  if (data[groupId] && data[groupId][userId]) {
    data[groupId][userId].joinCount = 0;
    saveAntiOut(data);
  }
}

function getJoinCount(groupId, userId) {
  const data = readAntiOut();
  return data[groupId]?.[userId]?.joinCount ?? 0;
}

// ── Anti Spam tracking ─────────────────────────────────────────────────────────
const spamStore = new Map(); // key: `groupId:userId` -> [timestamps]

function recordMessage(groupId, userId) {
  const key = `${groupId}:${userId}`;
  const now = Date.now();
  if (!spamStore.has(key)) spamStore.set(key, []);
  const times = spamStore.get(key);
  times.push(now);
  // Giữ lại 30 giây gần nhất để tránh tốn RAM
  const cutoff = now - 30000;
  const cleaned = times.filter(t => t >= cutoff);
  spamStore.set(key, cleaned);
  return cleaned;
}

function clearSpam(groupId, userId) {
  const key = `${groupId}:${userId}`;
  spamStore.delete(key);
}

module.exports = {
  getGroupAnti,
  setGroupAnti,
  recordJoin,
  resetJoinCount,
  getJoinCount,
  recordMessage,
  clearSpam,
  isAntiUndoEnabled: (groupId) => getGroupAnti(groupId).antiUndo,
};

"use strict";

/**
 * includes/database/messageCache.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Cache in-memory các tin nhắn gần đây theo threadId.
 * Dùng để tra cứu context reply khi quote thiếu nội dung.
 *
 * Exports:
 *   store(event)                    — lưu tin nhắn vào cache
 *   getById(msgId, threadId?)       — tra theo msgId
 *   getByCliId(cliMsgId, threadId?) — tra theo cliMsgId
 *   getThread(threadId, limit?)     — lấy danh sách tin gần nhất
 */

const MAX_PER_THREAD = 200;

const _store = new Map();

function _getList(threadId) {
  if (!_store.has(threadId)) _store.set(threadId, []);
  return _store.get(threadId);
}

function _prune(list) {
  if (list.length > MAX_PER_THREAD) {
    list.splice(0, list.length - MAX_PER_THREAD);
  }
}

function store(event) {
  try {
    const raw = event?.data;
    if (!raw) return;

    const threadId = String(event.threadId || raw.idTo || "");
    if (!threadId) return;

    const msgId    = raw.msgId    ? String(raw.msgId)    : null;
    const cliMsgId = raw.cliMsgId ? String(raw.cliMsgId) : null;
    if (!msgId && !cliMsgId) return;

    const list = _getList(threadId);

    const exists = list.find(
      m => (msgId && m.msgId === msgId) || (cliMsgId && m.cliMsgId === cliMsgId)
    );
    if (exists) return;

    list.push({
      msgId,
      cliMsgId,
      uidFrom  : raw.uidFrom ? String(raw.uidFrom) : null,
      content  : raw.content,
      attach   : Array.isArray(raw.attach) ? raw.attach : [],
      msgType  : raw.msgType || null,
      ts       : raw.ts || raw.msgTs || Date.now(),
      threadId,
      type     : event.type,
    });

    _prune(list);
  } catch (_) {}
}

function getById(msgId, threadId) {
  if (!msgId) return null;
  const id = String(msgId);

  if (threadId) {
    const list = _store.get(String(threadId)) || [];
    return list.find(m => m.msgId === id) || null;
  }

  for (const list of _store.values()) {
    const found = list.find(m => m.msgId === id);
    if (found) return found;
  }
  return null;
}

function getByCliId(cliMsgId, threadId) {
  if (!cliMsgId) return null;
  const id = String(cliMsgId);

  if (threadId) {
    const list = _store.get(String(threadId)) || [];
    return list.find(m => m.cliMsgId === id) || null;
  }

  for (const list of _store.values()) {
    const found = list.find(m => m.cliMsgId === id);
    if (found) return found;
  }
  return null;
}

function getThread(threadId, limit = 20) {
  const list = _store.get(String(threadId)) || [];
  return list.slice(-limit);
}

module.exports = { store, getById, getByCliId, getThread };

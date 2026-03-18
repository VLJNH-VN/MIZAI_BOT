"use strict";

/**
 * includes/handlers/ttlStore.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Factory tạo TTL Map dùng chung cho handleReply, handleReaction, handleUndo.
 *
 * Dùng:
 *   const { createTtlStore } = require("./ttlStore");
 *   const store = createTtlStore(DEFAULT_TTL_MS);
 *
 *   store.register({ messageId, commandName, payload, ttl })
 *   store.find(id)   → entry | null  (tự xóa nếu hết hạn)
 *   store.del(id)    → void
 */

function createTtlStore(defaultTtlMs = 10 * 60 * 1000) {
  const _map = new Map();

  // Dọn entry hết hạn định kỳ mỗi 1 phút
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _map) {
      if (entry.expireAt && now > entry.expireAt) _map.delete(key);
    }
  }, 60 * 1000);

  return {
    /**
     * Đăng ký entry mới.
     * @param {Object} opts
     * @param {string} opts.messageId
     * @param {string} opts.commandName
     * @param {Object} [opts.payload]
     * @param {number} [opts.ttl]
     */
    register({ messageId, commandName, payload = {}, ttl = defaultTtlMs }) {
      if (!messageId || !commandName) return;
      _map.set(String(messageId), {
        commandName,
        payload,
        expireAt: ttl > 0 ? Date.now() + ttl : null,
      });
    },

    /**
     * Tìm entry theo ID. Trả null nếu không có hoặc đã hết hạn.
     * @param {string|number} id
     * @returns {{ commandName, payload, expireAt, _key } | null}
     */
    find(id) {
      const key   = String(id);
      const entry = _map.get(key);
      if (!entry) return null;
      if (entry.expireAt && Date.now() > entry.expireAt) {
        _map.delete(key);
        return null;
      }
      return { ...entry, _key: key };
    },

    /** Xóa entry theo ID. */
    del(id) {
      _map.delete(String(id));
    },
  };
}

module.exports = { createTtlStore };

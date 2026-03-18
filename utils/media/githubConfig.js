"use strict";

/**
 * utils/media/githubConfig.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Helper dùng chung cho githubMedia.js và mediaCache.js:
 *   - githubApiHeaders(token)  →  object header chuẩn cho GitHub REST API v3
 */

function githubApiHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

module.exports = { githubApiHeaders };

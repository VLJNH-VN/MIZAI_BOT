"use strict";

/**
 * src/commands/fown.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Quản trị API server fown.onrender.com (yt-dlp admin)
 *
 * Cách dùng:
 *   .fown status            — Xem trạng thái GitHub storage
 *   .fown on                — Bật GitHub storage
 *   .fown off               — Tắt GitHub storage
 *   .fown token <ghp_...>   — Cập nhật GitHub token
 */

const FOWN_BASE  = "https://fown.onrender.com";
const ADMIN_KEY  = "ytdlp-admin-88fx";
const AUTH_QUERY = `?admin_key=${ADMIN_KEY}`;

// ─────────────────────────────────────────────────────────────────────────────
// Helper gọi API
// ─────────────────────────────────────────────────────────────────────────────
async function fownGet(path) {
  const res = await global.axios.get(`${FOWN_BASE}${path}${AUTH_QUERY}`, {
    timeout: 20_000,
  });
  return res.data;
}

async function fownPost(path, body = {}) {
  const res = await global.axios.post(
    `${FOWN_BASE}${path}${AUTH_QUERY}`,
    body,
    {
      timeout: 20_000,
      headers: { "Content-Type": "application/json" },
    }
  );
  return res.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Format trạng thái
// ─────────────────────────────────────────────────────────────────────────────
function formatStatus(data) {
  const gh = data?.github || data;
  const enabled   = gh.enabled   ?? gh.toggle ?? "?";
  const tokenSet  = gh.token_set ?? false;
  const owner     = gh.owner     || "—";
  const repo      = gh.repo      || "—";
  const branch    = gh.branch    || "main";
  const maxAge    = gh.cache_max_age_min ?? "?";

  const icon = enabled ? "🟢" : "🔴";

  return [
    `📡 Fown API — GitHub Storage`,
    `${icon} Trạng thái : ${enabled ? "BẬT" : "TẮT"}`,
    `🔑 Token     : ${tokenSet ? "Đã cấu hình" : "Chưa đặt"}`,
    `👤 Owner     : ${owner}`,
    `📦 Repo      : ${repo} (${branch})`,
    `⏱️ Cache TTL  : ${maxAge} phút`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Export lệnh
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  config: {
    name           : "fown",
    version        : "1.0.0",
    hasPermssion   : 1,
    credits        : "MIZAI",
    description    : "Quản trị yt-dlp API server (fown.onrender.com)",
    commandCategory: "Admin",
    usages         : "fown [status | on | off | token <ghp_...>]",
    cooldowns      : 5,
  },

  run: async ({ args, send }) => {
    const sub = (args[0] || "status").toLowerCase();

    // ── status ───────────────────────────────────────────────────────────────
    if (sub === "status") {
      send("⏳ Đang lấy trạng thái...");
      try {
        const data = await fownGet("/api/admin/status");
        return send(formatStatus(data));
      } catch (err) {
        return send(`❌ Lỗi: ${err?.response?.data?.error || err.message}`);
      }
    }

    // ── on ───────────────────────────────────────────────────────────────────
    if (sub === "on") {
      send("⏳ Đang bật GitHub storage...");
      try {
        const data = await fownPost("/api/admin/github/enable");
        const ok   = data?.success ?? data?.github_active ?? false;
        return send(ok
          ? "✅ GitHub storage đã được BẬT. Media sẽ được upload lên GitHub."
          : `⚠️ Phản hồi: ${JSON.stringify(data)}`
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err?.response?.data?.error || err.message}`);
      }
    }

    // ── off ──────────────────────────────────────────────────────────────────
    if (sub === "off") {
      send("⏳ Đang tắt GitHub storage...");
      try {
        const data = await fownPost("/api/admin/github/disable");
        const ok   = data?.success ?? true;
        return send(ok
          ? "🔴 GitHub storage đã TẮT. Download sẽ stream trực tiếp."
          : `⚠️ Phản hồi: ${JSON.stringify(data)}`
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err?.response?.data?.error || err.message}`);
      }
    }

    // ── token ─────────────────────────────────────────────────────────────────
    if (sub === "token") {
      const token = args[1];
      if (!token) return send("⚠️ Dùng: .fown token <ghp_...>");
      if (!token.startsWith("ghp_") && !token.startsWith("github_pat_")) {
        return send("⚠️ Token GitHub phải bắt đầu bằng ghp_ hoặc github_pat_");
      }
      send("⏳ Đang cập nhật token...");
      try {
        const data = await fownPost("/api/admin/github/token", { token });
        const ok   = data?.success ?? false;
        return send(ok
          ? "✅ GitHub token đã được cập nhật thành công."
          : `⚠️ Phản hồi: ${JSON.stringify(data)}`
        );
      } catch (err) {
        return send(`❌ Lỗi: ${err?.response?.data?.error || err.message}`);
      }
    }

    // ── help ─────────────────────────────────────────────────────────────────
    return send(
      `📖 Lệnh fown — Quản trị yt-dlp API\n\n` +
      `.fown status          — Xem trạng thái\n` +
      `.fown on              — Bật GitHub storage\n` +
      `.fown off             — Tắt GitHub storage\n` +
      `.fown token <ghp_...> — Cập nhật GitHub token`
    );
  },
};

const { GoogleGenAI } = require("@google/genai");
const axios = require("axios");
const fs    = require("fs");
const path  = require("path");

const KEY_FILE    = path.join(__dirname, "..", "..", "includes", "data", "key.json");
const CONFIG_FILE = path.join(__dirname, "..", "..", "config.json");
const GROQ_URL    = "https://api.groq.com/openai/v1/chat/completions";

// ── Helpers đọc/ghi key.json ────────────────────────────────────────────────────
function loadData() {
  try {
    if (!fs.existsSync(KEY_FILE)) {
      const def = {
        geminiKeys: [], geminiLive: [], geminiDead: [],
        keys: [], live: [], dead: [], no_balance: [], autoCheck: true
      };
      fs.writeFileSync(KEY_FILE, JSON.stringify(def, null, 2), "utf-8");
      return def;
    }
    const raw = JSON.parse(fs.readFileSync(KEY_FILE, "utf-8"));
    if (!Array.isArray(raw.geminiKeys))  raw.geminiKeys  = [];
    if (!Array.isArray(raw.geminiLive))  raw.geminiLive  = [];
    if (!Array.isArray(raw.geminiDead))  raw.geminiDead  = [];
    if (!Array.isArray(raw.keys))        raw.keys        = [];
    if (!Array.isArray(raw.live))        raw.live        = [];
    if (!Array.isArray(raw.dead))        raw.dead        = [];
    if (!Array.isArray(raw.no_balance))  raw.no_balance  = [];
    if (typeof raw.autoCheck !== "boolean") raw.autoCheck = true;
    return raw;
  } catch {
    return {
      geminiKeys: [], geminiLive: [], geminiDead: [],
      keys: [], live: [], dead: [], no_balance: [], autoCheck: true
    };
  }
}

function saveData(data) {
  fs.writeFileSync(KEY_FILE, JSON.stringify(data, null, 2), "utf-8");
}

// ── Check Gemini key ────────────────────────────────────────────────────────────
async function checkGeminiKey(key) {
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: "Hi" }] }],
      config: { maxOutputTokens: 5 }
    });
    return { key, status: "live" };
  } catch (err) {
    const status = err?.status || err?.response?.status || 0;
    const msg    = err?.message || "";
    const is429  = status === 429 || msg.includes("RESOURCE_EXHAUSTED");
    if (is429) {
      const m = msg.toLowerCase();
      const quotaExhausted = m.includes("daily") || m.includes("monthly") ||
        m.includes("billing") || m.includes("exceeded your quota") ||
        m.includes("quota exceeded");
      if (quotaExhausted) return { key, status: "no_balance", note: "hết quota ngày/tháng" };
      return { key, status: "rate_limit", note: "rate-limit tạm thời, key vẫn còn dùng được" };
    }
    if (status === 401 || msg.includes("API_KEY_INVALID") || msg.includes("invalid api key"))
      return { key, status: "dead", error: "API key không hợp lệ" };
    return { key, status: "dead", error: msg.slice(0, 100) };
  }
}

// ── Check Groq key ──────────────────────────────────────────────────────────────
async function checkGroqKey(key) {
  if (global.checkGroqKey) return global.checkGroqKey(key);
  try {
    await axios.post(GROQ_URL, {
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 5
    }, {
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      timeout: 12000
    });
    return { key, status: "live" };
  } catch (err) {
    const status = err?.response?.status;
    if (status === 402) return { key, status: "no_balance", note: "no balance" };
    const errMsg = err?.response?.data?.error?.message || err.message;
    return { key, status: "dead", error: errMsg };
  }
}

// ── Cập nhật active Gemini key vào global + config ─────────────────────────────
function syncActiveGeminiKey(data) {
  const deadSet  = new Set(Array.isArray(data.geminiDead) ? data.geminiDead : []);
  const liveKeys = (data.geminiKeys || []).filter(k => !deadSet.has(k));
  const activeKey = liveKeys[0] || "";
  if (activeKey) {
    if (global.config) global.config.geminiKey = activeKey;
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
      cfg.geminiKey = activeKey;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
    } catch {}
  }
  return activeKey;
}

module.exports = {
  config: {
    name: "key",
    version: "3.0.0",
    hasPermssion: 2,
    credits: "Bot",
    description: "Quản lý Gemini key (AIza...) và Groq key (gsk_...)",
    commandCategory: "Quản Trị",
    usages: [
      ".key add <key>         — Thêm key (Gemini hoặc Groq)",
      ".key del <key|số>      — Xoá key Gemini (g1, g2...) hoặc Groq (1, 2...)",
      ".key alive [g1|g2...]  — Khôi phục key bị đánh dấu dead nhầm",
      ".key list              — Danh sách tất cả key",
      ".key check             — Check tất cả key",
      ".key check <key>       — Check 1 key cụ thể",
      ".key autocheck         — Bật/tắt tự động kiểm tra",
    ].join("\n"),
    cooldowns: 3
  },

  run: async ({ args, send, senderId, isBotAdmin }) => {
    if (!isBotAdmin(senderId)) {
      return send("❌ Chỉ admin bot mới dùng được lệnh này.");
    }

    const FLAG_MAP = {
      "-a": "add", "-d": "del", "-l": "list",
      "-c": "check", "-r": "alive", "-ac": "autocheck",
    };
    const sub = FLAG_MAP[args[0]] || (args[0] || "").toLowerCase();

    // ── Thêm key ────────────────────────────────────────────────────────────────
    if (sub === "add") {
      const newKey = args[1]?.trim();
      if (!newKey) return send("⚠️ Nhập key cần thêm.\nGemini: AIza...\nGroq: gsk_...");

      const data = loadData();

      if (newKey.startsWith("AIza")) {
        if (data.geminiKeys.includes(newKey)) return send("⚠️ Gemini key này đã tồn tại.");
        await send(`🔍 Đang kiểm tra Gemini key...`);
        const result = await checkGeminiKey(newKey);

        data.geminiKeys.push(newKey);
        if (result.status === "live" || result.status === "rate_limit") {
          data.geminiDead = data.geminiDead.filter(k => k !== newKey);
        } else {
          data.geminiDead = [...new Set([...data.geminiDead, newKey])];
        }
        saveData(data);
        syncActiveGeminiKey(data);

        const short = `${newKey.slice(0, 8)}...${newKey.slice(-4)}`;
        const icon  = result.status === "live"       ? "✅"
                    : result.status === "rate_limit"  ? "⏳"
                    : result.status === "no_balance"  ? "💳" : "❌";
        const note  = result.status === "live"       ? "Live — sẵn sàng dùng"
                    : result.note || result.error || result.status;
        return send(`${icon} Đã thêm Gemini key: ${short}\n📊 Trạng thái: ${note}\n📦 Tổng Gemini: ${data.geminiKeys.length} key`);
      }

      if (newKey.startsWith("gsk_")) {
        if (data.keys.includes(newKey)) return send("⚠️ Groq key này đã tồn tại.");
        data.keys.push(newKey);
        if (!data.live.includes(newKey)) data.live.push(newKey);
        data.no_balance = data.no_balance.filter(k => k !== newKey);
        data.dead = data.dead.filter(k => k !== newKey);
        saveData(data);
        const short = `${newKey.slice(0, 8)}...${newKey.slice(-4)}`;
        return send(`✅ Đã thêm Groq key: ${short}\n📦 Tổng Groq: ${data.keys.length} key`);
      }

      return send("⚠️ Key không hợp lệ.\nGemini: AIza...\nGroq: gsk_...");
    }

    // ── Xoá key ─────────────────────────────────────────────────────────────────
    if (sub === "del" || sub === "delete" || sub === "remove" || sub === "rm") {
      const target  = args[1]?.trim();
      if (!target) return send("⚠️ Nhập key hoặc số thứ tự cần xoá.\nGemini: g1, g2... | Groq: 1, 2...");

      const data = loadData();

      if (target.startsWith("AIza")) {
        const idx = data.geminiKeys.indexOf(target);
        if (idx === -1) return send("❌ Không tìm thấy Gemini key này.");
        const removed = data.geminiKeys.splice(idx, 1)[0];
        data.geminiLive = data.geminiLive.filter(k => k !== removed);
        data.geminiDead = data.geminiDead.filter(k => k !== removed);
        saveData(data);
        syncActiveGeminiKey(data);
        const short = `${removed.slice(0, 8)}...${removed.slice(-4)}`;
        return send(`🗑️ Đã xoá Gemini key: ${short}\n📦 Còn lại: ${data.geminiKeys.length} key`);
      }

      const geminiMatch = /^g(\d+)$/i.exec(target);
      if (geminiMatch) {
        const idx = parseInt(geminiMatch[1]) - 1;
        if (idx < 0 || idx >= data.geminiKeys.length)
          return send(`❌ Số thứ tự Gemini không hợp lệ. Hiện có ${data.geminiKeys.length} key.`);
        const removed = data.geminiKeys.splice(idx, 1)[0];
        data.geminiLive = data.geminiLive.filter(k => k !== removed);
        data.geminiDead = data.geminiDead.filter(k => k !== removed);
        saveData(data);
        syncActiveGeminiKey(data);
        const short = `${removed.slice(0, 8)}...${removed.slice(-4)}`;
        return send(`🗑️ Đã xoá Gemini key g${idx + 1}: ${short}\n📦 Còn lại: ${data.geminiKeys.length} key`);
      }

      const byIndex = /^\d+$/.test(target);
      if (byIndex || target.startsWith("gsk_")) {
        let removed = null;
        if (byIndex) {
          const idx = parseInt(target) - 1;
          if (idx < 0 || idx >= data.keys.length)
            return send(`❌ Số thứ tự Groq không hợp lệ. Hiện có ${data.keys.length} key.`);
          removed = data.keys.splice(idx, 1)[0];
        } else {
          const idx = data.keys.indexOf(target);
          if (idx === -1) return send("❌ Không tìm thấy Groq key này.");
          removed = data.keys.splice(idx, 1)[0];
        }
        data.live = data.live.filter(k => k !== removed);
        data.dead = data.dead.filter(k => k !== removed);
        saveData(data);
        const short = `${removed.slice(0, 8)}...${removed.slice(-4)}`;
        return send(`🗑️ Đã xoá Groq key: ${short}\n📦 Còn lại: ${data.keys.length} key`);
      }

      return send("⚠️ Không nhận được key hợp lệ.\nDùng: g1, g2... cho Gemini | 1, 2... hoặc gsk_... cho Groq");
    }

    // ── Danh sách key ───────────────────────────────────────────────────────────
    if (sub === "list" || sub === "ls") {
      const data = loadData();
      const liveGSet = new Set(data.geminiLive);
      const deadGSet = new Set(data.geminiDead);
      const liveRSet = new Set(data.live);
      const deadRSet = new Set(data.dead);

      let msg = `🔑 DANH SÁCH API KEY\n${"━".repeat(22)}\n`;

      msg += `🤖 Gemini (${data.geminiKeys.length} key):\n`;
      if (data.geminiKeys.length) {
        data.geminiKeys.forEach((k, i) => {
          const short = `${k.slice(0, 8)}...${k.slice(-4)}`;
          const tag   = liveGSet.has(k) ? " ✅" : deadGSet.has(k) ? " ❌" : " ❓";
          msg += `  g${i + 1}. ${short}${tag}\n`;
        });
      } else {
        msg += `  (chưa có)\n`;
      }

      msg += `\n🦙 Groq (${data.keys.length} key):\n`;
      if (data.keys.length) {
        data.keys.forEach((k, i) => {
          const short = `${k.slice(0, 8)}...${k.slice(-4)}`;
          const tag   = liveRSet.has(k) ? " ✅" : deadRSet.has(k) ? " ❌" : " ❓";
          msg += `  ${i + 1}. ${short}${tag}\n`;
        });
      } else {
        msg += `  (chưa có)\n`;
      }

      msg += `${"━".repeat(22)}\n🔄 Auto check: ${data.autoCheck ? "✅ Bật" : "❌ Tắt"}`;
      return send(msg);
    }

    // ── Check key ───────────────────────────────────────────────────────────────
    if (sub === "check" || sub === "ck") {
      const target = args[1]?.trim();
      const data   = loadData();

      if (target) {
        await send(`🔍 Đang kiểm tra key...`);
        const result = target.startsWith("AIza")
          ? await checkGeminiKey(target)
          : await checkGroqKey(target);
        const icon  = result.status === "live"       ? "✅"
                    : result.status === "rate_limit"  ? "⏳"
                    : result.status === "no_balance"  ? "💳" : "❌";
        const short = `${target.slice(0, 8)}...${target.slice(-4)}`;
        const note  = result.note ? ` (${result.note})` : "";
        return send(`${icon} ${short}\n📊 ${result.status.toUpperCase()}${note}${result.error ? `\n⚠️ ${result.error}` : ""}`);
      }

      const total = data.geminiKeys.length + data.keys.length;
      if (!total) return send("📋 Chưa có key nào để kiểm tra.");
      await send(`🔍 Đang check ${total} key (${data.geminiKeys.length} Gemini + ${data.keys.length} Groq)...`);

      const gLive = [], gRateLimit = [], gDead = [], gNoBalance = [];
      for (const k of data.geminiKeys) {
        const r = await checkGeminiKey(k);
        if (r.status === "live")             gLive.push(k);
        else if (r.status === "rate_limit")  gRateLimit.push(k);
        else if (r.status === "no_balance")  gNoBalance.push(k);
        else                                 gDead.push(k);
      }
      data.geminiLive = [...gLive, ...gRateLimit];
      data.geminiDead = [...gDead, ...gNoBalance];

      const rLive = [], rDead = [], rNoBalance = [];
      for (const k of data.keys) {
        const r = await checkGroqKey(k);
        if (r.status === "live")       rLive.push(k);
        else if (r.status === "no_balance") rNoBalance.push(k);
        else                           rDead.push(k);
      }
      data.live       = rLive;
      data.dead       = rDead;
      data.no_balance = rNoBalance;

      saveData(data);
      syncActiveGeminiKey(data);

      const fmt = (arr) => arr.map((k, i) => `  ${i + 1}. ${k.slice(0, 8)}...${k.slice(-4)}`).join("\n");
      return send(
        `📊 KẾT QUẢ CHECK\n${"━".repeat(22)}\n` +
        `🤖 Gemini:\n` +
        `  ✅ Live: ${gLive.length}\n${fmt(gLive) || "  —"}\n` +
        `  ⏳ Rate-limit (vẫn dùng được): ${gRateLimit.length}\n${fmt(gRateLimit) || "  —"}\n` +
        `  💳 Hết quota: ${gNoBalance.length}\n${fmt(gNoBalance) || "  —"}\n` +
        `  ❌ Dead: ${gDead.length}\n${fmt(gDead) || "  —"}\n\n` +
        `🦙 Groq:\n` +
        `  ✅ Live: ${rLive.length}\n${fmt(rLive) || "  —"}\n` +
        `  💳 Hết credit: ${rNoBalance.length}\n${fmt(rNoBalance) || "  —"}\n` +
        `  ❌ Dead: ${rDead.length}\n${fmt(rDead) || "  —"}`
      );
    }

    // ── Khôi phục key bị mark dead nhầm ────────────────────────────────────────
    if (sub === "alive" || sub === "revive" || sub === "reset") {
      const target = args[1]?.trim();
      const data   = loadData();

      if (!target) {
        data.geminiDead = [];
        data.geminiLive = [...data.geminiKeys];
        saveData(data);
        syncActiveGeminiKey(data);
        return send(`✅ Đã bỏ dead cho TẤT CẢ ${data.geminiKeys.length} Gemini key.\nDùng .key check để kiểm tra lại.`);
      }

      const geminiMatch = /^g(\d+)$/i.exec(target);
      if (geminiMatch) {
        const idx = parseInt(geminiMatch[1]) - 1;
        if (idx < 0 || idx >= data.geminiKeys.length)
          return send(`❌ Số thứ tự không hợp lệ. Hiện có ${data.geminiKeys.length} Gemini key.`);
        const key = data.geminiKeys[idx];
        data.geminiDead = data.geminiDead.filter(k => k !== key);
        if (!data.geminiLive.includes(key)) data.geminiLive.push(key);
        saveData(data);
        syncActiveGeminiKey(data);
        const short = `${key.slice(0, 8)}...${key.slice(-4)}`;
        return send(`✅ Đã khôi phục Gemini key g${idx + 1}: ${short}`);
      }

      if (target.startsWith("AIza")) {
        if (!data.geminiKeys.includes(target)) return send("❌ Không tìm thấy key này.");
        data.geminiDead = data.geminiDead.filter(k => k !== target);
        if (!data.geminiLive.includes(target)) data.geminiLive.push(target);
        saveData(data);
        syncActiveGeminiKey(data);
        const short = `${target.slice(0, 8)}...${target.slice(-4)}`;
        return send(`✅ Đã khôi phục Gemini key: ${short}`);
      }

      return send("⚠️ Dùng: .key alive g1 | .key alive g2 | .key alive (tất cả)");
    }

    // ── Bật/tắt auto check ──────────────────────────────────────────────────────
    if (sub === "autocheck" || sub === "auto") {
      const data    = loadData();
      data.autoCheck = !data.autoCheck;
      saveData(data);
      if (global.setAutoCheck) global.setAutoCheck(data.autoCheck);
      return send(`🔄 Auto check: ${data.autoCheck ? "✅ Bật" : "❌ Tắt"}`);
    }

    // ── Hướng dẫn ───────────────────────────────────────────────────────────────
    const data    = loadData();
    syncActiveGeminiKey(data);
    let gmKey = "";
    try { gmKey = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")).geminiKey || ""; } catch {}
    const gmShort = gmKey ? `${gmKey.slice(0, 8)}...${gmKey.slice(-4)}` : "(chưa có)";
    return send(
      `🔑 Quản lý API Key\n${"━".repeat(22)}\n` +
      `.key add <key>      — Thêm Gemini/Groq key\n` +
      `.key del g<số>      — Xoá Gemini key (g1, g2...)\n` +
      `.key del <số>       — Xoá Groq key (1, 2...)\n` +
      `.key alive          — Khôi phục tất cả key bị dead nhầm\n` +
      `.key alive g1       — Khôi phục 1 key cụ thể\n` +
      `.key list           — Danh sách tất cả key\n` +
      `.key check          — Check tất cả key\n` +
      `.key check <key>    — Check 1 key cụ thể\n` +
      `.key autocheck      — Bật/tắt auto check\n` +
      `${"━".repeat(22)}\n` +
      `🤖 Gemini đang dùng: ${gmShort}\n` +
      `📦 Gemini: ${data.geminiKeys.length} | ✅ ${(data.geminiKeys.length - data.geminiDead.length)} còn dùng được\n` +
      `📦 Groq: ${data.keys.length} | ✅ ${(data.live || []).length} live\n` +
      `🔄 Auto check: ${data.autoCheck ? "✅ Bật" : "❌ Tắt"}`
    );
  }
};

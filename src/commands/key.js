const axios = require("axios");
const fs = require("fs");
const path = require("path");

const KEY_FILE    = path.join(__dirname, "..", "..", "includes", "data", "key.json");
const CONFIG_FILE = path.join(__dirname, "..", "..", "config.json");
const GROQ_URL    = "https://api.groq.com/openai/v1/chat/completions";

async function checkOneKey(key) {
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
    // 402 = key hợp lệ nhưng hết credit
    if (status === 402) return { key, status: "no_balance", note: "no balance" };
    const errMsg = err?.response?.data?.error?.message || err.message;
    return { key, status: "dead", error: errMsg };
  }
}

function loadData() {
  try {
    if (!fs.existsSync(KEY_FILE)) {
      const def = { keys: [], autoCheck: true, live: [], dead: [] };
      fs.writeFileSync(KEY_FILE, JSON.stringify(def, null, 2), "utf-8");
      return def;
    }
    const raw = JSON.parse(fs.readFileSync(KEY_FILE, "utf-8"));
    if (!Array.isArray(raw.keys)) raw.keys = [];
    if (typeof raw.autoCheck !== "boolean") raw.autoCheck = true;
    if (!Array.isArray(raw.live)) raw.live = [];
    if (!Array.isArray(raw.dead)) raw.dead = [];
    return raw;
  } catch {
    return { keys: [], autoCheck: true, live: [], dead: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(KEY_FILE, JSON.stringify(data, null, 2), "utf-8");
}

module.exports = {
  config: {
    name: "key",
    version: "2.0.0",
    hasPermssion: 2,
    credits: "Bot",
    description: "Quản lý API key: Groq (gsk_...) và DeepSeek (sk-...)",
    commandCategory: "Admin",
    usages: [
      ".key add <key>       — Thêm key",
      ".key del <key|số>    — Xoá key",
      ".key list            — Danh sách key",
      ".key check           — Check tất cả key",
      ".key check <key>     — Check 1 key cụ thể",
      ".key autocheck       — Bật/tắt tự động kiểm tra key"
    ].join("\n"),
    cooldowns: 3
  },

  run: async ({ args, send, senderId, isBotAdmin }) => {
    if (!isBotAdmin(senderId)) {
      return send("❌ Chỉ admin bot mới dùng được lệnh này.");
    }

    const sub = (args[0] || "").toLowerCase();

    // ── Thêm key ──────────────────────────────────────────────────────────────
    if (sub === "add") {
      const newKey = args[1]?.trim();
      if (!newKey) return send("⚠️ Vui lòng nhập API key.\nVD: .key add gsk_... (Groq)\n    .key add sk-... (DeepSeek)");

      // DeepSeek key (sk-...)
      if (newKey.startsWith("sk-")) {
        try {
          const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          cfg.deepseekKey = newKey;
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
          if (global.config) global.config.deepseekKey = newKey;
          const short = `${newKey.slice(0, 6)}...${newKey.slice(-4)}`;
          return send(`✅ Đã cập nhật DeepSeek key: ${short}`);
        } catch (e) {
          return send(`❌ Lỗi lưu key: ${e.message}`);
        }
      }

      if (!newKey.startsWith("gsk_")) return send("⚠️ Key không hợp lệ.\nGroq key bắt đầu bằng gsk_...\nDeepSeek key bắt đầu bằng sk-...");

      const data = loadData();
      if (data.keys.includes(newKey)) return send("⚠️ Key này đã tồn tại.");

      data.keys.push(newKey);
      if (!data.live.includes(newKey)) data.live.push(newKey);
      data.no_balance = (data.no_balance || []).filter(k => k !== newKey);
      data.dead = (data.dead || []).filter(k => k !== newKey);
      saveData(data);

      const short = `${newKey.slice(0, 8)}...${newKey.slice(-4)}`;
      return send(`✅ Đã thêm Groq key: ${short}\n📦 Tổng: ${data.keys.length} key`);
    }

    // ── Xoá key ───────────────────────────────────────────────────────────────
    if (sub === "del" || sub === "delete" || sub === "remove" || sub === "rm") {
      const target = args[1]?.trim();
      if (!target) return send("⚠️ Vui lòng nhập key hoặc số thứ tự cần xoá.");

      const data = loadData();
      const byIndex = /^\d+$/.test(target);
      let removed = null;

      if (byIndex) {
        const idx = parseInt(target) - 1;
        if (idx < 0 || idx >= data.keys.length)
          return send(`❌ Số thứ tự không hợp lệ. Hiện có ${data.keys.length} key.`);
        removed = data.keys.splice(idx, 1)[0];
      } else {
        const idx = data.keys.indexOf(target);
        if (idx === -1) return send("❌ Không tìm thấy key này.");
        removed = data.keys.splice(idx, 1)[0];
      }

      // Dọn khỏi live/dead
      data.live = (data.live || []).filter(k => k !== removed);
      data.dead = (data.dead || []).filter(k => k !== removed);
      saveData(data);

      const short = `${removed.slice(0, 8)}...${removed.slice(-4)}`;
      return send(`🗑️ Đã xoá key: ${short}\n📦 Còn lại: ${data.keys.length} key`);
    }

    // ── Danh sách key ─────────────────────────────────────────────────────────
    if (sub === "list" || sub === "ls") {
      const data = loadData();
      if (!data.keys.length) return send(`📋 Chưa có key nào.\n🔄 Auto check: ${data.autoCheck ? "✅ Bật" : "❌ Tắt"}`);

      const liveSet = new Set(data.live || []);
      const deadSet = new Set(data.dead || []);
      const list = data.keys.map((k, i) => {
        const short = `${k.slice(0, 8)}...${k.slice(-4)}`;
        const tag = liveSet.has(k) ? " ✅" : deadSet.has(k) ? " ❌" : "";
        return `${i + 1}. ${short}${tag}`;
      }).join("\n");

      return send(
        `📋 Groq Keys (${data.keys.length}):\n${list}\n\n` +
        `🔄 Auto check: ${data.autoCheck ? "✅ Bật" : "❌ Tắt"}`
      );
    }

    // ── Check key ─────────────────────────────────────────────────────────────
    if (sub === "check" || sub === "ck") {
      const target = args[1]?.trim();
      const data = loadData();

      if (target) {
        await send(`🔍 Đang kiểm tra key: ${target.slice(0, 8)}...`);
        const result = await checkOneKey(target);
        const icon = result.status === "live" ? "✅" : "❌";
        const short = `${target.slice(0, 8)}...${target.slice(-4)}`;
        const note = result.note ? ` (${result.note})` : "";
        return send(`${icon} ${short}\n📊 Trạng thái: ${result.status.toUpperCase()}${note}${result.error ? `\n⚠️ ${result.error.slice(0, 100)}` : ""}`);
      }

      if (!data.keys.length) return send("📋 Chưa có key nào để kiểm tra.");
      await send(`🔍 Đang check ${data.keys.length} Groq key, vui lòng đợi...`);

      const live = [], dead = [], noBalance = [];
      for (const k of data.keys) {
        const result = await checkOneKey(k);
        if (result.status === "live") live.push(k);
        else if (result.status === "no_balance") noBalance.push(k);
        else dead.push(k);
      }

      data.live = live;
      data.dead = dead;
      data.no_balance = noBalance;
      saveData(data);

      const liveList = live.map((k, i) => `  ${i + 1}. ✅ ${k.slice(0, 8)}...${k.slice(-4)}`).join("\n");
      const noBalList = noBalance.map((k, i) => `  ${i + 1}. 💳 ${k.slice(0, 8)}...${k.slice(-4)}`).join("\n");
      const deadList = dead.map((k, i) => `  ${i + 1}. ❌ ${k.slice(0, 8)}...${k.slice(-4)}`).join("\n");

      return send(
        `📊 Kết quả check (${data.keys.length} key)\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `✅ Live: ${live.length}\n${liveList || "  (không có)"}\n\n` +
        `💳 Hết credit: ${noBalance.length}\n${noBalList || "  (không có)"}\n\n` +
        `❌ Dead: ${dead.length}\n${deadList || "  (không có)"}`
      );
    }

    // ── Bật/tắt auto check ────────────────────────────────────────────────────
    if (sub === "autocheck" || sub === "auto") {
      const data = loadData();
      data.autoCheck = !data.autoCheck;
      saveData(data);
      if (global.setAutoCheck) global.setAutoCheck(data.autoCheck);
      return send(`🔄 Auto check: ${data.autoCheck ? "✅ Bật" : "❌ Tắt"}`);
    }

    // ── Hướng dẫn ─────────────────────────────────────────────────────────────
    const data = loadData();
    const liveCount = (data.live || []).length;
    let dsKey = "";
    try { dsKey = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")).deepseekKey || ""; } catch {}
    const dsShort = dsKey ? `${dsKey.slice(0, 6)}...${dsKey.slice(-4)}` : "(chưa có)";
    return send(
      `🔑 Quản lý API Key\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `.key add <key>    — Thêm key\n` +
      `  gsk_... → Groq | sk-... → DeepSeek\n` +
      `.key del <key|số> — Xoá Groq key\n` +
      `.key list         — Danh sách Groq key\n` +
      `.key check        — Check tất cả Groq key\n` +
      `.key check <key>  — Check 1 Groq key\n` +
      `.key autocheck    — Bật/tắt auto check\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🤖 DeepSeek: ${dsShort}\n` +
      `📦 Groq tổng: ${data.keys.length} | ✅ Live: ${liveCount}\n` +
      `🔄 Auto check: ${data.autoCheck ? "✅ Bật" : "❌ Tắt"}`
    );
  }
};

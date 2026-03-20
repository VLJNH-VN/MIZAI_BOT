"use strict";

/**
 * src/commands/autoxs.js
 * Bật/tắt tự động gửi kết quả xổ số vào nhóm lúc 18:32
 * Credits: vtishan(Vtuan) — converted MiZai
 */

const fs   = require("fs");
const path = require("path");
const { ThreadType } = require("zca-js");
const { registerReaction } = require('../../../includes/handlers/handleReaction');

const DATA_FILE   = path.join(process.cwd(), "includes", "data", "auto_xo_so.json");
const GROUPS_FILE = path.join(process.cwd(), "includes", "database", "groupsCache.json");

if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([]));

function readData()    { try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")); } catch { return []; } }
function writeData(d)  { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }
function readGroups()  { try { return Object.keys(JSON.parse(fs.readFileSync(GROUPS_FILE, "utf-8"))); } catch { return []; } }

function nowVN() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() };
}

// ─── Xổ số Miền Nam ───────────────────────────────────────────────────────────
async function xsmn() {
  const axios   = global.axios;
  const cheerio = require("cheerio");
  const url = "https://xsmn.mobi/";
  const res = await axios.get(url, { timeout: 30000 });
  const $   = cheerio.load(res.data);
  const con = $("#load_kq_mn_0");

  const Names = [];
  con.find("table.extendable tbody tr.gr-yellow th").each((_, th) => {
    const n = $(th).text().trim();
    if (n) Names.push(n);
  });

  const rows = [];
  con.find("table.extendable tbody tr").each((_, row) => {
    const giai    = $(row).find("td:first").text().trim();
    const provinces = [];
    if (giai) {
      $(row).find("td").each((_, td) => {
        const t = $(td).text().trim();
        if (t && t !== giai) provinces.push(t);
      });
      if (provinces.length) rows.push({ giai, provinces });
    }
  });

  const chunkMap = { ĐB: 6, G1: 5, G2: 5, G3: 5, G4: 5, G5: 4, G6: 4, G7: 3, G8: 2 };
  return Names.map(name => {
    const idx  = Names.indexOf(name);
    const data = rows.map(({ giai, provinces }) => {
      const kq     = provinces[idx] || "";
      const chunk  = chunkMap[giai];
      const splits = [];
      if (chunk) {
        if (giai === "G3") { splits.push(kq.slice(0, chunk)); splits.push(kq.slice(chunk, chunk * 2)); }
        else if (giai === "G6") { for (let i = 0; i < 3; i++) splits.push(kq.slice(i * chunk, (i + 1) * chunk)); }
        else if (giai === "G4") { for (let i = 0; i < 7; i++) splits.push(kq.slice(i * chunk, (i + 1) * chunk)); }
        else splits.push(kq.slice(0, chunk));
      }
      return { giải: giai, kết_quả: splits };
    });
    return { name, results: data };
  });
}

// ─── Xổ số Miền Bắc ───────────────────────────────────────────────────────────
async function xsmb() {
  try {
    const axios   = global.axios;
    const cheerio = require("cheerio");
    const url = "https://xsmn.mobi/xsmb-xo-so-mien-bac.html";
    const res = await axios.get(url, { timeout: 30000 });
    const $   = cheerio.load(res.data);

    const dateText = $('div.title-bor a[title^="XSMB ngày"]').attr("title");
    let date = dateText ? dateText.replace("XSMB ngày ", "").trim() : "Không rõ ngày";

    function luyNgay(ds) {
      const d  = new Date(ds.split("-").reverse().join("-"));
      d.setDate(d.getDate() - 1);
      return `${String(d.getDate()).padStart(2,"0")}-${String(d.getMonth()+1).padStart(2,"0")}-${d.getFullYear()}`;
    }

    const data = {};
    let results = [];
    $("table.kqmb tbody tr").each((_, el) => {
      const giai = $(el).find("td.txt-giai").text().trim();
      const num  = $(el).find("td.v-giai span").map((__, sp) => $(sp).text().trim()).get();
      if (giai && num.length) results.push({ giai, num });
      if (giai === "G.7") {
        data[date] = results.reduce((acc, { giai, num }) => {
          if (!acc[giai]) acc[giai] = [];
          acc[giai] = [...acc[giai], ...num];
          return acc;
        }, {});
        date    = luyNgay(date);
        results = [];
      }
    });
    if (results.length) {
      data[date] = results.reduce((acc, { giai, num }) => {
        if (!acc[giai]) acc[giai] = [];
        acc[giai] = [...acc[giai], ...num];
        return acc;
      }, {});
    }
    return { data };
  } catch (err) {
    logError?.(`[autoxs] xsmb: ${err.message}`);
    return { data: {} };
  }
}

module.exports = {
  config: {
    name:            "autoxs",
    version:         "1.1.0",
    hasPermssion:    1,
    credits:         "vtishan(Vtuan) — converted MiZai",
    description:     "Bật/tắt tự động gửi kết quả xổ số",
    commandCategory: "Nhóm",
    usages:          "autoxs on | off",
    cooldowns:       5,
  },

  // ── onLoad: khởi động interval gửi lúc 18:32 ──────────────────────────────
  onLoad: async ({ api }) => {
    let lastFired = "";
    setInterval(async () => {
      const { h, m, s } = nowVN();
      if (h !== 18 || m !== 32 || s !== 0) return;

      const key = `${h}:${m}`;
      if (lastFired === key) return;
      lastFired = key;

      try {
        const { data } = await xsmb();
        const dateKey  = Object.keys(data)[0];
        if (!dateKey) return;

        const fd = data[dateKey];
        const msg =
          `📋 Kết quả xổ số Miền Bắc ngày: ${dateKey}\n\n` +
          `🏅 Mã ĐB: ${(fd["Mã ĐB"] || []).join(" - ")}\n` +
          `🎯 Giải ĐB: ${(fd["ĐB"] || []).join(", ")}\n` +
          `1️⃣ Giải Nhất: ${(fd["G.1"] || []).join(", ")}\n` +
          `2️⃣ Giải Nhì: ${(fd["G.2"] || []).join(", ")}\n` +
          `3️⃣ Giải Ba: ${(fd["G.3"] || []).join(", ")}\n` +
          `4️⃣ Giải 4: ${(fd["G.4"] || []).join(", ")}\n` +
          `5️⃣ Giải 5: ${(fd["G.5"] || []).join(", ")}\n` +
          `6️⃣ Giải 6: ${(fd["G.6"] || []).join(", ")}\n` +
          `7️⃣ Giải 7: ${(fd["G.7"] || []).join(", ")}\n\n` +
          `👍 Thả cảm xúc để xem kết quả xổ số Miền Nam`;

        const disabledIds = readData();
        const groups      = readGroups();

        for (const id of groups) {
          if (disabledIds.includes(id)) continue;
          try {
            const sent  = await api.sendMessage({ msg }, id, ThreadType.Group);
            const msgId = sent?.message?.msgId ?? sent?.msgId;
            if (msgId) {
              registerReaction({
                messageId:   String(msgId),
                commandName: "autoxs",
                payload:     { type: "xsmn" },
                ttl:         30 * 60 * 1000,
              });
            }
          } catch (e) {
            logWarn?.(`[autoxs] Gửi thất bại tới ${id}: ${e.message}`);
          }
        }
      } catch (err) {
        logError?.(`[autoxs] onLoad interval: ${err.message}`);
      }
    }, 1000);
  },

  // ── run: bật / tắt cho nhóm ───────────────────────────────────────────────
  run: async ({ send, threadID }) => {
    const data    = readData();
    const isOff   = data.includes(threadID);
    if (isOff) {
      writeData(data.filter(id => id !== threadID));
      return send("✅ Đã bật tự động gửi kết quả xổ số cho nhóm này.");
    } else {
      writeData([...data, threadID]);
      return send("🔕 Đã tắt tự động gửi kết quả xổ số cho nhóm này.");
    }
  },

  // ── onReaction: gửi xổ số Miền Nam khi ai đó thả cảm xúc ─────────────────
  onReaction: async ({ data, send }) => {
    if (data?.type !== "xsmn") return;
    try {
      const provinces = await xsmn();
      const msg = provinces.map(p =>
        `📋 Kết quả xổ số tỉnh ${p.name}:\n` +
        Object.entries({
          ĐB: "Giải Đặc Biệt", G1: "Giải Nhất", G2: "Giải Nhì",
          G3: "Giải Ba", G4: "Giải 4", G5: "Giải 5",
          G6: "Giải 6", G7: "Giải 7", G8: "Giải 8"
        }).map(([key, label]) => {
          const r = p.results.find(x => x.giải === key);
          return r ? `${label}: ${r.kết_quả.join(", ")}` : "";
        }).filter(Boolean).join("\n")
      ).join("\n\n");
      return send(msg || "Không có dữ liệu xổ số Miền Nam.");
    } catch (err) {
      return send(`❌ Lỗi lấy xổ số Miền Nam: ${err.message}`);
    }
  },
};

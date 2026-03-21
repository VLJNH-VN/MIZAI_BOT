/**
 * src/commands/lookup.js
 * Gộp: wiki + thoitiet
 */

const axios = require("axios");

module.exports = {
  config: {
    name:            "lookup",
    aliases:         ["wiki", "thoitiet", "weather", "tracuu", "tt"],
    version:         "1.0.0",
    hasPermssion:    0,
    credits:         "MiZai",
    description:     "Tra cứu Wikipedia hoặc thời tiết theo địa điểm",
    commandCategory: "Tra Cứu",
    usages: [
      "lookup wiki <từ khóa>    — Tra cứu Wikipedia",
      "lookup tt [thành phố]    — Xem thời tiết",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ args, send, prefix, commandName }) => {
    const FLAG_MAP = { wiki: "wiki", thoitiet: "tt", weather: "tt", tt: "tt", tracuu: "wiki" };
    let sub = FLAG_MAP[commandName] || (args[0] || "").toLowerCase();
    let subArgs = FLAG_MAP[commandName] ? args : args.slice(1);

    if (!sub) {
      return send(
        `🔍 LOOKUP — TRA CỨU\n━━━━━━━━━━━━━━━━\n` +
        `${prefix}lookup wiki <từ khóa>    Wikipedia\n` +
        `${prefix}lookup tt [thành phố]   Thời tiết\n\n` +
        `Ví dụ:\n` +
        `• ${prefix}lookup wiki Hà Nội\n` +
        `• ${prefix}lookup tt Hanoi`
      );
    }

    // ── Wikipedia ─────────────────────────────────────────────────────────────
    if (sub === "wiki" || sub === "wikipedia") {
      const query = subArgs.join(" ").trim();
      if (!query) return send(`📖 Cách dùng: ${prefix}lookup wiki <từ khóa>\nVí dụ: ${prefix}lookup wiki Albert Einstein`);

      try {
        const viRes = await axios.get("https://vi.wikipedia.org/w/api.php", {
          params: { action: "query", list: "search", srsearch: query, utf8: 1, format: "json", srlimit: 1 },
          timeout: 8000
        });
        let results = viRes.data?.query?.search;
        let lang = "vi";

        if (!results?.length) {
          const enRes = await axios.get("https://en.wikipedia.org/w/api.php", {
            params: { action: "query", list: "search", srsearch: query, utf8: 1, format: "json", srlimit: 1 },
            timeout: 8000
          });
          results = enRes.data?.query?.search;
          lang = "en";
        }

        if (!results?.length) return send(`❌ Không tìm thấy kết quả cho: "${query}"\n💡 Thử từ khóa khác nhé!`);

        const pageId   = results[0].pageid;
        const baseUrl  = lang === "vi" ? "https://vi.wikipedia.org" : "https://en.wikipedia.org";
        const extractRes = await axios.get(`${baseUrl}/w/api.php`, {
          params: { action: "query", prop: "extracts", exintro: true, explaintext: true, pageids: pageId, format: "json" },
          timeout: 8000
        });
        const page    = Object.values(extractRes.data?.query?.pages || {})[0];
        const extract = (page?.extract || "").trim().slice(0, 600);
        const title   = page?.title || query;
        const url     = `${baseUrl}/?curid=${pageId}`;

        if (!extract) return send(`❌ Không có nội dung tóm tắt cho: "${query}"\n🔗 ${url}`);
        return send(
          `📖 ${title}${lang === "en" ? " (English)" : ""}\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `${extract}${extract.length >= 600 ? "..." : ""}\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `🔗 ${url}`
        );
      } catch (err) {
        return send(`❌ Không thể tra cứu lúc này: ${err?.message || "Lỗi kết nối"}`);
      }
    }

    // ── Thời tiết ─────────────────────────────────────────────────────────────
    if (sub === "tt" || sub === "thoitiet" || sub === "weather") {
      const location = subArgs.join(" ").trim() || "Ho Chi Minh City";
      try {
        const res = await axios.get(
          `https://wttr.in/${encodeURIComponent(location)}?format=j1`,
          { timeout: 10000, headers: { "User-Agent": global.userAgent } }
        );
        const data    = res.data;
        const current = data?.current_condition?.[0];
        const nearest = data?.nearest_area?.[0];

        if (!current) return send(`❌ Không tìm thấy thời tiết cho: "${location}"`);

        const cityName = nearest?.areaName?.[0]?.value || location;
        const country  = nearest?.country?.[0]?.value || "";
        const weather  = data?.weather?.[0];

        const uvLevel = (uv) => {
          if (uv <= 2) return "Thấp 🟢"; if (uv <= 5) return "Trung bình 🟡";
          if (uv <= 7) return "Cao 🟠";  if (uv <= 10) return "Rất cao 🔴";
          return "Cực cao ☢️";
        };

        return send(
          `🌤️ Thời Tiết — ${cityName}${country ? ", " + country : ""}\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `🌡️ Nhiệt độ: ${current.temp_C}°C (cảm giác ${current.FeelsLikeC}°C)\n` +
          `📊 Cao/Thấp: ${weather?.maxtempC}°C / ${weather?.mintempC}°C\n` +
          `☁️ Trạng thái: ${current.lang_vi?.[0]?.value || current.weatherDesc?.[0]?.value || "Không rõ"}\n` +
          `💧 Độ ẩm: ${current.humidity}%\n` +
          `💨 Gió: ${current.windspeedKmph} km/h\n` +
          `👁️ Tầm nhìn: ${current.visibility} km\n` +
          `☀️ Chỉ số UV: ${current.uvIndex} (${uvLevel(Number(current.uvIndex))})\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `📍 Nguồn: wttr.in`
        );
      } catch {
        return send(`❌ Không thể lấy thời tiết cho: "${location}"\n💡 Thử tên thành phố tiếng Anh, ví dụ: ${prefix}lookup tt Hanoi`);
      }
    }

    return send(`❓ Lệnh không hợp lệ. Dùng: ${prefix}lookup để xem hướng dẫn.`);
  },
};

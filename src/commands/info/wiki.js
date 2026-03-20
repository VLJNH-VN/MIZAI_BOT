const axios = require("axios");

module.exports = {
  config: {
    name: "wiki",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Tra cứu thông tin từ Wikipedia tiếng Việt",
    commandCategory: "Tra Cứu",
    usages: "wiki <từ khóa>",
    cooldowns: 5
  },

  run: async ({ args, send }) => {
    if (!args || args.length === 0) {
      return send(
        `📖 Hướng Dẫn Tra Cứu Wikipedia\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Cách dùng: .wiki <từ khóa>\n\n` +
        `📌 Ví dụ:\n` +
        `• .wiki Hà Nội\n` +
        `• .wiki Lịch sử Việt Nam\n` +
        `• .wiki Albert Einstein`
      );
    }

    const query = args.join(" ");

    try {
      // Tìm kiếm trên Wikipedia tiếng Việt
      const searchRes = await axios.get("https://vi.wikipedia.org/w/api.php", {
        params: {
          action: "query",
          list: "search",
          srsearch: query,
          utf8: 1,
          format: "json",
          srlimit: 1
        },
        timeout: 8000
      });

      const results = searchRes.data?.query?.search;
      if (!results || results.length === 0) {
        // Thử Wikipedia tiếng Anh
        const enRes = await axios.get("https://en.wikipedia.org/w/api.php", {
          params: {
            action: "query",
            list: "search",
            srsearch: query,
            utf8: 1,
            format: "json",
            srlimit: 1
          },
          timeout: 8000
        });
        const enResults = enRes.data?.query?.search;
        if (!enResults || enResults.length === 0) {
          return send(`❌ Không tìm thấy kết quả cho: "${query}"\n💡 Thử tìm với từ khóa khác nhé!`);
        }
        const pageId = enResults[0].pageid;
        const extractRes = await axios.get("https://en.wikipedia.org/w/api.php", {
          params: { action: "query", prop: "extracts", exintro: true, explaintext: true, pageids: pageId, format: "json" },
          timeout: 8000
        });
        const pages = extractRes.data?.query?.pages;
        const page = pages ? Object.values(pages)[0] : null;
        const extract = page?.extract ? page.extract.slice(0, 600).trim() : "Không có tóm tắt.";
        const title = page?.title || query;
        const url = `https://en.wikipedia.org/?curid=${pageId}`;
        return send(
          `📖 ${title} (English)\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `${extract}${extract.length >= 600 ? "..." : ""}\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `🔗 ${url}`
        );
      }

      const pageId = results[0].pageid;

      // Lấy tóm tắt bài viết
      const extractRes = await axios.get("https://vi.wikipedia.org/w/api.php", {
        params: {
          action: "query",
          prop: "extracts",
          exintro: true,
          explaintext: true,
          pageids: pageId,
          format: "json"
        },
        timeout: 8000
      });

      const pages = extractRes.data?.query?.pages;
      const page = pages ? Object.values(pages)[0] : null;
      let extract = page?.extract ? page.extract.trim() : "";

      // Giới hạn độ dài
      if (extract.length > 600) extract = extract.slice(0, 600);

      const title = page?.title || query;
      const url = `https://vi.wikipedia.org/?curid=${pageId}`;

      if (!extract) {
        return send(`❌ Không có nội dung tóm tắt cho: "${query}"\n🔗 ${url}`);
      }

      return send(
        `📖 ${title}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `${extract}${extract.length >= 600 ? "..." : ""}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `🔗 ${url}`
      );

    } catch (err) {
      return send(`❌ Không thể tra cứu lúc này: ${err?.message || "Lỗi kết nối"}\n💡 Thử lại sau nhé!`);
    }
  }
};

const axios = require("axios");

const JOKE_API = "https://v2.jokeapi.dev/joke/Any?type=single&safe-mode";

const CATEGORY_EMOJI = {
  Programming: "💻",
  Misc: "🎲",
  Dark: "🌑",
  Pun: "😄",
  Spooky: "👻",
  Christmas: "🎄",
};

module.exports = {
  config: {
    name: "joke",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Lấy một câu joke ngẫu nhiên từ JokeAPI",
    commandCategory: "Giải Trí",
    usages: "joke",
    cooldowns: 5,
  },

  run: async ({ send }) => {
    try {
      const res = await axios.get(JOKE_API, { timeout: 10000 });
      const data = res.data;

      if (data.error) {
        return send("❌ Không lấy được joke lúc này, thử lại sau nhé!");
      }

      const emoji = CATEGORY_EMOJI[data.category] || "😂";
      const joke = data.joke || "";

      return send(
        `${emoji} Joke ngẫu nhiên\n` +
        `━━━━━━━━━━━━━━━\n` +
        `${joke}\n` +
        `━━━━━━━━━━━━━━━\n` +
        `📂 Thể loại: ${data.category}`
      );
    } catch (err) {
      return send("❌ Lỗi kết nối tới JokeAPI. Thử lại sau nhé!");
    }
  },
};

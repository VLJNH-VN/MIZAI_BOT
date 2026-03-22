const axios = require("axios");

const VALID_CATS  = new Set(["Programming", "Misc", "Dark", "Pun", "Spooky", "Christmas"]);
const VALID_LANGS = new Set(["en", "de", "cs", "es", "fr", "pt"]);
const VALID_FLAGS = new Set(["nsfw", "religious", "political", "racist", "sexist", "explicit"]);
const CATEGORY_EMOJI = {
  Programming: "💻", Misc: "🎲", Dark: "🌑", Pun: "😄", Spooky: "👻", Christmas: "🎄",
};

function buildUrl(cats, lang, flags) {
  const catStr = cats.length ? cats.join(",") : "Any";
  const params = new URLSearchParams();
  params.set("lang", lang);
  if (flags.length) {
    params.set("blacklistFlags", flags.join(","));
  } else {
    params.set("safe-mode", "");
  }
  let qs = params.toString().replace("safe-mode=", "safe-mode");
  return `https://v2.jokeapi.dev/joke/${catStr}?${qs}`;
}

module.exports = {
  config: {
    name: "joke",
    version: "1.2.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Lấy một câu joke ngẫu nhiên từ JokeAPI",
    commandCategory: "Giải Trí",
    usages: [
      "joke                                   — Joke ngẫu nhiên (safe mode)",
      "joke --cat Programming,Misc            — Theo category (có thể kết hợp)",
      "joke --lang de                         — Theo ngôn ngữ: en/de/cs/es/fr/pt",
      "joke --flags nsfw,racist               — Blacklist nội dung cụ thể",
      "joke --cat Pun --lang en --flags nsfw  — Kết hợp tất cả",
    ].join("\n"),
    cooldowns: 5,
  },

  run: async ({ args, send }) => {
    const ALL_FLAGS = new Set(["--cat", "--lang", "--flags"]);

    const catIdx   = args.indexOf("--cat");
    const langIdx  = args.indexOf("--lang");
    const flagIdx  = args.indexOf("--flags");

    // Parse --cat (nhiều category cách nhau bởi dấu phẩy)
    let cats = [];
    if (catIdx !== -1) {
      const raw = args[catIdx + 1] || "";
      if (!raw || ALL_FLAGS.has(raw)) return send(`❌ Thiếu category sau --cat.\nVí dụ: --cat Programming,Misc`);
      cats = raw.split(",").map(c => c.trim()).filter(c => VALID_CATS.has(c));
      if (!cats.length) return send(
        `❌ Category không hợp lệ: "${raw}"\n` +
        `Hợp lệ: Programming, Misc, Dark, Pun, Spooky, Christmas`
      );
    }

    // Parse --lang
    let lang = "en";
    if (langIdx !== -1) {
      const l = args[langIdx + 1] || "";
      if (!l || ALL_FLAGS.has(l)) return send(`❌ Thiếu ngôn ngữ sau --lang.\nHợp lệ: en, de, cs, es, fr, pt`);
      if (!VALID_LANGS.has(l)) return send(`❌ Ngôn ngữ không hợp lệ: "${l}"\nHợp lệ: en, de, cs, es, fr, pt`);
      lang = l;
    }

    // Parse --flags (blacklist flags)
    let flags = [];
    if (flagIdx !== -1) {
      const raw = args[flagIdx + 1] || "";
      if (!raw || ALL_FLAGS.has(raw)) return send(`❌ Thiếu flags sau --flags.\nHợp lệ: nsfw, religious, political, racist, sexist, explicit`);
      flags = raw.split(",").map(f => f.trim()).filter(f => VALID_FLAGS.has(f));
      if (!flags.length) return send(`❌ Flags không hợp lệ: "${raw}"\nHợp lệ: nsfw, religious, political, racist, sexist, explicit`);
    }

    // Nếu không có flags, dùng safe-mode mặc định
    const url = buildUrl(cats, lang, flags);

    try {
      const res  = await axios.get(url, { timeout: 10000 });
      const data = res.data;

      if (data.error) return send("❌ Không lấy được joke lúc này, thử lại sau nhé!");

      let jokeText;
      if (data.type === "twopart") {
        if (!data.setup || !data.delivery) return send("❌ Joke không hợp lệ, thử lại nhé!");
        jokeText = `${data.setup}\n\n— ${data.delivery}`;
      } else {
        if (!data.joke) return send("❌ Joke không hợp lệ, thử lại nhé!");
        jokeText = data.joke;
      }

      const emoji = CATEGORY_EMOJI[data.category] || "😂";
      const meta  = [
        `📂 ${data.category}`,
        lang !== "en" ? `🌐 ${lang}` : null,
      ].filter(Boolean).join(" | ");

      return send(
        `${emoji} Joke ngẫu nhiên\n` +
        `━━━━━━━━━━━━━━━\n` +
        `${jokeText}\n` +
        `━━━━━━━━━━━━━━━\n` +
        meta
      );
    } catch {
      return send("❌ Lỗi kết nối tới JokeAPI. Thử lại sau nhé!");
    }
  },
};

const https = require("https");


const MIXCLOUD_GRAPHQL_URL = "https://app.mixcloud.com/graphql";

const SEARCH_QUERY = `query SearchResultsCloudcastsQuery(
  $count: Int!
  $term: String!
  $cursor: String
) {
  viewer {
    search {
      searchQuery(term: $term) {
        cloudcasts(first: $count, after: $cursor) {
          edges {
            node {
              id
              name
              slug
              owner { displayName username }
              picture { urlRoot }
              audioLength
              plays
              previewUrl
              isPlayable
            }
            cursor
          }
          pageInfo {
            endCursor
            hasNextPage
          }
        }
      }
    }
  }
}`;

const HEADERS = {
  "user-agent": global.userAgent,
  "accept": "*/*",
  "content-type": "application/json",
  "origin": "https://www.mixcloud.com",
  "referer": "https://www.mixcloud.com/",
  "x-mixcloud-client-version": "2d2abe714aa39c05e74111c1de52b08328a5fadb",
  "x-mixcloud-platform": "www",
  "sec-ch-ua": '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site"
};

function httpsGetJson(url, postData, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const dataString = typeof postData === "string" ? postData : JSON.stringify(postData);

    const req = https.request(
      {
        method: "POST",
        protocol: u.protocol,
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: HEADERS
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve({ status: res.statusCode || 0, json });
          } catch (e) {
            reject(new Error(`Invalid JSON response (status=${res.statusCode}): ${String(e?.message || e)}`));
          }
        });
      }
    );

    req.on("error", (e) => reject(e));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
    });
    req.write(dataString);
    req.end();
  });
}

function formatDuration(seconds) {
  const s = Number(seconds) || 0;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

async function searchMixcloud(term) {
  if (!term || typeof term !== "string" || term.trim().length === 0) {
    throw new Error("Vui lòng nhập từ khóa tìm kiếm");
  }

  const searchTerm = term.trim();
  const variables = { count: 10, term: searchTerm };
  const body = { query: SEARCH_QUERY, variables };

  try {
    const { status, json } = await httpsGetJson(MIXCLOUD_GRAPHQL_URL, body);

    if (status !== 200) {
      throw new Error(`HTTP Error: ${status}`);
    }

    if (json?.errors) {
      throw new Error("Lỗi GraphQL: " + json.errors[0]?.message);
    }

    const cloudcasts = json?.data?.viewer?.search?.searchQuery?.cloudcasts;
    if (!cloudcasts?.edges?.length) {
      throw new Error("Không tìm được kết quả từ Mixcloud");
    }

    return cloudcasts.edges.map(edge => {
      const node = edge?.node || {};
      const owner = node.owner || {};
      const picture = node.picture || {};

      return {
        id: node.id,
        name: node.name || "Unknown",
        slug: node.slug || "",
        owner: {
          displayName: owner.displayName || owner.username || "Unknown",
          username: owner.username || ""
        },
        pictureUrl: picture.urlRoot ? `https://thumbnail.mixcloud.com/c/w400-h400/${picture.urlRoot}` : "",
        audioLength: node.audioLength || 0,
        plays: node.plays || 0,
        previewUrl: node.previewUrl || "",
        isPlayable: node.isPlayable || false
      };
    });
  } catch (err) {
    logError(`[Mixcloud Search] ${err.message}`);
    throw err;
  }
}

module.exports = {
  config: {
    name: "mixcloud",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Tìm kiếm và phát nhạc từ Mixcloud",
    commandCategory: "Giải Trí",
    usages: "mixcloud <tên bài hát>",
    cooldowns: 5
  },

  run: async ({ event, args, send, registerReply }) => {
    const searchTerm = args.join(" ").trim();

    if (!searchTerm) {
      await send("Vui lòng nhập tên bài hát cần tìm.\nVí dụ: mixcloud Sao Em Vô Tình");
      return;
    }

    try {
      await send(`🔍 Đang tìm kiếm "${searchTerm}" trên Mixcloud...`);

      const results = await searchMixcloud(searchTerm);

      if (!results || results.length === 0) {
        await send(`❌ Không tìm thấy kết quả nào cho "${searchTerm}"`);
        return;
      }

      let msg = `🎵 Kết quả tìm kiếm "${searchTerm}" trên Mixcloud:\n\n`;

      for (let i = 0; i < Math.min(results.length, 5); i++) {
        const r = results[i];
        const duration = formatDuration(r.audioLength);
        const plays = r.plays.toLocaleString("vi-VN");
        msg += `${i + 1}. ${r.name}\n`;
        msg += `   👤 ${r.owner.displayName}\n`;
        msg += `   ⏱ ${duration} | 👁 ${plays}\n`;
        msg += `   🔗 https://www.mixcloud.com/${r.owner.username}/${r.slug}\n\n`;
      }

      msg += `Dùng reply + số để chọn bài hát muốn phát.`;

      const sent = await send(msg);

      // zca-js: sendMessage() trả về { message: { msgId }, attachment: [...] }
      const sentMessageId =
        sent?.message?.msgId ??
        (Array.isArray(sent?.attachment) && sent.attachment[0]?.msgId);

      if (sentMessageId) {
        registerReply({
          messageId: sentMessageId,
          commandName: "mixcloud",
          payload: { results }
        });
      }

    } catch (err) {
      logError(`mixcloud command error: ${err?.message || err}`);
      await send(`❌ Lỗi tìm kiếm Mixcloud: ${String(err?.message || err)}`);
    }
  },

  onReply: async ({ api, event, data, send }) => {
    const raw = event && event.data ? event.data : {};
    const body =
      typeof raw.content === "string"
        ? raw.content
        : raw.content && typeof raw.content.text === "string"
        ? raw.content.text
        : "";
    const choice = parseInt(body.trim(), 10);

    if (isNaN(choice) || choice < 1 || choice > 5) {
      await send("Vui lòng chọn số từ 1-5");
      return;
    }

    const results = Array.isArray(data?.results) ? data.results : [];
    const idx = choice - 1;

    if (!results[idx]) {
      await send("Không tìm thấy bài hát tương ứng. Hãy thử tìm lại với lệnh mixcloud.");
      return;
    }

    const selected = results[idx];

    await send(
      `✅ Bạn đã chọn:\n` +
        `🎵 ${selected.name}\n` +
        `👤 ${selected.owner.displayName}\n` +
        `🔗 https://www.mixcloud.com/${selected.owner.username}/${selected.slug}`
    );
  }
};

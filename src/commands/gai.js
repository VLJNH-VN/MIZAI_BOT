const fs   = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "../../includes/data/gai.json");

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function saveData(arr) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(arr, null, 2), "utf-8");
}

module.exports = {
  config: {
    name           : "gai",
    aliases        : ["g"],
    version        : "1.0.0",
    hasPermssion   : 0,
    credits        : "Bot",
    description    : "Lấy ảnh/video ngẫu nhiên từ kho gai. Thêm link bằng .gai add <url>. Xoá bằng .gai del <id>.",
    commandCategory: "Giải Trí",
    usages         : ".gai | .gai add <url> | .gai del <id> | .gai list",
    cooldowns      : 3
  },

  run: async ({ api, event, args, send, prefix, commandName, senderId, threadID, isGroup, isBotAdmin }) => {
    const sub = (args[0] || "").toLowerCase();

    // ── .gai add <url> ───────────────────────────────────────────
    if (sub === "add") {
      const url = args[1];
      if (!url || !/^https?:\/\/.+/.test(url)) {
        return send(`❌ Vui lòng cung cấp URL hợp lệ.\nVD: ${prefix}${commandName} add https://example.com/anh.jpg`);
      }

      const data  = loadData();
      const newId = data.length > 0 ? Math.max(...data.map(x => x.id)) + 1 : 1;
      data.push({
        id      : newId,
        url,
        addedBy : senderId,
        threadId: threadID,
        addedAt : new Date().toISOString()
      });
      saveData(data);
      return send(`✅ Đã thêm ảnh/video vào kho! (ID: ${newId})\nTổng: ${data.length} mục.`);
    }

    // ── .gai del <id> ────────────────────────────────────────────
    if (sub === "del" || sub === "delete" || sub === "xoa") {
      const id = parseInt(args[1]);
      if (isNaN(id)) return send(`❌ Cú pháp: ${prefix}${commandName} del <id>`);

      const data  = loadData();
      const index = data.findIndex(x => x.id === id);
      if (index === -1) return send(`❌ Không tìm thấy mục có ID: ${id}`);

      const item = data[index];
      if (!isBotAdmin(senderId) && item.addedBy !== senderId) {
        return send("⛔ Bạn chỉ có thể xoá ảnh do chính mình thêm vào!");
      }

      data.splice(index, 1);
      saveData(data);
      return send(`🗑️ Đã xoá mục ID ${id} khỏi kho. Còn lại: ${data.length} mục.`);
    }

    // ── .gai list ────────────────────────────────────────────────
    if (sub === "list") {
      const data = loadData();
      if (!data.length) return send("📭 Kho hiện chưa có ảnh/video nào.");
      const lines = data.map(x => `• [${x.id}] ${x.url}`).join("\n");
      return send(`📋 Danh sách kho gai (${data.length} mục):\n${lines}`);
    }

    // ── .gai [số thứ tự | id ngẫu nhiên] ────────────────────────
    const data = loadData();
    if (!data.length) {
      return send(`📭 Kho chưa có ảnh/video nào.\nThêm bằng: ${prefix}${commandName} add <url>`);
    }

    let item;
    if (args[0] && !isNaN(parseInt(args[0]))) {
      item = data.find(x => x.id === parseInt(args[0]));
      if (!item) return send(`❌ Không tìm thấy mục ID: ${args[0]}`);
    } else {
      item = data[Math.floor(Math.random() * data.length)];
    }

    try {
      await send({ msg: `🖼️ Ảnh/Video #${item.id}`, attachments: [] });
      await api.sendLink(
        { url: item.url, title: `Gai #${item.id}` },
        threadID,
        event.type
      );
    } catch {
      await send(`🔗 Link #${item.id}:\n${item.url}`);
    }
  }
};

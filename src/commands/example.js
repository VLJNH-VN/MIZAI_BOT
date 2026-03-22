// ╔══════════════════════════════════════════════════════════════════════════╗
//  TEMPLATE TẠO LỆNH — MIZAI_BOT
//  Sao chép file này → đổi tên file + config.name → viết logic trong run()
//  Repo: https://github.com/VLJNH-VN/mizai (private)
// ╚══════════════════════════════════════════════════════════════════════════╝

module.exports = {

  // ══════════════════════════════════════════════════════════════════════════
  //  PHẦN 1 — CONFIG  (bắt buộc)
  // ══════════════════════════════════════════════════════════════════════════
  config: {
    name: "example",          // Tên lệnh → người dùng gõ: >example
    version: "1.0.0",
    hasPermssion: 0,          // 0=tất cả | 1=admin nhóm | 2=admin bot
    credits: "MiZai",
    description: "Lệnh mẫu — hướng dẫn tạo lệnh mới",
    commandCategory: "Tiện Ích",
    usages: ">example [args]",
    cooldowns: 5,
    aliases: []               // Tên gọi tắt: ["ex", "vd"] → >ex cũng chạy được
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  PHẦN 2 — ON LOAD  (tuỳ chọn)
  //  Chạy 1 lần khi bot khởi động hoặc reload lệnh.
  // ══════════════════════════════════════════════════════════════════════════
  onLoad: async ({ api, commands }) => {
    // Dùng để: khởi tạo dữ liệu, đăng ký interval, setup DB riêng...
    logInfo("[example] Lệnh đã được tải thành công.");
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  PHẦN 3 — RUN  (bắt buộc)
  //
  //  Tham số có thể dùng:
  //  ┌──────────────────┬─────────────────────────────────────────────────┐
  //  │ api              │ Zalo API client                                 │
  //  │ event            │ Dữ liệu sự kiện gốc từ zca-js                  │
  //  │ args             │ Mảng từ sau tên lệnh → ">cmd a b" = ["a","b"] │
  //  │ send(msg)        │ Gửi tin nhắn về thread hiện tại (tự quote)     │
  //  │ senderId         │ UID người gửi (string)                         │
  //  │ threadID         │ ID cuộc trò chuyện / nhóm                      │
  //  │ isGroup          │ true nếu trong nhóm, false nếu nhắn riêng      │
  //  │ commandName      │ Tên lệnh đang chạy                             │
  //  │ prefix           │ Tiền tố lệnh (lấy từ config.json)             │
  //  │ commands         │ Map toàn bộ lệnh đang chạy                     │
  //  │ isBotAdmin(id)   │ Kiểm tra có phải admin bot không               │
  //  │ isGroupAdmin     │ async — kiểm tra quyền quản trị nhóm           │
  //  │ registerReply    │ Đăng ký xử lý khi người dùng reply tin này     │
  //  │ registerReaction │ Đăng ký xử lý khi người dùng react tin này     │
  //  │ registerUndo     │ Đăng ký xử lý khi tin này bị thu hồi          │
  //  └──────────────────┴─────────────────────────────────────────────────┘
  // ══════════════════════════════════════════════════════════════════════════
  run: async ({
    api, event, args, send,
    senderId, threadID, isGroup,
    registerReply, registerReaction
  }) => {

    // ── 1. Gửi tin nhắn đơn giản ───────────────────────────────────────────
    await send("Xin chào từ MizaiBot!");

    // ── 2. Dùng args ────────────────────────────────────────────────────────
    //   >example xin chào → args = ["xin", "chào"]
    if (args.length > 0) {
      const input = args.join(" ");
      await send(`Bạn nhập: ${input}`);
    }

    // ── 3. Chặn nếu không phải nhóm ────────────────────────────────────────
    if (!isGroup) return send("Lệnh này chỉ dùng trong nhóm!");

    // ── 4. Lấy tên người gửi ────────────────────────────────────────────────
    const raw        = event?.data || {};
    const senderName = raw?.dName || senderId;
    await send(`Xin chào, ${senderName}!`);

    // ── 5. Gọi HTTP (dùng global.axios có sẵn) ──────────────────────────────
    // const res = await global.axios.get("https://api.example.com/data", { timeout: 10000 });
    // await send(res.data.result);

    // ── 6. Hệ thống kinh tế (Users / economy) ───────────────────────────────
    // const userData = await global.Users.getData(senderId);
    // await send(`Số dư: ${global.economy.formatMoney(userData.money)} | EXP: ${userData.exp}`);

    // Cộng/trừ tiền:
    // await global.Users.addMoney(senderId, 500);
    // const ok = await global.Users.decreaseMoney(senderId, 200); // false nếu không đủ

    // Top người giàu:
    // const top = await global.Users.getTopMoney(10);

    // ── 7. Lưu/đọc settings nhóm (Threads) ──────────────────────────────────
    // const prefix = await global.Threads.getPrefix(threadID);
    // await global.Threads.setSetting(threadID, "myKey", "myValue");
    // const val = await global.Threads.getSetting(threadID, "myKey", "default");

    // ── 8. Upload file lên GitHub (Content API — ảnh/audio) ─────────────────
    // const ghUrl = await global.githubUpload("/path/to/file.jpg", "media/file.jpg");
    // await send(`Link: ${ghUrl}`);

    // ── 9. Upload video lên GitHub Release (không giới hạn kích thước) ───────
    // const ghUrl = await global.githubReleaseUpload("/path/to/video.mp4", "video.mp4");

    // ── 10. Đăng ký chờ Reply ────────────────────────────────────────────────
    const question = await send("Bạn muốn làm gì? Hãy reply tin nhắn này.");
    registerReply({
      messageID: question?.msgId,
      authorID:  senderId,
      callback: async ({ replyEvent, send: replySend }) => {
        const replyText = replyEvent?.data?.content || "";
        await replySend(`Bạn trả lời: ${replyText}`);
      }
    });

    // ── 11. Đăng ký chờ Reaction ─────────────────────────────────────────────
    const reactMsg = await send("React ❤️ vào tin nhắn này để xác nhận.");
    registerReaction({
      messageID: reactMsg?.msgId,
      authorID:  senderId,
      callback: async ({ reactionEvent, send: reactSend }) => {
        await reactSend("Đã xác nhận! ✅");
      }
    });

    // ── 12. Gửi ảnh/file đính kèm ────────────────────────────────────────────
    // await api.sendMessage(
    //   { msg: "Đây là ảnh", attachments: ["/path/to/image.jpg"] },
    //   threadID, event.type
    // );

    // ── 13. Gửi không quote ──────────────────────────────────────────────────
    // await api.sendMessage({ msg: "Tin không quote" }, threadID, event.type);

    // ── 14. Kiểm tra quyền admin ─────────────────────────────────────────────
    // if (!global.isBotAdmin(senderId)) return send("Chỉ admin bot dùng được.");
    // if (!await global.isGroupAdmin({ api, groupId: threadID, userId: senderId }))
    //   return send("Chỉ admin nhóm dùng được.");
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  CHECKLIST KHI TẠO LỆNH MỚI
//  ✅ 1. Sao chép file này → đặt tên file = tên lệnh (vd: chaoban.js)
//  ✅ 2. Đổi config.name = "chaoban" (phải trùng tên file)
//  ✅ 3. Chỉnh hasPermssion, cooldowns, description, usages
//  ✅ 4. Viết logic trong run()
//  ✅ 5. Lưu file → bot tự load (hoặc dùng >load để reload không cần restart)
// ══════════════════════════════════════════════════════════════════════════════

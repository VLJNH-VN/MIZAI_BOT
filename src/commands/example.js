// ╔══════════════════════════════════════════════════════════════════════════╗
//  TEMPLATE TẠO LỆNH — MIZAI_BOT
//  1. Copy file này → đặt tên = tên lệnh (vd: ping.js)
//  2. Đổi config.name = "ping"
//  3. Viết logic trong run()  →  bot tự load, không cần restart
// ╚══════════════════════════════════════════════════════════════════════════╝

module.exports = {

  // ════════════════════════════════════════════════════════════════
  //  CONFIG  (bắt buộc)
  // ════════════════════════════════════════════════════════════════
  config: {
    name:            "example",         // Tên lệnh → >example
    version:         "1.0.0",
    hasPermssion:    0,                 // 0=tất cả | 1=admin nhóm | 2=admin bot
    credits:         "MiZai",
    description:     "Lệnh mẫu — hướng dẫn tạo lệnh mới",
    commandCategory: "Tiện Ích",
    usages:          ">example [nội dung]",
    cooldowns:       5,                 // Giây chờ giữa 2 lần dùng
    aliases:         [],                // Tên gọi tắt: ["ex"] → >ex cũng chạy
  },

  // ════════════════════════════════════════════════════════════════
  //  ON LOAD  (tuỳ chọn — chạy 1 lần khi bot khởi động / reload)
  //  Dùng để: init dữ liệu, đăng ký interval, setup DB...
  // ════════════════════════════════════════════════════════════════
  // onLoad: async ({ api, commands }) => { },

  // ════════════════════════════════════════════════════════════════
  //  RUN  (bắt buộc)
  //
  //  ┌─────────────────┬──────────────────────────────────────────────────────┐
  //  │ api             │ Zalo API client                                       │
  //  │ event           │ Dữ liệu sự kiện gốc từ zca-js                        │
  //  │ args            │ Mảng từ sau tên lệnh  →  ">cmd a b" = ["a","b"]      │
  //  │ send(msg)       │ Gửi về thread hiện tại (tự quote tin người dùng)     │
  //  │ senderId        │ UID người gửi (string)                                │
  //  │ threadID        │ ID cuộc trò chuyện / nhóm                             │
  //  │ isGroup         │ true nếu trong nhóm, false nếu nhắn riêng            │
  //  │ commandName     │ Tên lệnh đang chạy (canonical)                        │
  //  │ prefix          │ Tiền tố lệnh (lấy từ config.json)                    │
  //  │ commands        │ Map toàn bộ lệnh đang load                            │
  //  │ isBotAdmin(id)  │ Kiểm tra có phải admin bot không                      │
  //  │ isGroupAdmin    │ async fn — kiểm tra quyền quản trị nhóm              │
  //  │ registerReply   │ Đăng ký xử lý khi người dùng reply tin này           │
  //  │ registerReaction│ Đăng ký xử lý khi người dùng react tin này           │
  //  │ registerUndo    │ Đăng ký xử lý khi tin này bị thu hồi                │
  //  │ reactLoading()  │ React ⏳ báo hiệu đang xử lý                         │
  //  │ reactSuccess()  │ React ✅ khi xong                                     │
  //  │ reactError()    │ React ❌ khi lỗi                                      │
  //  └─────────────────┴──────────────────────────────────────────────────────┘
  // ════════════════════════════════════════════════════════════════
  run: async ({
    api, event, args, send,
    senderId, threadID, isGroup,
    isBotAdmin, isGroupAdmin,
    registerReply, registerReaction, registerUndo,
    reactLoading, reactSuccess, reactError,
  }) => {

    // ── Chặn nếu không phải nhóm ───────────────────────────────────
    // if (!isGroup) return send("Lệnh này chỉ dùng trong nhóm!");

    // ── Chặn nếu không phải admin bot ──────────────────────────────
    // if (!isBotAdmin(senderId)) return send("Chỉ admin bot dùng được!");

    // ── Chặn nếu không phải admin nhóm ─────────────────────────────
    // if (!await isGroupAdmin({ api, groupId: threadID, userId: senderId }))
    //   return send("Chỉ admin nhóm dùng được!");

    // ── Kiểm tra args ───────────────────────────────────────────────
    // if (!args.length) return send(`Cú pháp: >example [nội dung]`);
    // const input = args.join(" ");

    // ── Lấy tên người gửi ──────────────────────────────────────────
    // const senderName = event?.data?.dName || senderId;

    // ── Gửi tin nhắn đơn giản ──────────────────────────────────────
    await send("Xin chào từ MizaiBot!");

    // ── Gọi HTTP (axios đã có sẵn global) ──────────────────────────
    // await reactLoading();
    // try {
    //   const res = await global.axios.get("https://api.example.com/data", { timeout: 10_000 });
    //   await send(res.data.result);
    //   await reactSuccess();
    // } catch (e) {
    //   await send("Lỗi: " + e.message);
    //   await reactError();
    // }

    // ── Hệ thống kinh tế ────────────────────────────────────────────
    // const userData = await global.Users.getData(senderId);
    // const balance  = global.economy.formatMoney(userData.money);
    // await send(`Số dư: ${balance} | EXP: ${userData.exp}`);
    //
    // await global.Users.addMoney(senderId, 500);                      // Cộng tiền
    // const ok = await global.Users.decreaseMoney(senderId, 200);      // false nếu không đủ
    // const top = await global.Users.getTopMoney(10);                  // Bảng xếp hạng

    // ── Settings nhóm (Threads) ─────────────────────────────────────
    // await global.Threads.setSetting(threadID, "myKey", "myValue");
    // const val = await global.Threads.getSetting(threadID, "myKey", "default");

    // ── Upload file → GitHub Content API (ảnh / audio < 100MB) ─────
    // const url = await global.githubUpload("/tmp/file.jpg", "media/file.jpg");

    // ── Upload video → GitHub Releases (không giới hạn kích thước) ──
    // const url = await global.githubReleaseUpload("/tmp/video.mp4", "video.mp4");

    // ── Gửi file đính kèm (ảnh / audio / file — cần local path) ────
    // await api.sendMessage(
    //   { msg: "Đây là ảnh", attachments: ["/tmp/anh.jpg"] },
    //   threadID, event.type
    // );

    // ── Gửi không quote ─────────────────────────────────────────────
    // await api.sendMessage({ msg: "Tin không quote" }, threadID, event.type);

    // ── Đăng ký chờ Reply ───────────────────────────────────────────
    // const q = await send("Hãy reply tin nhắn này.");
    // registerReply({
    //   messageID: q?.msgId,
    //   authorID:  senderId,
    //   callback: async ({ replyEvent, send: replySend }) => {
    //     const text = replyEvent?.data?.content || "";
    //     await replySend(`Bạn trả lời: ${text}`);
    //   }
    // });

    // ── Đăng ký chờ Reaction ────────────────────────────────────────
    // const m = await send("React ❤️ để xác nhận.");
    // registerReaction({
    //   messageID: m?.msgId,
    //   authorID:  senderId,
    //   callback: async ({ reactionEvent, send: reactSend }) => {
    //     await reactSend("Đã xác nhận! ✅");
    //   }
    // });

    // ── Đăng ký xử lý khi tin bị thu hồi ───────────────────────────
    // const msg = await send("Tin này có thể bị thu hồi.");
    // registerUndo({
    //   messageID: msg?.msgId,
    //   callback: async () => { /* xử lý khi thu hồi */ }
    // });
  }
};

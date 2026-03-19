/**
 * ════════════════════════════════════════════════════════════════
 *  TEMPLATE TẠO LỆNH BOT — ĐẦY ĐỦ & CHUẨN NHẤT
 *  Copy file này → đổi tên → sửa config → viết logic trong run()
 * ════════════════════════════════════════════════════════════════
 *
 *  BƯỚC TẠO LỆNH MỚI:
 *    1. Copy file này → đặt tên <tenlenhcuaban>.js
 *    2. Để vào thư mục: src/commands/
 *    3. Sửa config.name = "<tenlenhcuaban>"
 *    4. Dùng lệnh .load <tenlenhcuaban>  hoặc restart bot
 *
 *  GỌI LỆNH: .example [tham số]
 * ════════════════════════════════════════════════════════════════
 */

// ── REQUIRE — chỉ thêm những gì cần ─────────────────────────────
// const fs   = require("fs");
// const path = require("path");
// const { ThreadType } = require("zca-js");
// const { run, get, all } = require("../../includes/database/sqlite");

// ── GLOBALS SẴN CÓ — KHÔNG CẦN require() ────────────────────────
//
//  LOGGER:
//    logInfo("msg")     → [INFO]  màu xanh
//    logWarn("msg")     → [WARN]  màu vàng
//    logError("msg")    → [ERROR] màu đỏ
//    logEvent("msg")    → [EVENT] màu tím
//    logDebug("msg")    → chỉ hiện khi DEBUG=1
//
//  API & CONFIG:
//    global.config         → nội dung config.json
//      .prefix             → prefix hiện tại (vd: ".")
//      .ownerId            → Zalo ID chủ bot
//      .adminBotIds        → mảng ID admin bot
//      .groqKeys           → mảng API key Groq
//    global.api            → Zalo API instance
//    global.axios          → HTTP client (axios)
//    global.botId          → Zalo ID của bot (string)
//    global.commands       → Map<name, command> tất cả lệnh đang nạp
//    global.prefix         → Prefix hiện tại (vd: ".")
//
//  GỬI TIN NHẮN TOÀN CỤC (không cần send):
//    global.sendMessage(message, threadId, threadType) → Promise
//      message: string hoặc object { msg, attachments, ... }
//      threadType: ThreadType.Group | ThreadType.User
//
//  UPLOAD FILE / ẢNH:
//    global.uploadImage(input, name?)
//      input: URL công khai | đường dẫn file local | Buffer
//      → Promise<string>  rawUrl GitHub công khai (raw.githubusercontent.com)
//    global.upload(filePaths, threadId, threadType)
//      filePaths: string | string[]  (đường dẫn file local)
//      → Promise<Array<{ fileUrl, ... }>>  Kết quả từ uploadAttachment
//      Dùng khi cần lấy fileUrl để gửi video/audio qua api.sendVideo
//
//  GITHUB MEDIA (mã hóa base64 → lưu GitHub → giải mã):
//    global.githubMedia.upload(filePath, options?)
//      options: { folder?, key?, overwrite? }
//      → Promise<{ key, rawUrl, apiUrl }>
//    global.githubMedia.decode(keyOrApiUrl, outputPath?)
//      → Promise<Buffer>  (lưu file nếu có outputPath)
//    global.githubMedia.links()
//      → object  (toàn bộ githubMediaLinks.json)
//    Config cần thiết (config.json):
//      githubToken  — Personal Access Token (scope: repo)
//      uploadRepo   — "owner/repo" vd: "VLJNH-VN/UPLOAD_MIZAI"
//      branch       — Nhánh (mặc định "main")
//
//  MEDIA CACHE (quản lý file đã giải mã từ GitHub):
//    global.mediaCache.processAll(opts?)
//      → Promise<{success,fail,total,saved}>  decode entry mới vào cache
//    global.mediaCache.decodeOne(key, opts?)
//      → Promise<string|null>  decode 1 entry theo key, trả về cachedPath
//    global.mediaCache.loadIndex()
//      → array  toàn bộ dataCache.json
//    global.mediaCache.pickRandom(opts?)
//      opts: { videoOnly?, ext? }
//      → object|null  chọn ngẫu nhiên 1 entry có file trên disk
//
//  MESSAGE CACHE (cache in-memory tin nhắn gần đây):
//    global.messageCache.store(event)                    — lưu tự động
//    global.messageCache.getById(msgId, threadId?)       — tra theo msgId
//    global.messageCache.getByCliId(cliMsgId, threadId?) — tra theo cliMsgId
//    global.messageCache.getThread(threadId, limit?)     — lấy N tin gần nhất
//
//  RESOLVE QUOTE (lấy nội dung tin được reply đầy đủ):
//    global.resolveQuote({ raw, api, threadId, event })
//      → Promise<object|null>
//      Trả về: { msgId, cliMsgId, uidFrom, content, attach,
//                mediaUrl, ext, isMedia, isText, _source }
//      _source: "quote" | "cache" | "history"
//
//  DATABASE:
//    global.getDb()                         → Promise<db> — SQLite
//    Schema mặc định:
//      users         (user_id, name, profile_json, updated_at)
//      groups        (group_id, name, info_json, updated_at, ...)
//      users_money   (user_id, name, money, exp, daily_last, updated_at)
//
//  ECONOMY — HỆ THỐNG TIỀN:
//    global.economy.getUserMoney(userId, name?)              → Promise<number>
//    global.economy.getUserData(userId)                      → Promise<object>
//      object: { user_id, name, money, exp, daily_last, updated_at }
//    global.economy.updateUserMoney(userId, amount, type, name?)
//      type: "add" | "sub" | "set"              → Promise<number|false>
//      Trả về false nếu số dư âm sau khi trừ
//    global.economy.hasEnoughMoney(userId, amount)           → Promise<boolean>
//    global.economy.transferMoney(fromId, toId, amount, fromName?, toName?)
//      → Promise<{ success, fromNew, toNew } | { success: false, reason }>
//    global.economy.claimDaily(userId, name?)
//      → Promise<{ success: true, reward, newMoney, newExp }
//               | { success: false, remaining }>
//    global.economy.addExp(userId, amount)                   → Promise<void>
//    global.economy.getTopUsers(limit?)                      → Promise<array>
//    global.economy.formatMoney(amount)                      → string "1.000 VNĐ"
//    global.economy.formatTime(ms)                           → string "1h 30m 20s"
//    global.economy.getLevel(exp)                            → number
//
//  THÔNG TIN NGƯỜI DÙNG / NHÓM (có cache TTL tự động):
//    global.resolveSenderName({ api, userId, fallbackName? }) → Promise<string>
//    global.resolveGroupName({ api, groupId, fallbackName? }) → Promise<string>
//
//  KIỂM TRA QUYỀN:
//    global.isBotAdmin(userId)                               → boolean
//    global.isGroupAdmin({ api, groupId, userId })           → Promise<boolean>
//    global.getBotAdminIds()                                  → Set<string>
//
//  TIỆN ÍCH KHÁC:
//    global.restartBot(reason?, delayMs?)   → khởi động lại bot
//    global.checkGroqKey(key)               → Promise<{ key, status: "live"|"dead" }>
//    global.setAutoCheck(boolean)           → bật/tắt tự động check key
//    global.startAutoGetData()              → khởi động vòng lặp auto giải mã GitHub
//    global.stopAutoGetData()               → dừng vòng lặp
//
// ─────────────────────────────────────────────────────────────────

module.exports = {

  // ══════════════════════════════════════════════════════════════
  //  CẤU HÌNH LỆNH (BẮT BUỘC)
  // ══════════════════════════════════════════════════════════════
  config: {
    name        : "example",         // Tên lệnh — trùng tên file (không .js), viết thường
    aliases     : ["ex"],              // (tuỳ chọn) Alias thay thế
    version     : "2.0",
    hasPermssion: 0,                  // 0 = mọi người | 1 = admin nhóm | 2 = admin bot
    credits     : "LJZI x XBACH",
    description : "Mô tả lệnh này làm gì",
    commandCategory: "Utility",
    // Danh mục: System | Utility | Fun | Economy | Admin | Quản Trị | Giải Trí | Tra Cứu | Kinh Tế
    usages      : ".example [nội dung]",
    cooldowns   : 5                   // Giây chờ giữa 2 lần dùng (0 = không giới hạn)
  },

  // ══════════════════════════════════════════════════════════════
  //  HÀM CHÍNH — chạy khi người dùng gọi lệnh
  // ══════════════════════════════════════════════════════════════
  run: async ({
    api,            // Zalo API instance
    event,          // Toàn bộ event object
    args,           // Mảng tham số sau prefix+lệnh: ["a", "b", "c"]
    send,           // Gửi tin nhắn vào thread (tự quote vào lệnh gốc nếu truyền string)
    prefix,         // Prefix hiện tại, vd: "."
    commandName,    // Tên lệnh được gọi (kể cả alias, đã chuẩn hoá về canonical name)
    senderId,       // Zalo ID người gửi (string)
    threadID,       // Zalo ID thread / nhóm (string)
    isGroup,        // true nếu là nhóm
    commands,       // Map chứa tất cả lệnh đang nạp
    isBotAdmin,     // fn(userId) → boolean
    isGroupAdmin,   // fn({ api, groupId, userId }) → Promise<boolean>
    registerReply,     // Đăng ký chờ reply
    registerReaction,  // Đăng ký chờ thả cảm xúc
    registerUndo       // Đăng ký chờ thu hồi tin nhắn
  }) => {

    // ── ĐỌC THAM SỐ ─────────────────────────────────────────────
    const input = args.join(" ").trim();
    if (!input) {
      return send(`📌 Cách dùng: ${prefix}${commandName} <nội dung>`);
    }

    // ── LẤY TÊN NGƯỜI DÙNG / NHÓM ───────────────────────────────
    const tenNguoiGui = await global.resolveSenderName({ api, userId: senderId });
    const tenNhom     = isGroup
      ? await global.resolveGroupName({ api, groupId: threadID })
      : "Nhắn riêng";

    // ── KIỂM TRA QUYỀN THỦ CÔNG (nếu cần) ───────────────────────
    // if (!isBotAdmin(senderId)) return send("⛔ Chỉ admin bot mới dùng được!");
    // if (!(await isGroupAdmin({ api, groupId: threadID, userId: senderId }))) {
    //   return send("⛔ Chỉ admin nhóm mới dùng được!");
    // }

    // ── ĐỌC MENTIONS (nếu có tag @ai đó) ────────────────────────
    // const mentions    = event?.data?.mentions || {};   // { userId: "tên hiển thị", ... }
    // const mentionedIds = Object.keys(mentions);
    // if (!mentionedIds.length) return send("Hãy tag @ai đó!");
    // const targetId = mentionedIds[0];

    // ════════════════════════════════════════════════════════════
    //  ✅ PHẦN LOGIC CHÍNH — VIẾT CODE CỦA BẠN VÀO ĐÂY
    // ════════════════════════════════════════════════════════════

    await send(
      `📌 Thông tin:\n` +
      `• Tên: ${tenNguoiGui}\n` +
      `• ID: ${senderId}\n` +
      `• Nhóm: ${tenNhom}\n` +
      `• Input: ${input}`
    );

    // ════════════════════════════════════════════════════════════
    //  CÁC VÍ DỤ THAM KHẢO (comment lại toàn bộ, bỏ comment khi cần)
    // ════════════════════════════════════════════════════════════

    // ── 1. GỬI TIN NHẮN ─────────────────────────────────────────

    // Gửi KHÔNG quote (truyền object)
    // await send({ msg: "Tin nhắn không quote" });

    // Gửi file / ảnh local
    // const fs = require("fs");
    // await send({ msg: "Đây là file", attachments: [fs.createReadStream("/tmp/output.png")] });

    // Gửi tới thread khác
    // const { ThreadType } = require("zca-js");
    // await global.sendMessage("Thông báo!", targetThreadId, ThreadType.Group);

    // ── 2. UPLOAD ẢNH / FILE ────────────────────────────────────

    // Upload ảnh lên GitHub (trả về rawUrl công khai)
    // const link = await global.uploadImage("https://example.com/image.jpg");
    // const link = await global.uploadImage("/tmp/output.png");
    // const link = await global.uploadImage(buffer, "output.png");

    // Upload file local lên Zalo (dùng cho video/audio)
    // const [res] = await global.upload("/tmp/video.mp4", threadID, event.type);
    // await api.sendVideo({ videoUrl: res.fileUrl, ... }, threadID, event.type);

    // ── 3. GITHUB MEDIA (base64 encode → upload → decode) ───────

    // Upload file media (mã hóa base64) lên GitHub
    // const { key, rawUrl, apiUrl } = await global.githubMedia.upload("/tmp/video.mp4", {
    //   folder: "media/videos",
    //   key: "my_video_key",      // (tuỳ chọn) key tự đặt
    //   overwrite: false          // (tuỳ chọn) ghi đè nếu đã tồn tại
    // });
    // await send(`Đã upload: ${rawUrl}`);

    // Giải mã file từ GitHub về Buffer (hoặc lưu vào file)
    // const buffer = await global.githubMedia.decode(key);
    // const buffer = await global.githubMedia.decode(apiUrl, "/tmp/output.mp4");

    // Xem toàn bộ danh sách media đã upload
    // const links = global.githubMedia.links();

    // ── 4. MEDIA CACHE (quản lý file đã decode từ GitHub) ────────

    // Decode tất cả entry mới vào cache disk
    // const result = await global.mediaCache.processAll();
    // logInfo(`Cache: ${result.success} thành công, ${result.fail} lỗi`);

    // Decode 1 entry cụ thể
    // const cachedPath = await global.mediaCache.decodeOne("my_video_key");
    // if (cachedPath) { /* dùng cachedPath để gửi video */ }

    // Lấy toàn bộ index cache
    // const index = global.mediaCache.loadIndex();

    // Chọn ngẫu nhiên 1 video trong cache
    // const entry = global.mediaCache.pickRandom({ videoOnly: true });
    // const entry = global.mediaCache.pickRandom({ ext: ".mp4" });
    // if (entry) { /* entry.cachedPath, entry.key, ... */ }

    // ── 5. MESSAGE CACHE (tra cứu tin nhắn gần đây) ──────────────

    // Lấy tin nhắn theo msgId
    // const cached = global.messageCache.getById("msgId123", threadID);

    // Lấy tin nhắn theo cliMsgId
    // const cached = global.messageCache.getByCliId("cliMsgId456", threadID);

    // Lấy 20 tin nhắn gần nhất của nhóm
    // const recentMsgs = global.messageCache.getThread(threadID, 20);

    // ── 6. RESOLVE QUOTE (lấy nội dung tin được reply) ───────────

    // Lấy nội dung đầy đủ của tin nhắn được reply (hỗ trợ: quote → cache → history)
    // const raw = event?.data || {};
    // const quoted = await global.resolveQuote({ raw, api, threadId: threadID, event });
    // if (!quoted) return send("❌ Không tìm thấy tin nhắn được reply!");
    // if (quoted.isText) await send(`Nội dung: ${quoted.content}`);
    // if (quoted.isMedia) await send(`Link media: ${quoted.mediaUrl}`);

    // ── 7. ECONOMY — HỆ THỐNG TIỀN ──────────────────────────────
    // const eco = global.economy;

    // Lấy số dư
    // const soDu = await eco.getUserMoney(senderId, tenNguoiGui);
    // await send(`💰 Số dư: ${eco.formatMoney(soDu)}`);

    // Lấy toàn bộ thông tin (money, exp, daily_last, ...)
    // const data  = await eco.getUserData(senderId);
    // const level = eco.getLevel(data.exp);

    // Cộng / trừ / đặt tiền
    // await eco.updateUserMoney(senderId, 1000,  "add");
    // await eco.updateUserMoney(senderId, 500,   "sub"); // false nếu không đủ tiền
    // await eco.updateUserMoney(senderId, 50000, "set");

    // Kiểm tra đủ tiền trước khi trừ
    // if (!(await eco.hasEnoughMoney(senderId, 10000))) return send("❌ Không đủ tiền!");

    // Chuyển tiền (atomic transaction)
    // const ketQua = await eco.transferMoney(senderId, targetId, 5000, tenNguoiGui, tenTarget);
    // if (!ketQua.success) return send(`❌ ${ketQua.reason}`);
    // await send(`✅ Chuyển thành công! Còn lại: ${eco.formatMoney(ketQua.fromNew)}`);

    // Điểm danh hàng ngày (cooldown 24h)
    // const daily = await eco.claimDaily(senderId, tenNguoiGui);
    // if (!daily.success) return send(`⏳ Chờ thêm ${eco.formatTime(daily.remaining)}`);
    // await send(`✅ Nhận ${eco.formatMoney(daily.reward)}! Tổng: ${eco.formatMoney(daily.newMoney)}`);

    // Cộng EXP
    // await eco.addExp(senderId, 10);

    // Top người giàu nhất
    // const top = await eco.getTopUsers(10);
    // top.forEach((u, i) => { /* ... */ });

    // ── 8. HTTP REQUEST ──────────────────────────────────────────
    // try {
    //   const res = await global.axios.get("https://api.example.com/data", {
    //     params: { q: input },
    //     timeout: 10000
    //   });
    //   await send(`Kết quả: ${JSON.stringify(res.data)}`);
    // } catch (err) {
    //   logError(`[example] HTTP lỗi: ${err.message}`);
    //   await send("❌ Không lấy được dữ liệu!");
    // }

    // POST request
    // const res = await global.axios.post("https://api.example.com/submit", {
    //   key: "value"
    // }, { headers: { Authorization: "Bearer TOKEN" }, timeout: 8000 });

    // ── 9. SQLITE — TRUY VẤN DATABASE ───────────────────────────
    // const { run: dbRun, get: dbGet, all: dbAll } = require("../../includes/database/sqlite");
    // const db = await global.getDb();
    //
    // Tạo bảng
    // await dbRun(db, `
    //   CREATE TABLE IF NOT EXISTS my_table (
    //     id      INTEGER PRIMARY KEY AUTOINCREMENT,
    //     user_id TEXT NOT NULL,
    //     value   TEXT,
    //     created INTEGER DEFAULT (strftime('%s','now'))
    //   )
    // `);
    //
    // await dbRun(db, "INSERT INTO my_table (user_id, value) VALUES (?, ?)", [senderId, input]);
    // const row  = await dbGet(db, "SELECT * FROM my_table WHERE user_id = ?", [senderId]);
    // const rows = await dbAll(db, "SELECT * FROM my_table ORDER BY id DESC LIMIT 10");
    // await dbRun(db, "UPDATE my_table SET value = ? WHERE user_id = ?", [input, senderId]);
    // await dbRun(db, "DELETE FROM my_table WHERE user_id = ?", [senderId]);

    // ── 10. ĐĂNG KÝ CHỜ REPLY ───────────────────────────────────
    //  Bot gửi tin → người dùng reply vào → gọi onReply
    //
    // const msg       = await send(`❓ Bạn vừa nhập: "${input}"\n💬 Reply tin này để xác nhận.`);
    // const messageId = msg?.message?.msgId || msg?.msgId || msg?.data?.msgId;
    // if (messageId) {
    //   registerReply({
    //     messageId,
    //     commandName: "example",   // Phải trùng config.name (không dùng alias)
    //     ttl: 5 * 60 * 1000,       // 5 phút (ms). 0 = không hết hạn
    //     payload: { input, senderId, tenNguoiGui }
    //   });
    // }

    // ── 11. ĐĂNG KÝ CHỜ CẢM XÚC (REACTION) ─────────────────────
    //  Bot gửi tin → người dùng thả cảm xúc → gọi onReaction
    //
    // const msg2   = await send("Thả ❤️ để xác nhận!");
    // const msgId2 = msg2?.message?.msgId || msg2?.msgId || msg2?.data?.msgId;
    // if (msgId2) {
    //   registerReaction({
    //     messageId: msgId2,
    //     commandName: "example",
    //     ttl: 5 * 60 * 1000,
    //     payload: { action: "confirm", senderId }
    //   });
    // }

    // ── 12. ĐĂNG KÝ CHỜ THU HỒI TIN NHẮN (UNDO) ────────────────
    //  Người dùng thu hồi tin → gọi onUndo
    //
    // const msg3   = await send("Tin nhắn này sẽ được theo dõi nếu bị thu hồi.");
    // const msgId3 = msg3?.message?.msgId || msg3?.msgId || msg3?.data?.msgId;
    // if (msgId3) {
    //   registerUndo({
    //     messageId: msgId3,
    //     commandName: "example",
    //     ttl: 10 * 60 * 1000,
    //     payload: { senderId }
    //   });
    // }
  },

  // ══════════════════════════════════════════════════════════════
  //  XỬ LÝ SAU KHI REPLY
  //  Chạy khi người dùng reply vào tin bot đã gửi (đã registerReply).
  //
  //  Tham số:
  //    api, event, send         — như thường lệ
  //    data                     — payload truyền vào registerReply
  //    commands, prefix         — Map lệnh & prefix
  //    commandName              — tên lệnh (canonical)
  //    registerReply            — đăng ký tiếp nếu muốn multi-step dialog
  // ══════════════════════════════════════════════════════════════
  onReply: async ({ api, event, send, data, commandName, registerReply }) => {
    const raw  = event?.data || {};
    const body = typeof raw.content === "string"
      ? raw.content
      : (raw?.content?.text ?? "");

    const { input, senderId, tenNguoiGui } = data;
    await send(`✅ ${tenNguoiGui} đã xác nhận: "${body}"\n📌 Input gốc: "${input}"`);

    // Đăng ký tiếp để tiếp tục lắng nghe reply (multi-step dialog)
    // const msg   = await send("Tiếp tục...");
    // const msgId = msg?.message?.msgId || msg?.msgId || msg?.data?.msgId;
    // if (msgId) registerReply({ messageId: msgId, commandName, ttl: 5 * 60 * 1000, payload: { ... } });
  },

  // ══════════════════════════════════════════════════════════════
  //  XỬ LÝ SAU KHI REACTION
  //  Chạy khi người dùng thả cảm xúc vào tin bot đã gửi (đã registerReaction).
  //
  //  Tham số:
  //    api, send                — như thường lệ
  //    reaction                 — toàn bộ reaction event object
  //    data                     — payload truyền vào registerReaction
  //    icon                     — emoji cảm xúc (string)
  //    uid                      — ID người thả cảm xúc (string)
  //    threadID                 — ID thread (string)
  //    isGroup                  — boolean
  //    type                     — ThreadType (Group | User)
  //    commands, commandName    — Map lệnh & tên lệnh
  //    registerReaction         — đăng ký tiếp nếu cần
  // ══════════════════════════════════════════════════════════════
  onReaction: async ({ api, reaction, send, data, icon, uid, threadID, isGroup }) => {
    await send(`Bạn đã thả: ${icon} — action: ${data.action}`);
  },

  // ══════════════════════════════════════════════════════════════
  //  XỬ LÝ SAU KHI UNDO
  //  Chạy khi người dùng thu hồi tin nhắn (đã registerUndo).
  //
  //  Tham số:
  //    api, send                — như thường lệ
  //    undo                     — toàn bộ undo event object
  //    data                     — payload truyền vào registerUndo
  //    threadID                 — ID thread (string)
  //    commands, commandName    — Map lệnh & tên lệnh
  //    registerUndo             — đăng ký tiếp nếu cần
  // ══════════════════════════════════════════════════════════════
  onUndo: async ({ api, undo, send, data, threadID }) => {
    await send(`⚠️ Tin nhắn của ${data.senderId} vừa bị thu hồi.`);
  },

  // ══════════════════════════════════════════════════════════════
  //  LẮNG NGHE TẤT CẢ TIN NHẮN — không cần gọi lệnh
  //  Bỏ comment khối bên dưới để bật.
  //
  //  Tham số:
  //    api, event, send         — như thường lệ
  //    args                     — luôn là [] (không parse prefix)
  //    commands                 — Map lệnh
  //    prefix                   — prefix hiện tại
  //    commandName              — tên lệnh của command này
  //
  //  LƯU Ý: onMessage chạy cho MỌI tin nhắn trong mọi nhóm đã kích hoạt.
  //  Viết điều kiện lọc chặt để tránh bot phản hồi liên tục.
  // ══════════════════════════════════════════════════════════════
  // onMessage: async ({ api, event, send, commands, prefix }) => {
  //   const raw  = event?.data || {};
  //   const body = typeof raw.content === "string"
  //     ? raw.content
  //     : (raw?.content?.text ?? "");
  //
  //   if (body.toLowerCase() === "hello") {
  //     await send("Chào bạn! 👋");
  //   }
  // },

};

/*
 * ════════════════════════════════════════════════════════════════
 *  GHI NHỚ NHANH
 * ════════════════════════════════════════════════════════════════
 *
 *  send(string)          → gửi + tự quote vào lệnh gốc
 *  send({ msg })         → gửi KHÔNG quote
 *  send({ msg, attachments: [stream] })  → gửi kèm file/ảnh
 *
 *  hasPermssion:
 *    0 → mọi người
 *    1 → admin nhóm
 *    2 → admin bot
 *
 *  registerReply / registerReaction / registerUndo:
 *    messageId   — ID tin nhắn bot vừa gửi (lấy từ kết quả send)
 *    commandName — config.name (không dùng alias)
 *    ttl         — thời gian sống (ms), 0 = không hết hạn
 *    payload     — object dữ liệu truyền sang onReply / onReaction / onUndo
 *
 *  Lấy msgId từ kết quả send:
 *    const msg   = await send("...");
 *    const msgId = msg?.message?.msgId || msg?.msgId || msg?.data?.msgId;
 *
 *  global.uploadImage    → rawUrl GitHub (raw.githubusercontent.com)
 *  global.githubMedia    → upload/decode base64 media qua GitHub
 *  global.mediaCache     → quản lý file đã decode từ GitHub trên disk
 *  global.messageCache   → cache in-memory tin nhắn gần đây theo thread
 *  global.resolveQuote   → lấy nội dung đầy đủ của tin nhắn được reply
 * ════════════════════════════════════════════════════════════════
 */

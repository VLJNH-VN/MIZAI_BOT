# MIZAI_BOT

## Tổng quan dự án

MIZAI_BOT là một chatbot Zalo đa chức năng, xây dựng bằng Node.js. Bot sử dụng thư viện `zca-js` để giao tiếp với nền tảng Zalo thông qua xác thực bằng cookie và IMEI. AI chính là Groq (model `llama-3.3-70b-versatile`), AI phụ là Gemini (dùng cho vision, tìm kiếm web, đọc link).

## Thông tin cơ bản

- **Tên:** MIZAI_BOT
- **Phiên bản:** 1.5.0
- **Entry point:** `index.js`
- **Lệnh chạy:** `node index.js` hoặc `npm start`
- **Lệnh dev (auto-reload):** `npm run dev` (nodemon)

## Cài đặt nhanh

```bash
# 1. Clone và cài dependencies
npm install

# 2. Tạo config từ mẫu
cp config.example.json config.json

# 3. Chỉnh sửa config.json (thêm cookie, imei, ownerId, ...)
# 4. Chạy bot
npm start
```

## Cấu trúc thư mục

```
MIZAI_BOT/
├── index.js                    # Entry point, khởi tạo client Zalo, đăng ký event
├── config.json                 # Cấu hình bot (KHÔNG commit lên git)
├── config.example.json         # Mẫu config để tham khảo
├── cookie.json                 # Cookie đăng nhập Zalo (KHÔNG commit lên git)
├── package.json
│
├── src/
│   ├── commands/               # Lệnh của bot, phân theo danh mục
│   │   ├── admin/              # Quản trị nhóm: admin, anti, kick, mute, set, shell...
│   │   ├── economy/            # Kinh tế: tx, money, transfer, rank, daily...
│   │   ├── media/              # Media: 4k, timnhac, getlink, mixcloud, spt, scl...
│   │   ├── info/               # Thông tin: ping, uptime, wiki, thoitiet, profile...
│   │   ├── fun/                # Giải trí: poll, note, remind, carwl, forward...
│   │   ├── ai/                 # AI: api, adc, checktt
│   │   └── utility/            # Tiện ích: menu, key, gettoken, file, mail, undo...
│   └── events/                 # Xử lý sự kiện nền
│       ├── message.js          # Điều phối tin nhắn → handleCommand
│       ├── autoDown.js         # Tự động tải media
│       ├── autoSend.js         # Tự động gửi tin định kỳ
│       ├── groupEvents.js      # Sự kiện nhóm
│       ├── tuongTac.js         # Tương tác tự động
│       ├── txLoop.js           # Vòng lặp game Tài Xỉu
│       └── goibot/             # AI Mizai (tách thành subfolder)
│           ├── index.js        # Main handler (~230 dòng)
│           ├── goibotThrottle.js  # Anti-spam & cooldown state
│           ├── goibotContext.js   # TX context, self-profile cache, safeCalc
│           └── goibotRouter.js   # Action dispatch, image gen, file ops
│
├── includes/
│   ├── handlers/               # Xử lý lệnh, reply, reaction, undo
│   ├── database/               # SQLite wrapper + các module DB (phân theo nhóm)
│   │   ├── core/               # Lõi: sqlite.js, dataManager.js, requestQueue.js
│   │   ├── user/               # Người dùng: userController.js, economy.js, cooldown.js
│   │   ├── group/              # Nhóm chat: groupLoader.js, groupSettings.js
│   │   ├── message/            # Tin nhắn: messageCache.js, messageLog.js, infoCache.js
│   │   ├── game/               # Game: taixiu.js
│   │   ├── moderation/         # Kiểm duyệt: antiManager.js, muteManager.js, rent.js, aiMemory.js, tuongtac.js
│   │   └── data/               # mizai.sqlite (file DB thực tế)
│   ├── data/                   # Dữ liệu JSON phân theo mục đích
│   │   ├── config/             # Cấu hình tĩnh: anti.json, auto.json, autoSend.json, auto_xo_so.json
│   │   ├── runtime/            # Dữ liệu hoạt động: users, groups, key, rentKey, lastSeen, muted...
│   │   └── game/               # Dữ liệu game: taixiu/ (money, phien, betHistory, ...)
│   ├── listapi/                # Danh sách API
│   └── cache/                  # Cache bộ nhớ
│
├── utils/
│   ├── ai/goibot.js            # Logic AI (Groq, Gemini)
│   ├── bot/                    # botManager, messageUtils, cawr
│   ├── system/                 # client, global, loader, logger, maintenance, keepAlive, githubBackup
│   └── media/                  # Tiện ích xử lý media & config
│       ├── canvas.js           # Vẽ card ảnh (join/leave, menu, uptime...)
│       ├── zaloMedia.js        # Gửi video/voice Zalo chuẩn (GwenDev pattern)
│       └── helpers.js          # Hàm tiện ích dùng chung (readConfig, fmtMoney...)
│
└── scripts/                    # Script tiện ích (chạy bằng npm run ...)
    ├── new-cmd.js              # Tạo lệnh mới
    ├── list-cmds.js            # Liệt kê tất cả lệnh
    ├── move-cmd.js             # Di chuyển lệnh sang danh mục khác
    └── backup-cmds.js          # Backup lệnh ra .zip
```

## Tech Stack

| Thành phần | Công nghệ |
|---|---|
| Runtime | Node.js |
| Zalo SDK | `zca-js` v2.1.1 |
| AI chính | Groq — llama-3.3-70b-versatile |
| AI phụ | Google Gemini (`@google/genai`) |
| Database | SQLite (`better-sqlite3`, fallback `sql.js`) |
| Ảnh/Media | `canvas`, `sharp` |
| HTTP | `axios`, `node-fetch` |
| Scraping | `cheerio` |
| Cache | `node-cache` |
| TikTok DL | `@tobyg74/tiktok-api-dl` |
| Dev tool | `nodemon` |

## Script tiện ích

```bash
npm run new-cmd <tên> <danh-mục>   # Tạo lệnh mới
npm run list-cmds                   # Liệt kê tất cả lệnh
npm run move-cmd <tên> <danh-mục>  # Di chuyển lệnh
npm run backup-cmds                 # Backup lệnh ra .zip
npm run backup                      # Backup dữ liệu lên GitHub
```

## Cấu hình (config.json)

| Trường | Mô tả |
|---|---|
| `prefix` | Ký tự kích hoạt lệnh (mặc định `.`) |
| `loginMethod` | Phương thức đăng nhập: `cookie` |
| `cookiePath` | Đường dẫn file cookie |
| `imei` | IMEI thiết bị Zalo |
| `ownerId` | UID chủ bot |
| `adminBotIds` | Danh sách UID admin bot |
| `hfToken` | HuggingFace API token |
| `githubToken` | GitHub token để backup |
| `repo` | Repo GitHub để backup |

## Danh mục lệnh

| Danh mục | Số lệnh | Mô tả |
|---|---|---|
| admin | 11 | Quản trị nhóm, bảo mật |
| economy | 10 | Kinh tế ảo, game |
| media | 7 | Tải và xử lý media |
| info | 8 | Thông tin, tra cứu |
| fun | 5 | Giải trí, tương tác |
| ai | 3 | Trí tuệ nhân tạo |
| utility | 8 | Tiện ích hệ thống |

## utils/media/zaloMedia.js — Gửi media Zalo chuẩn (GwenDev pattern)

Module tái sử dụng cho mọi dự án `zca-js`. Copy file vào `utils/` và import là dùng được ngay.

### Vấn đề nền tảng

`api.sendVideo(thumbnailUrl)` yêu cầu URL có thể fetch được bởi Zalo server. URL bên ngoài (TikTok CDN, YouTube thumbnail...) thường bị block hoặc hết hạn. Giải pháp: upload thumbnail lên Zalo CDN trước → URL vĩnh cửu.

### Trick .bin (học từ GwenDev)

`zca-js` xử lý `uploadAttachment` theo extension file:

| Extension | Response | Dùng cho |
|---|---|---|
| `.jpg/.png` | `{ hdUrl, normalUrl }` | Chỉ gửi ảnh |
| `.bin` | `{ fileUrl, fileName }` | thumbnailUrl = `fileUrl/fileName` |
| `.aac` | `{ fileUrl, fileName }` | voiceUrl = `fileUrl/fileName` |

**Trick**: Tạo thumbnail bằng ffmpeg (output `.jpg`) → `rename` thành `.bin` → upload → nhận `fileUrl/fileName` → dùng làm `thumbnailUrl` trong `sendVideo`.

### API

```js
const { zaloSendVideo, zaloSendVoice, uploadThumbnail, uploadAttachmentToZalo } =
  require("../../utils/zaloMedia");

// Gửi video (tự tạo thumbnail, tự upload CDN, tự fallback)
await zaloSendVideo(api, {
  videoUrl:  "https://...",      // URL vĩnh cửu (GitHub Releases, CDN)
  videoPath: "/tmp/video.mp4",   // File local để tạo thumbnail (optional)
  msg:       "Caption",
  width:     720, height: 1280,
  duration:  30,                 // giây
}, threadId, threadType);

// Gửi voice từ file local hoặc URL
await zaloSendVoice(api, "/tmp/audio.aac", threadId, threadType);
await zaloSendVoice(api, "https://.../audio.mp3", threadId, threadType);

// Chỉ upload thumbnail → lấy URL (dùng khi tự gọi sendVideo)
const thumbUrl = await uploadThumbnail(api, "/tmp/video.mp4", threadId, threadType);

// Upload bất kỳ file → lấy URL
const url = await uploadAttachmentToZalo(api, "/tmp/file.bin", threadId, threadType);
```

### Flow tổng quát

```
VIDEO:
  Download URL → Convert H264 → uploadThumbnail(.jpg→.bin) → GitHub Upload
  → api.sendVideo(ghUrl, thumbZaloUrl) || fallback sendMessage attachment

AUDIO:
  Download URL → Convert AAC → uploadAttachment(.aac) → voiceUrl
  → api.sendVoice(voiceUrl) || fallback GitHub → fallback attachment
```

## Lưu ý bảo mật

- `config.json` và `cookie.json` được thêm vào `.gitignore` — **KHÔNG commit lên GitHub**
- Luôn dùng `config.example.json` làm mẫu khi chia sẻ project
- Chạy `npm run backup` để backup dữ liệu lên GitHub private repo

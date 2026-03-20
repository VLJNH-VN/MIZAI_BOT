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
│   │   ├── economy/            # Kinh tế: tx, money, transfer, rank, rent, daily...
│   │   ├── media/              # Media: 4k, timnhac, getlink, mixcloud, spt, scl...
│   │   ├── info/               # Thông tin: ping, uptime, wiki, thoitiet, profile...
│   │   ├── fun/                # Giải trí: poll, note, remind, carwl, forward...
│   │   ├── ai/                 # AI: api, adc, checktt
│   │   └── utility/            # Tiện ích: menu, key, gettoken, file, mail, undo...
│   └── events/                 # Xử lý sự kiện nền
│       ├── message.js          # Điều phối tin nhắn → handleCommand
│       ├── autoDown.js         # Tự động tải media
│       ├── autoSend.js         # Tự động gửi tin định kỳ
│       ├── goibot.js           # AI Mizai background
│       ├── groupEvents.js      # Sự kiện nhóm
│       ├── tuongTac.js         # Tương tác tự động
│       └── txLoop.js           # Vòng lặp game Tài Xỉu
│
├── includes/
│   ├── handlers/               # Xử lý lệnh, reply, reaction, undo
│   ├── database/               # SQLite, economy, groupSettings, cache DB
│   ├── data/                   # Dữ liệu JSON (anti, auto, taixiu, users...)
│   ├── listapi/                # Danh sách API
│   └── cache/                  # Cache bộ nhớ
│
├── utils/
│   ├── ai/goibot.js            # Logic AI (Groq, Gemini)
│   ├── bot/                    # botManager, messageUtils
│   └── system/                 # client, global, loader, logger, maintenance, keepAlive, githubBackup
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

## Lưu ý bảo mật

- `config.json` và `cookie.json` được thêm vào `.gitignore` — **KHÔNG commit lên GitHub**
- Luôn dùng `config.example.json` làm mẫu khi chia sẻ project
- Chạy `npm run backup` để backup dữ liệu lên GitHub private repo

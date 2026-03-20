# MIZAI_BOT

## Tổng quan dự án

MIZAI_BOT là một chatbot Zalo đa chức năng, xây dựng bằng Node.js. Bot sử dụng thư viện `zca-js` để giao tiếp với nền tảng Zalo thông qua xác thực bằng cookie và IMEI. AI chính là Groq (model `llama-3.3-70b-versatile`), AI phụ là Gemini (dùng cho vision, tìm kiếm web, đọc link).

## Thông tin cơ bản

- **Tên:** MIZAI_BOT
- **Phiên bản:** 1.5.0
- **Entry point:** `index.js`
- **Lệnh chạy:** `node index.js` hoặc `npm start`
- **Lệnh dev (auto-reload):** `npm run dev` (nodemon)

## Cấu trúc thư mục

```
MIZAI_BOT/
├── index.js                  # Entry point, khởi tạo client Zalo, đăng ký event
├── config.json               # Cấu hình bot (prefix, admin, API keys, ...)
├── cookie.json               # Cookie đăng nhập Zalo
├── package.json
├── src/
│   ├── commands/             # Các lệnh của bot (mỗi file = 1 lệnh)
│   └── events/               # Xử lý sự kiện nền (message, group, txLoop, ...)
├── includes/
│   ├── handlers/             # Xử lý lệnh, reply, reaction, undo
│   ├── database/             # SQLite và JSON cache (economy, rent, ...)
│   ├── data/                 # Dữ liệu tĩnh
│   ├── listapi/              # Danh sách API tích hợp
│   └── cache/                # Cache bộ nhớ
├── utils/
│   ├── ai/                   # Logic AI (goibot.js, Groq, Gemini)
│   ├── bot/                  # Tiện ích bot
│   └── system/               # Logger, loader, githubBackup, maintenance
└── attached_assets/          # Tài nguyên đính kèm
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

## Các lệnh chính (Commands)

| Lệnh | Mô tả |
|---|---|
| `tx` | Game Tài Xỉu (cược tiền) |
| `money` | Xem/quản lý số dư kinh tế |
| `transfer` | Chuyển tiền giữa người dùng |
| `naptien` | Nạp tiền vào hệ thống |
| `rent` | Hệ thống thuê bot theo nhóm |
| `admin` | Quản lý quyền admin |
| `kick` | Đuổi thành viên khỏi nhóm |
| `anti` | Bật/tắt lọc spam, link, NSFW |
| `auto` | Tự động hóa (tải media, reply, ...) |
| `rank` | Bảng xếp hạng người dùng |
| `remind` | Hẹn giờ nhắc nhở |
| `thoitiet` | Thời tiết |
| `wiki` | Tìm kiếm Wikipedia |
| `ping` | Kiểm tra bot còn sống |
| `menu` | Danh sách lệnh |
| `profile` | Xem thông tin cá nhân |
| `note` | Ghi chú nhóm |
| `poll` | Tạo poll khảo sát |
| `shell` | Chạy lệnh shell (admin) |
| `load` | Reload lệnh động |
| `uptime` | Thời gian bot hoạt động |

## Các sự kiện nền (Events)

- `message.js` — Xử lý tin nhắn đến
- `groupEvents.js` — Sự kiện nhóm (thêm/xóa thành viên, v.v.)
- `txLoop.js` — Vòng lặp game Tài Xỉu đồng bộ theo phòng (60s/round)
- `autoDown.js` — Tự động tải media từ link (TikTok, v.v.)
- `autoSend.js` — Tự động gửi tin
- `goibot.js` — Xử lý gọi AI chat
- `tuongTac.js` — Xử lý tương tác người dùng

## Handlers

- `handleCommand.js` — Điều phối lệnh
- `handleReply.js` — Xử lý reply tin nhắn
- `handleReaction.js` — Xử lý reaction
- `handleUndo.js` — Tự động thu hồi tin nhắn

## Database

- SQLite (`better-sqlite3`) lưu trữ: người dùng, kinh tế, rent nhóm
- JSON cache lưu trữ dữ liệu tạm thời

## Scripts tiện ích

```bash
npm run new-cmd       # Tạo lệnh mới
npm run list-cmds     # Liệt kê tất cả lệnh
npm run move-cmd      # Di chuyển lệnh
npm run backup-cmds   # Backup danh sách lệnh
npm run backup        # Backup lên GitHub
```

## Cấu hình

File chính: `config.json`
- Prefix lệnh
- Danh sách admin
- API keys (Groq, Gemini, ...)
- Cài đặt game, kinh tế

File xác thực: `cookie.json`
- Cookie phiên đăng nhập Zalo

## Lưu ý kiến trúc

- Lệnh được load động qua `utils/system/loader.js`, có thể reload không cần restart
- Bot có cơ chế `keepAlive` để tự khởi động lại khi mất kết nối
- Có tính năng backup tự động lên GitHub
- AI Mizai có nhân cách "nữ tính" được định nghĩa qua system prompt trong `utils/ai/goibot.js`

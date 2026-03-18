# Zalo Bot (zca-js)

## Tổng quan

Bot Zalo sử dụng thư viện `zca-js`, đăng nhập bằng cookie + IMEI. Tích hợp AI Groq (llama-3.3-70b-versatile) và tự động tải media từ các nền tảng phổ biến.

## Stack

- **Runtime**: Node.js v24
- **Zalo API**: zca-js
- **AI**: Groq API (llama-3.3-70b-versatile) — qua `utils/ai/goibot.js`
- **Media download**: yt-dlp API tại `https://yt-dlp-hwys.onrender.com`
- **Database**: sqlite3 (với fallback better-sqlite3 / sql.js)
- **Entry point**: `index.js`

## Cấu trúc

```
├── index.js                    # Entry point
├── config.json                 # Cấu hình bot (loginMethod, prefix, ...)
├── cookie.json                 # Cookie Zalo (bắt buộc để đăng nhập)
├── src/
│   ├── commands/               # Lệnh bot (.goibot, .auto, .timnhac, ...)
│   └── events/                 # Event handlers (message, ...)
├── includes/
│   ├── auto/
│   │   ├── autoDown.js         # Tự động tải media khi có link (dùng yt-dlp API)
│   │   ├── autoSend.js         # Tự động gửi tin nhắn định kỳ
│   │   └── tuongTac.js         # Tương tác tự động
│   ├── database/               # SQLite helpers
│   └── handlers/               # Reaction, GroupEvent, Undo handlers
└── utils/
    ├── ai/
    │   └── goibot.js           # Mizai AI (Groq + SoundCloud + yt-dlp API)
    ├── system/
    │   ├── keepAlive.js        # Ping yt-dlp API server mỗi 14 phút (UptimeRobot-like)
    │   ├── ytdlpInstaller.js   # Cài yt-dlp binary local (dùng cho timnhac)
    │   └── ...
    └── media/
        └── upload.js           # Helpers gửi video/voice
```

## yt-dlp API Server

API server dùng để tải media: `https://yt-dlp-hwys.onrender.com`

**Endpoints:**
- `GET /api/healthz` — Health check
- `GET /api/media?url=...` — Lấy thông tin media (title, thumbnail, download_url, download_audio_url)
- `GET /api/download?url=...&format=...` — Stream tải media
- `GET /api/search?q=...&platform=yt|sc&svl=10` — Tìm kiếm

**KeepAlive:** `utils/system/keepAlive.js` tự ping `/api/healthz` mỗi 14 phút để server không bị sleep (Render free tier).

## Scripts

- `npm start` — Chạy bot
- `npm run dev` — Chạy với nodemon (auto-restart)

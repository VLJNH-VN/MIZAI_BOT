# MIZAI_BOT - Zalo Bot

## Overview
Bot Zalo sử dụng thư viện `zca-js`, hỗ trợ đăng nhập bằng Cookie hoặc QR Code. Tích hợp AI (Groq), SQLite database và nhiều lệnh tiện ích.

## Architecture
- **Entry**: `index.js` (launcher, auto-restart) → `main.js` (core)
- **Commands**: `src/commands/`
- **Events**: `src/events/`
- **Handlers**: `includes/handlers/`
- **Database**: `includes/database/` (SQLite via better-sqlite3)
- **Auth/Client**: `utils/system/client.js`
- **Multi-account**: `utils/system/multiAccount.js`

## Cookie Format
Cookie được lưu tại `cookie.json` theo định dạng object đơn giản:
```json
{
  "zpw_sek": "...",
  "zpsid": "..."
}
```

Hàm `normalizeCookies` hỗ trợ nhiều định dạng:
1. `{ cookies: [...] }` - Extension style
2. `[{key, value}]` - Array of objects
3. `"a=b; c=d"` - Cookie header string
4. `{ key: value }` - Map object (định dạng mặc định khi lưu)

## Login Flow
1. Nếu có `cookie.json` → thử đăng nhập bằng cookie
2. Nếu không có hoặc cookie hết hạn → fallback QR Code (tối đa 3 lần)
3. Sau khi đăng nhập QR thành công → lưu cookie theo định dạng `{ key: value }`

## Config (config.json)
```json
{
  "prefix": "-",
  "loginMethod": "cookie",
  "cookiePath": "./cookie.json",
  "imei": "...",
  "userAgent": "...",
  "ownerId": "..."
}
```

## Workflow
- **Start application**: `node index.js` (console output)

## Key Dependencies
- `zca-js` - Zalo client library
- `better-sqlite3` - Local database
- `axios` - HTTP requests
- `sharp`, `canvas` - Image processing
- `qrcode`, `jsqr` - QR Code support

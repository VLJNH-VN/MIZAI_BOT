# 🤖 MIZAI_BOT

<div align="center">

**Bot Zalo đa chức năng · Node.js · AI · Kinh tế · Media**

![Version](https://img.shields.io/badge/version-1.5.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![Platform](https://img.shields.io/badge/platform-Zalo-blue)
![License](https://img.shields.io/badge/license-Private-red)

</div>

---

## Giới thiệu

MIZAI_BOT là một chatbot Zalo đa chức năng, xây dựng bằng **Node.js** và thư viện **zca-js**. Bot đăng nhập thông qua cookie + IMEI, hỗ trợ hàng chục lệnh từ quản trị nhóm, kinh tế ảo, tải media cho đến tích hợp AI.

- **AI chính:** Groq — `llama-3.3-70b-versatile`
- **AI phụ:** Google Gemini (vision, tìm kiếm web, đọc link)
- **Database:** SQLite (`better-sqlite3`)

---

## Cài đặt

```bash
# 1. Clone repo
git clone https://github.com/VLJNH-VN/MIZAI_BOT.git
cd MIZAI_BOT

# 2. Cài dependencies
npm install

# 3. Tạo config từ mẫu
cp config.example.json config.json

# 4. Chỉnh sửa config.json (thêm cookie, imei, ownerId, token...)
# 5. Chạy bot
npm start
```

---

## Cài đặt trên Termux (Android)

```bash
# 1. Clone repo
git clone https://github.com/VLJNH-VN/MIZAI_BOT.git
cd MIZAI_BOT

# 2. Chạy script setup tự động
#    - Cài gói hệ thống (cairo, libvips, ffmpeg, ...)
#    - Tạo thư mục & file dữ liệu mặc định
#    - Build native modules (canvas, sharp, better-sqlite3)
#    - Patch ffmpeg-static → system ffmpeg (ARM)
chmod +x setup-termux.sh
bash setup-termux.sh

# 3. Áp dụng biến môi trường
source ~/.bashrc

# 4. Sửa config.json (điền token, ownerId, ...)
nano config.json

# 5. Chạy bot trong tmux để không bị kill khi tắt màn hình
tmux new -s mizai
npm start
# Ctrl+B → D để thoát tmux, bot vẫn chạy nền
```

> **Lưu ý Termux:**
> - Script `setup-termux.sh` tự động cài Cairo, libvips, ffmpeg và build các native module (`canvas`, `sharp`, `better-sqlite3`) từ source.
> - Nếu `canvas` hoặc `sharp` không build được, bot vẫn chạy bình thường — chỉ các lệnh sinh card ảnh (menu, uptime, join/leave card) sẽ không hiển thị ảnh.
> - Cài **Termux:API** và chạy `termux-wake-lock` để ngăn Android tắt bot khi màn hình tối.
> - Tắt tối ưu pin cho Termux trong **Cài đặt → Ứng dụng → Termux → Pin**.

---

## Cấu hình (`config.json`)

> File này **KHÔNG được commit lên GitHub** — đã có trong `.gitignore`

| Trường | Mô tả |
|---|---|
| `prefix` | Ký tự kích hoạt lệnh (mặc định `>`) |
| `loginMethod` | Phương thức đăng nhập: `cookie` hoặc `qr` |
| `cookiePath` | Đường dẫn file cookie Zalo |
| `imei` | IMEI thiết bị Zalo |
| `ownerId` | UID chủ bot |
| `adminBotIds` | Danh sách UID admin bot |
| `hfToken` | HuggingFace API token (sinh ảnh) |
| `githubToken` | GitHub token để backup dữ liệu |
| `repo` | Repo GitHub backup (format: `user/repo`) |
| `uploadRepo` | Repo GitHub upload media |

---

## Danh mục lệnh

### 🛡️ Admin — Quản trị nhóm
| Lệnh | Mô tả |
|---|---|
| `admin` | Phân quyền admin nhóm |
| `anti` | Bật/tắt các tính năng chống spam, flood... |
| `kick` | Kick thành viên khỏi nhóm |
| `mute` | Cấm/bỏ cấm thành viên |
| `set` | Cài đặt nhóm (tên, ảnh đại diện...) |
| `duyet` | Duyệt thành viên xin vào nhóm |
| `poll` | Tạo bình chọn trong nhóm |
| `shell` | Chạy lệnh hệ thống (chủ bot) |

### 💰 Kinh tế & Game
| Lệnh | Mô tả |
|---|---|
| `tx` / `txLoop` | Game Tài Xỉu cổ điển |
| `wallet` | Xem số dư ví |
| `pay` | Chuyển tiền ảo |
| `stk` | Tra cứu STK ngân hàng |
| `rent` | Hệ thống thuê bot |
| `key` | Quản lý key truy cập |
| `bb` | Bầu bí — trò chơi may mắn |

### 🎵 Media
| Lệnh | Mô tả |
|---|---|
| `music` | Tải nhạc từ YouTube, SoundCloud... |
| `timnhac` | Nhận diện bài hát đang phát |
| `vd` | Tải video TikTok, YouTube, Facebook... |
| `4k` | Tải video chất lượng cao |
| `flux` | Sinh ảnh AI từ text (HuggingFace Flux) |
| `hf` | Gọi HuggingFace model trực tiếp |
| `file` | Gửi/lấy file |

### 🧠 AI
| Lệnh | Mô tả |
|---|---|
| `api` | Chat AI tự do (Groq / Gemini) |
| `adc` | Phân tích ảnh bằng AI vision |
| `checktt` | Kiểm tra thông tin từ ảnh |
| `mizai` | Gọi AI Mizai (chat có ngữ cảnh nhóm) |

### ℹ️ Thông tin & Tra cứu
| Lệnh | Mô tả |
|---|---|
| `info` | Thông tin bot |
| `infouser` | Tra thông tin người dùng Zalo |
| `id` | Lấy ID người dùng / nhóm |
| `profile` | Xem hồ sơ thành viên |
| `uptime` | Thời gian bot hoạt động |
| `lookup` | Tra cứu thông tin (IP, domain...) |
| `crawl` | Lấy nội dung từ link web |

### 🎉 Giải trí & Tiện ích
| Lệnh | Mô tả |
|---|---|
| `note` | Lưu / đọc ghi chú nhóm |
| `remind` | Đặt nhắc nhở tự động |
| `forward` | Forward tin nhắn sang nhóm khác |
| `dice` | Tung xúc xắc |
| `rs` | Xem hoặc replay nội dung |
| `autoreply` | Cài đặt tự động trả lời |
| `menu` | Xem toàn bộ danh sách lệnh |

---

## Cấu trúc thư mục

```
MIZAI_BOT/
├── index.js                  # Entry point
├── config.json               # Cấu hình (KHÔNG commit)
├── config.example.json       # Mẫu config
├── cookie.json               # Cookie Zalo (KHÔNG commit)
│
├── src/
│   ├── commands/             # Tất cả lệnh bot
│   └── events/               # Sự kiện nền (message, autoDown, groupEvents...)
│
├── includes/
│   ├── handlers/             # Xử lý lệnh, reply, undo
│   ├── database/             # SQLite wrapper + module theo nhóm
│   └── data/                 # Dữ liệu JSON (config, runtime, game)
│
├── utils/
│   ├── ai/                   # Logic AI (Groq, Gemini)
│   ├── bot/                  # botManager, messageUtils
│   ├── system/               # logger, keepAlive, githubBackup
│   └── media/                # canvas, zaloMedia, helpers
│
└── scripts/                  # Script tiện ích CLI
```

---

## Tech Stack

| Thành phần | Công nghệ |
|---|---|
| Runtime | Node.js ≥ 18 |
| Zalo SDK | `zca-js` v2.1.2 |
| AI chính | Groq — llama-3.3-70b-versatile |
| AI phụ | Google Gemini (`@google/genai`) |
| Database | SQLite (`better-sqlite3`) |
| Ảnh / Media | `canvas`, `sharp`, `ffmpeg` |
| HTTP | `axios`, `node-fetch` |
| Scraping | `cheerio` |
| TikTok DL | `@tobyg74/tiktok-api-dl` |
| Dev tool | `nodemon` |

---

## Script tiện ích

```bash
npm start                              # Chạy bot
npm run dev                            # Chạy với auto-reload (nodemon)
npm run new-cmd <tên> <danh-mục>       # Tạo lệnh mới
npm run list-cmds                      # Liệt kê tất cả lệnh
npm run move-cmd <tên> <danh-mục>      # Di chuyển lệnh
npm run backup-cmds                    # Backup lệnh ra .zip
npm run backup                         # Backup dữ liệu lên GitHub
```

---

## Push lên GitHub lần đầu

Nếu bạn fork/clone từ Replit hoặc từ máy khác rồi muốn đẩy lên GitHub sạch:

```bash
# 1. Xóa các file nhạy cảm ra khỏi git tracking (chỉ chạy 1 lần)
chmod +x git-clean.sh
bash git-clean.sh

# 2. Kiểm tra lại
git status

# 3. Commit và push
git add -A
git commit -m "chore: clean tracked sensitive files"
git push origin main
```

> Script `git-clean.sh` chỉ **bỏ tracking** — file local của bạn **không bị xóa**.

---

## Bảo mật

- `config.json` và `cookie.json` đã có trong `.gitignore` — **KHÔNG bao giờ commit** 2 file này
- Luôn dùng `config.example.json` làm mẫu khi chia sẻ
- Token GitHub, HuggingFace, Gemini chỉ lưu trong `config.json` local

---

<div align="center">
  Made with ❤️ by VLJNH-VN
</div>

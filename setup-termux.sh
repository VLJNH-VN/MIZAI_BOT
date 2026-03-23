#!/data/data/com.termux/files/usr/bin/bash

# ════════════════════════════════════════════════════════════
#  MIZAI_BOT — Setup Script cho Termux (Android)
#  Tác giả: VLJNH-VN
# ════════════════════════════════════════════════════════════

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()    { echo -e "${CYAN}[INFO]${NC} $1"; }
log_ok()      { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
log_section() { echo -e "\n${BOLD}${CYAN}══ $1 ══${NC}"; }

echo -e "${BOLD}${CYAN}"
echo "  ███╗   ███╗██╗███████╗ █████╗ ██╗"
echo "  ████╗ ████║██║╚══███╔╝██╔══██╗██║"
echo "  ██╔████╔██║██║  ███╔╝ ███████║██║"
echo "  ██║╚██╔╝██║██║ ███╔╝  ██╔══██║██║"
echo "  ██║ ╚═╝ ██║██║███████╗██║  ██║██║"
echo "  ╚═╝     ╚═╝╚═╝╚══════╝╚═╝  ╚═╝╚═╝"
echo -e "        BOT ZALO — TERMUX SETUP${NC}\n"

# ── 1. Cập nhật Termux ────────────────────────────────────────
log_section "Cập nhật Termux"
pkg update -y && pkg upgrade -y
log_ok "Termux đã cập nhật."

# ── 2. Cài các gói hệ thống cần thiết ────────────────────────
log_section "Cài gói hệ thống"

PKGS=(
  nodejs
  git
  python
  make
  clang
  pkg-config
  # Cho canvas
  cairo
  pango
  giflib
  librsvg
  libjpeg-turbo
  # Cho sharp / libvips
  libvips
  # Tiện ích
  curl
  wget
  ffmpeg
)

for pkg_name in "${PKGS[@]}"; do
  if pkg list-installed 2>/dev/null | grep -q "^$pkg_name"; then
    log_warn "$pkg_name đã cài, bỏ qua."
  else
    log_info "Đang cài $pkg_name..."
    pkg install -y "$pkg_name" || log_warn "Không thể cài $pkg_name — tiếp tục."
  fi
done

log_ok "Hoàn tất cài gói hệ thống."

# ── 3. Kiểm tra Node.js ───────────────────────────────────────
log_section "Kiểm tra Node.js"
NODE_VER=$(node --version 2>/dev/null || echo "không tìm thấy")
NPM_VER=$(npm --version 2>/dev/null || echo "không tìm thấy")

if [[ "$NODE_VER" == "không tìm thấy" ]]; then
  log_error "Node.js chưa được cài! Hãy chạy: pkg install nodejs"
  exit 1
fi

log_ok "Node.js: $NODE_VER | npm: $NPM_VER"

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])" 2>/dev/null)
if [ "$NODE_MAJOR" -lt 18 ]; then
  log_error "Cần Node.js >= 18! Phiên bản hiện tại: $NODE_VER"
  exit 1
fi

# ── 4. Biến môi trường build native modules ───────────────────
log_section "Cấu hình biến môi trường build"

export CC=clang
export CXX=clang++
export npm_config_build_from_source=true
export npm_config_cache="$HOME/.npm-cache"
export CFLAGS="-O2 -march=native"
export CXXFLAGS="-O2 -march=native"

# Giúp node-gyp tìm Python
export PYTHON=$(which python3 2>/dev/null || which python)

log_ok "CC=$CC | CXX=$CXX | PYTHON=$PYTHON"

# ── 5. Cài npm dependencies ───────────────────────────────────
log_section "Cài npm dependencies"
log_warn "Bước này có thể mất 10-20 phút trên lần đầu (build native modules)..."

# Thử cài canvas từ prebuilt trước, nếu fail thì build từ source
npm install --prefer-offline 2>/dev/null || npm install

log_ok "npm install hoàn tất."

# ── 6. Rebuild better-sqlite3 ────────────────────────────────
log_section "Rebuild better-sqlite3"
log_info "Đang rebuild better-sqlite3 cho kiến trúc hiện tại..."

npm rebuild better-sqlite3 --update-binary 2>/dev/null \
  || npm rebuild better-sqlite3 \
  || log_warn "better-sqlite3 không rebuild được — sẽ dùng sql.js fallback."

log_ok "better-sqlite3 đã xử lý."

# ── 7. Kiểm tra canvas ────────────────────────────────────────
log_section "Kiểm tra canvas"
node -e "require('canvas'); console.log('canvas OK')" 2>/dev/null \
  && log_ok "canvas hoạt động tốt." \
  || log_warn "canvas không load được — một số lệnh sinh ảnh có thể lỗi."

# ── 8. Kiểm tra sharp ─────────────────────────────────────────
log_section "Kiểm tra sharp"
node -e "require('sharp'); console.log('sharp OK')" 2>/dev/null \
  && log_ok "sharp hoạt động tốt." \
  || log_warn "sharp không load được — xử lý ảnh có thể lỗi."

# ── 9. Kiểm tra ffmpeg ───────────────────────────────────────
log_section "Kiểm tra ffmpeg"
FFMPEG_PATH=$(which ffmpeg 2>/dev/null || echo "")
if [ -n "$FFMPEG_PATH" ]; then
  log_ok "ffmpeg tìm thấy tại: $FFMPEG_PATH"
else
  log_warn "ffmpeg không tìm thấy — tải video/audio có thể lỗi."
fi

# ── 10. Kiểm tra config.json ─────────────────────────────────
log_section "Kiểm tra config.json"
if [ ! -f "config.json" ]; then
  if [ -f "config.example.json" ]; then
    cp config.example.json config.json
    log_warn "Đã tạo config.json từ mẫu. Hãy điền thông tin vào file này!"
  else
    log_error "Không tìm thấy config.json và config.example.json!"
  fi
else
  log_ok "config.json đã tồn tại."
fi

# ── 11. Kiểm tra cookie.json ─────────────────────────────────
log_section "Kiểm tra cookie.json"
if [ ! -f "cookie.json" ]; then
  log_warn "Chưa có cookie.json — cần export cookie Zalo và đặt vào file này."
else
  log_ok "cookie.json đã tồn tại."
fi

# ── Tổng kết ─────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  SETUP HOÀN TẤT!${NC}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════${NC}"
echo ""
echo -e "  ${CYAN}Các bước tiếp theo:${NC}"
echo -e "  1. Điền thông tin vào ${YELLOW}config.json${NC} (cookie, imei, ownerId, token...)"
echo -e "  2. Đảm bảo ${YELLOW}cookie.json${NC} đã có cookie Zalo hợp lệ"
echo -e "  3. Chạy bot: ${GREEN}npm start${NC}"
echo ""
echo -e "  ${CYAN}Lệnh hữu ích:${NC}"
echo -e "  ${GREEN}npm start${NC}           — Chạy bot"
echo -e "  ${GREEN}npm run dev${NC}         — Chạy với auto-reload"
echo -e "  ${GREEN}npm run list-cmds${NC}   — Liệt kê tất cả lệnh"
echo ""

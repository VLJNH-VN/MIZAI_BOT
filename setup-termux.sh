#!/data/data/com.termux/files/usr/bin/bash

# ════════════════════════════════════════════════════════════
#  MIZAI_BOT — Termux Setup Script
#  Yêu cầu: Termux (Android), Node.js >= 18
# ════════════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

_ok=0
_warn=0
_fail=0

log_info()    { echo -e "${CYAN}[INFO]${NC}  $1"; }
log_ok()      { echo -e "${GREEN}[OK]${NC}    $1"; (( _ok++ )); }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; (( _warn++ )); }
log_error()   { echo -e "${RED}[ERR]${NC}   $1"; (( _fail++ )); }
log_section() { echo -e "\n${BOLD}${CYAN}┌─ $1${NC}"; }
log_done()    { echo -e "${DIM}└─ xong${NC}"; }

banner() {
  echo -e "${BOLD}${CYAN}"
  echo "  ███╗   ███╗██╗███████╗ █████╗ ██╗"
  echo "  ████╗ ████║██║╚══███╔╝██╔══██╗██║"
  echo "  ██╔████╔██║██║  ███╔╝ ███████║██║"
  echo "  ██║╚██╔╝██║██║ ███╔╝  ██╔══██║██║"
  echo "  ██║ ╚═╝ ██║██║███████╗██║  ██║██║"
  echo "  ╚═╝     ╚═╝╚═╝╚══════╝╚═╝  ╚═╝╚═╝"
  echo -e "       BOT ZALO — TERMUX SETUP v1.5${NC}"
  echo -e "${DIM}  $(date '+%Y-%m-%d %H:%M:%S')${NC}\n"
}

# ── Kiểm tra đang chạy trong Termux ──────────────────────────
check_termux() {
  log_section "Kiểm tra môi trường"
  if [ -z "$PREFIX" ] || [[ "$PREFIX" != *"com.termux"* ]]; then
    log_warn "Script này được thiết kế cho Termux. Tiếp tục với rủi ro của bạn."
  else
    log_ok "Đang chạy trong Termux: $PREFIX"
  fi

  ARCH=$(uname -m)
  log_info "Kiến trúc CPU: ${ARCH}"

  # Yêu cầu quyền lưu trữ (nếu chưa có)
  if [ ! -d "$HOME/storage" ]; then
    log_info "Cấp quyền truy cập bộ nhớ trong..."
    termux-setup-storage 2>/dev/null || log_warn "termux-setup-storage không khả dụng."
  else
    log_ok "Quyền bộ nhớ trong đã có."
  fi
  log_done
}

# ── Cập nhật Termux ───────────────────────────────────────────
update_termux() {
  log_section "Cập nhật Termux packages"
  pkg update -y -o Dpkg::Options::="--force-confold" 2>/dev/null && \
  pkg upgrade -y -o Dpkg::Options::="--force-confold" 2>/dev/null && \
    log_ok "Termux đã cập nhật." || \
    log_warn "Cập nhật có lỗi nhỏ — tiếp tục."
  log_done
}

# ── Cài gói hệ thống ──────────────────────────────────────────
install_system_pkgs() {
  log_section "Cài gói hệ thống"

  # Nhóm: build tools
  BUILD_PKGS=(git python make clang binutils pkg-config)
  # Nhóm: cho canvas (node-canvas)
  CANVAS_PKGS=(cairo pango giflib librsvg libjpeg-turbo libpng)
  # Nhóm: cho sharp
  SHARP_PKGS=(libvips)
  # Nhóm: tiện ích
  UTIL_PKGS=(nodejs-lts ffmpeg curl wget)

  ALL_PKGS=( "${BUILD_PKGS[@]}" "${CANVAS_PKGS[@]}" "${SHARP_PKGS[@]}" "${UTIL_PKGS[@]}" )

  for p in "${ALL_PKGS[@]}"; do
    # Dùng dpkg -s để check chính xác hơn pkg list-installed
    if dpkg -s "$p" &>/dev/null; then
      echo -e "  ${DIM}· $p đã cài${NC}"
    else
      log_info "Đang cài $p..."
      pkg install -y "$p" 2>/dev/null && \
        echo -e "  ${GREEN}+ $p${NC}" || \
        log_warn "$p: không cài được — bỏ qua."
    fi
  done

  log_ok "Hoàn tất cài gói hệ thống."
  log_done
}

# ── Kiểm tra Node.js ──────────────────────────────────────────
check_node() {
  log_section "Kiểm tra Node.js"

  if ! command -v node &>/dev/null; then
    log_error "Không tìm thấy Node.js! Chạy: pkg install nodejs-lts"
    exit 1
  fi

  NODE_VER=$(node --version)
  NPM_VER=$(npm --version)
  NODE_MAJOR=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")

  log_ok "Node.js $NODE_VER  |  npm v$NPM_VER"

  if [ "$NODE_MAJOR" -lt 18 ]; then
    log_error "Cần Node.js >= 18. Hiện tại: $NODE_VER"
    log_info  "Chạy: pkg install nodejs-lts"
    exit 1
  fi

  log_done
}

# ── Cấu hình npm & biến môi trường build ─────────────────────
configure_build_env() {
  log_section "Cấu hình môi trường build"

  export CC=clang
  export CXX=clang++
  export PYTHON=$(command -v python3 2>/dev/null || command -v python)
  export MAKEFLAGS="-j$(nproc)"
  export npm_config_cache="$HOME/.npm-cache"

  # Flags tối ưu cho ARM/x86
  case "$(uname -m)" in
    aarch64) export CFLAGS="-O2" ; export CXXFLAGS="-O2" ;;
    armv7*)  export CFLAGS="-O2 -march=armv7-a" ; export CXXFLAGS="-O2 -march=armv7-a" ;;
    *)       export CFLAGS="-O2" ; export CXXFLAGS="-O2" ;;
  esac

  # Trỏ pkg-config cho canvas / sharp
  export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"
  export LD_LIBRARY_PATH="$PREFIX/lib:$LD_LIBRARY_PATH"

  # Cấu hình npm global
  npm config set python "$PYTHON"       2>/dev/null
  npm config set cache  "$HOME/.npm-cache" 2>/dev/null

  log_ok "CC=$CC | CXX=$CXX | PYTHON=$PYTHON | jobs=$(nproc)"
  log_ok "CFLAGS=$CFLAGS"
  log_ok "PKG_CONFIG_PATH=$PKG_CONFIG_PATH"
  log_done
}

# ── Cài npm dependencies ──────────────────────────────────────
install_npm() {
  log_section "Cài npm dependencies"
  log_warn "Có thể mất 10–25 phút (build native modules lần đầu)..."

  # Xóa cache cũ nếu có lỗi trước đó
  if [ -d "node_modules/.cache" ]; then
    rm -rf node_modules/.cache
  fi

  npm install --build-from-source 2>&1 | tail -5 && \
    log_ok "npm install hoàn tất." || {
      log_warn "npm install lỗi, thử lại không có --build-from-source..."
      npm install --ignore-scripts 2>&1 | tail -5 && \
        log_warn "Cài xong nhưng bỏ qua scripts — sẽ rebuild thủ công." || \
        log_error "npm install thất bại. Kiểm tra kết nối mạng."
    }

  log_done
}

# ── Rebuild native modules ────────────────────────────────────
rebuild_native() {
  log_section "Rebuild native modules"

  # better-sqlite3
  log_info "Rebuilding better-sqlite3..."
  node -e "require('better-sqlite3')" 2>/dev/null && \
    log_ok "better-sqlite3 đã hoạt động — bỏ qua rebuild." || {
      npm rebuild better-sqlite3 --update-binary 2>/dev/null || \
      npm rebuild better-sqlite3 2>/dev/null || \
      log_warn "better-sqlite3 rebuild thất bại → dùng sql.js fallback."
    }

  # canvas
  log_info "Rebuilding canvas..."
  node -e "require('canvas')" 2>/dev/null && \
    log_ok "canvas đã hoạt động." || {
      npm rebuild canvas --build-from-source 2>/dev/null && \
        log_ok "canvas rebuild thành công." || \
        log_warn "canvas rebuild thất bại — lệnh sinh ảnh có thể không dùng được."
    }

  # sharp
  log_info "Rebuilding sharp..."
  node -e "require('sharp')" 2>/dev/null && \
    log_ok "sharp đã hoạt động." || {
      SHARP_IGNORE_GLOBAL_LIBVIPS=0 npm rebuild sharp --build-from-source 2>/dev/null && \
        log_ok "sharp rebuild thành công." || \
        log_warn "sharp rebuild thất bại — xử lý ảnh có thể bị hạn chế."
    }

  log_done
}

# ── Kiểm tra ffmpeg ───────────────────────────────────────────
check_ffmpeg() {
  log_section "Kiểm tra ffmpeg"
  if command -v ffmpeg &>/dev/null; then
    FFVER=$(ffmpeg -version 2>&1 | head -1 | awk '{print $3}')
    log_ok "ffmpeg $FFVER  →  $(which ffmpeg)"
    # Ghi đè FFMPEG_PATH để fluent-ffmpeg dùng hệ thống thay vì ffmpeg-static
    echo "export FFMPEG_PATH=$(which ffmpeg)" >> "$HOME/.bashrc"
    echo "export FFPROBE_PATH=$(which ffprobe 2>/dev/null || echo '')" >> "$HOME/.bashrc"
    log_info "Đã ghi FFMPEG_PATH vào ~/.bashrc"
  else
    log_warn "ffmpeg không tìm thấy → tải video/audio có thể lỗi."
  fi
  log_done
}

# ── Kiểm tra & tạo file cấu hình ─────────────────────────────
check_config() {
  log_section "Kiểm tra file cấu hình"

  # config.json
  if [ -f "config.json" ]; then
    log_ok "config.json tồn tại."
    # Kiểm tra JSON hợp lệ
    node -e "JSON.parse(require('fs').readFileSync('config.json','utf8'))" 2>/dev/null && \
      log_ok "config.json hợp lệ (JSON parse OK)." || \
      log_error "config.json bị lỗi cú pháp JSON!"
  elif [ -f "config.example.json" ]; then
    cp config.example.json config.json
    log_warn "Đã tạo config.json từ mẫu — hãy điền thông tin vào file này!"
  else
    log_error "Không có config.json và config.example.json. Bot sẽ không chạy được!"
  fi

  # cookie.json
  if [ -f "cookie.json" ]; then
    log_ok "cookie.json tồn tại."
    node -e "const c=JSON.parse(require('fs').readFileSync('cookie.json','utf8')); if(!Array.isArray(c)&&typeof c!=='object') throw 1; console.log('cookie count:', Array.isArray(c)?c.length:'object')" 2>/dev/null && \
      log_ok "cookie.json hợp lệ." || \
      log_warn "cookie.json có thể bị lỗi định dạng."
  else
    log_warn "Chưa có cookie.json — cần export cookie Zalo rồi đặt vào thư mục này."
  fi

  log_done
}

# ── Báo cáo tổng kết ──────────────────────────────────────────
summary() {
  echo ""
  echo -e "${BOLD}${CYAN}════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}  SETUP KẾT THÚC${NC}"
  echo -e "${BOLD}${CYAN}════════════════════════════════════════════════${NC}"
  echo -e "  ${GREEN}Thành công:${NC} $_ok    ${YELLOW}Cảnh báo:${NC} $_warn    ${RED}Lỗi:${NC} $_fail"
  echo -e "${BOLD}${CYAN}────────────────────────────────────────────────${NC}"

  if [ "$_fail" -gt 0 ]; then
    echo -e "\n  ${RED}Có $_fail lỗi cần xử lý trước khi chạy bot.${NC}"
  fi

  echo ""
  echo -e "  ${BOLD}Bước tiếp theo:${NC}"
  echo -e "  1. Sửa ${YELLOW}config.json${NC}  — điền cookie path, IMEI, ownerId, token API"
  echo -e "  2. Đảm bảo ${YELLOW}cookie.json${NC} có cookie Zalo hợp lệ"
  echo -e "  3. Reload shell: ${GREEN}source ~/.bashrc${NC}"
  echo -e "  4. Chạy bot:     ${GREEN}npm start${NC}"
  echo ""
  echo -e "  ${DIM}Lệnh khác:${NC}"
  echo -e "  ${DIM}npm run dev          — chạy + auto-reload (nodemon)${NC}"
  echo -e "  ${DIM}npm run list-cmds    — xem tất cả lệnh${NC}"
  echo -e "  ${DIM}npm run backup       — backup dữ liệu lên GitHub${NC}"
  echo ""
}

# ══════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════
banner
check_termux
update_termux
install_system_pkgs
check_node
configure_build_env
install_npm
rebuild_native
check_ffmpeg
check_config
summary

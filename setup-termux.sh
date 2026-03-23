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

_ok=0; _warn=0; _fail=0

log_info()    { echo -e "  ${CYAN}·${NC} $1"; }
log_ok()      { echo -e "  ${GREEN}✔${NC} $1"; (( _ok++ )); }
log_warn()    { echo -e "  ${YELLOW}!${NC} $1"; (( _warn++ )); }
log_error()   { echo -e "  ${RED}✘${NC} $1"; (( _fail++ )); }
log_section() { echo -e "\n${BOLD}${CYAN}▸ $1${NC}"; }

banner() {
  echo -e "${BOLD}${CYAN}"
  echo "  ███╗   ███╗██╗███████╗ █████╗ ██╗"
  echo "  ████╗ ████║██║╚══███╔╝██╔══██╗██║"
  echo "  ██╔████╔██║██║  ███╔╝ ███████║██║"
  echo "  ██║╚██╔╝██║██║ ███╔╝  ██╔══██║██║"
  echo "  ██║ ╚═╝ ██║██║███████╗██║  ██║██║"
  echo "  ╚═╝     ╚═╝╚═╝╚══════╝╚═╝  ╚═╝╚═╝"
  echo -e "  ${NC}${DIM}Bot Zalo — Termux Setup  $(date '+%Y-%m-%d %H:%M')${NC}\n"
}

# ════════════════════════════════════════════════════════════
#  1. Kiểm tra môi trường
# ════════════════════════════════════════════════════════════
check_env() {
  log_section "Kiểm tra môi trường"

  # Phải chạy trong Termux
  if [[ -z "$PREFIX" || "$PREFIX" != *"com.termux"* ]]; then
    log_warn "Không phát hiện PREFIX của Termux — tiếp tục nhưng có thể lỗi."
  else
    log_ok "Termux OK  ($PREFIX)"
  fi

  # Kiến trúc
  ARCH=$(uname -m)
  log_info "CPU: $ARCH  |  Kernel: $(uname -r)"

  # Quyền lưu trữ
  if [ ! -d "$HOME/storage" ]; then
    log_info "Xin quyền bộ nhớ trong..."
    termux-setup-storage 2>/dev/null && log_ok "Đã cấp quyền bộ nhớ." || \
      log_warn "Không cấp được quyền bộ nhớ (tiếp tục)."
  else
    log_ok "Quyền bộ nhớ trong đã có."
  fi
}

# ════════════════════════════════════════════════════════════
#  2. Cập nhật & cài gói hệ thống
# ════════════════════════════════════════════════════════════
install_system() {
  log_section "Cập nhật Termux"
  pkg update -y -o Dpkg::Options::="--force-confold" 2>/dev/null
  pkg upgrade -y -o Dpkg::Options::="--force-confold" 2>/dev/null && \
    log_ok "Termux đã cập nhật." || log_warn "Cập nhật có lỗi nhỏ — tiếp tục."

  log_section "Cài gói hệ thống"

  # Khai báo rõ ràng từng nhóm + lý do
  declare -A PKGS_DESC=(
    ["git"]="quản lý repo"
    ["nodejs-lts"]="Node.js runtime"
    ["python"]="node-gyp cần Python"
    ["make"]="build C++ addons"
    ["clang"]="compiler cho native modules"
    ["binutils"]="linker (ld)"
    ["pkg-config"]="tìm thư viện khi build"
    # canvas
    ["cairo"]="canvas: 2D graphics"
    ["pango"]="canvas: text rendering"
    ["giflib"]="canvas: GIF support"
    ["librsvg"]="canvas: SVG support"
    ["libjpeg-turbo"]="canvas/sharp: JPEG"
    ["libpng"]="canvas: PNG"
    # sharp
    ["libvips"]="sharp: image processing"
    # system ffmpeg (quan trọng - thay ffmpeg-static)
    ["ffmpeg"]="xử lý video/audio (thay ffmpeg-static)"
    # tiện ích
    ["curl"]="HTTP requests"
    ["wget"]="download files"
  )

  for p in "${!PKGS_DESC[@]}"; do
    if dpkg -s "$p" &>/dev/null; then
      echo -e "  ${DIM}· $p (đã cài)${NC}"
    else
      log_info "Cài $p — ${PKGS_DESC[$p]}..."
      pkg install -y "$p" 2>/dev/null && \
        echo -e "  ${GREEN}+ $p${NC}" || \
        log_warn "$p không cài được — bỏ qua."
    fi
  done

  log_ok "Hoàn tất cài gói hệ thống."
}

# ════════════════════════════════════════════════════════════
#  3. Kiểm tra Node.js
# ════════════════════════════════════════════════════════════
check_node() {
  log_section "Kiểm tra Node.js"

  if ! command -v node &>/dev/null; then
    log_error "Node.js chưa cài! Chạy: pkg install nodejs-lts"
    exit 1
  fi

  NODE_VER=$(node --version)
  NPM_VER=$(npm --version)
  NODE_MAJOR=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")

  log_ok "Node.js $NODE_VER  |  npm v$NPM_VER"

  if [ "$NODE_MAJOR" -lt 18 ]; then
    log_error "Cần Node.js >= 18. Hiện tại: $NODE_VER → Chạy: pkg install nodejs-lts"
    exit 1
  fi
}

# ════════════════════════════════════════════════════════════
#  4. Cấu hình build environment
# ════════════════════════════════════════════════════════════
setup_build_env() {
  log_section "Cấu hình build environment"

  export CC=clang
  export CXX=clang++
  export PYTHON=$(command -v python3 2>/dev/null || command -v python)
  export MAKEFLAGS="-j$(nproc 2>/dev/null || echo 2)"
  export npm_config_cache="$HOME/.npm-cache"

  # CFLAGS an toàn cho mọi ARM (không dùng -march=native dễ crash khi cross-compile)
  export CFLAGS="-O2"
  export CXXFLAGS="-O2"

  # Trỏ đúng prefix của Termux để node-gyp tìm được thư viện
  export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig:$PREFIX/share/pkgconfig"
  export LD_LIBRARY_PATH="$PREFIX/lib:${LD_LIBRARY_PATH:-}"
  export C_INCLUDE_PATH="$PREFIX/include"
  export CPLUS_INCLUDE_PATH="$PREFIX/include"
  export LIBRARY_PATH="$PREFIX/lib"

  # Cấu hình npm
  npm config set python     "$PYTHON"            2>/dev/null
  npm config set cache      "$HOME/.npm-cache"   2>/dev/null
  npm config set prefer-offline false            2>/dev/null

  log_ok "CC=$CC | CXX=$CXX | PYTHON=$PYTHON | jobs=$(nproc 2>/dev/null || echo 2)"
  log_ok "PKG_CONFIG_PATH=$PKG_CONFIG_PATH"
}

# ════════════════════════════════════════════════════════════
#  5. Cài npm dependencies
# ════════════════════════════════════════════════════════════
install_npm() {
  log_section "Cài npm dependencies"
  log_warn "Có thể mất 10–30 phút lần đầu (build native modules)..."

  # Xóa lock file cũ của node_modules nếu có lỗi
  [ -f node_modules/.package-lock.json ] && rm -f node_modules/.package-lock.json 2>/dev/null

  NPM_LOG=$(npm install --build-from-source --ignore-engines 2>&1)
  NPM_EXIT=$?
  echo "$NPM_LOG" | tail -5

  if [ $NPM_EXIT -eq 0 ]; then
    log_ok "npm install thành công."
  else
    log_warn "npm install lỗi — thử --ignore-scripts..."
    NPM_LOG2=$(npm install --ignore-scripts --ignore-engines 2>&1)
    NPM_EXIT2=$?
    echo "$NPM_LOG2" | tail -5
    if [ $NPM_EXIT2 -eq 0 ]; then
      log_warn "Đã cài nhưng bỏ qua build scripts — sẽ rebuild thủ công ở bước sau."
    else
      log_error "npm install thất bại. Kiểm tra kết nối mạng và thử lại."
    fi
  fi
}

# ════════════════════════════════════════════════════════════
#  6. Rebuild better-sqlite3
# ════════════════════════════════════════════════════════════
rebuild_sqlite() {
  log_section "Rebuild better-sqlite3"

  if node -e "require('better-sqlite3')" 2>/dev/null; then
    log_ok "better-sqlite3 hoạt động — bỏ qua rebuild."
    return
  fi

  log_info "better-sqlite3 chưa build → đang rebuild..."
  npm rebuild better-sqlite3 --update-binary 2>/dev/null || \
  npm rebuild better-sqlite3 2>/dev/null || \
  (
    log_warn "Prebuilt binary không có cho ARM → build từ source..."
    npm rebuild better-sqlite3 --build-from-source 2>/dev/null
  ) || \
    log_warn "better-sqlite3 rebuild thất bại → sẽ dùng sql.js fallback."

  node -e "require('better-sqlite3')" 2>/dev/null && \
    log_ok "better-sqlite3 hoạt động sau rebuild." || \
    log_warn "better-sqlite3 vẫn lỗi → bot dùng sql.js fallback (vẫn chạy được)."
}

# ════════════════════════════════════════════════════════════
#  7. Rebuild canvas
# ════════════════════════════════════════════════════════════
rebuild_canvas() {
  log_section "Rebuild canvas"

  if node -e "require('canvas')" 2>/dev/null; then
    log_ok "canvas hoạt động — bỏ qua rebuild."
    return
  fi

  log_info "canvas chưa build → đang rebuild từ source..."
  npm rebuild canvas \
    --build-from-source \
    --canvas_jpeg_include_dir="$PREFIX/include" \
    --canvas_jpeg_lib_dir="$PREFIX/lib" \
    2>&1 | tail -5

  node -e "require('canvas')" 2>/dev/null && \
    log_ok "canvas hoạt động sau rebuild." || \
    log_warn "canvas rebuild thất bại → lệnh sinh ảnh (menu card, uptime...) sẽ không dùng được."
}

# ════════════════════════════════════════════════════════════
#  8. Rebuild sharp
# ════════════════════════════════════════════════════════════
rebuild_sharp() {
  log_section "Rebuild sharp"

  if node -e "require('sharp')" 2>/dev/null; then
    log_ok "sharp hoạt động — bỏ qua rebuild."
    return
  fi

  log_info "sharp chưa build → đang rebuild dùng system libvips..."
  SHARP_IGNORE_GLOBAL_LIBVIPS=0 \
  npm rebuild sharp \
    --build-from-source \
    2>&1 | tail -5

  node -e "require('sharp')" 2>/dev/null && \
    log_ok "sharp hoạt động sau rebuild." || \
    log_warn "sharp rebuild thất bại → lệnh 4k/stk có thể bị hạn chế."
}

# ════════════════════════════════════════════════════════════
#  9. Patch ffmpeg-static → system ffmpeg   ← QUAN TRỌNG NHẤT
#     ffmpeg-static ship binary x86_64, KHÔNG chạy trên ARM Android.
#     Giải pháp: ghi đè index.js để trả về đường dẫn system ffmpeg.
# ════════════════════════════════════════════════════════════
patch_ffmpeg_static() {
  log_section "Patch ffmpeg-static"

  SYSTEM_FFMPEG=$(command -v ffmpeg 2>/dev/null || echo "")
  FFSTATIC_INDEX="node_modules/ffmpeg-static/index.js"

  if [ -z "$SYSTEM_FFMPEG" ]; then
    log_warn "System ffmpeg không tìm thấy → không patch được. Cài: pkg install ffmpeg"
    return
  fi

  log_ok "System ffmpeg: $SYSTEM_FFMPEG"

  if [ ! -f "$FFSTATIC_INDEX" ]; then
    log_warn "node_modules/ffmpeg-static chưa tồn tại — bỏ qua patch."
    return
  fi

  # Kiểm tra binary gốc của ffmpeg-static có chạy được không
  FFSTATIC_BIN=$(node -e "try{const p=require('ffmpeg-static');process.stdout.write(p||'')}catch{}" 2>/dev/null)

  if [ -n "$FFSTATIC_BIN" ] && "$FFSTATIC_BIN" -version &>/dev/null 2>&1; then
    log_ok "ffmpeg-static binary chạy được — không cần patch."
    return
  fi

  # Binary không chạy được (sai arch) → patch index.js
  log_warn "ffmpeg-static binary không chạy được trên $ARCH → patch sang system ffmpeg..."

  # Backup bản gốc
  [ ! -f "${FFSTATIC_INDEX}.bak" ] && cp "$FFSTATIC_INDEX" "${FFSTATIC_INDEX}.bak"

  # Ghi đè index.js — đơn giản nhất, tương thích mọi version ffmpeg-static
  cat > "$FFSTATIC_INDEX" <<EOF
// Patched by setup-termux.sh: system ffmpeg thay cho binary x86_64
'use strict';
module.exports = '${SYSTEM_FFMPEG}';
EOF

  # Kiểm tra sau patch
  PATCHED=$(node -e "try{process.stdout.write(require('ffmpeg-static')||'')}catch{}" 2>/dev/null)
  if [ "$PATCHED" = "$SYSTEM_FFMPEG" ]; then
    log_ok "Patch thành công: ffmpeg-static → $SYSTEM_FFMPEG"
  else
    log_error "Patch thất bại — kiểm tra thủ công: $FFSTATIC_INDEX"
  fi

  # Ghi FFMPEG_PATH vào ~/.bashrc để fluent-ffmpeg và các thư viện khác tự tìm
  BASHRC="$HOME/.bashrc"
  grep -q "FFMPEG_PATH" "$BASHRC" 2>/dev/null && \
    sed -i '/FFMPEG_PATH/d' "$BASHRC"
  echo "export FFMPEG_PATH='$SYSTEM_FFMPEG'" >> "$BASHRC"

  SYSTEM_FFPROBE=$(command -v ffprobe 2>/dev/null || echo "")
  if [ -n "$SYSTEM_FFPROBE" ]; then
    grep -q "FFPROBE_PATH" "$BASHRC" 2>/dev/null && \
      sed -i '/FFPROBE_PATH/d' "$BASHRC"
    echo "export FFPROBE_PATH='$SYSTEM_FFPROBE'" >> "$BASHRC"
    log_ok "FFPROBE_PATH=$SYSTEM_FFPROBE → đã ghi vào ~/.bashrc"
  fi

  log_ok "FFMPEG_PATH=$SYSTEM_FFMPEG → đã ghi vào ~/.bashrc"
}

# ════════════════════════════════════════════════════════════
#  10. Kiểm tra & tạo file cấu hình
# ════════════════════════════════════════════════════════════
check_config() {
  log_section "Kiểm tra file cấu hình"

  # config.json
  if [ -f "config.json" ]; then
    if node -e "JSON.parse(require('fs').readFileSync('config.json','utf8'))" 2>/dev/null; then
      log_ok "config.json hợp lệ."
    else
      log_error "config.json bị lỗi cú pháp JSON! Kiểm tra lại file."
    fi
  elif [ -f "config.example.json" ]; then
    cp config.example.json config.json
    log_warn "Đã tạo config.json từ mẫu — hãy điền thông tin vào file này!"
  else
    log_error "Không có config.json. Bot sẽ không chạy!"
  fi

  # cookie.json
  if [ -f "cookie.json" ]; then
    if node -e "JSON.parse(require('fs').readFileSync('cookie.json','utf8'))" 2>/dev/null; then
      log_ok "cookie.json hợp lệ."
    else
      log_warn "cookie.json có thể bị lỗi định dạng."
    fi
  else
    log_warn "Chưa có cookie.json — cần export cookie Zalo rồi đặt vào đây."
  fi
}

# ════════════════════════════════════════════════════════════
#  11. Cài tmux (giữ bot chạy khi tắt Termux)
# ════════════════════════════════════════════════════════════
setup_keepalive() {
  log_section "Cài tiện ích giữ bot sống (tmux)"

  if command -v tmux &>/dev/null; then
    log_ok "tmux đã cài."
  else
    log_info "Cài tmux..."
    pkg install -y tmux 2>/dev/null && log_ok "tmux đã cài." || \
      log_warn "tmux không cài được — bot sẽ dừng khi đóng Termux."
  fi

  # Kích hoạt wake-lock nếu có termux-api
  if command -v termux-wake-lock &>/dev/null; then
    termux-wake-lock 2>/dev/null && log_ok "Wake-lock đã bật — Android sẽ không sleep Termux." || true
  else
    log_warn "termux-api chưa cài — cài Termux:API app rồi: pkg install termux-api"
  fi
}

# ════════════════════════════════════════════════════════════
#  Tổng kết
# ════════════════════════════════════════════════════════════
summary() {
  echo ""
  echo -e "${BOLD}${CYAN}══════════════════════════════════════════════${NC}"
  printf "  ${GREEN}✔ OK: %-3s${NC}  ${YELLOW}! Warn: %-3s${NC}  ${RED}✘ Lỗi: %-3s${NC}\n" $_ok $_warn $_fail
  echo -e "${BOLD}${CYAN}══════════════════════════════════════════════${NC}"

  if [ "$_fail" -gt 0 ]; then
    echo -e "\n  ${RED}${BOLD}Có $_fail lỗi cần xử lý trước khi chạy bot!${NC}"
  fi

  echo ""
  echo -e "  ${BOLD}Bước tiếp theo:${NC}"
  echo -e "  1. Sửa ${YELLOW}config.json${NC}  — điền cookie path, IMEI, ownerId, Groq/Gemini token..."
  echo -e "  2. Đảm bảo ${YELLOW}cookie.json${NC} có cookie Zalo hợp lệ"
  echo -e "  3. Áp dụng biến môi trường:"
  echo -e "     ${GREEN}source ~/.bashrc${NC}"
  echo -e "  4. Chạy bot (trong tmux để không bị kill khi tắt màn hình):"
  echo -e "     ${GREEN}tmux new -s mizai${NC}"
  echo -e "     ${GREEN}npm start${NC}"
  echo -e "     ${DIM}(Ctrl+B → D để thoát tmux, bot vẫn chạy nền)${NC}"
  echo ""
  echo -e "  ${BOLD}Giữ bot chạy liên tục trên Android:${NC}"
  echo -e "  ${DIM}• Cài Termux:API app → pkg install termux-api → termux-wake-lock${NC}"
  echo -e "  ${DIM}• Bật 'Acquire WakeLock' trong notification bar của Termux${NC}"
  echo -e "  ${DIM}• Tắt tối ưu pin cho app Termux trong cài đặt Android${NC}"
  echo ""
  echo -e "  ${DIM}Lệnh khác:${NC}"
  echo -e "  ${DIM}npm run dev        — chạy + auto-reload${NC}"
  echo -e "  ${DIM}npm run list-cmds  — xem tất cả lệnh${NC}"
  echo -e "  ${DIM}npm run backup     — backup dữ liệu lên GitHub${NC}"
  echo -e "  ${DIM}tmux attach -t mizai — mở lại session bot${NC}"
  echo ""
}

# ══════════════════════════════════════════════════════════════
#  MAIN — Chạy theo thứ tự
# ══════════════════════════════════════════════════════════════
banner
check_env
install_system
check_node
setup_build_env
install_npm
rebuild_sqlite
rebuild_canvas
rebuild_sharp
patch_ffmpeg_static   # ← bước này fix lỗi ffmpeg-static trên ARM
check_config
setup_keepalive
summary

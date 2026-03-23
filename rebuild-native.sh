#!/data/data/com.termux/files/usr/bin/bash

# ════════════════════════════════════════════════════════════
#  rebuild-native.sh — Rebuild canvas / sharp / better-sqlite3
#  Dành cho Termux ARM (arm64-v8a / armeabi-v7a)
#  Chạy: bash rebuild-native.sh
# ════════════════════════════════════════════════════════════

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

ok()   { echo -e "  ${GREEN}✔${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
err()  { echo -e "  ${RED}✘${NC} $1"; }
info() { echo -e "  ${CYAN}·${NC} $1"; }
sec()  { echo -e "\n${BOLD}${CYAN}▸ $1${NC}"; }

echo -e "\n${BOLD}${CYAN}  MIZAI — Rebuild Native Modules (Termux)${NC}"
echo -e "  ${DIM}$(uname -m) | $(node --version 2>/dev/null || echo 'node?')${NC}\n"

# ── 0. Cài nvm & hạ Node.js xuống v20 LTS ────────────────────────────────────
sec "Kiểm tra phiên bản Node.js"

NODE_VER=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])" 2>/dev/null || echo 0)

# Load nvm nếu đã cài
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh" 2>/dev/null

if [ "$NODE_VER" -gt 20 ] || [ "$NODE_VER" -eq 0 ]; then
  warn "Node.js hiện tại: v$(node --version 2>/dev/null || echo '?') — canvas/sharp cần Node 20 LTS"
  info "Đang cài nvm để quản lý phiên bản Node..."

  # Cài nvm
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash 2>/dev/null
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
  fi

  if command -v nvm &>/dev/null; then
    info "Đang cài Node.js v20 LTS (có thể mất vài phút)..."
    nvm install 20 2>&1 | tail -5
    nvm use 20
    nvm alias default 20

    # Ghi vào .bashrc để tự load mỗi lần mở Termux
    BASHRC="$HOME/.bashrc"
    grep -q "NVM_DIR" "$BASHRC" 2>/dev/null || cat >> "$BASHRC" <<'NVMEOF'

# nvm — Node Version Manager
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
NVMEOF
    ok "Node.js đã chuyển sang: $(node --version)"
  else
    warn "nvm không cài được — thử dùng pkg..."
    pkg install -y nodejs-lts 2>/dev/null
    ok "Node.js: $(node --version 2>/dev/null || echo 'lỗi')"
  fi
else
  ok "Node.js v$(node --version) OK (≤ v20)"
fi

# Cập nhật NODE_VER sau khi đổi
NODE_VER=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])" 2>/dev/null || echo 0)

# ── 0b. Kiểm tra node_modules ─────────────────────────────────────────────────
if [ ! -d node_modules ]; then
  info "Chưa có node_modules — đang cài..."
  npm install --ignore-scripts 2>&1 | tail -3
fi

# ── 1. Cài gói hệ thống cần thiết ────────────────────────────────────────────
sec "Cài gói hệ thống (nếu thiếu)"
for p in clang make pkg-config python cairo pango giflib librsvg libjpeg-turbo libpng libvips; do
  dpkg -s "$p" &>/dev/null || pkg install -y "$p" 2>/dev/null && true
done
ok "Gói hệ thống OK"

# ── 1b. Cài node-gyp (bắt buộc để build native modules) ─────────────────────
sec "Cài node-gyp"
if ! command -v node-gyp &>/dev/null; then
  info "Đang cài node-gyp toàn cục..."
  npm install -g node-gyp 2>&1 | tail -3
  command -v node-gyp &>/dev/null && ok "node-gyp đã cài." || { err "node-gyp cài thất bại!"; exit 1; }
else
  ok "node-gyp đã có: $(node-gyp --version)"
fi
npm config set node_gyp "$(which node-gyp)" 2>/dev/null

# ── 2. Set biến môi trường ────────────────────────────────────────────────────
sec "Cấu hình build environment"

export CC=clang
export CXX=clang++
export PYTHON=$(command -v python3 || command -v python)
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig:$PREFIX/share/pkgconfig"
export LD_LIBRARY_PATH="$PREFIX/lib:${LD_LIBRARY_PATH:-}"
export C_INCLUDE_PATH="$PREFIX/include"
export CPLUS_INCLUDE_PATH="$PREFIX/include"
export LIBRARY_PATH="$PREFIX/lib"
export CFLAGS="-O2"
export CXXFLAGS="-O2"
export MAKEFLAGS="-j$(nproc 2>/dev/null || echo 2)"

npm config set python "$PYTHON" 2>/dev/null
ok "CC=$CC | PYTHON=$PYTHON | jobs=$(nproc 2>/dev/null || echo 2)"

# ── Hàm check module ─────────────────────────────────────────────────────────
check_module() {
  node -e "require('$1')" 2>/dev/null
}

# ── 3. Rebuild better-sqlite3 ─────────────────────────────────────────────────
sec "Rebuild better-sqlite3"
if check_module better-sqlite3; then
  ok "better-sqlite3 hoạt động — bỏ qua."
else
  info "Đang rebuild better-sqlite3 từ source..."
  npm rebuild better-sqlite3 --build-from-source 2>&1 | tail -8
  if check_module better-sqlite3; then
    ok "better-sqlite3 OK!"
  else
    warn "better-sqlite3 vẫn lỗi — bot tiếp tục dùng sql.js fallback."
  fi
fi

# ── 4. Rebuild canvas ─────────────────────────────────────────────────────────
sec "Rebuild canvas"
if check_module canvas; then
  ok "canvas hoạt động — bỏ qua."
else
  info "Đang rebuild canvas từ source..."
  npm rebuild canvas \
    --build-from-source \
    --canvas_jpeg_include_dir="$PREFIX/include" \
    --canvas_jpeg_lib_dir="$PREFIX/lib" \
    2>&1 | tail -10

  if check_module canvas; then
    ok "canvas OK! Lệnh tạo ảnh đã hoạt động."
  else
    warn "canvas thất bại — thử thêm cờ..."
    CPPFLAGS="-I$PREFIX/include" \
    LDFLAGS="-L$PREFIX/lib" \
    npm rebuild canvas \
      --build-from-source \
      --canvas_jpeg_include_dir="$PREFIX/include" \
      --canvas_jpeg_lib_dir="$PREFIX/lib" \
      2>&1 | tail -10

    if check_module canvas; then
      ok "canvas OK (lần 2)!"
    else
      err "canvas rebuild thất bại. Lệnh card ảnh sẽ bị tắt — bot vẫn chạy bình thường."
    fi
  fi
fi

# ── 5. Rebuild sharp ──────────────────────────────────────────────────────────
sec "Rebuild sharp"
if check_module sharp; then
  ok "sharp hoạt động — bỏ qua."
else
  info "Đang rebuild sharp (dùng system libvips)..."
  SHARP_IGNORE_GLOBAL_LIBVIPS=0 \
  npm rebuild sharp --build-from-source 2>&1 | tail -10

  if check_module sharp; then
    ok "sharp OK!"
  else
    warn "sharp thất bại — thử buộc dùng libvips từ Termux..."
    SHARP_IGNORE_GLOBAL_LIBVIPS=0 \
    SHARP_LIBVIPS_VERSION=$(pkg show libvips 2>/dev/null | grep Version | awk '{print $2}' | cut -d- -f1) \
    CPPFLAGS="-I$PREFIX/include" \
    LDFLAGS="-L$PREFIX/lib -lvips" \
    npm rebuild sharp --build-from-source 2>&1 | tail -10

    if check_module sharp; then
      ok "sharp OK (lần 2)!"
    else
      err "sharp rebuild thất bại. QR terminal display sẽ bị tắt — bot vẫn chạy bình thường."
    fi
  fi
fi

# ── Tổng kết ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════════${NC}"
echo -e "  Kết quả:"
check_module better-sqlite3 && echo -e "  ${GREEN}✔ better-sqlite3${NC}" || echo -e "  ${YELLOW}· better-sqlite3${NC} (dùng sql.js fallback)"
check_module canvas         && echo -e "  ${GREEN}✔ canvas${NC}"         || echo -e "  ${YELLOW}· canvas${NC} (lệnh ảnh bị tắt)"
check_module sharp          && echo -e "  ${GREEN}✔ sharp${NC}"          || echo -e "  ${YELLOW}· sharp${NC} (QR terminal bị tắt)"
echo -e "${BOLD}${CYAN}══════════════════════════════════════════${NC}"
echo ""
echo -e "  Restart bot: ${CYAN}npm start${NC}"
echo ""

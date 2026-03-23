#!/bin/bash

# ════════════════════════════════════════════════════════════
#  git-clean.sh — Xóa các file nhạy cảm khỏi git tracking
#
#  Chạy script này MỘT LẦN trên máy bạn để:
#  - Untrack config.json, cookie.json, database, runtime data
#  - Giữ nguyên file local (không xóa khỏi ổ cứng)
#  - Sau đó commit + push lên GitHub là xong
#
#  Cách dùng:
#    chmod +x git-clean.sh
#    bash git-clean.sh
# ════════════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}${CYAN}▸ Dọn dẹp git tracking — file nhạy cảm & runtime data${NC}\n"

untrack() {
  if git ls-files --error-unmatch "$1" &>/dev/null 2>&1; then
    git rm --cached -r "$1" 2>/dev/null && \
      echo -e "  ${GREEN}✔ Untracked:${NC} $1" || \
      echo -e "  ${RED}✘ Lỗi:${NC} $1"
  else
    echo -e "  ${YELLOW}· Bỏ qua (chưa track):${NC} $1"
  fi
}

# Sensitive files
untrack config.json
untrack cookie.json
untrack qr.png

# Database
untrack includes/database/core/data/

# Cache
untrack includes/cache/

# Runtime data
untrack includes/data/runtime/
untrack includes/data/game/taixiu/betHistory/
untrack includes/data/game/taixiu/lichsuGD/
untrack includes/data/game/taixiu/money.json
untrack includes/data/game/taixiu/phien.json
untrack includes/database/groupsCache.json

# Config có dữ liệu nhóm cụ thể
untrack includes/data/config/anti.json
untrack includes/data/config/auto.json
untrack includes/data/config/muted.json
untrack includes/data/config/tuongtac.json

# Replit-specific
untrack .replit
untrack .replitignore
untrack .npmrc
untrack .canvas/
untrack attached_assets/

echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════════${NC}"
echo -e "  ${GREEN}Xong! Bước tiếp theo:${NC}"
echo ""
echo -e "  1. Kiểm tra lại:"
echo -e "     ${CYAN}git status${NC}"
echo ""
echo -e "  2. Commit:"
echo -e "     ${CYAN}git add -A${NC}"
echo -e "     ${CYAN}git commit -m 'chore: remove tracked sensitive files'${NC}"
echo ""
echo -e "  3. Push lên GitHub:"
echo -e "     ${CYAN}git push origin main${NC}"
echo -e "${BOLD}${CYAN}══════════════════════════════════════════${NC}"

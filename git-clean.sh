#!/bin/bash

# ════════════════════════════════════════════════════════════
#  git-clean.sh — Dọn file cũ & push lên GitHub MIZAI_BOT
#
#  Cách dùng trên Termux:
#    chmod +x git-clean.sh
#    bash git-clean.sh
# ════════════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}${CYAN}▸ Bắt đầu dọn dẹp & upload lên GitHub${NC}\n"

# ── 1. Nhập thông tin GitHub ────────────────────────────────
read -p "GitHub username của bạn: " GH_USER
read -p "Tên repo (VD: MIZAI_BOT): " GH_REPO
read -sp "GitHub Token (ghp_...): " GH_TOKEN
echo ""

if [[ -z "$GH_USER" || -z "$GH_REPO" || -z "$GH_TOKEN" ]]; then
  echo -e "${RED}✘ Thiếu thông tin. Thoát.${NC}"
  exit 1
fi

REMOTE_URL="https://${GH_TOKEN}@github.com/${GH_USER}/${GH_REPO}.git"

# ── 2. Untrack file nhạy cảm & Replit-specific ─────────────
echo -e "\n${CYAN}▸ Bước 1: Untrack file không cần upload...${NC}"

untrack() {
  if git ls-files --error-unmatch "$1" &>/dev/null 2>&1; then
    git rm --cached -r "$1" 2>/dev/null && \
      echo -e "  ${GREEN}✔ Untracked:${NC} $1" || \
      echo -e "  ${RED}✘ Lỗi:${NC} $1"
  else
    echo -e "  ${YELLOW}· Bỏ qua:${NC} $1"
  fi
}

untrack config.json
untrack cookie.json
untrack qr.png
untrack pnpm-lock.yaml
untrack .replit
untrack .replitignore
untrack .npmrc
untrack .canvas/
untrack attached_assets/
untrack .agents/
untrack includes/database/core/data/
untrack includes/cache/
untrack includes/data/runtime/
untrack includes/data/game/taixiu/betHistory/
untrack includes/data/game/taixiu/lichsuGD/
untrack includes/data/game/taixiu/money.json
untrack includes/data/game/taixiu/phien.json
untrack includes/database/groupsCache.json
untrack includes/data/config/anti.json
untrack includes/data/config/auto.json
untrack includes/data/config/muted.json
untrack includes/data/config/tuongtac.json

# ── 3. Thiết lập git ────────────────────────────────────────
echo -e "\n${CYAN}▸ Bước 2: Cấu hình git...${NC}"

git config user.email "bot@mizai.local" 2>/dev/null
git config user.name "MIZAI_BOT" 2>/dev/null

# Xoá remote cũ nếu có, thêm remote mới
git remote remove origin 2>/dev/null
git remote add origin "$REMOTE_URL"
echo -e "  ${GREEN}✔ Remote:${NC} https://github.com/${GH_USER}/${GH_REPO}.git"

# ── 4. Commit & push ────────────────────────────────────────
echo -e "\n${CYAN}▸ Bước 3: Commit & push...${NC}"

git add -A
git commit -m "chore: upload MIZAI_BOT $(date '+%Y-%m-%d %H:%M')" 2>/dev/null || \
  echo -e "  ${YELLOW}· Không có gì mới để commit${NC}"

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
echo -e "  ${CYAN}Đang push branch '${BRANCH}' lên GitHub...${NC}"
if git push -u origin "$BRANCH" --force 2>&1; then
  echo -e "\n${BOLD}${GREEN}✔ Upload thành công!${NC}"
  echo -e "  Link: ${CYAN}https://github.com/${GH_USER}/${GH_REPO}${NC}"
else
  echo -e "\n${RED}✘ Push thất bại.${NC}"
  echo -e "  Kiểm tra lại token và tên repo."
  echo -e "  Nếu repo chưa tồn tại, tạo trước tại: ${CYAN}https://github.com/new${NC}"
fi

# ── 5. Xoá token khỏi remote (bảo mật) ─────────────────────
git remote set-url origin "https://github.com/${GH_USER}/${GH_REPO}.git" 2>/dev/null

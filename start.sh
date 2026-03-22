#!/bin/bash

cd /home/container

export NODE_OPTIONS="--max-old-space-size=384 --gc-interval=100"

echo "[START] Kiểm tra better-sqlite3..."
node -e "require('better-sqlite3')" 2>/dev/null
if [ $? -ne 0 ]; then
  echo "[START] Rebuilding better-sqlite3 cho Node $(node -v)..."
  npm rebuild better-sqlite3 --update-binary 2>/dev/null || \
  npm install better-sqlite3 --build-from-source 2>/dev/null || \
  echo "[START] Rebuild thất bại, sẽ dùng sql.js fallback."
fi

echo "[START] Khởi động MIZAI_BOT..."
exec node /home/container/index.js

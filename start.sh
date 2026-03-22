#!/bin/bash

cd /home/container

export NODE_OPTIONS="--max-old-space-size=384 --gc-interval=100"

echo "[START] Khởi động MIZAI_BOT..."
exec node /home/container/index.js

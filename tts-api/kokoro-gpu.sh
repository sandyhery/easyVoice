#!/bin/bash
# 启动 Kokoro TTS（GPU 版）
# 用法：./kokoro-gpu.sh
docker run -d \
  --gpus all \
  --restart unless-stopped \
  --name kokoro-api \
  -p 8880:8880 \
  ghcr.io/remsky/kokoro-fastapi-cpu:v0.2.3pre

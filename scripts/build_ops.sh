#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATIC_DEPLOY_DIR="${STATIC_DEPLOY_DIR:-}"

cd "${ROOT_DIR}/web-app"
npm run build:ops

if [ -n "${STATIC_DEPLOY_DIR}" ]; then
  if [ ! -d "${STATIC_DEPLOY_DIR}" ]; then
    echo "static deploy dir does not exist: ${STATIC_DEPLOY_DIR}" >&2
    exit 1
  fi
  cp -f dist/index.html "${STATIC_DEPLOY_DIR}/"
  rm -rf "${STATIC_DEPLOY_DIR}/assets"
  mkdir -p "${STATIC_DEPLOY_DIR}/assets"
  cp -rf dist/assets/. "${STATIC_DEPLOY_DIR}/assets/"
  if [ -f dist/wechat-receive-qrcode.jpg ]; then
    cp -f dist/wechat-receive-qrcode.jpg "${STATIC_DEPLOY_DIR}/"
  fi
  if [ -f dist/henu-kit-qq-group.png ]; then
    cp -f dist/henu-kit-qq-group.png "${STATIC_DEPLOY_DIR}/"
  fi
  chmod 644 "${STATIC_DEPLOY_DIR}/wechat-receive-qrcode.jpg" 2>/dev/null || true
  chmod 644 "${STATIC_DEPLOY_DIR}/henu-kit-qq-group.png" 2>/dev/null || true
fi

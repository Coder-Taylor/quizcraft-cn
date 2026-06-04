#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

DOCX_PATH="${DOCX_PATH:-/Users/jerry/Desktop/2026新华三杯大赛预赛第一阶段模拟题（团队赛） .docx}"
BANK_NAME="${BANK_NAME:-2026新华三杯大赛网络安全赛道模拟题（团队赛）}"
BANK_KEY="${BANK_KEY:-h3c_2026_team_mock}"
REMOTE_HOST="${REMOTE_HOST:-root@8.146.200.82}"
REMOTE_DIR="${REMOTE_DIR:-/root/quizcraft-cn}"
REMOTE_BACKEND_PORT="${REMOTE_BACKEND_PORT:-10086}"
LOCAL_JSON_PATH="${LOCAL_JSON_PATH:-${PROJECT_ROOT}/tiku/${BANK_KEY}.json}"

echo "==> 生成题库 JSON"
python3 "${SCRIPT_DIR}/import_docx_bank.py" \
  --input "${DOCX_PATH}" \
  --name "${BANK_NAME}" \
  --key "${BANK_KEY}" \
  --output "${LOCAL_JSON_PATH}"

echo "==> 本地语法检查"
python3 -m py_compile server.py

echo "==> 同步后端与题库到 ${REMOTE_HOST}:${REMOTE_DIR}"
scp server.py "${REMOTE_HOST}:${REMOTE_DIR}/server.py"
scp "${LOCAL_JSON_PATH}" "${REMOTE_HOST}:${REMOTE_DIR}/tiku/${BANK_KEY}.json"

echo "==> 远端最小化重启后端"
ssh "${REMOTE_HOST}" "cd '${REMOTE_DIR}' && \
  PID=\$(lsof -tiTCP:${REMOTE_BACKEND_PORT} -sTCP:LISTEN | head -n1 || true) && \
  if [ -n \"\$PID\" ]; then kill \"\$PID\"; sleep 1; fi && \
  nohup ./.venv/bin/python server.py > server.log 2>&1 < /dev/null & \
  disown || true"

echo "==> 等待后端恢复"
for _ in $(seq 1 30); do
  if ssh "${REMOTE_HOST}" "curl -fsS http://127.0.0.1:${REMOTE_BACKEND_PORT}/api/banks" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "==> 校验新题库已加载"
ssh "${REMOTE_HOST}" "curl -fsS http://127.0.0.1:${REMOTE_BACKEND_PORT}/api/banks" | \
  python3 -c "import json,sys; data=json.load(sys.stdin); key='${BANK_KEY}'; assert any(item.get('key')==key for item in data.get('banks', [])), f'missing bank: {key}'; print('loaded', key)"

echo "==> 完成"

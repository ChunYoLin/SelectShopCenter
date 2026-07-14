#!/usr/bin/env bash
# Wrapper for cron — 每日重跑所有選品店爬蟲，讓 DB 資料保持新鮮。
# 由 crontab 每天觸發 (見 README「自動更新」)。

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${BACKEND_DIR}/logs"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/daily-scrape-$(date +%Y%m%d).log"

# 讀取 .env (DATABASE_URL 等)
set -a
# shellcheck disable=SC1091
[ -f "${BACKEND_DIR}/.env" ] && . "${BACKEND_DIR}/.env"
set +a

# 讓 cron 的精簡 PATH 找得到 node / npm (nvm 安裝路徑)
export PATH="/usr/local/bin:/usr/bin:/bin:${HOME}/.nvm/versions/node/$(ls -t "${HOME}/.nvm/versions/node" 2>/dev/null | head -1)/bin:${PATH}"

cd "${BACKEND_DIR}"
{
  echo "===== $(date -Is) scrape:all 開始 ====="
  # scrape:all 會依 registry 逐店爬取；npm script 內已設好 ARKnets 需要的 LD_LIBRARY_PATH
  if npm run scrape:all; then
    echo "===== $(date -Is) 完成 ====="
  else
    echo "===== $(date -Is) 失敗 (exit $?) ====="
    exit 1
  fi
} >>"${LOG_FILE}" 2>&1

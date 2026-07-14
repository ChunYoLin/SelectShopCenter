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

# 讓 cron 的精簡 PATH 找得到 node / npm。
# nvm 路徑必須擺「最前面」— 系統 /usr/bin/node 是舊版 (v18)，會導致 undici fetch 報錯，
# 必須優先用 nvm 的新版 node。
NVM_BIN="${HOME}/.nvm/versions/node/$(ls -t "${HOME}/.nvm/versions/node" 2>/dev/null | head -1)/bin"
export PATH="${NVM_BIN}:/usr/local/bin:/usr/bin:/bin:${PATH}"

cd "${BACKEND_DIR}"
{
  echo "===== $(date -Is) scrape:all 開始 ====="
  # scrape:all 會依 registry 逐店爬取；npm script 內已設好 ARKnets 需要的 LD_LIBRARY_PATH
  set +e
  npm run scrape:all
  rc=$?
  set -e
  if [ "${rc}" -eq 0 ]; then
    echo "===== $(date -Is) 完成 ====="
  else
    echo "===== $(date -Is) 失敗 (exit ${rc}) ====="
    exit 1
  fi
} >>"${LOG_FILE}" 2>&1

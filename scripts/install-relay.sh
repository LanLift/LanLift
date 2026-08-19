#!/usr/bin/env bash
# LanLift 公網中繼伺服器安裝腳本（Ubuntu 22.04+ / Kali Rolling）
# 部署到具有公網 IP 的 VPS：sudo bash scripts/install-relay.sh
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "請以 root 執行：sudo bash scripts/install-relay.sh" >&2
  exit 1
fi

if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
fi
case "${ID:-}" in
  ubuntu|kali|debian) : ;;
  *) echo "僅支援 Ubuntu、Kali 與 Debian（目前：${ID:-未知}）。" >&2; exit 1 ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends ca-certificates curl unzip ufw

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
else
  NODE_MAJOR=0
fi
if [[ "${NODE_MAJOR}" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

INSTALL_DIR="/opt/lanlift-relay"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "${INSTALL_DIR}"
rsync -a --delete --exclude node_modules --exclude release --exclude .git "${REPO_DIR}/" "${INSTALL_DIR}/" 2>/dev/null \
  || cp -a "${REPO_DIR}/." "${INSTALL_DIR}/"

cd "${INSTALL_DIR}"
corepack enable pnpm 2>/dev/null || npm install -g pnpm
pnpm install --frozen-lockfile --ignore-scripts=false 2>/dev/null || pnpm install

# ---- 設定檔 ----
RELAY_PORT="${RELAY_PORT:-8443}"
RELAY_TOKEN="${RELAY_TOKEN:-}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
mkdir -p /etc/lanlift
if [[ ! -f /etc/lanlift/relay.json ]]; then
  cat > /etc/lanlift/relay.json <<EOF
{
  "port": ${RELAY_PORT},
  "host": "0.0.0.0",
  "serverToken": ${RELAY_TOKEN:+'"'"${RELAY_TOKEN}"'"' :-null},
  "adminToken": ${ADMIN_TOKEN:+'"'"${ADMIN_TOKEN}"'"' :-null},
  "limits": {
    "bytesPerSecond": 2097152,
    "burstFactor": 3,
    "maxChunkBytes": 262144,
    "maxSessionBytes": 214748364800
  }
}
EOF
fi
echo "中繼設定檔：/etc/lanlift/relay.json（請自行填入 TLS 憑證路徑）"

SERVICE_USER="${LANLIFT_USER:-lanlift}"
if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/lanlift --create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
fi
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"

cat > /etc/lanlift-relay.env <<EOF
LANLIFT_PORT=${RELAY_PORT}
LANLIFT_SERVER_TOKEN=${RELAY_TOKEN}
EOF
install -m 0644 "${INSTALL_DIR}/scripts/lanlift-relay.service" /etc/systemd/system/lanlift-relay.service
systemctl daemon-reload
systemctl enable lanlift-relay.service
systemctl restart lanlift-relay.service

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow "${RELAY_PORT}/tcp" comment "LanLift public relay"
fi

echo
echo "=============================="
echo "LanLift 中繼伺服器安裝完成。"
echo "  訊號網址：  wss://<你的網域或 IP>:${RELAY_PORT}/ws"
echo "  遠端頁面：  https://<你的網域或 IP>:${RELAY_PORT}/"
echo "  服務狀態：  systemctl status lanlift-relay"
echo "=============================="
echo "生產環境請務必在 /etc/lanlift/relay.json 設定 TLS 憑證（fullchain/privkey）。"

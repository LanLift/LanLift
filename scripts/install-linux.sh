#!/usr/bin/env bash
# LanLift Linux 主機安裝腳本（Ubuntu 22.04+ / Kali Rolling）
# 以 root 執行：sudo bash scripts/install-linux.sh
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "請以 root 執行：sudo bash scripts/install-linux.sh" >&2
  exit 1
fi

# ---- 1. 發行版偵測（Ubuntu 與 Kali 皆為 Debian 系） ----
if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
else
  echo "無法讀取 /etc/os-release，僅支援 Ubuntu 與 Kali Linux。" >&2
  exit 1
fi

case "${ID:-}" in
  ubuntu)
    if [[ "${VERSION_ID:-0}" < "22.04" ]]; then
      echo "需要 Ubuntu 22.04 或更新版本（目前：${VERSION_ID:-未知}）。" >&2
      exit 1
    fi
    DISTRO="Ubuntu ${VERSION_ID:-}"
    ;;
  kali)
    DISTRO="Kali Linux ${VERSION:-}"
    ;;
  *)
    echo "僅支援 Ubuntu 22.04+ 與 Kali Linux（目前：${ID:-未知}）。" >&2
    exit 1
    ;;
esac
echo "偵測到發行版：${DISTRO}"

# ---- 2. 系統依賴 ----
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends ca-certificates curl unzip ufw

# ---- 3. Node.js 22+（Kali 收錄的 nodejs 版本不一，統一使用 NodeSource） ----
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
else
  NODE_MAJOR=0
fi
if [[ "${NODE_MAJOR}" -lt 22 ]]; then
  echo "安裝 Node.js 22（NodeSource）…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node --version

# ---- 4. 部署程式到 /opt/lanlift ----
INSTALL_DIR="/opt/lanlift"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "${INSTALL_DIR}"
rsync -a --delete --exclude node_modules --exclude release --exclude .git "${REPO_DIR}/" "${INSTALL_DIR}/" 2>/dev/null \
  || cp -a "${REPO_DIR}/." "${INSTALL_DIR}/"

# ---- 5. 依賴（pnpm 由 corepack 提供） ----
cd "${INSTALL_DIR}"
corepack enable pnpm 2>/dev/null || npm install -g pnpm
pnpm install --frozen-lockfile --ignore-scripts=false 2>/dev/null || pnpm install

# ---- 6. 執行使用者與目錄 ----
SERVICE_USER="${LANLIFT_USER:-lanlift}"
if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/lanlift --create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
fi
RECEIVE_DIR="${LANLIFT_RECEIVE_DIR:-/var/lib/lanlift/downloads}"
mkdir -p "${RECEIVE_DIR}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}" "${RECEIVE_DIR}"

# ---- 7. systemd 服務 ----
cat > /etc/lanlift.env <<EOF
LANLIFT_PORT=${LANLIFT_PORT:-8899}
LANLIFT_HOST=${LANLIFT_HOST:-0.0.0.0}
LANLIFT_RECEIVE_DIR=${RECEIVE_DIR}
LANLIFT_ADMIN_TOKEN=${LANLIFT_ADMIN_TOKEN:-}
EOF
install -m 0644 "${INSTALL_DIR}/scripts/lanlift.service" /etc/systemd/system/lanlift.service
systemctl daemon-reload
systemctl enable lanlift.service
systemctl restart lanlift.service

# ---- 8. 防火牆提示 ----
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow "${LANLIFT_PORT:-8899}/tcp" comment "LanLift LAN transfer"
fi

echo
echo "=============================="
echo "LanLift 安裝完成。"
echo "  管理頁面：  http://127.0.0.1:${LANLIFT_PORT:-8899}/admin"
echo "  接收資料夾：${RECEIVE_DIR}"
echo "  服務狀態：  systemctl status lanlift"
echo "  檢視記錄：  journalctl -u lanlift -f"
echo "  解除安裝：  sudo bash ${INSTALL_DIR}/scripts/uninstall-linux.sh"
echo "=============================="

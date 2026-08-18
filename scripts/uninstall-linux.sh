#!/usr/bin/env bash
# LanLift Linux 主機解除安裝腳本
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "請以 root 執行：sudo bash scripts/uninstall-linux.sh" >&2
  exit 1
fi

systemctl disable lanlift.service 2>/dev/null || true
systemctl stop lanlift.service 2>/dev/null || true
rm -f /etc/systemd/system/lanlift.service
rm -f /etc/lanlift.env
systemctl daemon-reload
rm -rf /opt/lanlift

echo "LanLift 已解除安裝（使用者檔案保留於 /var/lib/lanlift）。"

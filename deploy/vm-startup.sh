#!/usr/bin/env bash
# Runs once on first boot of the CineXchange VM (passed as metadata startup-script).
# Installs Docker + the compose plugin. Nothing app-specific: the code and .env
# arrive afterwards over scp, so this script stays cacheable and re-runnable.
set -euxo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# So the ssh user can drive docker without sudo on every command.
for u in $(ls /home); do usermod -aG docker "$u" || true; done

systemctl enable --now docker
mkdir -p /opt/cinexchange
chmod 0777 /opt/cinexchange

touch /var/log/cinex-startup-done

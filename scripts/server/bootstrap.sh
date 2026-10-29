#!/usr/bin/env bash
# Run once as root on the dedicated WMS VPS after verifying the SSH host key.
# Inputs are PUBLIC keys only. This script never deploys WMS or changes DNS.
set -euo pipefail
umask 077
if [[ ${EUID} != 0 || $# != 2 ]]; then
  echo "Usage (root): bootstrap.sh OPERATOR_PUBLIC_KEY_FILE CI_PUBLIC_KEY_FILE" >&2
  exit 1
fi
operator_key_file=$1
ci_key_file=$2
for key_file in "$operator_key_file" "$ci_key_file"; do
  test -f "$key_file" && ! test -L "$key_file"
  ssh-keygen -lf "$key_file" >/dev/null
  test "$(awk '{print $1}' "$key_file")" = ssh-ed25519
  test "$(wc -l < "$key_file")" -eq 1
  test "$(awk '{print $2}' "$key_file" | tr -d 'A-Za-z0-9+/=')" = ""
done
if [[ $(awk '{print $2}' "$operator_key_file") == $(awk '{print $2}' "$ci_key_file") ]]; then
  echo "Operator and CI must have distinct SSH keys." >&2
  exit 1
fi
. /etc/os-release
if [[ ${ID} != ubuntu || ${VERSION_ID} != 26.04 || $(uname -m) != x86_64 ]]; then
  echo "This bootstrap targets the inspected Ubuntu 26.04 amd64 WMS VPS only." >&2
  exit 1
fi
if command -v docker >/dev/null; then
  if ! existing_containers=$(docker ps -aq); then
    echo "Cannot inspect existing Docker daemon; inspect manually." >&2
    exit 1
  fi
  if [[ -n $existing_containers ]]; then
    echo "Refusing bootstrap on a host with existing containers; inspect manually." >&2
    exit 1
  fi
fi
for package in docker.io docker-compose docker-compose-v2 podman-docker containerd runc docker-buildx docker-doc; do
  if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
    echo "Conflicting Docker package exists; inspect manually: $package" >&2
    exit 1
  fi
done
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg xz-utils openssh-client
install -d -m 0755 /etc/apt/keyrings
if [[ ! -e /etc/apt/keyrings/docker.asc ]]; then
  curl --proto '=https' --tlsv1.2 -fsS https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod 0644 /etc/apt/keyrings/docker.asc
fi
repo_text="Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc"
if [[ -e /etc/apt/sources.list.d/docker.sources ]]; then
  if [[ $(cat /etc/apt/sources.list.d/docker.sources) != "$repo_text" ]]; then
    echo "Existing Docker repository differs; inspect manually." >&2
    exit 1
  fi
else
  printf '%s\n' "$repo_text" > /etc/apt/sources.list.d/docker.sources
  chmod 0644 /etc/apt/sources.list.d/docker.sources
fi
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
# Host Node is used only by operational CLI scripts. All app builds run in CI.
if ! command -v node >/dev/null || [[ $(node -p 'process.versions.node.split(".")[0]') != 24 ]]; then
  if command -v node >/dev/null; then
    echo "Existing host Node is not 24; inspect before changing it." >&2
    exit 1
  fi
  node_tmp=$(mktemp -d)
  trap 'rm -rf "$node_tmp"' EXIT
  curl --proto '=https' --tlsv1.2 -fsS https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$node_tmp/SHASUMS256.txt"
  node_archive=$(awk '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$/ {print $2}' "$node_tmp/SHASUMS256.txt")
  [[ $node_archive =~ ^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$ ]]
  node_version=${node_archive#node-}
  node_version=${node_version%-linux-x64.tar.xz}
  curl --proto '=https' --tlsv1.2 -fsS "https://nodejs.org/dist/$node_version/$node_archive" -o "$node_tmp/$node_archive"
  (cd "$node_tmp" && awk -v file="$node_archive" '$2 == file' SHASUMS256.txt | sha256sum --check --status)
  install -d -m 0755 /opt/node
  tar -xJf "$node_tmp/$node_archive" --strip-components=1 -C /opt/node
  ln -s /opt/node/bin/node /usr/local/bin/node
  rm -rf "$node_tmp"
  trap - EXIT
fi
# CI user has administrative Docker access. No password, no sudo, no forwarding.
if ! id wms-deploy >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash wms-deploy
fi
usermod -aG docker wms-deploy
install -d -m 0700 -o wms-deploy -g wms-deploy /home/wms-deploy/.ssh
install -d -m 0700 /root/.ssh
add_key() {
  local source=$1 target=$2 owner=$3 key_type key_data key_comment
  read -r key_type key_data key_comment < "$source"
  touch "$target"
  if ! awk -v key="$key_data" '{for(i=1;i<=NF;i++) if($i==key) found=1} END {exit !found}' "$target"; then
    if [[ -s "$target" && $(tail -c 1 "$target" | od -An -tu1 | tr -d ' \n') != 10 ]]; then
      printf '\n' >> "$target"
    fi
    printf 'restrict %s %s %s\n' "$key_type" "$key_data" "$key_comment" >> "$target"
  fi
  chmod 0600 "$target"
  chown "$owner:$owner" "$target"
}
add_key "$operator_key_file" /root/.ssh/authorized_keys root
add_key "$ci_key_file" /home/wms-deploy/.ssh/authorized_keys wms-deploy
install -d -m 0700 -o wms-deploy -g wms-deploy /opt/artmate-wms
install -d -m 0700 -o wms-deploy -g wms-deploy /opt/artmate-wms/releases /opt/artmate-wms/shared /opt/artmate-wms/backups
# One 2 GiB swap file is a short peak buffer, not a RAM capacity guarantee.
if ! swapon --noheadings --show=NAME | grep -q .; then
  if [[ -e /swapfile ]]; then
    echo "Inactive existing /swapfile found; inspect manually before enabling." >&2
    exit 1
  fi
  available_kib=$(df --output=avail / | tail -1 | tr -d ' ')
  if (( available_kib < 6291456 )); then
    echo "Not enough disk headroom for swap; inspect manually." >&2
    exit 1
  fi
  fallocate -l 2G /swapfile
  chmod 0600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  if ! grep -qE '^/swapfile[[:space:]]' /etc/fstab; then
    printf '\n/swapfile none swap sw 0 0\n' >> /etc/fstab
  fi
fi
if [[ ! -e /etc/sysctl.d/90-artmate-wms-memory.conf ]]; then
  printf 'vm.swappiness=10\n' > /etc/sysctl.d/90-artmate-wms-memory.conf
  chmod 0644 /etc/sysctl.d/90-artmate-wms-memory.conf
  sysctl -p /etc/sysctl.d/90-artmate-wms-memory.conf >/dev/null
fi
printf 'Runtime prepared; no WMS application deployed.\n'
node --version
docker --version
docker compose version
free -m

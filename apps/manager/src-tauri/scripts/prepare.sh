set -euo pipefail
printf '::mew-stage::packages\n'
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y git curl ca-certificates build-essential python3 tmux xz-utils
id mew >/dev/null 2>&1 || useradd --create-home --shell /bin/bash mew
install -d -o mew -g mew /home/mew/apps /home/mew/workspace
printf 'mew-manager-v1\n' > /etc/mew-manager-owner
printf '::mew-stage::packages-ready\n'

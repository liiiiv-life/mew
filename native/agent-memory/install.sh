#!/bin/sh
set -eu

# Installs only an empty workload slice. Does not restart mew or move existing agents.
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit_file="$unit_dir/mew-agents.slice"
test "$(uname -s)" = Linux || { echo 'Linux systemd user manager required' >&2; exit 1; }
systemctl --user show-environment >/dev/null
systemd_version=$(systemctl --version | sed -n '1s/^systemd \([0-9]*\).*/\1/p')
test "$systemd_version" -ge 254 || { echo 'systemd 254+ required' >&2; exit 1; }
mkdir -p "$unit_dir"
if [ ! -e "$unit_file" ]; then
  install -m 644 "$source_dir/mew-agents.slice" "$unit_file"
else
  echo "Preserving existing $unit_file"
fi
systemctl --user daemon-reload
systemctl --user enable --now mew-agents.slice
group=$(systemctl --user show mew-agents.slice -p ControlGroup --value)
test -n "$group" && test -r "/sys/fs/cgroup$group/memory.max" || { echo 'cgroup v2 memory controller unavailable' >&2; exit 1; }
test "$(cat "/sys/fs/cgroup$group/memory.max")" != max || { echo 'Finite MemoryMax required' >&2; exit 1; }
systemctl --user show mew-agents.slice -p ControlGroup -p MemoryHigh -p MemoryMax -p MemorySwapMax

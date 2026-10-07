set -euo pipefail
app=$1; workspace=$2; port=$3; email=$4
[ -n "$email" ] || { printf '첫 관리자 이메일을 입력하세요.\n' >&2; exit 1; }
export PATH="$HOME/.local/share/mew-manager/node/bin:$PATH"
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) === 24 ? 0 : 1)' >/dev/null 2>&1; then
  printf '::mew-stage::node\n'
  case "$(uname -m)" in x86_64) arch=x64;; aarch64) arch=arm64;; *) printf 'Unsupported CPU architecture\n' >&2; exit 1;; esac
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  curl --fail --location --retry 3 --proto '=https' https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$tmp/SHASUMS256.txt"
  file=$(awk -v arch="$arch" '$2 ~ "^node-v24\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$" {print $2; exit}' "$tmp/SHASUMS256.txt")
  [ -n "$file" ] || { printf 'Node 24 archive not found\n' >&2; exit 1; }
  curl --fail --location --retry 3 --proto '=https' "https://nodejs.org/dist/latest-v24.x/$file" -o "$tmp/$file"
  (cd "$tmp"; awk -v name="$file" '$2 == name' SHASUMS256.txt | sha256sum --check -)
  mkdir -p "$HOME/.local/share/mew-manager/node"
  tar -xJf "$tmp/$file" --strip-components=1 -C "$HOME/.local/share/mew-manager/node"
fi
printf '::mew-stage::clone\n'
if [ -d "$app/.git" ]; then
  remote=$(git -C "$app" remote get-url origin)
  [ "$remote" = 'https://github.com/liiiiv-life/mew.git' ] || { printf 'Install directory belongs to another repository\n' >&2; exit 1; }
elif [ -e "$app" ] && [ -n "$(ls -A "$app")" ]; then
  printf 'Install directory is not empty\n' >&2; exit 1
else
  mkdir -p "$(dirname "$app")"
  git clone --branch main --single-branch https://github.com/liiiiv-life/mew.git "$app"
fi
mkdir -p "$workspace" "$HOME/.config/mew"
if [ -z "$(ls -A "$workspace")" ]; then
  mkdir -p "$workspace/docs"
  printf '# Welcome to mew\n\nEach folder in this workspace is a project.\n' > "$workspace/docs/README.md"
fi
chmod 700 "$HOME/.config/mew"
config="$HOME/.config/mew/config.env"
if [ ! -f "$config" ]; then
  umask 077
  printf 'MEW_WORKSPACE="%s"\nMEW_TEAM_PORT=%s\nMEW_BIND=127.0.0.1\nMEW_NODE="%s"\n' "$workspace" "$port" "$HOME/.local/share/mew-manager/node/bin/node" > "$config"
fi
printf '::mew-stage::build\n'
cd "$app"
./mew setup </dev/null
printf '::mew-stage::account\n'
node --input-type=module - "$app" "$email" <<'JS'
import { pathToFileURL } from 'node:url';
const [app, email] = process.argv.slice(2);
await import(pathToFileURL(`${app}/server/config.ts`).href);
const auth = await import(pathToFileURL(`${app}/server/auth.ts`).href);
if (auth.listUsers().length === 0) {
  if (!auth.isValidEmail(email)) throw new Error('관리자 이메일을 입력하세요.');
  const normalized = auth.normalizeEmail(email), password = auth.generateTempPassword(), now = Date.now();
  auth.upsertUser(normalized, { hash: auth.hashPassword(password), role: 'owner', mustChangePassword: true, createdAt: now, passwordChangedAt: now });
  console.log('::mew-credential::' + Buffer.from(JSON.stringify({ email: normalized, password })).toString('base64'));
} else console.log('기존 계정을 유지합니다.');
JS
printf '::mew-stage::health\n'

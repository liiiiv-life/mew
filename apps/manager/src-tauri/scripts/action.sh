set -euo pipefail
app=$1; action=$2
export PATH="$HOME/.local/share/mew-manager/node/bin:$PATH"
cd "$app"
case "$action" in
  check-update)
    printf '::mew-stage::check-update\n'
    [ "$(git remote get-url origin)" = 'https://github.com/liiiiv-life/mew.git' ] || exit 1
    git fetch --no-tags origin main
    node --input-type=module <<'JS'
import { execFileSync } from 'node:child_process';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const [ahead, behind] = git('rev-list', '--left-right', '--count', 'HEAD...origin/main').split(/\s+/).map(Number);
const commits = behind ? git('log', '-8', '--format=%h %s', 'HEAD..origin/main').split('\n') : [];
console.log('::mew-update::' + Buffer.from(JSON.stringify({ ahead, behind, latest: git('rev-parse', '--short=8', 'origin/main'), commits })).toString('base64'));
JS
    ;;
  update)
    [ "$(git remote get-url origin)" = 'https://github.com/liiiiv-life/mew.git' ] || { printf '공식 mew 저장소만 업데이트할 수 있습니다.\n' >&2; exit 1; }
    [ "$(git branch --show-current)" = main ] || { printf 'main 브랜치에서만 업데이트할 수 있습니다.\n' >&2; exit 1; }
    [ -z "$(git status --porcelain)" ] || { printf '로컬 변경을 먼저 커밋하거나 보관하세요.\n' >&2; exit 1; }
    git fetch --no-tags origin main
    [ "$(git rev-list --count origin/main..HEAD)" = 0 ] || { printf '로컬 커밋이 있어 자동 업데이트를 중단했습니다.\n' >&2; exit 1; }
    printf '::mew-stage::update\n'; ./mew update ;;
  start|stop|restart|desktop-setup) printf '::mew-stage::%s\n' "$action"; ./mew "$action" ;;
  *) printf 'Unsupported action\n' >&2; exit 1;;
esac

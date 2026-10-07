set -euo pipefail
app=$1
export PATH="$HOME/.local/share/mew-manager/node/bin:$PATH"
python3 - "$app" <<'PY'
import json, os, pathlib, subprocess, sys
app = pathlib.Path(sys.argv[1])
def output(args):
    try: return subprocess.check_output(args, cwd=app if app.is_dir() else None, stderr=subprocess.DEVNULL, timeout=4).decode().strip()
    except Exception: return ''
config = pathlib.Path.home()/'.config/mew/config.env'
port = 5000
workspace = ''
if config.exists():
    import shlex
    for line in config.read_text().splitlines():
        if '=' not in line: continue
        key, value = line.split('=', 1)
        try: value = shlex.split(value)[0]
        except Exception: continue
        if key == 'MEW_TEAM_PORT':
            try: port = int(value)
            except ValueError: pass
        if key == 'MEW_WORKSPACE': workspace = value
state = pathlib.Path.home()/'.local/state/mew'
running = False
try:
    pid = int((state/'mew.pid').read_text())
    cmd = pathlib.Path(f'/proc/{pid}/cmdline').read_bytes()
    running = b'server/serve.ts' in cmd and pathlib.Path(f'/proc/{pid}/cwd').resolve() == app.resolve()
except Exception: pass
result = {'installed': (app/'package.json').is_file() and (app/'mew').is_file(), 'built': (app/'dist/index.html').is_file(), 'running': running, 'port': port, 'workspace': workspace, 'commit': output(['git', 'rev-parse', '--short=8', 'HEAD']), 'branch': output(['git', 'branch', '--show-current']), 'dirty': bool(output(['git', 'status', '--porcelain'])), 'tools': {name: output(args) for name,args in {'node':['node','--version'], 'npm':['npm','--version'], 'git':['git','--version'], 'tmux':['tmux','-V'], 'python':['python3','--version']}.items()}, 'paths': {'app':str(app), 'data':str(pathlib.Path.home()/'.local/share/mew'), 'config':str(config), 'logs':str(state/'mew.log')}}
print(json.dumps(result))
PY

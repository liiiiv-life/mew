# 네이티브 서버 배포

[문서 지도](../MOC.md) · [이 분야](MOC.md) · [설치·실행](../../README.md)

## 배포 경로와 전제

현재 지원하는 배포 경로는 **Linux 또는 macOS에서의 네이티브 설치**다. 개인 컴퓨터에서는 `./mew setup`만으로 충분하고, 서버에서는 아래 절차처럼 전용 OS 사용자·로컬 바인딩·HTTPS 프록시(또는 터널)·프로세스 관리자를 함께 둔다.

| 상황 | 권장 경로 |
| --- | --- |
| 내 컴퓨터에서 혼자 사용 | 네이티브 설치 후 `./mew setup` |
| 휴대폰을 포함한 내 기기에서 접속 | 네이티브 설치 + VPN 또는 HTTPS 터널 |
| 신뢰하는 소규모 팀용 서버 | 네이티브 설치 + `127.0.0.1` 바인딩 + HTTPS 리버스 프록시 + systemd |
| 불특정 다수·다중 테넌트 서비스 | 지원 대상 아님 — 권한 모델과 터미널 기능이 맞지 않음 |

앱은 **별도 호스트명의 루트 경로(**`/`**)** 에 올리는 것을 전제로 한다. 클라이언트가 `/api`와 WebSocket 경로를 절대 경로로 사용하므로 `/mew` 같은 하위 경로 배포는 지원하지 않는다.

> **컨테이너 앱 배포는 현재 지원하지 않는다.** 이 레포에서는 Dockerfile이 제거되어 `docker compose --profile app up -d --build`가 성공하지 않는다. `docker-compose.yml`은 현재 `/db` 기능용 Postgres를 띄우는 용도로만 쓴다. 컨테이너 앱 경로를 다시 제공하려면 Dockerfile·운영 계약·보안 검토를 함께 복구해야 한다.

## 서버 배포 (네이티브)

아래는 Linux 서버에서 `mew`라는 전용 비관리자 계정으로 운영하는 예시다. 계정명·경로·도메인은 환경에 맞게 바꾼다. `config.env` **안의 경로는** `~`**·**`$HOME`**이 아닌 절대 경로로 쓴다.** 설정 파일은 셸 스크립트가 아니므로 경로를 확장하지 않는다.

## 1. 서버와 파일 경로 준비

Node는 24를 권장한다(최소 Node 22.18). `git`, C/C++ 빌드 도구, `python3`, `tmux`가 필요하다. `node-pty`를 로컬에서 빌드하고 tmux가 터미널 기능을 담당하기 때문이다.

```bash
# Debian/Ubuntu 예시 — root가 아닌 mew 사용자로 서비스를 운영한다.
sudo apt install git build-essential python3 tmux
sudo adduser --disabled-password --gecos "" mew   # 아직 없다면 한 번만

sudo -iu mew
git clone <이 레포 URL> ~/apps/mew
install -d -m 700 ~/workspace ~/.config/mew ~/.local/share/mew

cat > ~/.config/mew/config.env <<'EOF'
MEW_WORKSPACE=/home/mew/workspace
MEW_DATA_DIR=/home/mew/.local/share/mew
MEW_TEAM_PORT=5000
MEW_BIND=127.0.0.1
EOF
chmod 600 ~/.config/mew/config.env

cd ~/apps/mew
./mew setup
```

설정 파일이 이미 있으면 `setup`은 작업 폴더와 포트를 다시 묻지 않는다. 의존성을 설치·빌드하고 서버를 시작한 뒤 첫 owner 계정의 이메일만 받는다. 출력한 임시 비밀번호로 로그인한 즉시 비밀번호를 바꾼다.

`MEW_WORKSPACE`에는 mew가 읽고 쓸 프로젝트만 둔다. 홈 디렉터리 전체, 서버 설정, 다른 서비스의 데이터처럼 mew 사용자에게도 열어서는 안 되는 경로를 넣지 않는다. 설정 파일과 데이터 폴더의 소유자는 반드시 mew를 실행하는 OS 사용자여야 한다.

## 2. HTTPS 프록시 또는 터널 연결

서비스 포트는 외부에 직접 열지 않고 `MEW_BIND=127.0.0.1`로 둔다. 그 앞에 HTTPS를 종료하는 리버스 프록시나 터널을 둔다. 프록시 설정에는 다음이 모두 필요하다.

- 공개 도메인의 요청을 `http://127.0.0.1:5000`으로 전달한다. 경로를 덧붙이거나 지우지 않는다.
- 원래 `Host` 헤더를 보존하고 HTTPS 요청에는 `X-Forwarded-Proto: https`를 보낸다. 로그인 쿠키가 `Secure`로 발급되고 CSRF Origin 검사가 정상 동작하려면 필요하다.
- WebSocket 업그레이드를 모든 경로에서 통과시킨다. 협업·presence·터미널·에이전트·데이터베이스와 서버 브라우저가 모두 WebSocket을 쓴다.
- `index.html`이나 `/api` 응답을 프록시에서 장기 캐시하지 않는다. 정적 `/assets` 캐시는 앱이 직접 관리한다.

프록시 또는 터널을 연결한 뒤, 실제 도메인에서 아래 순서로 확인한다.

1. `https://<도메인>/api/auth/me`가 JSON 응답을 돌려준다.
2. 브라우저에서 로그인한 뒤 임시 비밀번호 변경 화면이 먼저 보인다.
3. 문서를 다른 브라우저 창에서 함께 열어 협업 연결과 자동 저장이 되는지 확인한다.
4. manager 또는 owner 계정에서 터미널을 열 수 있는지 확인한다. 이 검사는 실제 셸 권한을 주는 일이므로 테스트 계정으로만 한다.

개발 서버 `npm run dev`(4999)는 HMR과 소스맵을 노출하므로 터널·프록시·방화벽 어느 쪽으로도 공개하지 않는다.

## 3. 재부팅 뒤에도 실행하기 (systemd)

`./mew start`는 `nohup`으로 프로세스를 띄우는 간단한 개인용 경로라 재부팅 후 자동 시작하지 않는다. 서버에서는 하나의 process manager만 사용한다. 아래처럼 systemd를 쓴다면 `./mew start|stop|restart|update`와 섞지 말고 `systemctl`로만 시작·중지·재시작한다.

먼저 `./mew setup`이 띄운 프로세스를 멈춘 다음, 실제 사용자·경로·Node 경로를 반영한 unit을 만든다. `command -v node`로 Node 절대 경로를 확인한다.

```ini
# /etc/systemd/system/mew.service
[Unit]
Description=mew workspace editor
After=network.target

[Service]
Type=simple
User=mew
Group=mew
WorkingDirectory=/home/mew/apps/mew
Environment=HOME=/home/mew
Environment=PATH=/usr/local/bin:/usr/bin:/bin
UMask=0077
ExecStart=/usr/bin/node server/serve.ts
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
# mew 사용자에서: setup이 띄운 nohup 프로세스를 먼저 정리
cd ~/apps/mew && ./mew stop
exit

# 관리자로 돌아와 unit 반영과 시작
sudo systemctl daemon-reload
sudo systemctl enable --now mew
sudo systemctl status mew
journalctl -u mew -f
```

Node 또는 에이전트 CLI를 `nvm`, `mise` 같은 사용자 전용 경로에 설치했다면 systemd의 `PATH`에도 그 절대 경로를 넣는다. systemd는 로그인 셸의 초기화 파일을 읽지 않는다.

## 4. 업데이트·백업·장애 확인

`./mew start`로 실행한 개인용 설치는 헤더 메뉴의 **Mew 업데이트**로 `origin/main`의 새 커밋을 확인하고 업데이트할 수 있다. 새 커밋이 있으면 전용 숨김 tmux에서 `./mew update`를 실행하고, pull·의존성 설치·빌드·재시작이 모두 성공해 새 서버가 응답하면 화면을 자동으로 새로고침한다. `git pull --ff-only`라 로컬 브랜치가 갈라졌거나 작업 파일과 충돌하면 자동 병합하지 않고 실패하며 작업 트리를 보존한다. systemd 같은 외부 supervisor가 실행한 서버는 이 버튼으로 재시작하지 않고 수동 업데이트가 필요하다고 표시한다.

배포 전에는 항상 현재 커밋과 데이터 백업 위치를 기록한다. 앱 클론을 지워도 다음 상태는 남고, 반대로 이 상태를 잃으면 계정·세션·게스트 규칙·UI 원장이 사라진다.

| 대상 | 기본 위치 | 백업 이유 |
| --- | --- | --- |
| 설정·외부 서비스 자격증명 | `~/.config/mew/config.env` | 워크스페이스, 포트, DB 연결 등 복구 |
| mew 앱 데이터 | `~/.local/share/mew/` 또는 `MEW_DATA_DIR` | 계정, 세션, 게스트 규칙, 채팅, RAG 캐시·인덱스 |
| 작업물 | `MEW_WORKSPACE` | mew가 편집하는 실제 파일 — Git만으로 충분한지 별도 판단 |
| `/db` 데이터 | `DATABASE_URL`이 가리키는 Postgres | 앱 데이터 폴더에 포함되지 않음 |

설정 파일과 앱 데이터는 비밀값·비밀번호 해시를 포함하므로 암호화된 백업에만 넣고, Git이나 공유 폴더에 복사하지 않는다. RAG 캐시와 인덱스는 지워도 다시 만들 수 있지만 계정·세션·게스트 규칙은 그렇지 않다.

systemd 운영에서는 다음처럼 업데이트한다. 빌드가 `dist/`를 바로 바꾸므로, 사용자가 접속 중인 서버에서는 짧은 반영 구간을 공지하고 한 번에 진행한다.

```bash
# mew 사용자에서 빌드한다.
sudo -iu mew
cd ~/apps/mew
git status                 # 작업 트리가 깨끗한지 먼저 확인
git pull --ff-only
npm ci --no-audit --no-fund
npm test                   # 권장: 새 버전 검증
npm run build
exit

# 관리자로 돌아와 새 빌드를 재시작한다.
sudo systemctl restart mew
sudo systemctl status mew
```

문제가 나면 `journalctl -u mew -n 100 --no-pager`로 서버 로그를 먼저 확인한다. 개인용 `./mew` 실행 경로에서는 `./mew status`와 `./mew logs`를 쓴다. 롤백은 마지막 정상 커밋으로 앱 클론을 되돌린 뒤 같은 의존성 설치·빌드·재시작 절차를 수행한다. 워크스페이스와 `MEW_DATA_DIR`를 지우거나 덮어쓰는 방식으로 롤백하지 않는다.

## 앱 업데이트 API

| 라우트 | 역할 | 하는 일 |
| --- | --- | --- |
| `GET /api/mew-update/status` | manager·owner | `HEAD`와 `origin/main`의 ahead/behind, 실행 방식, 업데이트 작업 상태 조회. `?refresh=1`이면 먼저 fetch |
| `POST /api/mew-actions/update/run` | manager·owner | 내장 `./mew start` 서버에서만 고정 업데이트 명령을 숨김 tmux로 실행 |

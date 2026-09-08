# mew

## 베타 설치 (macOS/Linux)

터미널에서 아래 두 줄만 실행한다.

```bash
git clone <전달받은 저장소 URL> mew && cd mew
./mew setup
```

화면의 질문에 따라 편집할 폴더와 계정 이메일을 입력한 뒤, 마지막에 표시되는 주소를 브라우저로 연다. 임시 비밀번호로 로그인하면 바로 새 비밀번호로 바꾼다. 필요한 Node·빌드 도구·tmux가 없으면 설치 방법을 안내해 준다. 이후 업데이트는 mew 폴더에서 `./mew update`를 실행하면 된다.

내 컴퓨터 또는 내가 관리하는 서버의 **폴더 하나를 브라우저 프로젝트로** 여는 편집기다. 마크다운·코드 편집, 파일 트리, 정확/의미 검색, git 커밋, 실시간 협업, 터미널(tmux), 에이전트와 게스트 열람 링크를 한 화면에 둔다. 다른 경로도 프로젝트 탭으로 열 수 있고, 루트 바로 아래에서 `.mew` 폴더를 가진 폴더는 사이드바의 하위 프로젝트로 구분한다. 모바일도 지원한다.

> \[!WARNING\] mew는 일반적인 공개 문서 서비스가 아니다. `manager`·`owner`는 서버의 터미널과 에이전트를 쓸 수 있어 사실상 **서버 셸 권한**을 받는다. 공개 배포 전에는 반드시 [SECURITY.md](SECURITY.md)를 읽고, 신뢰하는 소수의 사람만 계정으로 초대한다.

## 배포 경로와 전제

현재 지원하는 배포 경로는 **Linux 또는 macOS에서의 네이티브 설치**다. 개인 컴퓨터에서는 `./mew setup`만으로 충분하고, 서버에서는 아래의 "서버 배포" 절처럼 전용 OS 사용자·로컬 바인딩·HTTPS 프록시(또는 터널)·프로세스 관리자를 함께 둔다.

| 상황 | 권장 경로 |
| --- | --- |
| 내 컴퓨터에서 혼자 사용 | 네이티브 설치 후 `./mew setup` |
| 휴대폰을 포함한 내 기기에서 접속 | 네이티브 설치 + VPN 또는 HTTPS 터널 |
| 신뢰하는 소규모 팀용 서버 | 네이티브 설치 + `127.0.0.1` 바인딩 + HTTPS 리버스 프록시 + systemd |
| 불특정 다수·다중 테넌트 서비스 | 지원 대상 아님 — 권한 모델과 터미널 기능이 맞지 않음 |

앱은 **별도 호스트명의 루트 경로(**`/`**)** 에 올리는 것을 전제로 한다. 클라이언트가 `/api`와 WebSocket 경로를 절대 경로로 사용하므로 `/mew` 같은 하위 경로 배포는 지원하지 않는다.

> **컨테이너 앱 배포는 현재 지원하지 않는다.** 이 레포에서는 Dockerfile이 제거되어 `docker compose --profile app up -d --build`가 성공하지 않는다. `docker-compose.yml`은 현재 `/db` 기능용 Postgres를 띄우는 용도로만 쓴다. 컨테이너 앱 경로를 다시 제공하려면 Dockerfile·운영 계약·보안 검토를 함께 복구해야 한다.

## 빠른 시작

```bash
git clone <이 레포> mew && cd mew
./mew setup
```

`setup`은 필요한 것(Node·빌드 도구·tmux)을 확인하고, 편집할 폴더와 포트를 물어보고, 빌드한 뒤 첫 계정을 만들어 임시 비밀번호를 알려준다. 다시 돌려도 안전하다. 권한 모델과 노출 시 주의는 [**SECURITY.md**](SECURITY.md) — 계정 하나를 주는 것이 어디까지를 주는 것인지 먼저 읽는다.

지원 대상은 Linux와 macOS다. 터미널•에이전트패널의 terminal 런타임은 `node-pty`를 로컬에서 빌드하고 `tmux`에 붙으므로 OS별 기본 도구가 필요하다.

> **에이전트 실행 불변식:** 에이전트는 `mew`**를 실행하지 않는다.** 빌드·배포·서버 재시작은 사용자가 직접 맡는다. `npm run build`, `npm start`, `./mew start|stop|restart|update`, 프로세스 직접 종료·백그라운드 실행처럼 현재 화면이나 서버를 바꾸는 명령도 실행하지 않는다. 에이전트는 코드 변경 후 `npm test`, `npm run lint`, `npx tsc -b`처럼 실행 중인 서버를 건드리지 않는 검증까지만 하고, 반영이 필요하다고 사용자에게 알린다.

```bash
# Debian/Ubuntu
sudo apt install build-essential python3 tmux

# macOS
xcode-select --install
brew install tmux python
```

macOS에서는 `node-pty 1.1.0` 배포본의 `spawn-helper` 실행 권한 누락을 PTY 연결 전에 보정한다.
현재 로드된 네이티브 모듈 옆의 보조 파일에 소유자 실행 권한만 추가하며, 실패하면 터미널에
시작 오류를 표시하고 서버 로그에 원인을 남긴다. 빈 화면이면 로그의 `[mew:tmux]` 오류를 먼저 확인한다.

**이 폴더에는 아무것도 저장되지 않는다.** 설정은 `~/.config/mew/config.env`, 계정·세션과 완료된 에이전트 턴 전사는 `~/.local/share/mew/`, 로그는 `~/.local/state/mew/`에 산다(`server/config.ts`). 클론을 지워도 데이터는 남고, `git pull`이 곧 업데이트다.

```bash
./mew start | stop | restart   # 서버
./mew status                   # 지금 뭐가 어디에 있는지
./mew logs                     # 로그 따라가기
./mew update                   # origin/main fast-forward + 재빌드 + 재시작
./mew users add you@x.com owner
```

## 서버 배포 (네이티브)

아래는 Linux 서버에서 `mew`라는 전용 비관리자 계정으로 운영하는 예시다. 계정명·경로·도메인은 환경에 맞게 바꾼다. `config.env` **안의 경로는** `~`**·**`$HOME`**이 아닌 절대 경로로 쓴다.** 설정 파일은 셸 스크립트가 아니므로 경로를 확장하지 않는다.

### 1. 서버와 파일 경로 준비

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

### 2. HTTPS 프록시 또는 터널 연결

서비스 포트는 외부에 직접 열지 않고 `MEW_BIND=127.0.0.1`로 둔다. 그 앞에 HTTPS를 종료하는 리버스 프록시나 터널을 둔다. 프록시 설정에는 다음이 모두 필요하다.

- 공개 도메인의 요청을 `http://127.0.0.1:5000`으로 전달한다. 경로를 덧붙이거나 지우지 않는다.
- 원래 `Host` 헤더를 보존하고 HTTPS 요청에는 `X-Forwarded-Proto: https`를 보낸다. 로그인 쿠키가 `Secure`로 발급되고 CSRF Origin 검사가 정상 동작하려면 필요하다.
- WebSocket 업그레이드를 모든 경로에서 통과시킨다. 협업·presence·터미널·에이전트·데이터베이스와 loopback 브라우저가 모두 WebSocket을 쓴다.
- `index.html`이나 `/api` 응답을 프록시에서 장기 캐시하지 않는다. 정적 `/assets` 캐시는 앱이 직접 관리한다.

프록시 또는 터널을 연결한 뒤, 실제 도메인에서 아래 순서로 확인한다.

1. `https://<도메인>/api/auth/me`가 JSON 응답을 돌려준다.
2. 브라우저에서 로그인한 뒤 임시 비밀번호 변경 화면이 먼저 보인다.
3. 문서를 다른 브라우저 창에서 함께 열어 협업 연결과 자동 저장이 되는지 확인한다.
4. manager 또는 owner 계정에서 터미널을 열 수 있는지 확인한다. 이 검사는 실제 셸 권한을 주는 일이므로 테스트 계정으로만 한다.

개발 서버 `npm run dev`(4999)는 HMR과 소스맵을 노출하므로 터널·프록시·방화벽 어느 쪽으로도 공개하지 않는다.

### 3. 재부팅 뒤에도 실행하기 (systemd)

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

### 4. 업데이트·백업·장애 확인

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

**MOC는 파일명으로 목록에 섞이지 않는다** — `MOC.md`·`_MOC.md`(둘은 같은 것)는 파일 목록에서 빠지고, 대신 **자기 폴더를 펼쳤을 때 맨 첫 줄**에 지도 아이콘 + `Map Of Contents`로 고정된다. 프로젝트 루트의 MOC는 담을 폴더가 없으니 트리 전체의 맨 위, 어떤 폴더보다 앞에 같은 모양으로 선다. 판별은 파일명뿐이라 프로젝트를 가리지 않는다.

## 프로젝트 탭

mew에서 **폴더 하나가 프로젝트 하나**다. 설정된 시작 폴더도 워크스페이스가 아니라 처음 열린 프로젝트일 뿐이다. 화면 주소는 항상 `/`이고, 헤더에는 이 브라우저에서 열어 본 루트 프로젝트 경로가 탭으로 선다. 열린 경로 목록은 `localStorage`의 `mew:open-project-paths`에 남는다.

- 헤더의 `+ 탭` 또는 `Ctrl+O`는 화면 가운데 서버 폴더 브라우저를 연다. 절대경로·`~`를 주소창에 직접 넣거나 하위 폴더를 눌러 이동하고, **현재 폴더 열기**로 그 폴더를 프로젝트 탭에 추가한다(owner 전용). 우상단 `+` 메뉴는 현재 폴더 안에 새 폴더 만들기, 원격 Git 저장소 clone, 현재 폴더 `git init`을 제공한다. clone은 완료될 때까지 창에 처리 중 상태로 남고 성공하면 목록을 다시 읽는다.
- 탭을 누르면 그 루트 프로젝트로 전환한다. 현재 서버 호환층은 활성 루트를 프로세스 전체에서 하나만 유지하므로 트리 감시자·협업 방·에이전트를 정리한다. 브라우저는 새로고침하지 않고 새 루트의 트리를 읽어 화면을 교체하며, 열린 탭 목록과 작은 텍스트 본문 캐시는 루트 절대경로별로 분리해 다시 돌아올 때 복원한다. 내부 이름 `WORKSPACE_ROOT`·`MEW_WORKSPACE`는 설정·경로 검증 호환용이며 사용자 개념이 아니다.
- 탭을 길게 누르거나 우클릭하면 아이콘 선택기를 연다(owner 전용). 아이콘은 이 브라우저의 열린 루트 경로별로 기억한다. `+ 탭`은 글자 없이 `+` 아이콘만 보인다.
- 프로젝트 이름이 보이는 탭에는 `×`가 보인다. 누르면 확인 뒤 탭 목록에서만 닫으며, 파일·폴더는 지우지 않는다. 마지막 루트 프로젝트 탭은 닫을 수 없다.
- 프로젝트 탭에는 명령 버튼과 하위 폴더가 붙지 않는다. 탭은 독립적으로 연 루트 폴더만 나타낸다.
- 절대경로 탭 추가·전환은 owner가 맡는다. manager는 셸과 같은 권한으로 현재 프로젝트 경로를 볼 수 있고, member·guest에는 절대경로 대신 일반 프로젝트 이름만 보인다.

작업 화면 상태(문서 탭·칸 배치·스크롤·트리 펼침·보조 패널)는 로그인 계정별 서버 원장에 남아 다른 기기·시크릿 창에서도 복원한다. 기존 `localStorage` 값은 계정 원장이 처음 비어 있을 때만 이관 원본으로 쓰며, 루트 프로젝트와 Documents의 내부 API 식별자 `.workspace`·`docs`는 호환을 위해 유지한다. 화면 폭·테마·언어·글꼴·작성 중 초안처럼 기기 특성이 강한 값은 브라우저에 남는다.

프로젝트·문서·터미널•에이전트·브라우저·시트 탭 줄은 항목이 폭을 넘겨도 가로 스크롤바를 표시하지 않는다. 손가락·트랙패드·Shift+휠을 통한 가로 이동은 그대로 유지한다.

## 사이드바의 프로젝트 · 하위 프로젝트 · Documents

사이드바 상단의 탐색기(폴더) · 전체 검색(돋보기) · \*\*현재 루트 프로젝트 명령(▶)\*\*은 서로 다른 세 개의 사이드바 탭이다. 루트 명령 ▶를 누르면 파일 탐색기·Documents 없이 루트의 `.mew/cmd-button.json` 목록만 보인다. Git은 사이드바에 버튼을 두지 않고 헤더 햄버거 메뉴 또는 `Alt+G`로 연다.

파일 검색창 바로 아래에는 Documents와 직계 하위 프로젝트가 큰 펼침 항목으로 선다. 그 뒤에는 현재 루트의 나머지 파일·폴더가 별도 Project 폴더 없이 바로 이어진다.

- **Documents** — 현재 프로젝트가 고른 docs 폴더. 펼치면 바로 아래에 내용이 보이고, owner가 우클릭하면 기존 폴더 변경·가져오기·내보내기 설정 창이 열린다. 내부 식별자와 API는 계속 `docs`다.
- 모바일에서는 사이드바의 파일·폴더를 **0.5초 이상 누른 뒤 이동 없이 손을 떼면** 데스크톱 우클릭과 같은 항목 메뉴가 열린다. 폴더 메뉴의 **Git 저장소로 만들기**는 선택한 폴더 자체에서 `git init`한다(owner·manager). 누른 채 움직이면 이 메뉴를 열지 않아 기존 끌어놓기 이동을 계속할 수 있다. 루트 바로 아래 폴더에 `.mew`가 있으면 **하위 프로젝트**다. Documents 바로 뒤에서 각자 큰 펼침 항목으로 보이고, 줄 오른쪽에는 기존 명령 메뉴(`<폴더>/.mew/cmd-button.json`)만 둔다. 펼치면 자기 파일이 바로 보인다. `.mew`가 없는 루트 파일·폴더는 이 항목들 뒤에 별도 컨테이너 없이 바로 나열한다. owner·manager는 숨김 폴더도 보되 `.git`·`node_modules`·`.data`는 기존 차단·성능 규칙에 따라 제외한다. 하위 프로젝트 안의 중첩 `.mew` 폴더는 아직 별도 프로젝트로 분류하지 않는다.

## Git 워크벤치 팝업

헤더 햄버거 메뉴의 **Git** 또는 `Alt+G`는 편집 탭을 바꾸지 않는 독립 팝업을 연다. 처음에는 루트 프로젝트·Documents·그 안의 모든 Git 저장소 목록을 보이고, 하나를 고르면 그 저장소의 이력으로 들어간다. 그래프 화면의 왼쪽 위 뒤로가기는 이 목록으로 돌아간다. 바깥 클릭·닫기 버튼·Esc로 닫으며, 파일 탭·분할 칸 이동·계정별 탭 복원 대상이 아니다. 기존 `mew:git:` 가상 탭 저장분은 다음 복원 때 제거한다.

- 첫 화면은 모든 ref의 최근 커밋 최대 300개를 topo-order로 표시한다. 맨 위 첫 항목은 항상 **커밋되지 않은 변경사항**이고, 그 아래에 그래프 레인과 커밋 제목·ref·작성자·시간·짧은 해시가 선다.
- 팝업 안 화면은 `그래프 → 커밋 또는 작업트리 상세 → 파일 diff`의 세 단계다. 상세·diff 화면 왼쪽 위의 뒤로가기로 바로 전 단계에 돌아가며 오른쪽 위 `×`는 어느 단계에서든 팝업을 닫는다.
- 커밋 상세는 본문과 변경 파일을 표시한다. 작업트리 상세는 수정·추가·삭제·미추적 파일 전체를 먼저 표시하고, 팝업 맨 아래 고정 작성 영역에서 커밋 제목·선택 설명을 입력한다. `커밋`은 이 변경을 모두 stage해 한 커밋으로 만들며, 그 옆 `AI Commit`은 에이전트 연결 전에는 안내만 표시한다.
- 상세의 변경 파일을 누르면 같은 팝업이 파일 diff 화면으로 바뀌고 이전·이후 줄 번호와 추가·삭제 줄을 표시한다. 파일을 누를 때만 patch를 읽으므로 전체 diff가 첫 응답을 막지 않는다.
- 커밋 우클릭은 해시 복사, branch/tag 생성, detached checkout, cherry-pick, revert를 제공한다. checkout·cherry-pick·revert는 확인 뒤 실행하며 강제 checkout·reset·clean은 제공하지 않는다. 작업 트리 변경이나 충돌 때문에 Git이 거부하면 오류를 그대로 표시한다.
- API는 저장소 상대경로와 구조화된 작업 인자만 받으며 임의 셸 문자열을 받지 않는다. 지정한 폴더 자체에 `.git`이 있어야 하고 상위 저장소를 암묵적으로 찾아가지 않는다.

| 라우트 | 역할 | 하는 일 |
| --- | --- | --- |
| `GET /api/git/repository` · `GET /api/git/log` | manager·owner | 저장소 상태와 커밋 그래프 원본 |
| `GET /api/git/repositories` | manager·owner | 루트·Documents·중첩 Git 저장소 선택 목록 |
| `GET /api/git/commit` · `GET /api/git/diff` | manager·owner | 과거 커밋 메타데이터·변경 파일과 선택 파일 patch |
| `GET /api/git/working-tree` · `GET /api/git/working-tree/diff` | manager·owner | 현재 작업트리 변경 파일과 선택 파일 patch |
| `POST /api/git/commit` · `POST /api/git/action` | manager·owner | 작업트리 전체 커밋과 과거 커밋 대상 허용 작업 |
| `POST /api/git/init` | manager·owner | 프로젝트 안 폴더 Git 초기화 |
| `POST /api/fs/folder` · `POST /api/fs/git/init` · `POST /api/fs/git/clone` | owner | 프로젝트 브라우저의 임의 OS 경로 생성·초기화·clone |

워크스페이스 스코프 홈 고정 탭과 최상위 하위 폴더 전체를 나열하던 프로젝트 격자 진입점은 없다. 할 일·달력 위젯을 다시 노출할 때는 워크스페이스 홈 탭을 되살리지 않고 프로젝트 스코프 배치를 별도로 결정한다.

## 서버 파일 탐색기

헤더 메뉴에서 여는 프로젝트 독립 팝업(`components/ServerFileExplorer.tsx`). 기본 경로는 서버 사용자의 홈이고, 주소 입력·드롭다운으로 `~` 또는 절대경로를 연다. 폴더는 펼칠 때 한 단계씩 읽으므로 홈 전체를 미리 재귀 스캔하지 않는다. 숨김 항목을 포함해 mew 서버의 OS 사용자가 읽을 수 있는 모든 파일·폴더가 대상이다.

- 파일을 누르면 현재 프로젝트는 그대로 둔 채 포커스된 편집 칸의 **미리보기 탭**으로 열린다. 외부 탭은 자동저장할 수 있지만 협업·댓글·git 이력·프로젝트 규칙을 쓰지 않고, 새로고침 탭 복원에도 남지 않는다.
- 우클릭 메뉴는 파일·폴더 이름 변경, 복사·잘라내기·폴더에 붙여넣기, 삭제를 제공한다. 파일은 다운로드할 수 있다. **모바일에서 브라우저가 셀룰러 연결을 확인하고 파일이 100MiB를 넘으면**, 실제 내려받기 전에 데이터 요금 안내와 계속 다운로드 확인을 띄운다. Wi‑Fi·데스크톱·연결 종류를 알 수 없는 브라우저는 바로 내려받는다.
- 폴더의 **프로젝트로 열기**는 그 폴더 자체를 루트 프로젝트 탭에 추가하고 활성 프로젝트로 연다. owner 전용이며 활성 루트 전환 계약에 따라 현재 화면을 새 루트로 교체한다.
- 탐색·읽기·쓰기 API는 **manager·owner 전용**이다. 워크스페이스 경계나 `.git`·`node_modules` 차단 규칙을 적용하지 않으며 셸과 동일한 OS 권한 범위다. 공개 서버의 권한 의미는 [SECURITY.md](SECURITY.md)를 따른다.

| 라우트 | 역할 | 하는 일 |
| --- | --- | --- |
| `GET /api/fs/entries?path=` | manager·owner | 절대경로 폴더의 파일·하위 폴더 한 단계 |
| `GET/PUT /api/fs/file` | manager·owner | 외부 텍스트 파일 읽기·저장(텍스트 열기는 10MB 이하) |
| `POST /api/fs/rename` · `DELETE /api/fs/path` · `POST /api/fs/paste` | manager·owner | 이름 변경·재귀 삭제·복사/이동 |
| `GET /api/fs/raw` · `GET /api/fs/download` | manager·owner | 외부 미디어 스트리밍·파일 다운로드 |
| `POST /api/fs/open-project` | owner | 선택 폴더 자체를 루트 프로젝트로 열고 활성화 |
| `POST /api/fs/folder` · `POST /api/fs/git/init` · `POST /api/fs/git/clone` | owner | 현재 폴더 안 생성·Git 초기화·저장소 clone |

## 브라우저 창

Alt+B·헤더 메뉴·플로팅 핸들의 **브라우저**는 Mew 화면 위의 독립 플로팅 팝업으로 연다. 상단 바를 끌어 옮기고 창의 네 변·모서리로 크기를 조절할 수 있다. 탭·주소 상태는 같은 origin의 localStorage(`mew:browser-*`)를 공유한다.

이 화면은 `server/browserProxy.ts`의 **서버 loopback 개발 서버 뷰어**다. 폰에서 `localhost:3100`을 넣으면 Mew가 실행되는 WSL/서버의 `localhost:3100`을 열어, 응답을 sandbox iframe에서 렌더링한다. HTTP(S)·WebSocket·redirect·탭별 cookie/storage를 중계하므로 개발 중인 SPA도 확인할 수 있다.

- 대상은 이 서버의 `localhost`, `127.0.0.0/8`, `::1`만 허용한다. 공개 인터넷·사설망·임의 URL은 열 수 없다. 권한은 터미널과 같은 **manager·owner**다.
- 일반 Browser 패널은 OAuth나 범용 웹 탐색용이 아니다. 다만 Codex의 `codex login` 작업은 등록된 인증 호스트와 서버 loopback만 여는 일회성 내장 브라우저를 에이전트 화면 안에서 쓴다. Kimi·Cursor OAuth는 현재 기기의 일반 새 탭으로 연결한다. 공급자·키·모델 선택이 먼저 필요한 Hermes·OpenClaw·OpenCode·Prime은 Mew 터미널을 연다. Claude Code·Antigravity는 에이전트 탭 자체가 공식 CLI의 tmux 터미널이므로 로그인도 그 TUI에서 진행한다. 근거와 경계는 [ADR 0109](../.mew/docs/decisions/0109-mew-agent-authentication-and-loopback-browser.md)·[ADR 0110](../.mew/docs/decisions/0110-mew-declarative-agent-authentication-jobs.md)·[ADR 0117](../.mew/docs/decisions/0117-mew-terminal-agent-tabs-for-claude-and-antigravity.md)·[ADR 0121](../.mew/docs/decisions/0121-mew-codex-oauth-through-scoped-server-browser.md)에 둔다.
- Mew session cookie는 대상에 보내지 않으며 대상 문서는 `allow-same-origin` 없는 iframe에서 돌아 Mew UI DOM·localStorage에 직접 접근하지 못한다. Mew 서버 재시작·세션 만료·창을 새로 열면 사이트 세션은 사라진다.

`/3100`처럼 포트를 첫 경로로 연 전체 페이지도 같은 구현을 쓰되, 이 호환 진입점의 대상은 계속 해당 서버의 loopback 포트로 고정한다.

| 라우트 | 역할 | 하는 일 |
| --- | --- | --- |
| `GET /api/browser-url?url=` | **manager·owner** | 서버 loopback 대상의 탭별 프록시 세션과 짧은 서명 URL 발급 |
| `GET /browser` | 페이지 셸은 공개, 연결은 **manager·owner** | 권한 확인 뒤 같은 브라우저 UI를 독립 팝업 창으로 표시 |
| `ANY /__mew_browser/<origin-token>/<session-token>/...` | 서명 세션 | loopback HTTP(S)를 서버에서 요청하고 텍스트 응답 URL·cookie·storage 문맥 중계 |
| `WS /__mew_browser_ws/<origin-token>/<session-token>/...` | 서명 세션 | loopback WebSocket을 서버에서 연결해 frame 양방향 중계 |
| `ANY /<port>` · `/<port>/...` | **manager·owner** | 같은 프록시를 전체 페이지로 연다. 첫 요청에서 짧은 토큰 경로로 리다이렉트 |

## Android 창

헤더 메뉴의 Android 버튼으로 오른쪽 끝에 여는 보조창(`components/AndroidPanel.tsx`). Android Emulator나 system image는 mew 배포물에 넣지 않는다([ADR 0058](../.mew/docs/decisions/0058-mew-android-panel-optional-gateway.md)). 패널이 하는 일은 두 가지뿐이다.

- Linux·WSL에서는 `/dev/kvm`, macOS에서는 Emulator의 Hypervisor.Framework 가속 상태를 확인하고, Android SDK 도구(`sdkmanager`·`adb`·`emulator`·`avdmanager`), API 36 system image, AVD 존재 여부를 보여준다. Apple Silicon은 `arm64-v8a`, Intel/AMD는 `x86_64` image를 고르고, image가 없으면 설치 명령만 제시한 뒤 새로고침 후에 AVD 생성 명령을 제시한다.
- 안내 명령의 복사 아이콘 옆 \*\*▶\*\*는 서버가 정한 명령 ID를 전용 숨김 tmux 세션(`mewcmd-*`)에서 실행한다. 옆 터미널 아이콘은 `SessionTerminalPopup`으로 진행 화면과 대화형 입력을 열고, 명령이 끝나면 프로젝트 one-shot 명령어 버튼과 같은 경로로 자기 세션을 자동 종료한다. 브라우저가 보낸 임의 명령 문자열은 실행하지 않는다.
- 이미 떠 있는 Android WebRTC/gateway 주소를 입력하면 브라우저 창과 같은 loopback 프록시로 iframe에 연다.

권한은 브라우저 창·터미널과 같다 — **manager·owner만** 연다. 상태 점검 API는 emulator를 실행하지 않고, 프로세스 시작·설치·system image 다운로드도 하지 않는다. 따라서 Android 창을 열지 않으면 mew 기본 실행 경로에 붙는 무게는 패널 코드와 API 라우트뿐이다.

| 라우트 | 역할 | 하는 일 |
| --- | --- | --- |
| `GET /api/android/status` | **manager·owner** | Linux·WSL KVM 또는 macOS 가속, Android SDK, 호스트 아키텍처용 AVD 상태 점검. emulator 실행 없음 |
| `POST /api/android/commands/:id/run` | **manager·owner** | 서버 등록표의 Android 안내 명령을 one-shot tmux 세션에서 실행 |

## Documents 폴더 계약

Documents는 탭이 아니라 사이드바의 가상 폴더다. 실제 폴더는 현재 루트 프로젝트 안에서 owner가 고르며 기본은 `docs`다. 설정이 없고 옛 `.mew/docs`만 있으면 그 위치를 그대로 쓴다. 폴더가 없으면 빈 Documents 폴더를 만든다.

- 내부 식별자 `docs`는 유지한다. 문서·트리·검색·협업 방·git·저장 키가 이 이름을 공유하므로 UI 배치와 함께 바꾸지 않는다.
- 현재 Documents의 실제 최상위 폴더는 루트 프로젝트 트리에서 중복 표시하지 않는다.
- owner가 사이드바의 Documents를 우클릭하면 `DocsSettingsModal`이 열린다. 폴더 변경은 현재 루트 프로젝트 안에서만 허용하고, 가져오기는 기존 내용을 지운 뒤 교체하며, 내보내기는 대상 아래 `docs`로 복사한다.
- 폴더 선택은 서버 파일시스템을 읽는 `GET /api/fs/dirs`를 쓰며 owner 전용이다.

| 라우트 | 역할 | 하는 일 |
| --- | --- | --- |
| `GET /api/fs/dirs?path=` | **owner** | 그 폴더의 하위 폴더 목록 |
| `POST /api/docs/root` `{path}` | **owner** | 현재 루트 프로젝트 안에서 Documents 폴더 변경 |
| `POST /api/docs/import` `{path}` | **owner** | Documents를 통째로 교체(되돌릴 수 없음) |
| `POST /api/docs/export` `{path}` | **owner** | `{path}/docs`로 복사 |

## 편집 칸 (문서 탭 · 화면 분할)

편집 영역은 **칸(pane) 하나 이상**이다. 칸 하나가 `EditorPane.tsx` 하나고, 칸마다 **자기 문서 탭 줄 · 자기 도구 줄 · 자기 Yjs 협업 세션**을 들고 있다. 배치는 나무다(`utils/paneTree.ts`):

```ts
type PaneNode = { kind: 'leaf'; pane: string } | { kind: 'split'; dir: 'row' | 'col'; kids: PaneNode[] }
```

- **문서 탭을 (꾹 눌러 집은 뒤) 끌어다 놓으면 갈라진다.** 놓는 자리는 칸 넓이·높이의 \*\*가장자리 30%\*\*로 정해진다 (`dropZoneAt`) — 오른쪽 30%면 오른쪽에, 아래 30%면 아래에 새 칸이 생기고 그 탭이 거기로 간다. **가운데면 분할 없이 그 칸으로 옮기기**만 한다. 끄는 동안 놓일 자리가 반투명으로 미리 보인다.
- **사이드바에서 파일을 끌어 가장자리에 놓아도 같은 규칙으로 갈라진다** — 새 칸에 그 파일이 열린다. 가운데는 분할이 아니라 경로 텍스트 삽입이다("사이드바 항목 끌어놓기" 절).
- **분할 자리를 재는 대상은 칸의 본문 영역뿐이다** — 탭 줄은 뺀다. 넣으면 자기 줄 안에서 순서만 바꾸는 동안에도 "위로 분할" 미리보기가 번쩍인다.
- **다른 칸의 탭 줄에 놓으면 그 칸으로 옮겨진다**(가장자리를 따지지 않고 언제나 옮기기, 맨 뒤에 붙는다). 제 칸의 탭 줄은 순서 바꾸기이므로 드롭 자리로 치지 않는다(`App.tsx`의 `dropTargetAt`).
- **그 칸의 유일한 탭을 자기 칸 가장자리에 놓는 것은 무시한다** — 갈라도 옮기기 전과 같은 화면이다.
- 같은 방향 분할은 **중첩하지 않고 형제로 편다**(`splitLeaf`). 칸 크기는 **언제나 균등**이다 — 크기 값도 끌어서 조절하는 손잡이도 없다.
- 칸이 비면(마지막 탭을 닫으면) **저절로 접히고** 나무도 같이 줄어든다(`removeLeaf`·`prunePanes`). 마지막 한 칸은 비어도 남아 안내문을 띄운다.
- \*\*초점 칸(focused pane)\*\*이 키보드 단축키·검색·기록 되돌리기·터미널 선택 붙여넣기의 대상이다. 칸 아무 데나 누르면(`onPointerDownCapture`) 초점이 옮겨 가고, 초점 없는 칸의 탭 줄은 흐려진다. `useTabs`가 내주는 `tabs`/`activePath`/`activeTab`은 **초점 칸의 것**이다.
- **내용 캐시·자동저장은 칸이 아니라 경로 기준**이다. 같은 파일을 두 칸에 열면 같은 내용을 본다.
- 터미널•에이전트패널·시스템 자원 버튼은 칸이 아니라 **헤더 햄버거 메뉴**(`HeaderMenu`)에 있다 — 칸 도구 줄에 달면 같은 버튼이 여러 개 선다.
- 협업 참여자 표시(presence)가 서버에 알리는 파일은 **초점 칸의 것 하나**다 — 다른 칸에 열어둔 문서는 남에게 "보고 있는 중"으로 보이지 않는다.

### Ctrl+L 참조 (`경로:줄`)

편집기 안에서 Ctrl+L(`insertPathOrSelection`)을 누르면 지금 보고 있는 자리를 `programs/modoo-2026/사업계획서-0811.md:3` 꼴로 만들어 **보조창 입력칸 하나**에 써 준다. 선택이 있으면 `…:3-15`, 없으면 커서가 있는 줄 하나다. 뒤에 공백 한 칸이 붙어 바로 이어 칠 수 있다.

- **파일 종류를 가리지 않는다** — md 핫뷰(ProseMirror)든 코드·텍스트(CodeMirror)든 편집기가 붙으면 대상이다 (`.ProseMirror, .cm-editor` 안에서 눌렀을 때만). 줄 번호는 각 편집기의 `getSelectedLineRange`가 내고, 핫뷰는 화면상의 블록이 아니라 **md 원본 줄**로 환산한다(frontmatter 줄 수까지 더한다).
- **받는 창은 마지막으로 연 보조창 하나**다(터미널•에이전트패널 · 채팅). 그 창이 닫혀 있으면 지금 열려 있는 창으로 넘어가고, 하나도 안 열려 있으면 아무 일도 하지 않는다 (`utils/refTarget.ts`, 테스트 있음). App이 `mew:insert-ref`에 `detail.target`을 실어 보내고 **자기 이름이 아닌 창은 무시**한다 — 예전에는 열려 있는 창이 전부 받아 적어 쓰지도 않을 창에 찌꺼기가 남았다.
- 터미널•에이전트패널은 탭이 여럿이어도 **보이는 탭**만 받는다(안 보이는 탭도 마운트된 채로 살아 있다). 채팅 창만 글자 대신 파일 멘션 토큰(`[[프로젝트:경로]]`)으로 받는다 — 같은 이벤트의 `project`·`path`를 쓴다.
- 터미널 **안에서** 누른 Ctrl+L은 이 경로가 아니다 — `TmuxTerminal`이 직접 처리해 편집기 선택 글자(없으면 활성 파일 경로)를 셸에 찍는다.

## 실행

```bash
npm run dev     # 4999 — 개발 (vite HMR)
npm run build   # tsc + vite build → dist/
npm run serve   # 5000 — dist/ 필요
npm start       # build + serve
npm test        # node:test
npm run lint    # oxlint
npx tsc -b      # 타입만 (빌드 없이)
```

⚠️ `npm run build`**는 즉시 배포다** — 서버가 `dist/`를 디스크에서 읽어 서빙하므로, 빌드하는 순간 띄워 둔 화면이 바뀐다. 빌드와 재시작은 사용자가 직접 한다. 에이전트는 위 실행 불변식대로 검증까지만 하고 `mew`를 포함한 반영 명령을 실행하지 않는다.

**터미널에서 이 레포 파일을 고쳤는데 다음에 보니 되돌아가 있으면**, 사용자가 그 파일을 mew 에디터에 열어둔 채라 버퍼 저장이 디스크를 덮어쓴 것이다. 반영 여부를 다시 확인하고, 해당 파일을 닫거나 Revert File 하도록 안내한다.

### 설정

헤더의 계정/설정 메뉴에서 여는 `설정 > 화면`은 테마·언어와 함께 글꼴 세 벌을 브라우저별로 기억한다. 전역 UI 텍스트, Markdown 핫뷰 본문, Mono(코드 편집기·터미널·인라인/블록 코드·`font-mono` UI)는 서로 독립이며, 입력한 글꼴이 이 기기에 없으면 각 범주의 시스템 폴백 글꼴을 쓴다. 값은 `localStorage`의 `mew:fonts`에 저장되고 각 항목을 기본값으로 되돌릴 수 있다.

설정 파일은 **레포 밖**에 있다 — `~/.config/mew/config.env`(`XDG_CONFIG_HOME` 존중). 레포 안의 `.env`가 있으면 그것이 마지막에 덮으므로 개발 중 임시 덮어쓰기로 쓴다. 읽는 순서와 기본 경로는 `server/config.ts` 한 곳이 정한다 — **진입점의 첫 import여야 한다.** 뒤로 밀리면 `MEW_DATA_DIR`같은 값이 다른 모듈이 이미 읽어 버린 뒤라 조용히 무시된다.

| 변수 | 기본값 | 무엇 |
| --- | --- | --- |
| `MEW_WORKSPACE` | 앱 폴더의 부모 | 프로젝트들이 사는 폴더. `server/paths.ts`의 `WORKSPACE_ROOT`를 고정 경로로 되돌리지 않는다 — 앱과 워크스페이스를 분리해야 다른 폴더·다른 서버에 안전하게 배포할 수 있다 |
| `MEW_DATA_DIR` | `~/.local/share/mew` (옛 설치의 `<앱>/.data`가 있으면 그것) | 계정·세션·게스트 규칙·아이콘·RAG 인덱스/모델 캐시 |
| `MEW_TEAM_PORT` | 5000 | 서버 포트 |
| `MEW_BIND` | `127.0.0.1` | 서버가 들을 주소. 공개 기본값은 loopback이며, LAN 직접 접속이 꼭 필요할 때만 노출 주소를 명시한다. 서버 배포는 HTTPS 프록시·터널 뒤 `127.0.0.1`로 유지한다 |
| `MEW_COLLAB_RUST` | 없음(=JS Yjs) | `1`이면 협업 방 상태를 Rust(yrs)로 — 먼저 `npm run build:native` (아래 §협업 방) |
| `DATABASE_URL` | 없음 | `/db`용 Postgres. 없거나 접속 불가면 `/db` API만 503 |
| `MEW_RAG_ENABLED` | `1` | `0`이면 로컬 의미 검색만 끈다. 정확 검색은 항상 유지 |
| `MEW_RAG_MODEL` | `Xenova/multilingual-e5-small` | Transformers.js feature-extraction 모델(기본 384차원 계약) |
| `MEW_RAG_MAX_FILE_BYTES` | `1000000` | 이 크기를 넘는 단일 텍스트 파일은 의미 인덱스에서 제외 |

전부 선택이다 — 하나도 없어도 뜬다. 지금 값이 어디서 오는지는 `./mew status`.

### 프로젝트 검색 · 로컬 RAG

`Ctrl+Shift+F` 검색창의 `의미` 버튼은 현재 프로젝트의 보이는 텍스트 파일을 청크로 나눠 로컬 LanceDB에서 검색한다. 로그인 사용자 전용이며 외부 API로 문서를 보내지 않는다.

- 기본 모델 `Xenova/multilingual-e5-small` q8(384차원)은 첫 검색 때 약 130MB를 내려받아 `<MEW_DATA_DIR>/rag/models`에 캐시한다. Docker에서는 기존 `/data` 볼륨에 남는다.
- DB와 manifest는 `<MEW_DATA_DIR>/rag/indexes/<workspace-hash>`에 있다. Markdown·코드가 SSoT이고 이 폴더는 지워도 다음 검색에서 전부 재생성된다.
- 파일 크기·mtime fingerprint가 바뀐 파일만 재임베딩한다. docs는 MOC의 Current를 기본 검색하고 `이력` 버튼을 켰을 때만 History/raw와 대체 ADR을 포함한다.
- 모델 다운로드·초기 인덱싱이 실패하면 `GET /api/search/semantic`만 503이다. 기존 정확/정규식 검색은 영향 없다.
- API: `GET /api/search/semantic?q=&project=&history=0|1`, `GET /api/rag/status`, `POST /api/rag/reindex`(manager/owner). 결과는 파일 경로·시작/끝 줄·heading·점수·인용 문맥을 포함한다.

### Postgres만 Docker Compose로 띄우기 (선택)

현재 Docker Compose는 `/db` 기능의 Postgres만 보조한다. 앱 컨테이너에는 Dockerfile이 없으므로 `--profile app`은 실행하지 않는다. 네이티브 mew 서버에서 `/db`를 쓸 때만 다음을 사용한다.

```bash
npm run db:up     # Postgres만 127.0.0.1:55432에 기동
npm run db:down   # Postgres 중지
```

`DATABASE_URL`과 `MEW_PG_PASSWORD`는 레포에 커밋하지 않는 설정 파일에 둔다. 기본 연결 예시는 [.env.example](.env.example)에 있다.

### 사용자 관리 (호스트에서)

```bash
npm run users -- add <email> [role]   # 임시 비밀번호 발급 — 첫 로그인 때 변경 강제 (role 생략 시 member)
npm run users -- role <email> <role>  # 기존 계정의 역할 변경 (owner|manager|member)
npm run users -- reset <email>        # 임시 비밀번호 재발급 + 기존 세션 전부 무효화
npm run users -- remove <email>       # 삭제 (세션 즉시 무효화)
npm run users -- list
```

임시 비밀번호는 안전한 채널로 본인에게 전달한다. 최초 owner 계정은 이 CLI로만 만들 수 있다 (`npm run users -- add <email> owner`) — 이후로는 owner가 앱 내 설정 팝업에서 다른 계정의 역할을 바꿀 수 있다.

## /db 데이터베이스

에디터에서 `/db`를 치면 노션식 표 데이터베이스를 삽입한다 (v1은 표 보기만). 본문에는 참조 id만 저장되고(`<div data-mew-db="uuid">`), 실제 데이터는 **Postgres가 SSoT**다.

- **컬럼 타입**: 텍스트 · 숫자 · 체크박스 · 날짜. 열 헤더의 `+`로 추가하고, 헤더를 눌러 이름을 바꾼다.
- **실시간 협업**: 행·셀·열·제목 변경이 인프로세스 허브를 거쳐 WS로 같은 DB를 보는 모든 세션에 즉시 방송된다.
- **참조(뷰 전용)**: `/db 참조`로 기존 데이터베이스를 읽기 전용 뷰로 삽입하거나, 외부 Postgres 테이블(`schema.table`)을 `external`로 붙일 수 있다. 참조 노드는 절대 원본을 수정하지 않는다.
- **프로젝트 격리**: 물리 테이블은 프로젝트별 스키마 `mew_{프로젝트}`에, 메타데이터(제목·컬럼)는 카탈로그 스키마 `mew`에 저장된다. 다른 프로젝트의 dbId로는 조회조차 되지 않는다.
- **전체 DB 팝업**: 헤더의 원통 아이콘(설정 옆, 로그인 사용자 전용)을 누르면 이 프로젝트의 모든 데이터베이스를 한 팝업에서 골라 열람·편집한다 (에디터 노드와 같은 표를 재사용).

```bash
npm run db:up     # docker-compose로 Postgres 기동 (127.0.0.1:55432, 외부 미노출)
npm run db:down   # 중지
```

접속 정보는 `.env`의 `DATABASE_URL`로 준다(`.env.example` 참고). `DATABASE_URL`이 없거나 접속 불가면 `/db` API는 503을 반환하고, 통합 테스트는 통째로 skip된다 (에디터의 나머지 기능은 정상 동작).

### 보안

- 모든 값은 파라미터(`$1`)로, 모든 식별자는 앱이 생성하거나 화이트리스트 검증(`[a-z0-9_]+`) 후 쿼팅한다 (`server/db/identifiers.ts`) — SQL 인젝션 차단.
- external(참조) 테이블은 **읽기 전용**이다. 원본 테이블에 대한 INSERT/UPDATE/DELETE/DDL은 일절 없다.
- `/db`의 모든 REST·WS는 마운트 시 `requireAuthenticated`라 **게스트는 행 데이터를 받지 못한다**.
- 백엔드 계층: `pool → identifiers → schema → catalog → databaseService → hub`, REST는 `server/db/routes.ts`, 실시간 릴레이는 `server/db/socket.ts`.

보안 경계를 구현하는 지점: `server/guestAccess.ts`(게스트 파일 단위 승인), `server/paths.ts`(deny 목록), `server/reqAuth.ts`(역할 게이팅). **정책 자체는 [SECURITY.md](SECURITY.md)가 기준본**이고, 여기 코드는 그것의 구현이다 — 정책을 바꾸면 docs를 같은 세션에 고친다.

## 명령어 버튼 — 두 종류

이름이 비슷하지만 별개 기능이다. 사이드바의 ▶는 **프로젝트별 배치 실행**, 터미널 줄의 버튼은 **지금 보고 있는 세션에 타이핑**이다.

|  | 사이드바 프로젝트 ▶ 버튼 | 터미널 버튼 |
| --- | --- | --- |
| 설정 파일 | `<프로젝트>/.mew/cmd-button.json` | `.data/term-button.json` (**전역** — 모든 프로젝트·탭 공통) |
| 편집 방법 | UI의 `＋ 명령 추가`·줄 꾹 누르기(우클릭), 또는 파일 직접 편집 | UI의 `+`·버튼 꾹 누르기(우클릭) |
| 실행 위치 | 전용 숨김 세션 `mewcmd-<해시>` | 지금 열려 있는 tmux 세션 |
| 실행 주체 | 서버(`tmux send-keys`) | 클라이언트(터미널 WebSocket에 직접 타이핑) |

### 사이드바 프로젝트 ▶ 버튼 (.mew/cmd-button.json)

사이드바 상단의 ▶는 루트 프로젝트 명령 탭을 열고, 하위 프로젝트 줄의 ▶는 그 하위 프로젝트의 명령어 팝오버를 연다. 각 프로젝트의 `.mew/cmd-button.json` 에 정의한 명령을 tmux에서 바로 실행한다 (owner/manager 전용 — tmux와 같은 보안 경계). 하위 프로젝트를 별도 탭으로 옮기지 않고도 자기 목록을 실행할 수 있다.

파일 형식:

```json
{
  "commands": [
    { "name": "빌드", "command": "npm run build" },
    { "name": "개발 서버", "command": "npm run dev" }
  ]
}
```

- ▶ 아이콘을 누르면 그 명령이 **프로젝트 폴더를 cwd로** 하는 tmux 세션에서 실행된다. 같은 버튼은 늘 같은 세션(`mewcmd-<해시>`)으로 이어져, 다시 누르면 그 세션에서 재실행된다.
- **실행 중인 줄의 ▶는 ■(정지)가 된다** — 누르면 그 명령의 세션만 죽는다(`DELETE /api/tmux/sessions/:name`). 실행 여부는 서버가 붙여주는 `running`이 정하므로, 다른 곳에서 세션이 죽으면 다음 갱신에 ▶로 돌아온다.
- 명령어 세션은 특수 이름(`mewcmd-*`)이라 **터미널 탭 목록에는 뜨지 않는다**(`isCommandSession`으로 필터). 각 줄의 터미널 아이콘을 누르면 팝업으로 그 세션을 본다 — 팝업의 \*\*\[종료\]\*\*는 세션을 죽이고 닫고, \*\*\[닫기\]\*\*는 세션을 살려둔 채 팝업만 닫는다.
- **실행할 명령 문자열은 언제나 서버가 파일에서 읽는다** — 실행 요청 본문의 명령은 신뢰하지 않는다. (편집은 별도 경로다: `PUT`으로 목록을 통째로 저장하면 그 다음 실행이 새 파일 내용을 읽는다.)
- 편집: 드롭다운 맨 아래 `＋ 명령 추가`, 기존 줄을 **꾹 누르거나 우클릭**하면 수정·삭제. 저장은 목록 전체 쓰기라 손으로 고친 파일과 같은 자리를 덮어쓴다(`{ "commands": [...] }` 형태로 정규화되고 다른 최상위 키는 보존되지 않는다). **이름을 바꾸면 세션 이름 해시가 바뀐다** — 그전에 띄워둔 실행 세션은 살아 있되 이 버튼에서는 더 이상 보이지 않는다.
- 이름은 프로젝트 안에서 겹칠 수 없다(겹치면 두 명령이 한 세션을 공유하게 되므로 400).
- 서버: `server/cmdButtons.ts`(파일 파싱·정규화·쓰기·세션 이름) + `GET/PUT/POST /api/cmd-buttons*`(owner/manager). 클라이언트: `src/components/CommandButtonMenu.tsx`·`SessionTerminalPopup.tsx`(세션 팝업은 예약 작업과 **같은 컴포넌트**를 쓴다 — 세션 이름·제목·실행 함수만 다르게 넘긴다). 하위 프로젝트의 드롭다운은 사이드바의 overflow에 잘리지 않도록 **body로 포털해 fixed로** 띄운다.

### 터미널 버튼 (.data/term-button.json)

터미널•에이전트패널의 **tmux 터미널 탭** 버튼 줄(선택 모드 버튼과 같은 줄) 왼쪽에 뜬다. 누르면 지금 보고 있는 셸 세션에 하단 입력칸 전송과 똑같은 경로로 들어간다. 에이전트 TUI 탭에는 이 셸 명령 버튼을 표시하지 않는다.

```json
{
  "commands": [
    { "name": "정리", "command": "/clear", "icon": "i:sparks" },
    { "name": "커밋", "command": "/commit", "icon": "i:git-commit", "iconOnly": true },
    { "name": "모델", "command": "/model" }
  ]
}
```

- 목록은 **전역 하나**다 — 프로젝트나 터미널 탭마다 다르지 않다. 그래서 프로젝트 폴더가 아니라 서버가 `.data/`에 저장한다(`.data/`는 `paths.ts` deny 목록이라 편집 API로 열리지 않는다). 손으로 고칠 파일이 아니라 **UI가 편집 수단**이다: `+`로 추가하고, 버튼을 꾹 누르면(데스크톱은 우클릭) 이름·명령어·아이콘 수정과 삭제가 나온다.
- `icon`은 **프로젝트 아이콘과 같은 표기**다 — `i:{키}` · 이모지 · `svg:{마크업}`. 고르는 칸도 같은 `IconPicker`라 SVG 직접 넣기까지 그대로 된다(검사는 `normalizeIconValue` 하나).
- `iconOnly: true`면 그 버튼은 **이름을 감추고 아이콘만** 그린다(버튼마다 따로 정한다 — 편집 창의 `이름 숨기고 아이콘만 보이기`). 아이콘이 없으면 빈 칸이 되므로 무시하고 이름을 그대로 둔다.
- 실행은 서버가 하지 않는다. 클라이언트가 이미 열려 있는 터미널 WebSocket으로 직접 보내므로 세션·cwd가 화면과 항상 일치한다. 그 소켓 자체가 owner/manager 경계라 별도 게이팅이 없다.
- 서버: `server/termButtons.ts` + `GET/PUT /api/term-buttons`(owner/manager, 목록 읽기·쓰기만). 클라이언트: `src/components/TermButtonBar.tsx` — `AgentPanel`이 tmux 터미널 탭의 `TmuxTerminal`에 `renderCommandButtons` 렌더 프롭으로 주입한다(터미널 패키지는 이 기능의 API를 모른다).

### 시스템 자원 팝업

에디터 우상단 도구 줄, **터미널 버튼 바로 아래 계기판 아이콘** — 서버가 도는 기계의 CPU·메모리·GPU 사용량과 온도, 그리고 **프로세스별 점유**를 2초마다 새로 읽어 보여준다. 터미널 버튼과 달리 터미널이 열려 있어도 계속 보인다.

- 서버: `server/sysStats.ts` + `GET /api/system-stats`(owner/manager — 셸과 같은 경계다). 클라이언트: `src/components/SystemStatsModal.tsx`.
- CPU 사용률은 `os.cpus()` 누적 시간의 **직전 호출 대비 증분**이다. 표본을 모듈 하나가 들고 있어 창이 여럿이면 각자의 구간이 짧아질 뿐 값은 유효하다.
- 메모리 여유는 `/proc/meminfo`의 `MemAvailable`을 쓴다 — `os.freemem()`은 캐시를 사용 중으로 세서 리눅스에서 항상 과장된다.
- GPU는 `nvidia-smi --query-gpu=...` 한 번. 없으면 빈 배열이고 팝업은 "GPU 정보 없음"을 띄운다.
- CPU 온도는 `/sys/class/thermal/thermal_zone*/temp`. \*\*WSL·컨테이너에는 노출되지 않아 `null`\*\*이고, 그때는 팝업이 그 사실을 한 줄로 알린다(GPU 온도는 `nvidia-smi`에서 따로 오므로 WSL에서도 뜬다).
- `processes[]`는 `/proc/<pid>/stat`을 직접 읽는다 — `ps %cpu`는 **프로세스 수명 전체의 평균**이라 "지금 누가 먹고 있나"에 못 쓴다. CPU는 `utime+stime` tick의 직전 표본 대비 증분이고 코어 하나 기준이라 100%를 넘을 수 있다. RSS·CPU·GPU가 모두 0인 항목(커널 스레드)은 빼고 보낸다. 프로세스별 GPU는 `nvidia-smi --query-compute-apps`가 주는 **메모리(MB)뿐**이다 — 프로세스별 GPU 사용률은 그 쿼리에 없다. `/proc`이 없는 환경(비리눅스)에서는 빈 배열.
- **추이 그래프는 클라이언트가 모은다** — 서버에 링버퍼가 없다. 팝업이 열려 있는 동안 최근 60표본 (2분)을 들고 있다가 닫으면 버린다. 개별 프로세스 그래프도 이 이력에서 pid로 뽑는다.

### 예약 작업 (.data/schedules.json)

도구 줄 **시계 아이콘** — "언제 / 어느 폴더에서 / 어떤 에이전트로 / 어떤 프롬프트를" 을 등록하면 그 시각에 에이전트가 무인으로 돈다. owner/manager만(임의 프롬프트가 무인 실행되는 표면 — 셸과 같은 경계).

- 서버: `server/schedules.ts` + `server/runAgentJob.ts` + `GET/PUT /api/schedules`, `POST /api/schedules/run`(지금 실행). 클라이언트: `src/components/ScheduleModal.tsx`, 크론식↔GUI 변환은 `src/utils/cron.ts`.
- **원본은** `.data/schedules.json`**, crontab은 파생물이다.** 저장할 때마다 `# mew-job:<id>` 마커가 붙은 줄만 걷어내고 다시 쓴다 — 손으로 쓴 크론 줄은 건드리지 않고, 창에도 읽기 전용으로 보여준다.
- **실행은 잡 전용 tmux 세션 안에서 일어난다.** 크론 줄이 하는 일은 세 가지뿐이다 — `tmux new-session -d -s <세션> -c <설정한 폴더>`(이미 있으면 실패시키고 그 세션을 재사용) → `send-keys -l <에이전트 명령>` → `send-keys Enter`. 명령어 버튼과 같은 구조라, 무인 실행이 끝난 뒤에도 화면이 세션에 남아 각 줄의 **터미널 아이콘**으로 그대로 들여다볼 수 있다(같은 `SessionTerminalPopup`).
- 세션 이름은 `mewcmd-job-<id 앞 8자>`다. 명령어 버튼과 같은 프리픽스라 **터미널 탭 목록에는 뜨지 않고**(`isCommandSession` 필터), 팝업의 \*\*\[종료\]\*\*는 그 세션을 죽인다(`DELETE /api/tmux/sessions/:name`). 팝업 안의 **실행** 버튼과 `POST /api/schedules/run`은 크론과 **똑같은 세션·똑같은 명령**을 쓴다 — 예약 시각을 기다리지 않고 확인할 수 있다. 실행 요청 본문에서 받는 건 잡 `id`뿐이다.
- **프롬프트는 셸에 인라인하지 않는다.** `.data/schedules/<id>.prompt`에 쓰고 명령이 그 파일을 읽는다 — 따옴표·개행, 그리고 크론에서 stdin 구분자로 먹히는 `%`를 통째로 피한다(명령 쪽 `%`는 escape).
- 실행 명령은 에이전트별 템플릿이 아니라 공통 ACP runner다: `node server/runAgentJob.ts --runtime <id> --prompt-file <프롬프트파일> --log-file <로그> --cwd <폴더>`. runner가 `server/agentRuntimes.ts`의 같은 등록표로 ACP 런타임을 띄운다([ADR 0060](../.mew/docs/decisions/0060-mew-shared-agent-runtime-registry.md)). 사용자가 명령 문자열을 넣는 곳은 없다. `node`·`tmux`는 저장 시점에 `command -v`로 **절대 경로로 굳힌다** — cron의 PATH로는 이름만으로 못 찾는다.
- 크론 5필드는 `[A-Za-z0-9*/,-]`만 통과시킨다(crontab 주입 차단). 출력은 세션 화면에 보이면서 동시에 `runAgentJob.ts`가 `.data/schedules/<id>.log`에 덧붙이고, 그 파일의 mtime이 창의 "마지막 실행"이다. **로그는 자동으로 줄지 않는다** — 커지면 직접 지운다.
- 앞 실행이 아직 돌고 있는데 다음 예약 시각이 오면 **같은 세션에 그대로 타이핑된다**(=돌고 있는 에이전트의 stdin으로 들어간다). 주기를 실행 시간보다 짧게 잡지 말 것.
- 잡을 지우면 저장할 때 그 잡의 세션도 함께 죽인다 — 숨은 세션이라 UI 어디에서도 잡을 수 없기 때문.

### 숨김 목록 (.data/ignore.json)

파일 목록·검색·트리 감시에서 통째로 건너뛸 **이름** 목록. 경로가 아니라 이름이라 어느 깊이에 있든 그 이름의 폴더·파일이 사라진다(`dist` → 모든 프로젝트의 모든 `dist/`). 설정 창 → **숨김 목록**에서 고친다(owner/manager). 파일이 없으면 `server/ignoreList.ts`의 `DEFAULT_IGNORE`를 쓴다.

```json
{ "names": ["dist", ".next", "node_modules", ".git", ".data"] }
```

- 목록은 **전역 하나**다 — 프로젝트마다 다르지 않다. 그래서 `.data/`에 서버가 저장한다.
- `.git`·`node_modules`·`.data`는 `paths.ts`의 `DENY_SEGMENTS`가 API 계층에서 따로 막는다. 목록에서 빼도 계속 안 보이므로, 저장할 때 서버가 도로 넣고 UI는 **고정**으로 표시한다 — 지울 수 있는 것처럼 보이면 "지웠는데 왜 그대로냐"가 된다.
- 저장하면 서버가 감시자를 전부 접고(`resetTreeWatchers`) `tree` 신호를 보낸다. 살아 있는 감시자는 옛 규칙으로 만든 트리 서명을 들고 있어 새 규칙을 "변화 없음"으로 흘려버리기 때문 — 접어두면 클라이언트가 새 트리를 받아 갈 때(`GET /api/tree`) 새 규칙으로 다시 등록된다.
- `build/`는 기본 숨김이 **아니다**. 트리는 안의 APK/AAB만 노출하고 나머지·빈 폴더는 접으며 (`tree.ts`의 `DOWNLOAD_ONLY_DIRS`), 감시는 숨김 목록과 별개로 `build`에 내려가지 않는다.
- **owner·manager의 트리에는 이 목록도 확장자 필터도 적용되지 않는다** — 있는 그대로 다 보인다. 목록은 계속 살아서 member 이하의 트리와, 역할과 무관하게 **검색·트리 감시**에 적용된다.
- 사이드바는 `GET /api/tree?path=<폴더>`로 해당 폴더의 **직접 자식만** 읽는다. 프로젝트 전환 때는 계정에서 복원한 펼침 상태와 자식 스냅샷을 먼저 그리고 열린 경로의 직접 자식만 갱신한다. 접힌 조상 아래와 닫힌 최상위 폴더는 펼칠 때 읽고, 받은 목록·진행 중 요청은 재사용한다. Docs·하위 프로젝트를 포함한 사이드바 스크롤은 계정에 중앙 항목의 트리 식별자·경로·항목 내 비율로 저장하며, 지연 로딩 중에도 같은 항목을 중앙에 복원한다. 사용자가 조작하면 초기 보정을 끝낸다([ADR 0125](../.mew/docs/decisions/0125-mew-sidebar-center-anchor-and-visible-loading.md)). `path` 없는 API 호출은 기존 서버 도구 호환을 위해 전체 재귀 트리를 유지한다. 정책 기준본은 [SECURITY.md](SECURITY.md)이고, 판정은 `server/tree.ts`의 `isPathVisible`과 `server/reqAuth.ts`의 `seesEveryFile` 둘뿐이다.
- 서버: `server/ignoreList.ts` + `GET/PUT /api/ignore`(owner/manager). 클라이언트: `src/components/SettingsModal.tsx`의 `IgnorePanel`.

### 사이드바 항목 끌어놓기

파일·폴더를 끌면 **놓는 자리에 따라 뜻이 다르다**. 여러 뜻을 한 드래그에 담으려고 `@mew/ui`의 `pathDrag.ts`가 전용 MIME(`application/x-mew-path`)과 `text/plain` 양쪽에 경로를 싣고, 폴더는 `application/x-mew-dir`을 하나 더 실어 **값을 못 읽는** `dragover` **단계에서도 파일과 구분**되게 한다.

| 놓는 곳 | 결과 |
| --- | --- |
| 사이드바의 폴더 (빈 곳 = 프로젝트 루트) | 그 폴더로 **이동**(`POST /api/rename`) |
| 에디터 칸의 **가장자리 30%** (파일만) | 탭 드래그와 같은 규칙으로 **그 방향 화면 분할** + 새 칸에 그 파일이 열린다 |
| 에디터 Hotview·Plain (가운데) | 놓은 자리에 **경로 텍스트** 삽입 |
| 터미널 화면 | 셸에 그대로 **타이핑**(Enter는 보내지 않는다 — 명령을 완성하는 건 사용자다) |
| 터미널 하단 입력칸 | 커서 자리에 **경로 삽입**(선택 영역이 있으면 대체) |

가장자리 분할 가로채기는 `App.tsx`가 칸 컨테이너의 **캡처 단계** `dragover`/`drop`에서 한다 (`pathDropTargetAt`) — 가운데·폴더는 `preventDefault` 없이 흘려보내 아래 표의 원래 뜻을 지키고, 가장자리 드롭은 `stopPropagation`으로 끊어 ProseMirror의 경로 삽입이 뒤따르지 않게 한다. 새 칸은 `useTabs.splitEmptyPane`이 비워서 세우고 탭은 `openFile(paneId)`가 붙인다.

- `dragover`**에서는** `getData()`**가 언제나 빈 문자열이다**(DataTransfer 보호 모드). 받는 쪽 판정은 `hasPathDrag`(=`types` 검사)로 하고, 값 읽기(`pathFromDrag`)는 `drop`에서만 한다. 여기서 헷갈리면 `preventDefault`를 못 해 드롭 자체가 발생하지 않는다.
- `effectAllowed`는 `copyMove`다 — `move`만 허용하면 `dropEffect='copy'`로 받는 에디터·터미널에서 드롭이 통째로 거부된다. 트리 안 폴더는 자기 `dragover`에서 `move`를 명시해 원래 뜻을 지킨다.
- 에디터는 **전용 MIME이 있을 때만** 가로챈다. 바깥에서 끌어온 이미지·텍스트는 프로젝트의 `.mew/assets/`에 업로드되고 본문에 링크로 삽입된다. UUID 파일명과 프로젝트 id를 담은 `/api/asset` 링크는 종전 R2 공개 URL처럼 링크를 아는 사람이 볼 수 있다. Git이 무시하지 않는 새 asset은 프로젝트 저장소에 자동 커밋되며, 기존 R2 링크 22개는 `.mew/assets/`로 이관 완료했다.

**바깥(파일 탐색기)에서 사이드바로 끌어놓기**는 놓은 폴더(빈 곳 = 프로젝트 루트)에 그 파일을 **그대로 저장**한다(`POST /api/upload-into`, multipart `file`·`destDir`). 판정은 `dataTransfer.types`에 `'Files'`가 있는지로 하고, 그때만 `dropEffect='copy'`가 된다. 이름이 겹치면 서버가 `이름 copy`로 비켜 쓰고, 여러 개를 놓으면 **순서대로** 올린다(동시에 보내면 같은 빈 이름을 함께 집는다). 에디터 본문 드롭은 `.mew/assets/`에 UUID 이름으로 저장하는 반면, 사이드바 드롭은 바이트와 원래 이름을 놓은 폴더에 보존하고 Git에 커밋한다.

### 표 열 너비 (.mew/table-layout.json)

Hotview에서 표의 세로선을 끌어 조절한 **열 너비**는 마크다운이 담지 못한다(HTML `<table>`로 쓰면 담기지만 plain 모드가 지저분해진다). 그래서 본문은 순수 md 표로 두고, 너비만 그 프로젝트의 `.mew/table-layout.json`에 문서 경로별로 저장한다.

```json
{
  "version": 1,
  "docs": {
    "ops/repos.md": [[220, 380, 160], null, [120, 120]]
  }
}
```

- 바깥 배열 = **그 문서 안 표의 등장 순서**, 안쪽 배열 = 그 표의 열 너비(px). `null`은 저장된 너비가 없는 표, `0`은 아직 끌지 않은 열이다.
- 표를 **추가·삭제·이동하면 순서가 밀려 너비가 어긋날 수 있다.** 다시 끌면 덮어써진다 — 본문 md를 건드리지 않는 대가다.
- 복원은 본문 시딩 뒤에 한 번, `addToHistory: false`(collab이면 `SEED_ORIGIN`)로 들어간다. 사용자의 undo 스택에 올라가면 Ctrl+Z 한 번에 너비가 통째로 되돌아가기 때문이다. **콘텐츠를 코드로 시딩하는 곳은 전부 이 규칙을 따른다** — `SEED_ORIGIN` 트랜잭션으로 감싸지 않으면 시딩이 사용자 undo 스택에 잡혀 Ctrl+Z 한 번에 문서 전체가 사라진다(`Editor.tsx`).
- **불러오기에 실패하면 저장도 하지 않는다.** 못 읽은 것을 "너비 없음"으로 오해해 덮어쓰면 저장돼 있던 값이 사라진다.
- 서버: `server/tableLayout.ts` + `GET /api/table-layout`(게스트는 보기 권한 필요)· `PUT /api/table-layout`(로그인 필요). 클라이언트: `packages/editor/src/Editor.tsx`의 `readTableWidths`/`applyTableWidths`, 주입은 `EditorApi.fetchTableLayout`/`saveTableLayout`.

### 리스트 첫 항목 들여쓰기 (`- - b`)

Tab은 리스트 항목을 한 단계 들여쓴다. 기본 `sinkListItem`은 **바로 앞 형제 항목 안으로** 밀어 넣는 방식이라 앞에 형제가 없는 첫 항목에서는 아무 일도 하지 않는다. mew는 그 자리에 **자기 줄이 없는 부모 항목**을 만들어 들여쓴다 — 마크다운으로는 `- - b`, Shift+Tab이 그대로 되돌린다.

- 그래서 `listItem`의 content가 기본값 `paragraph block*`이 아니라 `(paragraph|bulletList|orderedList) block*`다 (`packages/editor/src/editor/listIndent.ts`의 `IndentableListItem`). 문단이 필수면 markdown-it이 중첩으로 읽어 준 `- - b`의 HTML을 항목 안에 넣지 못해 두 리스트로 풀려, 들여쓰기가 왕복에서 사라진다.
- **클라이언트(**`Editor.tsx`**)와 서버(**`serverExtensions.ts`**)가 같은** `IndentableListItem`**을 써야 한다**.한쪽만 바꾸면 협업 병합에서 문서가 갈라진다. 그래서 정의는 한 모듈에만 둔다.
- 부모 마커 없는 `- b`로는 저장할 수 없다 — 마크다운 규칙상 다시 읽으면 최상위 항목이 된다.

## 터미널•에이전트패널 (ACP 채팅 · tmux TUI · 셸)

런타임의 `사용`을 누르면 서버가 현재 프로젝트 루트 cwd를 확인한 뒤에만 탭을 만든다. 확인 중에는 선택기를 닫지 않고 진행 상태를 표시하므로 cwd 없는 빈 탭은 만들지 않는다.

헤더의 통합 버튼은 **현재 루트 프로젝트**에 묶인 터미널·AI 에이전트 탭을 연다. 기존의 별도 터미널 보조패널은 없으며 ``` Ctrl+\``· ```Alt+T`·`Alt+L`은 모두 이 패널을 토글한다. 프로젝트마다 독립 탭 목록을 가지며, 프로젝트를 오가면 창은 그대로 둔 채 그 프로젝트의 탭으로 바뀐다. 새 탭의 cwd는 현재 프로젝트 루트다. `tmux 터미널\`은 탭별 기본 셸, Claude Code·Antigravity는 탭별 공식 CLI TUI, Codex·Hermes·Kimi·OpenClaw·OpenCode·Cursor·Prime은 [ACP](https://agentclientprotocol.com) 채팅 UI를 쓴다. 근거는 [ADR 0034](../.mew/docs/decisions/0034-mew-agent-panel-acp-reintroduction.md)·[ADR 0117](../.mew/docs/decisions/0117-mew-terminal-agent-tabs-for-claude-and-antigravity.md)·[ADR 0119](../.mew/docs/decisions/0119-mew-unified-terminal-agent-panel.md), 권한 경계는 [SECURITY.md](SECURITY.md). 데스크톱에서는 창 왼쪽 경계선 전체를 좌우로 끌어 폭을 조절하며, 조절한 폭은 브라우저에 남는다.

⚠️ ACP 채팅 런타임을 `serve.ts` 요청 핸들러 안에서 블로킹 실행하지 않는다. terminal 런타임의 시작 요청은 등록표의 고정 CLI를 tmux에 타이핑한 뒤 즉시 끝나며, 실제 TUI 수명과 스트리밍은 tmux가 소유한다.

- 서버: `server/agentRuntimes.ts`(공통 런타임·표면 등록표) + `server/agentTerminal.ts`(terminal 탭의 tmux 수명) + `server/agentDefaults.ts`(ACP 런타임별 모델·권한 기본값) + `server/agentAcp.ts`(ACP 세션) + `server/agentHost.ts`(ACP 탭별 독립 감독) + `server/agentWs.ts`(WS↔감독 릴레이). 클라이언트: `src/components/AgentPanel.tsx`가 ACP 채팅과 `@mew/tmux-term` 터미널 본문을 표면별로 고른다. 접근은 **owner/manager**(`authorizeTmux`와 같은 집합) — 어느 표면이든 셸을 쓸 수 있어 tmux와 같은 경계여야 한다.
- ACP 채팅 입력창은 `/`로 로컬 스킬을, `@`로 하위 프로젝트·현재 프로젝트의 폴더·파일을 검색해 넣는다. `@` 결과는 **하위 프로젝트 → 폴더 → 파일** 순서이고 같은 종류 안에서는 가나다순이다. 프로젝트 목록은 `GET /api/projects`가 역할에 맞게 돌려주며, 고르면 기존처럼 `#프로젝트명`이 들어간다. 폴더·파일은 `[[프로젝트:경로]]` 토큰으로 들어간다. 스킬 목록은 `GET /api/skills`가 `CODEX_HOME/skills`와 `<워크스페이스>/.agents/skills`의 `SKILL.md`를 읽어 만든다. `/스킬명`을 고르면 브라우저는 스킬 id만 WS에 싣고, 서버가 `server/agentRuntimes.ts`의 런타임 등록표로 실제 프롬프트를 합성한다. **채팅과 입력창 사이의 경계선 전체**를 위아래로 끌어 입력창을 화면 높이의 80%까지 늘릴 수 있다(키보드는 경계선에서 ↑·↓).
- 질문 위에는 전송 시점의 **모델 · 추론 정도 · 권한**을 양쪽 선과 함께 남긴다. 첫 질문도 표시하며, 이전 질문과 셋 중 하나라도 달라질 때만 다시 표시한다. 이 값은 ACP 이벤트 전사에 같이 저장돼 재접속·세션 복원 뒤에도 당시 설정을 보인다.
- `+`와 탭이 없을 때 가운데의 **새 탭** 버튼은 탭을 먼저 만들지 않고 **새 탭 선택기**를 연다. 런타임을 고르면 그 이름의 탭이 열리고, `tmux 터미널`은 전용 셸 세션을, Claude·Antigravity는 전용 tmux TUI를, ACP 런타임은 채팅 세션을 시작한다. 에이전트셋은 모델·역할을 주입할 수 있는 ACP 채팅 런타임만 대상으로 한다. 선택 전에는 탭·WS·프로세스가 없고, 탭 이름은 직접 바꿀 수 있다. 정의는 `GET`·`PUT /api/agent-sets`(owner/manager)로 `<DATA_DIR>/agent-sets.json`에 저장된다 ([ADR 0095](../.mew/docs/decisions/0095-mew-agent-sets-as-tab-presets.md)·[ADR 0119](../.mew/docs/decisions/0119-mew-unified-terminal-agent-panel.md)).
- 답변의 **현재 워크스페이스 파일 링크**를 누르면 브라우저 새 탭이 아니라 같은 mew에서 해당 프로젝트와 문서 탭을 연다. `:줄`·`#L줄`이 붙으면 그 줄로 이동하며, Markdown도 정확한 원본 줄을 보여 주기 위해 이 경우 Plain으로 연다. `GET /api/agent-file-link?href=`가 서버 절대경로를 노출하지 않고 `{project,path,line}`으로 검증·변환한다(owner/manager). 웹 링크는 계속 새 브라우저 탭으로 연다.
- 탭의 \*\*작업 경로(cwd)\*\*는 새 탭을 열 때 현재 워크스페이스 루트로 정해지며 화면에서 바꾸지 않는다. 경로는 ACP 세션·히스토리의 기준으로 계속 저장하지만, 주소창 형태의 입력줄은 없다 ([ADR 0097](../.mew/docs/decisions/0097-mew-agent-panel-removes-cwd-bar.md)).
- ACP 채널은 `/api/agent/ws?runtime=<id>&tab=<id>&cwd=<absolute-path>&resume=<session-id>`이고 terminal 표면은 `POST /api/agent-runtimes/:id/terminal/:tab`으로 전용 tmux를 준비한 뒤 기존 `/api/tmux/ws?session=<server-name>`에 붙는다. 어느 쪽이든 **탭 하나가 세션 하나**다. 패널·브라우저를 닫아도 세션은 남으며, 탭의 `×`만 ACP 감독 또는 terminal tmux를 종료한다. terminal tmux 이름은 `mewagent-*`로 서버가 만들고 사용자 세션 목록에서는 숨긴다.
- **설치와 로그인은 별개다**. ACP 런타임은 인증 센터의 등록된 browser/terminal 작업을 쓰고, Claude·Antigravity는 탭에 열린 공식 TUI의 로그인 흐름을 그대로 쓴다. Mew는 두 terminal 런타임의 OAuth 토큰이나 승인 코드를 별도 API로 받거나 저장하지 않는다.
- 탭 목록·이름·런타임·cwd별 마지막 세션 ID는 **계정에 저장**하고 루트 프로젝트 절대 경로별로 분리한다. 브라우저의 `mew:agent-tabs:<root-path>`는 서버 응답 전 연결에 쓰지 않는 로컬 fallback뿐이다. 저장 PUT은 화면마다 한 번씩 직렬화하며, 전송 중 갱신이 여럿 생기면 마지막 스냅샷만 이어 보내 오래된 응답이 최신 thread 포인터를 되돌리지 못하게 한다. 서버 복원이 끝난 뒤에만 활성 탭의 WS를 붙이므로 localStorage의 낡은 세션으로 먼저 연결하지 않는다. 세션 ID는 탭을 닫을 때 함께 지워지고, 같은 탭에서 런타임이나 cwd를 갈아타면 각 조합의 대화 포인터를 따로 보존한다. 마지막으로 보던 탭도 같은 루트 경로별로 남는다(`mew:agent-active-tab:<root-path>`) — 창을 다시 열거나 브라우저를 껐다 켜면 그 탭이 선다. **붙는 탭은 그 하나뿐이다**(복원된 나머지 탭은 눌러서 열 때 붙는다 — 탭마다 프로세스 하나라). 스와이프로 창·탭을 전환하거나 닫는 동작은 없다. 이 작업은 플로팅 핸들이 맡는다. 탭 이름은 선택한 런타임 또는 에이전트셋 이름으로 시작하고, 탭을 두 번 누르면 직접 고친다 ([ADR 0093](../.mew/docs/decisions/0093-mew-account-synced-project-and-agent-tabs.md)·[ADR 0096](../.mew/docs/decisions/0096-mew-agent-tabs-created-after-selection.md)).
  - 새 탭은 선택 후에만 생기므로, 선택 전 히스토리 조회·세션 입력을 위한 빈 탭은 없다. 새 세션은 선택 직후부터 해당 탭에서 시작하며, 지난 세션을 고르는 기능은 탭에서 계속 제공한다
  - 플로팅 핸들의 `오른쪽 탭` 다음 `탭 닫기`는 현재 전면 표면의 활성 탭을 닫는다
  - 같은 세션을 두 탭에서 열지 않는다(목록에서 잠근다) — 현재 mount된 탭뿐 아니라 같은 계정에 저장된 다른 루트 프로젝트의 숨은 탭까지 한 번의 탭 상태 응답에 포함해 판정한다. 한 전사를 두 프로세스가 붙들면 기록이 엉킨다
  - **대화가 자라도 바닥에 붙어 있을 때만 따라 내려간다**(바닥 판정 여유 48px). 위로 올려 읽는 중이면 자리를 지키고 \*\*\[새 메시지\]\*\*만 띄운다 — 누르면 바닥으로, 스스로 바닥까지 내려가도 사라진다. 내가 프롬프트를 보냈을 때와 세션을 새로 불러왔을 때(`reset`)는 다시 바닥에 붙인다
  - **탭을 닫는 것만 세션을 끝낸다**(`close_session`). 창을 닫는 것과 다르다. 안 보고 있는 탭도 WS는 붙어 있고(돌던 대화가 멎으면 안 된다), 한 번이라도 연 탭만 붙인다(복원된 탭을 한꺼번에 띄우지 않는다)
  - **턴 버블 오른쪽에 걸린 시간이 선다** — "15초"·"36분 32초"·"2시간 5분 4초" 꼴. 서버가 `turn_start`에 `startedAt`, `turn_end`에 `durationMs`를 새기므로 되받은 히스토리에서도 그대로 보인다. 돌고 있는 턴은 startedAt부터 지금까지를 1초마다 다시 세고, 시간 정보가 없는 옛 히스토리는 감춘다. 감독이 유휴 종료된 뒤에도 완료 시점에 남긴 전체 이벤트 전사를 다시 써서, 질문·답변·작업 내역과 소요 시간을 보존한다.
  - ACP가 히스토리를 다시 흘릴 때 마지막 `turn_end`를 보내지 않아도, 현재 세션 `meta.busy`가 false면 마지막 턴은 \*\*완료(초록)\*\*로 그린다. meta를 받기 전이나 아직 작업 중이면 \*\*진행 중(파랑)\*\*을 유지한다.

| 방향 | 메시지 |
| --- | --- |
| 클라이언트 → 서버 | `{type:'prompt', text, settings?: {model, thinking, permission}}` · `{type:'cancel'}` · \`{type:'permission', id, optionId |
| 서버 → 클라이언트 | `{type:'ready'}` · `{type:'replay', events, restored?, restoreFailure?}` · `{type:'update', update, settings?}`(ACP `session/update` 원본 + 사용자 발화 설정) · `{type:'permission', id, toolCall, options}` · `{type:'permission_done', id}` · `{type:'turn_start', startedAt}` · `{type:'turn_end', stopReason, durationMs}` · \`{type:'error' |

- **되감기는 한 프레임이다(**`replay`**).** 붙는 순간 서버가 쌓아 둔 대화(`snapshot()`)를 통째로 보내고, 그 뒤부터 이벤트가 하나씩 흐른다. 창은 마지막으로 본 전사를 탭·런타임·cwd별 `localStorage`(`mew:agent-events:*`)에 캐시해 브라우저 재진입 첫 프레임부터 그린다. 같은 세션의 `replay`는 캐시와 겹치는 꼬리를 제거한 뒤 최신분만 이어 붙이고, 다른 세션이면 `replay`로 갈아끼운다. 창은 소켓이 끊겨도 대화를 지우지 않는다. 예전에는 되감기 이벤트를 **한 개씩** 보냈고, 창은 그때마다 다시 그리느라(이벤트당 `foldEvents` 한 번 + 목록 전체) 눈에 띄게 굳었다. 지금은 긴 전사도 한 덩어리로 보내므로 이벤트 수를 이유로 질문이나 답변 앞부분을 자르지 않는다.

- 로컬 전사 캐시는 탭당 1MiB·전체 4MiB가 상한이다. 긴 대화는 상한 안에 들어가는 최근 이벤트 꼬리만 원형 그대로 저장하고, 서버의 전체 `replay`가 오면 앞부분을 복원한다. 서버 탭 원장 조회 중에는 활성 ACP 탭의 최근 텍스트를 읽기 전용으로 먼저 표시하며, 실제 세션 연결은 원장 확인 뒤에만 시작한다. 저장 전 오래된 캐시를 정리해 공간을 확보하고 quota 실패 시 전사 캐시만 비워 한 번 재시도한다. 계정 탭 원장에 없는 탭의 `mew:agent-events:*`·`mew:agent-controls:*` 캐시는 탭 동기화 때 지운다.

- **히스토리를 열 때마다** 계정의 모든 루트 프로젝트 탭이 주장한 ACP 세션을 다시 읽는다. 현재 탭 또는 다른 탭이 이미 연 세션은 목록에서 잠가 두므로, 이미 붙은 writer를 다시 `session/load`해 ACP의 `Internal error`가 나는 경로가 없다.

- **창은 들어오는 이벤트를 한 프레임에 모아 한 번만 그린다**(`requestAnimationFrame`). 스트리밍 청크는 초당 수십 개다. `reset`도 그 줄에서 순서대로 처리돼 "비우기"와 "새 대화"가 같은 프레임에 들어간다.

- `meta`**·**`sessions`**·**`reset`**은 이벤트 버퍼에 쌓지 않는다.** `meta`는 상태 스냅샷이라 붙을 때·바뀔 때 통째로 보내고(`sessionId`·`startedAt`·`turns`·`busy`·`queued`·`usage`·`canLoad`·`canList`), `sessions`는 **물어본 창에만, 물어봤을 때만** 답한다(claude 런타임은 세션이 뜨기를 기다리지 않고 디스크에서 바로 읽는다). 세션 목록의 cwd 비교는 대소문자를 구분하지 않아, 이전 기록의 경로 표기가 현재 실제 경로와 달라도 같은 폴더 히스토리로 찾는다. `reset`을 받은 창은 지금까지 그린 대화를 버린다.

- 서버는 소켓에 **30초마다 핑**을 보낸다 — 조용한 대화(에이전트가 긴 작업 중일 때)가 중간 장비의 유휴 타임아웃에 끊기지 않게. 그래도 끊기면 창이 1초 뒤 다시 붙고 `replay`로 복구한다.

- **진행 중에 온** `prompt`**는 던지지 않고 줄을 세운다.** 턴이 끝나면 서버가 순서대로 이어 돌리고, `cancel`은 대기열도 함께 비운다. 대기 항목은 창에서 자리를 옮기고(`move_queued`) 내용도 고칠 수 있다(`edit_queued`) — 고치는 사이 앞 턴이 끝나 큐가 당겨질 수 있으므로 `expect`(창이 보고 있던 원본)가 지금 그 자리의 값과 다르면 서버가 무시한다.

- 불러오기(`/resume`)는 **ACP 메서드**(`session/list`·`session/load`)다. 진행 중인 턴·승인·대기열과는 겹치지 않는다. 다른 런타임은 같은 자식 프로세스에서 세션만 갈아끼우지만, **Codex는 히스토리 전환 전에 어댑터를 재시작**해 이전 thread writer를 반납한다([ADR 0122](../.mew/docs/decisions/0122-mew-codex-history-load-restarts-writer.md)). 선택한 Codex 기록 불러오기가 실패하면 새 어댑터에서 바로 전 thread를 다시 불러와 현재 대화를 복구한다. 자동 복원 실패 시 `replay.restoreFailure`로 실패한 ID를 내려 원래 탭 포인터와 브라우저 전사를 보존한다. 사용자가 다른 히스토리를 고르거나 새 메시지를 보낼 때만 fallback 새 세션을 채택한다. 목록을 물어볼지는 `initialize`의 capability(`meta.canList`)로 정한다. 정확한 `/clear`는 CLI에 프롬프트로 넘기지 않는다. 작업 중이면 서버 큐의 **세션 경계**로 들어가 앞선 작업을 마친 뒤 ACP 새 세션을 열고, 그 뒤 큐에 넣은 메시지는 새 대화에서 실행한다. 이전 대화는 히스토리에만 남는다.

- Prime Agent는 공식 `prime-agent --mode rpc`를 Mew 내부 어댑터가 ACP로 변환한다. 따라서 Prime ACP의 구현 유무와 무관하게 세션 목록/불러오기, 모델, thinking mode를 Mew 창에서 제공한다.

- **토큰 사용량만 ACP 밖에서 온다** — 어댑터가 사용량을 보내지 않아 `agentUsage.ts`가 `<CLAUDE_CONFIG_DIR>/projects/<인코딩된 cwd>/<sessionId>.jsonl`을 읽는다. 읽기 전용·선택적이고, 파일이 없으면 사용량 칸만 빈다([ADR 0036](../.mew/docs/decisions/0036-mew-agent-session-controls-and-usage.md)).

- `GET /api/agent-cwd?path=&base=`는 주소창 입력을 서버 파일시스템 기준 절대 디렉터리로 검증한다 (owner/manager). 빈 `path`는 현재 워크스페이스, 상대경로는 `base` 기준이다.

- `GET /api/agent-cwd/suggestions?input=&base=&entered=`는 입력 중인 마지막 경로 조각의 접두어와 맞는 하위 디렉터리, 또는 이미 들어간 디렉터리의 하위를 돌려준다(owner/manager).

- **모델·권한 선택기 옆 저장 아이콘은 현재 값을 그 런타임의 기본값으로 남긴다**([ADR 0063](../.mew/docs/decisions/0063-mew-agent-runtime-saved-defaults.md)). 값은 브라우저가 아니라 `<DATA_DIR>/agent-defaults.json`에 런타임별로 저장되어, 새 탭·서버 재시작 뒤 `session/new`·`session/load`에도 적용된다. 현재 선택이 저장값과 같으면 아이콘이 강조된다. 저장값이 없는 **권한 모드 기본값은 그 런타임의 "전체 허용"이다**([ADR 0037](../.mew/docs/decisions/0037-mew-agent-bypass-permissions-default.md)). ACP 세션은 제한 모드로 시작하므로(claude `default`·codex `auto`) 서버가 `session/new`·`session/load`뒤마다 다시 걸어 준다(`#applyDefaults`). 이름이 런타임마다 달라 한 값으로 박지 않고 후보 순서 (`FULL_ACCESS_MODES`)로 고른다 — claude `bypassPermissions` · codex `agent-full-access` · hermes `dont_ask`. claude의 `dontAsk`는 뜻이 반대(미리 승인 안 된 건 거절)라 순서로 갈린다. 헤더 선택기로 턴마다 바꿀 수 있다. `MEW_AGENT_MODE`에 모드 id를 박으면 운영자 강제값으로 저장된 권한보다 우선한다. 모드 목록은 백엔드가 광고하는 것을 그대로 쓴다 — 광고에 없으면(예: root 실행) 조용히 넘어간다.

- **새 탭은 런타임 또는 에이전트셋을 고르기 전에 세션을 띄우지 않는다**([ADR 0096](../.mew/docs/decisions/0096-mew-agent-tabs-created-after-selection.md)). 마지막 탭을 닫으면 가운데 `새 탭` 버튼만 남고, `+`와 이 버튼은 선택기만 연다. 설치되지 않은 런타임은 서버 등록표의 고정 설치 명령으로만 설치하고, 성공하면 새로고침 없이 그 런타임을 선택한다. 선택 후에만 WS·히스토리·입력창이 생긴다. 런타임은 탭별로 `mew:agent-tabs` 안에 남고, 예전 탭은 마지막 `mew:agent-runtime` 값으로 한 번 승격한다.

- **세션 창의 헤더 아이콘은 런타임 드롭다운이다**([ADR 0074](../.mew/docs/decisions/0074-mew-agent-header-runtime-switch.md) — 0062의 탭 안 전환 금지를 해제). 누르면 새 탭의 목록과 같은 등록표(아이콘·설치 상태·사용/설치)가 펼쳐지고, 다른 에이전트를 고르면 **그 탭의 세션이 갈아탄다** — 새 탭을 만들지 않는다. WS 연결 effect가 `runtime` 의존이라 재접속하며 새 세션을 붙이고, 옛 세션은 서버 감독에 그대로 남는다. 설치도 드롭다운 안에서 같은 고정 명령 경로로 한다.

- 실행 표면과 명령은 `server/agentRuntimes.ts`의 `RUNTIMES` 등록표가 정한다. 클라이언트에 같은 목록이 또 있는 이유는 **아이콘**뿐이고 판정은 서버가 한다:

  | 런타임 | 에이전트 탭 표면·명령 | 인증 | 환경변수 |
  | --- | --- | --- | --- |
  | `claude` | terminal · `claude` (탭별 tmux) | 공식 TUI 안에서 진행 | `MEW_AGENT_CLAUDE_CLI_CMD` · `MEW_AGENT_CLAUDE_CLI_ARGS`; 예약 ACP는 기존 `MEW_AGENT_CMD` · `MEW_AGENT_CLAUDE_CMD` 계약 유지 |
  | `antigravity` | terminal · `agy` (탭별 tmux) | 공식 TUI 안에서 진행 | `MEW_AGENT_ANTIGRAVITY_CMD` · `MEW_AGENT_ANTIGRAVITY_ARGS` |
  | `codex` | 로컬 `node_modules/.bin/codex-acp`(버전 고정) → 컴퓨터에 설치된 `codex` 엔진, 자격증명은 `~/.codex` | server browser · 호스트 `codex login` · 제한된 OAuth host→loopback callback | `MEW_AGENT_CODEX_CMD` · `MEW_AGENT_CODEX_ARGS` · `MEW_AGENT_CODEX_CLI_CMD` · `CODEX_PATH` · `NO_BROWSER`(기본 `1`) |
  | `hermes` | `hermes acp` — mew가 번들하지 않는다 | `hermes acp --setup` | `MEW_AGENT_HERMES_CMD` · `MEW_AGENT_HERMES_ARGS` |
  | `kimi` | `kimi acp` | browser · `kimi login`(.com) / `kimi login --region global`(.ai) | `MEW_AGENT_KIMI_CMD` · `MEW_AGENT_KIMI_ARGS` |
  | `openclaw` | `openclaw acp` | `openclaw onboard --tui` | `MEW_AGENT_OPENCLAW_CMD` · `MEW_AGENT_OPENCLAW_ARGS` |
  | `opencode` | `opencode acp` | `opencode auth login` | `MEW_AGENT_OPENCODE_CMD` · `MEW_AGENT_OPENCODE_ARGS` |
  | `cursor` | `agent acp` | browser · `agent login`(`NO_OPEN_BROWSER=1`) | `MEW_AGENT_CURSOR_CMD` · `MEW_AGENT_CURSOR_ARGS` |
  | `prime` | Mew 내장 어댑터 → 공식 `prime-agent --mode rpc` — 공식 인스톨러로 설치(\`curl -fsSL https://app.primeintellect.ai/prime-agent/install.sh | sh\`) | TUI `/login`(공급자 선택) |

  공통은 `MEW_AGENT_MODE`(안 주면 위의 전체 허용 후보 순서). 진입점이 없거나 로그인 전 ACP를 말하지 않으면 오류와 terminal auth를 함께 보여 준다 — 목록에서 감추거나 탭을 닫지 않는다. 로그인 완료 뒤에도 실패하면 같은 화면에 최신 시작 오류를 남긴다. Prime Agent는 연결당 세션 하나라 mew의 탭 하나가 곧 하나의 Prime 세션이 된다(둘째 탭은 프로세스를 하나 더 띄운다).

| 라우트 | 역할 | 하는 일 |
| --- | --- | --- |
| `GET /api/agent-runtimes` | manager·owner | 등록 런타임의 실행 파일 존재와 설치·안전 제거·로그아웃 가능 상태 |
| `POST /api/agent-runtimes/:id/terminal/:tab` | manager·owner | terminal 런타임의 탭별 전용 tmux를 검증된 cwd에서 만들고 등록표의 공식 CLI 실행 |
| `DELETE /api/agent-runtimes/:id/terminal/:tab` | manager·owner | 탭이 소유한 전용 tmux와 CLI 종료 |
| `POST /api/agent-runtimes/:id/install` | manager·owner | id에 대응하는 등록표의 고정 설치 명령 실행. 임의 명령·인자는 받지 않음 |
| `DELETE /api/agent-runtimes/:id/install` | manager·owner | 등록표가 선언한 고정 역설치 명령 실행. 안전한 제거 계약이 없으면 거부 |
| `POST /api/agent-runtimes/:id/logout` | manager·owner | 등록표가 선언한 비대화형 CLI 로그아웃만 실행. 자격증명 값은 읽거나 전송하지 않음 |
| `POST /api/agent-runtimes/:id/auth/:method/run` | manager·owner | ACP가 광고했거나 등록표에 박힌 terminal auth 고정 명령을 숨김 tmux에서 실행. body는 `{tab}`만 |
| `GET /api/mew-update/status` | manager·owner | `HEAD`와 `origin/main`의 ahead/behind, 실행 방식, 업데이트 작업 상태 조회. `?refresh=1`이면 먼저 fetch |
| `POST /api/mew-actions/update/run` | manager·owner | 내장 `./mew start` 서버에서만 고정 업데이트 명령을 숨김 tmux로 실행 |
| `GET /api/agent-runtimes/:id/auth/:method/status?tab=<id>` | manager·owner | 인증 작업 상태·exit code, browser 표면의 allowlist URL·일회용 코드, 필터된 실패 이유. 출력·비밀값은 기록하지 않음 |
| `GET /api/agent-defaults/:id` | manager·owner | 런타임별로 저장된 모델·권한 기본값 |
| `PUT /api/agent-defaults/:id` | manager·owner | 현재 모델·권한을 그 런타임의 기본값으로 원자적 저장 |
| `GET /api/agent-runtimes/:id/settings` | manager·owner | 런타임 설정(실행 파일·추가 인자·env). **env 값은 마지막 4자만 마스킹해서** 돌려준다 |
| `PUT /api/agent-runtimes/:id/settings` | manager·owner | 병합 저장 — 보낸 키만 갈아끼우고 없는 env 키는 기존 값을 유지(시크릿 원문을 브라우저가 모르므로) |
| `DELETE /api/agent-runtimes/:id/settings` | manager·owner | 그 런타임의 사용자 설정을 지우고 등록표 기본값으로 돌아간다 |

- **런타임 설정 팝업**(목록의 톱니 아이콘) — 설치·삭제·로그인·로그아웃과 실행 파일 경로·추가 인자·공급자 env를 런타임별로 저장한다. ACP 런타임은 `resolvedSpec`, terminal 런타임은 `resolvedTerminalSpec`이 다음 탭 시작과 설치 판정에 적용한다. Claude 예약 작업용 ACP 어댑터는 대화형 CLI 설정과 분리된 고정 계약을 유지한다. 시크릿은 서버에만 있고 화면은 `****끝4자`만 본다. 제거·로그아웃은 확인 뒤 등록표의 고정 명령만 실행하며, 안전한 역설치 계약이 없는 Antigravity는 임의 파일을 지우지 않는다.
- ACP 런타임의 **모델 목록은 ACP가 광고하는 것을 그대로 쓴다.** Claude·Antigravity의 모델·권한·히스토리는 Mew 선택기로 복제하지 않고 공식 TUI 안에서 조작한다.
- 클라이언트 capability는 **인증에 필요한** `auth.terminal`**·**`elicitation.url`**만 광고하고** `fs`**는 광고하지 않는다** — `fs`를 켜면 어댑터가 CLI의 `Read`·`Write`·`Edit`를 끄고 `mcp__acp__*`로 갈아끼워서, 터미널에서 만든 대화를 창에서 불러올 때 전사 속 `Edit` 참조가 API 400으로 거부된다. 도구 이름을 CLI와 맞춰 두는 것이 계약이다 ([ADR 0044](../.mew/docs/decisions/0044-mew-agent-cli-tool-parity.md)) — 경로 스코프는 없다.
- 워크스페이스를 갈아끼우면 **떠 있던 세션을 전부 접는다**(`disposeAllSessions`) — 자식 프로세스의 cwd는 뜰 때 정해져 옛 폴더에 매여 있다.
- 자식 환경에서 `CLAUDECODE`**를 지운다.** 남아 있으면 Claude Code가 중첩 세션으로 보고 실행을 거부해 세션 생성이 통째로 실패한다(mew 서버를 Claude Code 터미널에서 띄우면 상속된다).

## 구조

- `server/serve.ts` — 프로덕션 서버 (5000, 단일 포트)
- `server/plugin.ts` — vite dev 플러그인 (4999)
- `server/dataDir.ts` — `.data/` 상태 파일 공용 입출력 (아래)
- `server/auth.ts`, `server/authRoutes.ts` — 인증 (사용자·세션·로그인 라우트)
- `server/reqAuth.ts` — 요청별 역할 해석(`req.auth`)·역할 게이팅 미들웨어
- `server/guestAccess.ts` — 게스트 경로별 보기/편집 승인 규칙
- `server/usersCli.ts` — 승인 리스트 CLI
- `server/docsRepo.ts` — docs 폴더 가져오기/내보내기, `server/fsBrowse.ts` — 워크스페이스 밖 폴더 목록
- docs 전용 규칙(MOC 커버리지·archives 불변·링크 라벨 동기화)은 docs 프로젝트에만 적용된다.

### 협업 방 (Yjs 릴레이)

- `server/collab.ts` — 방·클라이언트·awareness·`/api/collab` 웹소켓. 방 하나 = `프로젝트:상대경로`
- `server/syncCodec.ts` — 프레임 인코딩/디코딩. **와이어 포맷이 코드 결합 계약이다**: 바깥 varUint 채널(`0` sync · `1` awareness) + sync 안의 varUint 종류(`0` step1 · `1` step2 · `2` update) + varUint8Array 본문. y-protocols와 바이트 단위로 같아야 하고 `server/syncCodec.test.ts`가 그것을 대조한다 — 어긋나면 배포 순간 열려 있는 모든 탭이 조용히 깨진다. 신뢰할 수 없는 바이트에는 던지지 않고 `null`을 준다
- `server/roomDoc.ts` — CRDT 백엔드 둘(JS Yjs · Rust yrs). 요구 면은 셋뿐: `stateVector()` · `encodeStateAsUpdate(sv?)` · `applyUpdate(update)`. `applyUpdate`는 **방이 새로 얻은 업데이트**를 돌려준다(없으면 `null`) — 브로드캐스트는 이 값으로 한다. 상태 벡터 diff로 계산하면 삭제만 있는 업데이트가 빈 diff로 보여 사라진다
- `server/collabAgent.ts` — 디스크→방 브리지. **자기 Y.Doc + awareness를 들고 방의** `connect()`**로 붙는 인프로세스 클라이언트다** — 방의 doc을 붙들지 않는다(백엔드를 갈 수 없게 된다). 루프백 소켓을 쓰지 않는 이유는 `authorizeCollab`(게스트 차단) 우회 통로를 뚫어야 하기 때문. 터미널에서 고친 `.md`가 열려 있는 Yjs 방에 `agent` 커서로 실시간 주입되는 정상 기능이다 — 2026-07-25에 지운 에이전트 창과는 무관하니 헷갈려서 지우지 말 것. `appWrites` 메아리 원장이 사용자의 정상 타이핑을 보호한다
- 인증·`MAX_ROOMS`·awareness·방 수명은 백엔드와 무관하게 JS에 남는다. 방을 살려두는 것은 **실제 접속자뿐**이다 — 브리지의 인프로세스 클라이언트를 세면 방이 영원히 닫히지 않아 헤드리스 에디터와 fs watcher가 쌓인다

Rust 백엔드는 선택이고 기본은 꺼져 있다([ADR 0035](../.mew/docs/decisions/0035-mew-collab-rooms-rust-yrs.md)):

```bash
npm run build:native        # native/collab (cargo, napi-rs) → native/collab/mew-collab.node
MEW_COLLAB_RUST=1 npm run serve
```

`.node`는 플랫폼별 산물이라 커밋하지 않는다. `MEW_COLLAB_RUST=1`인데 로드가 실패하면 **조용히 JS로 돌지 않고 던진다** — 어느 구현이 도는지 모르는 상태가 협업 경로에서 제일 위험하다.

### 멤버 채팅 (`.data/chat.json`)

단체방 하나 + 사람마다 1:1 DM. 전달은 전용 소켓 없이 **presence 신호 + REST 재조회**다 — `{type:'chat'}` 신호에는 내용이 없다(그 소켓은 게스트에게도 간다). 모델은 [ADR 0050](../.mew/docs/decisions/0050-mew-chat-dm-and-read-receipts.md).

**방 식별자는 없다.** `to`**(수신자 배열)가 있으면 DM, 없으면 단체방이다.** 대화는 보는 사람 기준으로 계산한다(`server/chat.ts`의 `conversationsOf`). 화면 쪽 `inConversation`이 같은 규칙이라 **둘은 같이 고쳐야 한다.**

| 요청 | 하는 일 |
| --- | --- |
| `GET /api/chat` | **그 사람이 볼 수 있는 것만** — `{messages, unread}`. 남의 DM은 응답에 실리지 않는다. 메시지마다 `unread`(아직 안 읽은 수신자 수), `unread` 맵은 대화별로 **내가** 안 읽은 수 |
| `POST /api/chat` `{text, to?}` | `to`를 주면 DM. 수신자는 실재하는 계정만 통과한다 |
| `POST /api/chat/read` `{conversation}` | 그 대화를 읽었다고 적는다. 대화 키는 `group` 또는 상대 이메일 |

- **읽음 포인터는 "지금 시각"이 아니라 읽는 순간 그 대화의 마지막 메시지 시각이다.** 지금 시각으로 찍으면 같은 밀리초에 도착한 다음 메시지가 읽은 것으로 묻힌다. 같은 이유로 원장의 메시지 시각은 **엄격히 증가**시킨다(`max(now, 마지막+1)`) — 이 둘은 한 쌍이니 따로 고치지 말 것
- 읽음은 **바뀔 때만** 방송한다. 창이 떠 있는 동안 계속 찍으면 방송이 무한히 돈다
- 500줄 상한은 단체·DM 공용이다

### 서버 상태 파일 (`.data/`)

사용자·세션·게스트 규칙·프로젝트 아이콘·프로젝트 배치·터미널 버튼·숨김 목록·예약 작업이 여기 있다. 전부 `server/dataDir.ts`를 거쳐 읽고 쓴다:

- **쓰기는 임시 파일 + rename**뿐이다. `writeFileSync`로 바로 쓰면 파일이 잠깐 0바이트가 되고, 그 순간 다른 프로세스가 읽으면 빈 값으로 오해한다.
- **읽기 실패를 빈 값으로 넘기지 않는다.** 파일이 없으면 `null`, 깨졌으면 사본(`*.corrupt-*`)을 남기고 던진다. 못 읽은 걸 `{}`로 보고 덮어쓰면 남아 있던 설정이 통째로 사라지기 때문 — 실제로 프로젝트 아이콘이 이 경로로 초기화됐었다.
- 위치는 `MEW_DATA_DIR`로 바꿀 수 있다. `npm test`가 이걸 임시 경로로 지정해 **테스트가 실제** `.data/`**를 건드리지 않게** 한다 (테스트는 프로젝트를 만들었다 지우면서 아이콘·배치를 함께 고친다).

## 패키지 (npm workspaces)

재사용 가능한 부분은 `packages/*`의 소스 패키지로 분리되어 있다 (빌드 없음 — vite·node가 소스를 직접 소비). 컴포넌트는 fetch 경로·인증을 모르고, 호스트 앱이 `api` prop으로 서버 연동을 주입한다 (앱 쪽 구현은 `src/api/client.ts`).

- `@mew/editor` — TipTap 마크다운 에디터(`Editor`). frontmatter 패널·표·링크/멘션 툴팁· 미디어 업로드 포함. `EditorApi`(fetchFile·uploadAsset·fetchLinkPreview) 주입. fuzzy 검색·frontmatter 유틸도 여기서 export. `@`**·**`/` **입력 감지는** `keydown`**이 아니라** `onUpdate`**/**`onSelectionUpdate`**(트랜잭션 기반)로 한다** — keydown 스페이스 트리거는 모바일에서 조용히 실패한다(`SlashMenu.tsx`가 현재 구현).
  - **왼쪽 거터의 줄 번호가 드래그 핸들을 대신한다.** 번호는 호버와 상관없이 늘 떠 있고(`editor.css`의 `counter`), 핸들 엘리먼트는 그 숫자 위에 포개지는 **투명한 손잡이**다(클릭=블록 선택). 블록 이동은 **0.7초 동안 움직이지 않고 누른 뒤**에만 시작한다. 그 전에 드래그를 시작하면 이동으로 승격되지 않고 기존 드래그/스크롤 제스처로 끝까지 처리한다. 밝기 3단: 평소 → 지금 잡히는 줄(`mew-line--hover`, DragHandle의 `onNodeChange`가 붙임) → 커서가 있는 줄(`mew-line--focus`, `editor/lineFocus.ts`의 장식).
  - 세는 단위는 핸들이 잡는 단위와 같아야 한다 — **최상위 블록 하나가 한 줄, 리스트는 항목이 한 줄**이고 `ul`/`ol` 자체는 줄이 아니다. 리스트 들여쓰기 되돌림(한 단 24px)은 CSS의 `li::before`와 JS의 `listLevel`이 **같은 값**을 써야 손잡이가 숫자 위에 남는다 — 한쪽만 고치지 말 것.
- `@mew/shortcuts` — 단축키 바인딩.
- `@mew/tmux-term` — 터미널 본문(xterm.js)과 서버 (`@mew/tmux-term/server`: `createTmuxManager`·`createTmuxRouter`·`attachTmuxWebSocket`, cwd 파라미터)을 제공한다. Mew의 주 UI는 `AgentPanel` 안의 `TmuxTerminal`이며 패키지의 범용 `TmuxTerminalPanel`은 현재 보조패널로 마운트하지 않는다. 버튼 줄 오른쪽 도구는 **전부 아이콘 하나**다(맨 아래 · 키보드 잠금 · 선택 모드 · 복사). 에디터에서 누른 Ctrl+L의 `경로:줄` 참조는 호스트 앱이 `mew:insert-ref`로 보내며 활성 통합 패널만 받는다.
  - \*\*\[맨 아래\]\*\*는 올라간 스크롤을 **누가 들고 있는지**에 따라 셋을 다 한다: ① xterm 자체 스크롤백이면 `scrollToBottom` ② tmux copy-mode(마우스를 안 쓰는 프로그램)면 WebSocket `exitCopyMode` → 서버가 `tmux copy-mode -q`(멱등. PTY에 `q`·Esc를 쏘면 모드가 아닐 때 TUI에 오입력된다) ③ **앱이 직접 스크롤하는 경우**(Claude Code처럼 마우스를 잡는 TUI) — tmux는 휠을 앱에 넘겼을 뿐이라 ①②가 통하지 않는다. 이때는 SGR 휠 아래를 한 번에 몰아 보내 앱 스스로 최신까지 내려가게 한다.
  - **\[키보드 잠금\]**(자물쇠)은 모바일 소프트 키보드가 뜨지 않게 한다 — 터미널의 보조 textarea와 하단 입력칸에 `inputMode='none'`을 건다. 포커스는 살아 있어 붙여넣기·하드웨어 키보드·명령어 버튼은 그대로 쓴다. 세션이 아니라 브라우저 설정이라 `localStorage: mew:tmux-keyboard-lock`에 남는다.
  - 터미널 세션·에이전트 탭의 전송 성공 입력은 각각 브라우저에 최근 100개까지 보관한다. 입력칸의 첫 줄에서 `↑`, 마지막 줄에서 `↓`를 누르면 셸처럼 이전·다음 항목을 불러오며, 여러 줄 안에서는 본래 커서 이동을 유지한다.
  - 하단 입력칸은 내용에 따라 자동으로 늘어나되 32\~160px 범위를 지킨다. 숨겨진 패널에서 `scrollHeight`가 0으로 측정돼도 32px 아래로 줄이지 않는다.
- `@mew/mobile-keys` — 모바일 키보드 보조키 바(`MobileKeyBar`). 에디터·터미널이 공용으로 쓴다. 에디터 바는 화면 하단 고정, **터미널 바는 자기 입력칸 아래의 레이아웃 공간을 차지**해 입력칸을 덮지 않는다. 고정 바는 `z-20`이다 — 전체 화면 오버레이(사이드바·채팅·에이전트· 터미널)가 `z-30`이라 그 아래로 깔려야 한다.\*\* 같은 `z-30`으로 두면 DOM 순서상 편집 칸이 사이드바보다 뒤라 보조키가 열린 사이드바 위에 떠 버린다. `onComment`를 주면 댓글 아이콘이 붙는다(폰에는 Alt+Shift+C가 없다) — 앵커는 호스트(`EditorPane.startComment`)가 만든다. `onCodeBlock`·`onTable`을 주면 코드블럭·표 아이콘이 붙는다 — 에디터만 넘기고(터미널은 대상이 없다) 코드블럭은 커서 문단 toggle, 표는 슬래시 메뉴 '표'와 같은 3×3 삽입이다. `onUndo`·`onRedo`는 되돌리기·다시 실행 아이콘이다 — Ctrl+Z/Y 단축키와 같은 경로(`runUndoRedoKeepingView`)라 커서가 바뀐 자리로 옮겨진다. 읽기 전용일 때는 에디터가 이 넷을 모두 감춘다. 보조키 바는 문서가 짧아도 화면 맨 아래에 고정되고, 모바일 키보드가 열린 때는 그 바로 위에 붙는다. 스와이프 전환은 제공하지 않는다.
- `@mew/ui` — 의존성 없는 공용 조각: `ConfirmDialog`(네이티브 confirm 대체 — 전체화면이 풀리지 않게), `useToast`(답을 받을 필요가 없는 짧은 안내 — 화면 아래 알약 하나, 2.6초 뒤 저절로 사라지고 `pointer-events-none`이라 아무것도 가로채지 않는다. **오버레이 스택에 등록하지 않는다** — 등록하면 안드로이드 뒤로가기가 토스트를 닫는 데 쓰인다), `pathDrag`(위 §사이드바 항목 끌어놓기), `useDragReorder`(줄 안 재정렬 + 줄 **바깥**에 놓을 때를 알리는 `onDragMove`/`onDrop` — 문서 탭 끌어서 화면 분할이 이걸 쓴다. **꾹 누른 뒤**에만 집힌다 — 모바일 0.35초·마우스 0.5초. 그전에 끌면 탭 줄이 좌우로 굴러갈 뿐이다: 터치는 브라우저 기본 스크롤, 마우스는 훅이 `scrollLeft`를 민다), `useOverlayDismiss`(아래).

### 각주 (Alt+E)

커서 자리(고른 글자가 있으면 그 **뒤**)에 마커를 박고, 문서 맨 아래 `# References` 구역과 번호를 맞춘다. 계산은 `utils/footnotes.ts`(순수·테스트), 적용은 `editor/footnoteSync.ts`(tiptap 확장).

**저장 형태가 곧 결합 계약이다:**

- 마커는 **유니코드 아래첨자 글자 그대로**다 — `22만명₁₎`. 커스텀 노드도 직렬화기도 없어서 다른 편집기·GitHub·git diff에서 그대로 읽힌다. 찾는 정규식은 `[₀-₉]+₎`
- 참고문헌은 `# References` 아래의 **순서 목록**이다. 문단에 `1) 내용`이라고 쓰면 안 된다 — `1)`은 CommonMark의 목록 표시라 저장했다 다시 열면 목록으로 재파싱돼 구역이 통째로 어긋난다 (`footnoteSync.test.ts`의 왕복 테스트가 이걸 잡는다). 화면에 `1)`로 보이는 것은 CSS(`.mew-references`)다
- **번호는 자리가 정한다.** n번째 마커 ↔ 목록의 n번째 항목. 그래서 번호를 글자로 적을 필요가 없고, 중간에 끼우거나 빼면 목록이 스스로 다시 센다. 우리가 하는 일은 **항목을 끼우고 빼기만** — 내용을 다시 쓰지 않으므로 참고문헌에 걸어 둔 링크가 살아남는다
- 짝짓기는 **옛 번호** 기준이다(`planFootnotes`). 새 마커는 아직 아무도 안 쓰는 번호(최대+1)로 넣어 남의 내용을 가로채지 않게 하고, 제자리 번호는 `appendTransaction`이 매긴다
- **마커가 하나도 없으면 아무것도 하지 않는다** — 손으로 쓴 References를 지우지 않는 안전장치다. 마지막 각주를 지우면 마지막 항목이 남는다(남의 글을 자동으로 지우는 것보다 낫다)
- 마커를 누르면 그 번호의 내용이 쪽지로 뜨고, 참고문헌 항목을 누르면 그 마커 자리로 간다. 쪽지는 오버레이 스택에 올리지 않는다(링크·표 툴팁과 같은 이유)

### 오버레이 닫기 규칙 (`useOverlayDismiss`)

**팝업·모달·드롭다운을 새로 만들면 반드시** `useOverlayDismiss(onClose)`**를 부른다.** 열려 있는 오버레이를 앱 전체에서 하나의 스택으로 모아, Esc와 **안드로이드 하드웨어 뒤로가기**가 언제나 *가장 나중에 열린 것 하나만* 닫게 한다. 등록하지 않은 팝업 위에서 뒤로가기를 누르면 그 팝업 대신 뒤에 있는 터미널·사이드바가 닫히거나 페이지를 떠난다.

- App이 상태를 소유하는 보조 패널(사이드바·채팅·터미널•에이전트패널·브라우저·Android)은 `utils/mobile-panel-stack.ts`의 공통 스택 하나가 전면 순서와 닫기 순서를 함께 소유한다. 모바일에서 뒤에 열린 패널을 다시 선택하면 닫지 않고 전면으로 옮기며, 전면 패널을 다시 선택할 때만 닫는다. `hooks/use-panel-dismissals.ts`도 이 전면 패널 하나만 오버레이로 등록하므로 Esc·뒤로가기와 z-index가 어긋나지 않는다. 새 보조 패널은 `WORKSPACE_PANEL_IDS`와 `App.tsx`의 open/setter 등록표에 추가하고 공통 open/close/toggle/layer 함수를 사용한다(빠진 등록은 타입 검사로 막힌다). 모달·팝업·드롭다운은 각 컴포넌트가 직접 등록한다. 모바일은 루트 프로젝트별로 **마지막 전면 창**도 이 기기 브라우저에 기억하므로, 새로고침·재시작 뒤에도 열린 창 중 마지막으로 보던 창이 다시 전면에 온다.
- 모바일에서 사이드바·채팅·터미널•에이전트패널에서 파일을 열면, 그 창을 닫고 선택한 파일의 편집 칸을 바로 드러낸다. 데스크톱의 나란한 패널 배치는 유지한다.
- 뒤로가기 대응은 History에 더미 항목(가드)을 하나 얹어 두는 방식이다. 겹쳐 있어도 가드는 하나뿐이고, 한 겹 닫힐 때마다 다시 얹는다. UI로 닫혔을 땐 `history.back()`으로 걷어 스택을 맞춘다.
- 오버레이마다 각자 keydown 리스너를 달면 안 된다 — capture 단계에서 `stopPropagation`을 해도 같은 노드(window)에 붙은 다른 리스너는 그대로 실행돼, 겹친 팝업이 Esc 한 번에 전부 닫힌다.
- `escapePhase: 'bubble'`은 사이드바·터미널 패널처럼 **콘텐츠를 감싸고만 있는** 오버레이용이다. 안쪽(에디터 슬래시 메뉴, 파일 이름 바꾸기)이 Esc를 먼저 쓰고 `stopPropagation` 하면 패널은 닫히지 않는다. 기본값 `'capture'`는 다이얼로그용 — 아래 에디터·터미널이 손대기 전에 가로챈다.
- `closeOnEscape`는 Esc를 삼킬지 판단한다. 터미널을 품은 오버레이는 `outsideTerminal`(`src/utils/terminalFocus.ts`)을 넘겨 vim 등의 Esc를 양보한다. 뒤로가기에는 영향이 없다.
- `outside: () => 요소`를 주면 **그 요소 바깥을 눌러도 닫힌다**(맨 위 하나만, Esc와 같은 규칙). 터치 화면에는 Esc 키가 없으므로 **닫기 버튼이 없는 팝업은 이걸 주지 않으면 빠져나갈 길이 없다**.판단은 전파가 아니라 `contains()` 위치로 한다 — 안쪽에서 `stopPropagation`을 해도 capture는 이미 지나간 뒤다. 사이드바처럼 바깥 클릭으로 닫히면 안 되는 오버레이는 그냥 안 주면 된다.

에디터의 멘션·슬래시 메뉴와 링크/표 툴팁은 **일부러 등록하지 않았다.** 타이핑·선택에 따라 수시로 떴다 사라져서 그때마다 History를 밀고 당기면 브라우저 pushState 제한에 걸린다. 이들의 Esc는 `Editor.tsx`의 ProseMirror `handleKeyDown`이 직접 처리한다.

### 포커스 기반 탭 단축키

`Ctrl+W`(기본 `closeTab`)는 App이 조합을 한 번만 판정한 뒤, `@mew/shortcuts`의 `dispatchFocusedShortcut`으로 **포커스된 표면**에 전달한다. 터미널•에이전트패널·브라우저처럼 자기 탭을 소유하는 창은 루트 ref와 `useFocusedShortcutScope(ref, { closeTab })`만 등록한다. 이 계약 덕분에 새 탭 창을 추가해도 App의 단축키 조건문을 고치지 않는다.

- 실제로 닫을 탭이 있을 때만 `preventDefault()`로 브라우저의 `Ctrl+W`보다 먼저 처리한다. 탭이 없거나 마지막 브라우저 탭처럼 닫을 수 없으면 브라우저 기본 탭 닫기를 양보하며, 다른 표면의 탭으로 새지 않는다.
- 등록된 창이 없고 편집기의 초점 칸에 활성 문서가 있을 때만 그 문서 탭을 닫는다. 터미널의 탭 닫기는 세션 종료이므로 기존 `×` 버튼과 같이 확인 대화상자를 연다.

# 

<br/>

# References

1. ㅇㅇ

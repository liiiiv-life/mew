---
description: "Linux·macOS 네이티브 서버 설치, 전용 사용자·HTTPS·systemd 운영과 계정 기반 P2P 등록·별도 중앙 서비스, 업데이트·백업 절차와 하위 경로·앱 컨테이너의 지원 제한을 안내한다."
---
# 네이티브 서버 배포

[문서 지도](../MOC.md) · [이 분야](MOC.md) · [설치·실행](../guides/getting-started-ko.md)

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

설정 파일이 이미 있으면 `setup`은 작업 폴더와 포트를 다시 묻지 않는다. 앱 의존성 설치 후 원격 데스크톱 보조앱도 미리 준비하고, Mac은 서버 Mac의 권한 설정을 열어 승인을 확인한다. 이어 앱을 빌드·시작한 뒤 첫 owner 계정의 이메일을 받는다. 보조앱 설치·권한 준비가 실패하면 오류와 경고를 표시하고 Mew 설치는 계속한다(Ctrl+C는 중단). 이미 실행 중인 서버에서는 설치 폴더의 `./mew desktop-setup`으로 빌드·서버 재시작 없이 준비만 재실행할 수 있다. 준비 중 화면 캡처·입력 제어·로그인 자동 시작을 활성화하지 않는다. 데스크톱이 없는 서버에 구성 요소를 설치해도 공유할 화면이 생기지는 않는다. OS별 라이브러리·로그인·권한 조건은 [원격 데스크톱 준비](../guides/remote-desktop.md#%EC%B2%98%EC%9D%8C-%EC%97%B0%EA%B2%B0)를 따른다. 출력한 임시 비밀번호로 로그인한 즉시 비밀번호를 바꾼다.

`MEW_WORKSPACE`에는 mew가 읽고 쓸 프로젝트만 둔다. 홈 디렉터리 전체, 서버 설정, 다른 서비스의 데이터처럼 mew 사용자에게도 열어서는 안 되는 경로를 넣지 않는다. 설정 파일과 데이터 폴더의 소유자는 반드시 mew를 실행하는 OS 사용자여야 한다.

계정 기반 원격 접속을 쓸 때는 로컬 owner가 임시 비밀번호를 변경한 뒤 **계정 관리 → 원격 접속**에서 A를 한 번 등록한다. `./mew setup`의 원격 접속 선택 또는 `./mew remote-access account`는 이 순서를 안내한다. 중앙 서비스의 HTTPS·OAuth 구성은 [중앙 서비스 운영](remote-central.md)을 따른다. A의 HTTP 포트는 loopback으로 유지하며 중앙에는 발신 WSS로 연결하고, 작업 데이터는 브라우저와 직접 WebRTC로 전송한다. [구현 계약](../development/remote-access.md)을 참고한다. 실제 외부망 검증과 중앙 배포는 아직 완료되지 않았다.

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

<br/>

## 4. 업데이트·백업·장애 확인

`./mew start`로 실행한 개인용 설치는 헤더 메뉴의 **업데이트**에서 `origin/main`의 새 커밋을 확인하고 업데이트할 수 있다. 새 커밋이 있으면 전용 숨김 tmux에서 `./mew update`를 실행하고, pull·의존성 설치·빌드·재시작이 모두 성공해 새 서버가 응답하면 화면을 자동으로 새로고침한다. `git pull --ff-only`라 로컬 브랜치가 갈라졌거나 작업 파일과 충돌하면 자동 병합하지 않고 실패하며 작업 트리를 보존한다. 의존성 설치·빌드가 실패하면 서버를 재시작하지 않고, 업데이트 화면에 실패 상태와 접을 수 있는 실행 로그를 남긴다. pull이 성공해 Git 커밋이 최신이어도 실패한 작업은 **다시 시도**로 전체 절차를 다시 실행할 수 있다. tmux 작업이 중단되면 실패로 표시하며, 시작 대기에는 최대 30초의 실행 유예를 둔다. 업데이트 중 페이지를 다시 열어도 진행 상태를 이어서 확인한다. 숨김 tmux는 로그인 셸 초기화 없이 작업 명령을 직접 시작하고 완료 후 종료한다. systemd 같은 외부 supervisor가 실행한 서버는 이 버튼으로 재시작하지 않고 수동 업데이트가 필요하다고 표시한다.

배포 전에는 항상 현재 커밋과 데이터 백업 위치를 기록한다. 앱 클론을 지워도 다음 상태는 남고, 반대로 이 상태를 잃으면 계정·세션·게스트 규칙·UI 원장이 사라진다.

| 대상 | 기본 위치 | 백업 이유 |
| --- | --- | --- |
| 설정·외부 서비스 자격증명 | `~/.config/mew/config.env` | 워크스페이스, 포트, DB 연결 등 복구 |
| mew 앱 데이터 | `~/.local/share/mew/` 또는 `MEW_DATA_DIR` | 계정, 세션, 게스트 규칙, 채팅 |
| 작업물 | `MEW_WORKSPACE` | mew가 편집하는 실제 파일 — Git만으로 충분한지 별도 판단 |
| `/db` 데이터 | `DATABASE_URL`이 가리키는 Postgres | 앱 데이터 폴더에 포함되지 않음 |

설정 파일과 앱 데이터는 비밀값·비밀번호 해시를 포함하므로 암호화된 백업에만 넣고, Git이나 공유 폴더에 복사하지 않는다. 계정·세션·게스트 규칙은 지워도 다시 만들 수 있는 캐시가 아니므로 보존한다.

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

### 설치된 의존성·에이전트 통합 업데이트

- manager·owner가 앱에 들어올 때 설치된 항목의 현재 버전과 최신 버전을 조회한다. 업데이트가 있으면 뮤캣이 개수와 대표 항목을 알리며 **업데이트 보기**로 통합 화면을 연다. 화면의 **다시 확인**은 원격 버전 조회를 다시 수행한다. 같은 서버의 동시 조회는 합쳐 처리한다.
- 목록은 Mew의 Git 커밋, 설치된 독립 에이전트 CLI, Mew 관련 시스템 도구를 포함한다. 앱 npm 의존성(개발·선택·전이 의존성 포함), 번들 ACP 어댑터, 내부 `@mew/*` 패키지와 미설치 항목은 개별 최신 조회·알림·업데이트에서 제외한다.
- npm 최신 버전은 공식 레지스트리 `latest`, Hermes는 PyPI, Cursor는 공식 설치 스크립트의 버전, Antigravity는 공식 ACP Registry, Prime은 공식 설치 스크립트의 배포 저장소 stable 채널, Rust는 stable 채널, uv는 공식 GitHub 릴리스에서 조회한다. Prime의 `PRIME_AGENT_DOWNLOAD_BASE_URL`·`PRIME_AGENT_RELEASE_CHANNEL`·`PRIME_AGENT_VERSION` 설정은 공식 updater와 동일하게 따른다. Node는 최신 LTS를 표시한다. apt 도구는 호스트의 현재 패키지 목록에 있는 설치 버전·candidate를 비교하며 패키지 목록 자체는 갱신하지 않는다.
- 각 항목은 현재·최신 버전과 **업데이트** 버튼을 갖는다. 설치 방식과 자동 갱신 명령이 확인된 항목만 실행 가능하다. Node의 외부 설치 관리, apt의 관리자 권한, 비 npm Codex CLI, 버전 고정 Antigravity ACP 등 자동 갱신할 수 없는 항목에는 사유를 표시한다. 조회 실패·버전 미확인은 최신으로 단정하지 않는다.
- 앱 의존성은 Mew 업데이트에서 해당 커밋의 `package-lock.json` 조합을 `npm ci --no-audit --no-fund`로 설치한다. 화면과 API는 앱 의존성을 개별·일괄 최신화하지 않으며, 이전 `npm:*` ID 요청도 거절한다. 독립 CLI 업데이트는 앱 manifest·lockfile을 변경하지 않지만 Mew 연동 호환성을 보장하지는 않는다. 앱 의존성 갱신은 개발자가 별도 작업 공간에서 관련 패키지를 함께 변경하고 타입 검사·테스트·빌드로 검증한 뒤 코드와 lockfile을 함께 반영한다. 에이전트의 빌드·서버 재시작 금지 규칙은 그대로 적용한다.
- 독립 에이전트는 **개별 업데이트**만 허용한다. 일괄 선택에서 제외하고 API도 에이전트가 포함된 여러 항목 요청을 거절한다. 실행 직전 같은 OS 사용자의 프로세스에서 해당 런타임의 Mew 감독·CLI 실행을 검사해 발견하면 차단한다. 프로세스 조회가 실패해도 설치를 진행하지 않는다. 외부에서 검사 후 시작되는 프로세스까지 잠그지는 못한다.
- **일괄 업데이트**는 실행 가능한 시스템 도구만 서버에서 순차 처리한다. 하나가 실패해도 나머지를 처리하고 항목별 대기·실행·완료·실패 및 오류를 남긴다. 창을 닫아도 작업과 상태 조회는 계속된다. 의존성 작업의 결과는 서버 메모리에 있으며 서버 자체가 종료되면 복원하지 않는다.
- 일괄 선택에 Mew가 있으면 모든 의존성 업데이트 성공 뒤 기존 Mew 업데이트 경로를 마지막에 호출한다. 실패 항목이 있으면 Mew 재시작을 보류한다. Mew는 기존 main·실행 관리자 제한을 유지하고, Git 충돌을 자동 병합하지 않는다. 전체 앱 페이지를 닫으면 의존성 서버 작업은 계속되지만 클라이언트의 후속 Mew 실행 예약은 취소된다.
- API는 항목 ID만 받는다. 클라이언트가 셸 문자열·버전·파일 경로를 정할 수 없으며 요청 시 설치 목록과 최신 버전을 다시 확인한다. 같은 서버에서 통합 업데이트 작업은 하나만 실행하며, Mew 빌드·재시작·업데이트 작업과 서로 동시에 시작하지 않는다.

| 라우트 | 역할 | 하는 일 |
| --- | --- | --- |
| `GET /api/updates/status` | manager·owner | 설치된 항목·버전·실행 가능 여부·직전 작업 상태. `?refresh=1`로 원격 재조회 |
| `POST /api/updates/run` | manager·owner | `{ ids: string[] }`로 등록된 설치 항목의 개별·일괄 업데이트 요청. 즉시 작업 상태 응답 |

### 화면에서 실행하는 업데이트 런타임

화면 업데이트는 실행 중인 서버의 Node 절대경로를 사용한다. 작업 스크립트는 Bash로 호출하고, 의존성 설치·빌드 PATH와 서버 재시작(`MEW_NODE`)도 같은 Node로 고정한다. tmux 환경의 다른 Node 버전이나 `mew` 실행 비트 누락으로 인한 시작 실패를 방지한다. 실패 이유·단계와 재시도 상태는 업데이트 화면에 남으며 기존 main/프로세스 관리자 경계는 유지한다.

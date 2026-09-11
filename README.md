# mew

mew는 내 컴퓨터나 서버의 폴더를 브라우저에서 열어 작업하는 편집기다. 마크다운과 코드를 편집하고, 파일을 검색하거나 git 커밋을 만들 수 있다. 실시간 협업, tmux 터미널, 에이전트, 게스트 열람 링크를 지원하며 모바일에서도 사용할 수 있다.

파일 트리에서 폴더를 탐색하고 정확 검색이나 의미 검색으로 내용을 찾는다. 다른 경로는 별도 프로젝트 탭으로 열 수 있다. 루트 바로 아래의 폴더에 `.mew`가 있으면 사이드바에 하위 프로젝트로 표시된다.

`manager`와 `owner` 계정은 서버의 터미널과 에이전트를 사용할 수 있으며, 사실상 서버 셸 권한을 갖는다. 공개 배포 전에는 [SECURITY.md](SECURITY.md)를 읽고, 신뢰하는 소수의 사람만 계정으로 초대한다.

에디터·에이전트·터미널·브라우저는 상단 손잡이나 탭을 끌어 배치한다. 브라우저는 좌우로만 옮길 수 있다.

## 설치 (macOS/Linux)

터미널에서 아래 두 줄을 실행한다.

```bash
git clone <전달받은 저장소 URL> mew && cd mew
./mew setup
```

안내에 따라 편집할 폴더, 포트, 계정 이메일을 입력한다. 설치가 끝나면 표시된 주소를 브라우저로 열고, 임시 비밀번호로 로그인한 뒤 비밀번호를 바꾼다.

`setup`은 Node, 빌드 도구, tmux가 설치되어 있는지 확인하고 앱 빌드와 첫 계정 생성을 진행한다. 이미 설정한 환경에서 다시 실행해도 된다.

Linux와 macOS에서 Node 22.18 이상을 지원하며, Node 24를 권장한다. 터미널과 에이전트 패널의 `terminal` 런타임은 `node-pty`를 로컬에서 빌드하고 tmux에 연결하므로 아래 도구가 필요하다.

에이전트는 `mew`를 실행하지 않는다. 빌드·배포·서버 재시작은 사용자가 직접 한다. `npm run build`, `npm start`, `./mew start|stop|restart|update`, 프로세스 직접 종료나 백그라운드 실행 등 현재 화면이나 서버를 바꾸는 명령도 실행하지 않는다. 코드 변경 후에는 `npm test`, `npm run lint`, `npx tsc -b`처럼 실행 중인 서버에 영향을 주지 않는 검증까지만 하고, 반영이 필요하면 사용자에게 알린다.

```bash
# Debian/Ubuntu
sudo apt install build-essential python3 tmux

# macOS
xcode-select --install
brew install tmux python
```

macOS에서는 `node-pty 1.1.0` 배포본의 `spawn-helper`에 실행 권한이 빠져 있어, PTY 연결 전에 이를 보정한다. 현재 로드된 네이티브 모듈 옆의 보조 파일에 소유자 실행 권한만 추가한다. 실패하면 터미널에 시작 오류가 표시되고 서버 로그에 원인이 기록된다. 터미널이 빈 화면으로 나오면 로그의 `[mew:tmux]` 오류를 먼저 확인한다.

설정과 실행 데이터는 저장소 폴더 밖에 저장된다(`server/config.ts`). 저장소를 삭제해도 이 데이터는 남는다.

- 설정: `~/.config/mew/config.env`
- 계정·세션·완료된 에이전트 턴 기록: `~/.local/share/mew/`
- 로그: `~/.local/state/mew/`

업데이트는 `./mew update`로 진행한다. 의존성 설치, 재빌드, 서버 재시작까지 포함한다.

```bash
./mew start                    # 서버 시작
./mew stop                     # 서버 중지
./mew restart                  # 서버 재시작
./mew status                   # 실행 상태와 경로 확인
./mew logs                     # 실시간 로그 확인
./mew update                   # origin/main fast-forward + 재빌드 + 재시작
./mew users add you@x.com owner
```

## 개발 실행과 검증

```bash
npm run dev     # 4999 — 개발 (vite HMR)
npm run build   # tsc + vite build → dist/
npm run serve   # 5000 — dist/ 필요
npm start       # build + serve
npm test        # node:test
npm run lint    # oxlint
npx tsc -b      # 타입만 (빌드 없이)
```

서버는 디스크의 `dist/`를 읽어 제공하므로 `npm run build`를 실행하면 빌드 결과가 실행 중인 화면에 바로 반영된다. 빌드와 재시작은 사용자가 직접 한다. 에이전트는 검증까지만 하고, `mew` 실행을 포함해 서버에 변경을 반영하는 명령은 실행하지 않는다.

터미널에서 수정한 파일이 이전 내용으로 돌아갔다면, mew 에디터에 열려 있던 내용이 저장되면서 파일을 덮어썼을 수 있다. 파일 내용을 다시 확인하고, 사용자에게 해당 파일을 닫거나 Revert File을 실행하도록 안내한다.

## 상세 문서

[문서 지도](docs/MOC.md)에서 주제별 문서를 찾을 수 있다. 문서의 명령은 모두 저장소 루트에서 실행한다. 코드를 변경하면 관련 문서도 함께 갱신한다.

| 찾는 내용 | 문서 |
| --- | --- |
| 프로젝트·파일·편집·터미널·브라우저·명령 버튼·DB | [사용법](docs/guides/MOC.md) |
| 환경변수·계정·검색·에이전트 런타임 | [설정](docs/configuration/MOC.md) |
| 지원 배포 경로·HTTPS·systemd·업데이트·백업 | [서버 배포](docs/deployment/native.md) |
| 코드 구조·협업·패키지·UI·에이전트 통신 계약 | [개발](docs/development/MOC.md) |
| 제품 스펙·운영·진행 작업·과거 검토 | [문서 지도](docs/MOC.md) |
| 역할·인증·게스트 경계 | [보안](SECURITY.md) |

제품 스펙, 운영 절차, 작업 기록은 `docs/`에서 관리한다. README에는 소개, 설치·실행·검증 방법과 문서 링크를 둔다.
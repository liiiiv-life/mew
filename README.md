# mew

mew는 내 컴퓨터나 서버의 폴더를 브라우저에서 열어 작업하는 편집기다. 마크다운·코드 편집, 파일 검색, Git, 실시간 협업, 터미널, AI 에이전트, 서버 브라우저와 원격 데스크톱을 한 화면에서 사용하며 모바일에서도 작업을 이어갈 수 있다.

처음 사용한다면 [설치](#설치-macoslinux) 후 프로젝트의 파일을 눌러 연다. 아래 **기능별 안내**에서 하고 싶은 작업의 진입 방법을 찾고, 연결된 `docs/` 문서에서 자세한 사용법·설정·제한을 확인한다. `메뉴`는 화면 오른쪽 위의 햄버거 메뉴를 뜻하며, 단축키는 기본 설정 기준이다.

- [프로젝트·파일·검색](#프로젝트파일검색)
- [문서·코드·미디어 편집](#문서코드미디어-편집)
- [Git·변경 이력](#git변경-이력)
- [협업·댓글·게스트 공유](#협업댓글게스트-공유)
- [터미널·AI 에이전트·자동화](#터미널ai-에이전트자동화)
- [브라우저·Android·원격 데스크톱](#브라우저android원격-데스크톱)
- [데이터베이스](#데이터베이스)
- [화면·모바일·계정·운영](#화면모바일계정운영)
- [설치](#설치-macoslinux) · [개발 실행과 검증](#개발-실행과-검증) · [상세 문서 지도](#상세-문서)

`manager`와 `owner` 계정은 서버의 터미널과 에이전트를 사용할 수 있으며, 사실상 서버 셸 권한을 갖는다. 공개 배포 전에는 [SECURITY.md](SECURITY.md)를 읽고, 신뢰하는 소수의 사람만 계정으로 초대한다.

## 기능별 안내

### 프로젝트·파일·검색

| 기능 | 시작 방법과 할 수 있는 일 | 상세 사용법 |
| --- | --- | --- |
| 프로젝트 탭 | 헤더 `+` 또는 `Ctrl+O`로 서버 폴더를 열고 탭으로 전환·닫기·아이콘 변경(owner) | [프로젝트 탭](docs/guides/projects.md#프로젝트-탭) |
| 새 프로젝트·Git clone | 프로젝트 폴더 선택 창의 `+`에서 폴더 생성·저장소 clone·Git 초기화(owner) | [프로젝트 만들기](docs/guides/projects.md#프로젝트-탭) |
| Documents·하위 프로젝트·MOC | 사이드바에서 Documents와 직계 `.mew` 하위 프로젝트를 펼치고 `Map Of Contents`로 문서 지도 열기 | [사이드바 구조](docs/guides/projects.md#사이드바의-프로젝트--하위-프로젝트--documents) |
| Documents 관리 | Documents 우클릭으로 문서 폴더 변경·가져오기·내보내기(owner). 가져오기는 기존 내용을 교체 | [Documents 설정](docs/guides/projects.md#documents-폴더-계약) |
| 파일·폴더 관리 | 사이드바 우클릭·길게 누르기로 생성·개명·복제·복사·잘라내기·붙여넣기·삭제·다운로드. 끌어서 이동·업로드 | [파일 조작](docs/guides/projects.md#파일폴더-관리) · [끌어놓기](docs/guides/editor.md#사이드바-항목-끌어놓기) |
| 서버 전체 파일 탐색 | 메뉴 → 파일 탐색기에서 프로젝트 밖 파일을 열고 편집·복사·이동·삭제·다운로드(manager·owner) | [서버 파일 탐색기](docs/guides/projects.md#서버-파일-탐색기) |
| 파일명 검색 | `Ctrl+P`로 파일을 찾고 `@`로 Documents·하위 프로젝트 범위 선택 | [검색 사용법](docs/configuration/search.md#파일명내용-검색과-치환) |
| 내용 검색·일괄 치환 | `Ctrl+Shift+F`에서 정확 검색·대소문자 구분·정규식 검색, 결과 줄로 이동, 파일별·전체 치환 | [검색과 치환](docs/configuration/search.md#파일명내용-검색과-치환) |
| 로컬 의미 검색(RAG) | 서버 API로 문맥 검색·색인 상태 확인·재색인. 현재 사이드바에는 의미 검색·이력 버튼이 없음 | [RAG 설정과 API](docs/configuration/search.md#로컬-의미-검색-rag) |
| 숨김 목록 | 메뉴 → 설정 → 숨김 목록에서 검색·감시·일부 역할의 트리에 적용할 제외 이름 관리(manager·owner) | [숨김 목록의 적용 범위](docs/guides/projects.md#숨김-목록-dataignorejson) |

### 문서·코드·미디어 편집

| 기능 | 시작 방법과 할 수 있는 일 | 상세 사용법 |
| --- | --- | --- |
| Markdown Hotview·Plain | `.md`를 열고 렌더된 본문 편집과 원문 편집 전환. 제목·목록·체크박스·인용·코드 블록·강조 작성 | [기본 편집](docs/guides/editor.md#기본-편집) |
| 문서 속성·목차 | Hotview 상단에서 frontmatter 제목·필드 편집, 목차 버튼으로 제목 위치 이동 | [기본 편집](docs/guides/editor.md#기본-편집) |
| 코드·텍스트 편집 | 파일을 눌러 줄 번호·구문 강조·지원 형식의 진단 확인. `Ctrl+F`로 문서 안 찾기·바꾸기 | [코드와 검색](docs/guides/editor.md#기본-편집) |
| 링크·파일 참조 | `Ctrl+K`로 링크 삽입·수정, Hotview의 `@`로 파일 연결, 링크 툴팁·YouTube 노드 삽입(재생은 배포 CSP 보완 필요) | [링크와 첨부](docs/guides/editor.md#링크와-첨부) |
| 첨부·이미지 | `/` → 파일 업로드, 파일 드롭·이미지 붙여넣기, 이미지 크기 조절 | [링크와 첨부](docs/guides/editor.md#링크와-첨부) |
| Markdown 표 | `/` → 표로 삽입하고 행·열 편집, 열 너비 조절, Markdown·CSV·이미지로 복사 | [표 사용법](docs/guides/editor.md#표-편집과-복사) · [너비 저장](docs/guides/editor.md#표-열-너비-mewtable-layoutjson) |
| 목록 들여쓰기 | `Tab`·`Shift+Tab`으로 첫 항목을 포함한 목록 깊이 조절 | [들여쓰기](docs/guides/editor.md#리스트-첫-항목-들여쓰기-----b) |
| 각주·참고문헌 | `Alt+E`로 각주 추가, 자동 번호 정리, 마커와 References 사이 이동 | [각주](docs/guides/editor.md#각주-alte) |
| 미디어·시트 보기 | 이미지·오디오·영상·PDF 미리보기, SVG 이미지/텍스트 전환, XLSX·CSV·TSV 읽기, APK·AAB 다운로드 | [파일 형식별 보기](docs/guides/editor.md#미디어와-시트-보기) |
| 자동저장·실행 취소 | 편집한 내용은 자동저장하고 `Ctrl+Z`·`Ctrl+Y`로 실행 취소·다시 실행 | [저장과 이력](docs/guides/editor.md#자동저장커밋파일-이력) |
| 문서 탭·분할 편집 | 미리보기 탭을 고정하고 탭·손잡이를 끌어 분리·합치기·순서·크기 조절 | [편집 칸](docs/guides/editor.md#편집-칸-문서-탭--화면-분할) |
| 선택 위치 전달 | 편집기에서 `Ctrl+L`로 파일 경로·선택 줄을 터미널·에이전트·채팅 입력에 넣기 | [경로와 줄 참조](docs/guides/editor.md#ctrll-참조-경로줄) |

### Git·변경 이력

| 기능 | 시작 방법과 할 수 있는 일 | 상세 사용법 |
| --- | --- | --- |
| 현재 파일 커밋·이력 복원 | `Ctrl+S` 또는 메뉴 → Commit으로 현재 파일 커밋, 편집기의 히스토리에서 이전 내용 확인·되돌리기 | [파일 저장과 이력](docs/guides/editor.md#자동저장커밋파일-이력) |
| 저장소 탐색·그래프·diff | 메뉴 → Git 또는 `Alt+G`에서 저장소를 고르고 커밋 그래프·변경 파일·파일 diff 보기(manager·owner) | [Git 작업 패널](docs/guides/projects.md#git-작업-패널) |
| 작업트리 전체 커밋 | Git의 **커밋되지 않은 변경사항**에서 제목·설명을 입력해 모든 변경을 stage·커밋 | [커밋 범위와 제한](docs/guides/projects.md#git-작업-패널) |
| 브랜치·태그·과거 커밋 작업 | 커밋 우클릭으로 해시 복사·branch/tag 생성·detached checkout·cherry-pick·revert | [지원 Git 작업](docs/guides/projects.md#git-작업-패널) |
| 여러 저장소 패널 | Git의 `+`로 저장소 탭 추가, 탭 분리·합치기·패널 닫기·다시 열기 | [Git 탭과 초안 유지](docs/guides/projects.md#git-작업-패널) |

`AI Commit`은 현재 안내만 표시하며 자동 커밋 메시지를 생성하지 않는다([현재 범위](docs/guides/projects.md#git-작업-패널)).

### 협업·댓글·게스트 공유

| 기능 | 시작 방법과 할 수 있는 일 | 상세 사용법 |
| --- | --- | --- |
| 실시간 공동 편집·참여자 | 로그인한 사용자끼리 같은 파일을 열어 함께 편집하고 커서·작업 중인 사람 표시 확인 | [공동 편집](docs/guides/collaboration.md#공동-편집과-참여자) |
| 댓글·답글·멤버 멘션 | 본문 선택 후 `Alt+Shift+C`, 하이라이트나 댓글 목록에서 답글·수정·삭제·멤버 멘션 | [댓글](docs/guides/collaboration.md#댓글과-답글) |
| 단체 채팅·DM·읽음 확인 | 메뉴 → 채팅 또는 `Alt+C`에서 단체방·상대 선택, 메시지·파일 참조 전송 | [멤버 채팅](docs/guides/collaboration.md#단체-채팅과-dm) |
| 게스트 열람·편집 공유 | 파일 트리의 눈·연필 버튼으로 로그인하지 않은 방문자에게 경로별 접근 허용 | [게스트 공유](docs/guides/collaboration.md#게스트-공유) |

### 터미널·AI 에이전트·자동화

이 영역은 manager·owner가 사용한다. 런타임에 따라 채팅 화면 또는 공식 CLI의 터미널 화면이 열린다.

| 기능 | 시작 방법과 할 수 있는 일 | 상세 사용법 |
| --- | --- | --- |
| tmux 터미널 | 메뉴 → 터미널, `Ctrl+백틱` 또는 `Alt+T`로 셸 탭 열기·세션 재연결·종료 | [터미널과 탭 수명](docs/guides/terminal-agents.md) |
| AI 런타임 선택 | 메뉴 → 에이전트(`Alt+L`) → `+`에서 Claude Code·Antigravity·Codex·Hermes·Kimi·OpenClaw·OpenCode·Cursor·Prime 선택 | [런타임별 지원](docs/configuration/agent-runtimes.md#모델권한-기본값과-런타임-선택) |
| 런타임 설치·인증·설정 | 런타임 목록의 설치·톱니 버튼에서 로그인·로그아웃·지원되는 제거·실행 경로·인자·환경변수 설정 | [설치와 계정 연결](docs/configuration/agent-runtimes.md) |
| 모델·추론·권한·기본값 | ACP 채팅 입력부에서 지원되는 설정 선택, 저장 버튼으로 런타임 기본값 저장 | [모델과 권한](docs/configuration/agent-runtimes.md#모델권한-기본값과-런타임-선택) |
| 에이전트셋·탭 관리 | 모델·역할 프리셋으로 ACP 탭 만들기, 탭 이름 변경·런타임 전환·분할 배치 | [에이전트 탭](docs/guides/terminal-agents.md) |
| 프롬프트·스킬·파일 첨부 | `@`로 프로젝트·파일·폴더 참조, `/`로 로컬 스킬 선택, 파일·이미지 첨부와 미리보기, ↑·↓로 보낸 입력 재사용 | [입력 사용법](docs/specs/agent-input-mentions.md) |
| 대화·작업 기록·메시지 큐 | 메시지 전송·중단, 작업 내역·소요 시간 확인, 작업 중 대기 메시지 편집·순서 변경, `/clear`로 새 대화 시작 | [대화 조작](docs/guides/terminal-agents.md#대화-진행과-기록) |
| 히스토리·외부 CLI 이어쓰기 | 히스토리에서 지난 세션 선택, 외부 CLI 작업을 끝낸 뒤 **현재 대화 새로고침**, 답변 파일 링크로 편집기 열기 | [세션 복원](docs/guides/terminal-agents.md) |
| 계정·구독·토큰·비용 | ACP 세션의 `i`에서 지원되는 계정·플랜·한도·토큰과 API 환산 비용 조회, 구독 페이지 열기 | [계정·구독 범위](docs/configuration/agent-runtimes.md#설치로그인구독) |
| 예약 메시지 | ACP 입력줄 시계로 현재 세션에 한 번 보낼 메시지 예약·수정·시각 변경·삭제 | [예약 메시지](docs/specs/agent-scheduled-prompts.md) |
| 프로젝트 명령 버튼 | 사이드바 ▶에서 명령 추가·편집·실행·정지, 전용 터미널 팝업으로 출력 확인 | [프로젝트 명령](docs/guides/commands.md#사이드바-프로젝트--버튼-mewcmd-buttonjson) |
| 터미널 명령 버튼 | 셸 탭 버튼 줄의 `+`로 자주 쓰는 명령·아이콘 등록, 활성 셸에 입력 | [터미널 버튼](docs/guides/commands.md#터미널-버튼-dataterm-buttonjson) |
| 반복 예약 작업 | 메뉴 → 예약 작업에서 폴더·에이전트·프롬프트·주기 등록, 지금 실행·출력 확인·삭제 | [cron 예약 작업](docs/guides/commands.md#예약-작업-dataschedulesjson) |

### 브라우저·Android·원격 데스크톱

모두 manager·owner 전용이며, 추가 설치가 필요한 기능이다.

| 기능 | 시작 방법과 할 수 있는 일 | 상세 사용법 |
| --- | --- | --- |
| 서버 웹 브라우저 | 메뉴 → 브라우저(`Alt+B`)에서 URL 입력. 서버의 localhost·사설망·외부 사이트 탐색, 탭·뒤로/앞으로·폼·업로드·다운로드 사용 | [Chromium 준비와 조작](docs/guides/browser.md#브라우저-창) |
| 브라우저 로그인·팝업 | 계정별 서버 프로필로 로그인 상태 유지, 사이트 팝업·에이전트 인증 처리, `/browser` 독립 화면 사용 | [프로필·OAuth·지원 한계](docs/guides/browser.md#브라우저-창) |
| Android | 메뉴 → Android에서 SDK·가속·AVD 상태 확인, 안내 명령 실행·터미널 보기, 기존 WebRTC/gateway 연결 | [Android 준비](docs/guides/browser.md#android-창) |
| 원격 데스크톱 | 메뉴 → 원격 데스크톱에서 자동 준비 후 전체 화면 연결. Mac/Linux 또는 WSL의 Windows 로그인 데스크톱 조작. 직접 연결 실패 시 외부 서비스 없이 Mew 서버 전송으로 전환; OS 권한 승인 필요 | [설치·연결](docs/guides/remote-desktop.md) |
| 원격 입력·모바일 조이스틱 | 마우스·키보드·붙여넣기·원격 Esc, 조이스틱 클릭·드래그·휠·화면 이동·확대, 모니터 선택·재연결 | [조작](docs/guides/remote-desktop.md#조작) · [네트워크·검증 범위](docs/development/remote-desktop.md) |

### 데이터베이스

| 기능 | 시작 방법과 할 수 있는 일 | 상세 사용법 |
| --- | --- | --- |
| 문서 안 표 DB | Hotview에서 `/db`로 삽입해 제목·행·셀·열 편집. 텍스트·숫자·체크박스·날짜와 실시간 협업 지원 | [DB 사용법](docs/guides/database.md) |
| DB 참조·외부 테이블 | `/` → 데이터베이스 참조에서 기존 DB 또는 외부 Postgres 테이블을 읽기 전용으로 연결 | [참조와 프로젝트 격리](docs/guides/database.md) |
| 프로젝트 DB 목록 | 메뉴 → 데이터베이스에서 현재 프로젝트의 모든 DB를 골라 열람·편집 | [전체 DB 팝업](docs/guides/database.md) |
| Postgres 연결 | `DATABASE_URL` 설정. 선택적으로 `npm run db:up`·`db:down`으로 DB만 실행·중지 | [DB 준비](docs/guides/database.md#postgres만-docker-compose로-띄우기-선택) |

### 화면·모바일·계정·운영

| 기능 | 시작 방법과 할 수 있는 일 | 상세 사용법 |
| --- | --- | --- |
| 패널 배치·상태 복원 | 에디터·에이전트·터미널·브라우저·Git 손잡이와 탭을 끌어 배치. 브라우저는 좌우 배치만 지원. 문서 탭·배치·스크롤은 계정별 복원 | [편집 칸](docs/guides/editor.md#편집-칸-문서-탭--화면-분할) · [복원 범위](docs/guides/projects.md#프로젝트-탭) |
| 모바일·전체화면·빠른 조작 | 메뉴 → 전체화면(`Alt+Enter`), 플로팅 핸들로 패널·탭 조작, 길게 눌러 항목 메뉴 열기, Esc·뒤로가기로 전면 창 닫기 | [모바일 사용법](docs/guides/editor.md#모바일과-전체화면) |
| 테마·언어·강조색·글꼴 | 메뉴 → 설정 → 화면에서 밝게/어둡게, 한국어·영어·일본어·중국어, 색상과 UI·본문·코드 글꼴 설정 | [화면 설정](docs/configuration/environment.md#화면-설정) |
| 단축키 맞춤 설정 | 설정 → 단축키에서 조합 변경·개별 초기화·전체 초기화 | [단축키 설정](docs/configuration/environment.md#단축키-설정) |
| Mewcat | 하단 고양이를 클릭·끌기·던지기, 설정 → 뮤캣에서 스킨 선택 또는 숨기기 | [Mewcat](docs/specs/mewcat.md) |
| 내 계정 | 설정 → 계정에서 표시 이름·프로필 이미지·비밀번호 변경, 로그아웃 | [계정 사용법](docs/configuration/environment.md#내-계정과-계정-관리) |
| 사용자·역할 관리 | owner가 메뉴 → 계정 관리에서 계정 추가·역할 변경. 호스트 CLI에서 목록·비밀번호 재발급·계정 삭제 | [사용자 관리](docs/configuration/environment.md#내-계정과-계정-관리) |
| 시스템 자원 | 메뉴 → 시스템 자원에서 CPU·메모리·GPU·온도·프로세스와 최근 추이 확인(manager·owner) | [자원 팝업](docs/guides/commands.md#시스템-자원-팝업) |
| 서버 설정·시작·중지·로그 | `./mew setup`, `start`·`stop`·`restart`·`status`·`logs`로 설치·운영 | [서버 설정](docs/configuration/environment.md#서버-설정) · [배포](docs/deployment/native.md) |
| 앱 업데이트·HTTPS·백업 | 메뉴의 업데이트 확인·실행 또는 `./mew update`, 서버 배포 시 HTTPS·systemd·백업·복구 구성 | [업데이트와 운영](docs/deployment/native.md) |

예전 워크스페이스 홈의 **할 일·달력**은 현재 화면에서 제공하지 않는다. 문서 안 체크박스와 에이전트 예약 기능은 위 안내대로 사용할 수 있다([현재 프로젝트 화면 범위](docs/guides/projects.md#현재-제공하지-않는-홈-화면)).

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

제품 스펙, 상세 사용법, 운영 절차, 작업 기록은 `docs/`에서 관리한다. README는 모든 기능의 요약·진입 방법과 설치·실행·검증 방법을 안내하고 상세 기준본으로 연결한다.

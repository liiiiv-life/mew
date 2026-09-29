# mew 사용법

[한국어](getting-started-ko.md) · [English](getting-started-en.md) · [简体中文](getting-started-zh.md) · [日本語](getting-started-ja.md)

mew는 컴퓨터나 서버의 폴더를 브라우저에서 열어 쓸 수 있게 합니다. Markdown과 코드를 편집하고, 터미널과 AI 에이전트를 실행하며, Git 변경을 검토하고, 문서를 함께 작업할 수 있습니다. 휴대폰에서도 사용할 수 있습니다.

## 빠른 시작

[Windows (WSL 2)](#windows-wsl-2) · [macOS](#macos) · [Linux](#linux) · [원격 접속](#remote-access)

<a id="windows-wsl-2"></a>

### Windows (WSL 2)

WSL 2의 Ubuntu 안에서 mew를 실행한 다음 Windows 브라우저에서 엽니다.

**1. WSL과 Ubuntu를 설치합니다.** PowerShell을 관리자 권한으로 열고 다음을 실행합니다.

```powershell
wsl --install -d Ubuntu
```

Windows를 다시 시작한 뒤 시작 메뉴에서 **Ubuntu**를 열어 Linux 사용자 이름과 비밀번호를 만듭니다. Windows 로그인 계정과는 별개입니다. 이 명령은 Windows 11 또는 Windows 10 버전 2004(빌드 19041) 이상에서 사용할 수 있습니다. 설치가 실패하면 [Microsoft WSL 설치 안내](https://learn.microsoft.com/en-us/windows/wsl/install)를 참고하세요.

이미 Ubuntu가 설치되어 있다면 PowerShell에서 `wsl -l -v`로 확인합니다. 버전이 `1`이면 목록에 표시된 배포판 이름을 사용해 `wsl --set-version Ubuntu 2`를 실행합니다.

**2. mew를 설치합니다.** **Ubuntu**에서 다음 명령을 실행합니다.

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential python3 tmux
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/liiiiv-life/mew.git
cd mew
./mew setup
```

Node를 nvm으로 설치할지 물으면 설치를 선택합니다. Linux 도구를 빠르게 쓰려면 저장소와 프로젝트를 `~/apps`, `~/mew-workspace`처럼 Linux 파일 시스템에 둡니다. `explorer.exe .`를 실행하면 현재 폴더가 Windows 탐색기에서 열립니다. 자세한 내용은 [Microsoft의 WSL 파일 저장소 안내](https://learn.microsoft.com/en-us/windows/wsl/setup/environment#file-storage)를 참고하세요.

**3. 로그인합니다.** 아래 [설치 마무리](#finish-setup)의 안내를 따른 후, 출력된 URL을 Edge, Chrome 등 Windows 브라우저에서 엽니다. 보통 주소는 `http://localhost:5000`입니다. [WSL은 Windows에서 localhost 접속을 전달합니다](https://learn.microsoft.com/en-us/windows/wsl/networking#accessing-linux-networking-apps-from-windows-localhost).

<a id="macos"></a>

### macOS

**1. Apple 명령줄 도구를 설치합니다.** 터미널을 열고 다음을 실행합니다.

```bash
xcode-select --install
```

설치가 끝날 때까지 기다립니다. 이미 도구가 설치되어 있으면 다음 단계로 넘어갑니다.

**2. Homebrew와 필요한 도구를 설치합니다.** `brew`가 없다면 [Homebrew](https://brew.sh/)의 명령을 실행합니다.

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

설치 프로그램의 **Next steps**에 따라 Homebrew를 셸에 추가하고 아래 명령을 실행합니다.

```bash
brew install tmux python
```

**3. mew를 설치합니다.** 같은 터미널 창에서 다음을 실행합니다.

```bash
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/liiiiv-life/mew.git
cd mew
./mew setup
```

Node를 nvm으로 설치할지 물으면 설치를 선택합니다. 아래 [설치 마무리](#finish-setup)를 마친 후 브라우저에서 출력된 URL을 엽니다.

설치 프로그램은 원격 데스크톱 도우미도 준비합니다. mew를 실행하는 Mac에서 시스템 설정이 열리면 Electron에 **손쉬운 사용** 및 **화면 기록** 권한을 허용합니다. 권한을 허용하면 설치가 계속됩니다. 자세한 내용은 [Mac 권한 준비](../guides/remote-desktop.md#mac-%EA%B6%8C%ED%95%9C-%EC%A4%80%EB%B9%84)를 참고하세요.

<a id="finish-setup"></a>

### 설치 마무리

설치 프로그램은 다음을 묻습니다.

- **Workspace folder:** 프로젝트를 모아 둘 상위 폴더입니다. 기본값은 `~/mew-workspace`이며, 그 안의 각 폴더를 프로젝트로 사용합니다.
- **Port:** 기본값은 `5000`입니다. 이미 사용 중이면 설치 프로그램이 가까운 사용 가능한 포트를 고릅니다.
- **Postgres connection:** 데이터베이스 표에 선택적으로 연결합니다. 건너뛰고 나중에 추가할 수 있습니다.
- **Owner email:** 처음 만들 mew 계정입니다. 설치 프로그램이 임시 비밀번호를 출력합니다.

설치 프로그램이 필요한 패키지를 받고 원격 데스크톱 구성 요소를 준비한 뒤 앱을 빌드하고 서버를 시작합니다. 처음에는 다운로드에 몇 분 걸릴 수 있습니다. 원격 데스크톱 준비에 실패해도 경고만 표시하고 나머지 설치는 계속합니다.

설치가 끝나면 표시된 URL을 열어 로그인하고 임시 비밀번호를 바꿉니다. 헤더의 **+**로 프로젝트 폴더를 연 뒤 사이드바에서 파일을 선택합니다.

재부팅한 후에는 Ubuntu나 터미널을 열고 설치 폴더에서 mew를 시작합니다.

```bash
cd ~/apps/mew
./mew start
```

<a id="linux"></a>

### Linux

Debian 또는 Ubuntu에서는 다음을 실행합니다.

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential python3 tmux
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/liiiiv-life/mew.git
cd mew
./mew setup
```

다른 배포판에서는 먼저 같은 용도의 패키지를 설치합니다. 위의 [설치 마무리](#finish-setup)를 따릅니다. 부팅할 때 자동으로 시작하거나 원격 접속을 받으려면 [배포 안내](../deployment/native.md)를 사용합니다.

<a id="remote-access"></a>

### 원격 접속

설치 후 아래 방법 중 하나로 휴대폰이나 다른 컴퓨터에서 mew를 엽니다. 호스트를 켜 두고 mew가 실행 중이어야 합니다. 두 방법 모두 HTTPS 트래픽을 로컬 mew 서버로 전달합니다. `MEW_BIND=127.0.0.1`은 그대로 두고, 설치 포트가 다르면 `5000`을 해당 포트로 바꿉니다.

#### 1. Tailscale (권장)

본인이 소유한 기기끼리 연결할 때 사용합니다. 도메인을 구매할 필요가 없으며 비공개 Tailscale 네트워크(tailnet)에 연결한 기기만 접속할 수 있습니다.

1. mew 호스트와 접속할 모든 기기에 [Tailscale](https://tailscale.com/download)을 설치합니다. 모든 기기를 같은 tailnet에 연결합니다.

2. mew 호스트에서 다음을 실행합니다.

   ```bash
   tailscale serve --bg http://127.0.0.1:5000
   ```

   요청되면 출력된 링크를 따라 HTTPS를 활성화합니다. Linux에서는 권한 오류가 나면 `sudo`를 사용합니다. WSL 2에서는 **Windows**에 Tailscale을 설치한 뒤, `http://localhost:5000`이 Windows 브라우저에서 열리는 것을 확인하고 PowerShell에서 이 명령을 실행합니다.

3. 휴대폰이나 다른 컴퓨터에서 Tailscale에 연결한 뒤 출력된 `https://<machine>.<tailnet>.ts.net` URL을 열어 mew에 로그인합니다.

공식 [Tailscale Serve 안내](https://tailscale.com/docs/features/tailscale-serve)와 [명령어 참고](https://tailscale.com/docs/reference/tailscale-cli/serve)를 참고하세요.

#### 2. Cloudflare Tunnel

접속하는 기기에 Tailscale을 설치하지 않고도 브라우저에서 접속할 수 있는 고정 HTTPS 주소가 필요할 때 사용합니다. **Cloudflare DNS에서 관리하는 도메인이 필요합니다.**

1. 공식 [Cloudflare 도메인 등록 안내](https://developers.cloudflare.com/registrar/get-started/register-domain/)로 도메인을 구매하거나, [기존 도메인을 Cloudflare에 추가](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/)하고 네임서버 안내를 따릅니다.
2. 공식 [Cloudflare Tunnel 설정 안내](https://developers.cloudflare.com/tunnel/get-started/)에 따라 터널을 만들고 mew 호스트에 `cloudflared`를 설치해 실행합니다. WSL 2에서는 mew와 같은 Ubuntu 환경에서 `cloudflared`를 실행합니다.
3. 호스트 이름을 `mew.example.com`처럼 정하고 서비스 URL을 `http://127.0.0.1:5000`으로 하는 **Published application** 경로를 추가합니다. mew가 `/`에서 제공되도록 경로는 비워 둡니다.
4. `cloudflared`를 실행한 상태로 유지한 뒤 다른 기기에서 `https://mew.example.com`을 열어 mew에 로그인합니다.

이 설정은 공개 HTTPS 진입점을 만듭니다. mew의 계정 권한은 계속 적용됩니다. 프록시 요구 사항과 연결 점검은 [Security](../../SECURITY.md) 및 [배포 안내](../deployment/native.md#2-https-%ED%94%84%EB%A1%9D%EC%8B%9C-%EB%98%90%EB%8A%94-%ED%84%B0%EB%84%90-%EC%97%B0%EA%B2%B0)를 참고하세요.

## 실행 환경과 권한

서버는 Linux 또는 macOS에서 실행하며, Windows에서는 WSL 2를 사용합니다. Node 22.18+ 또는 24+가 필요하며 Node 24를 권장합니다. 터미널은 tmux와 로컬에서 컴파일한 `node-pty`를 사용하므로 설치에 Python과 C/C++ 도구 모음이 필요합니다. Postgres에는 Docker를 선택적으로 쓸 수 있지만, mew 앱 자체를 컨테이너에서 실행하는 것은 현재 지원하지 않습니다.

신뢰할 수 있는 사람과만 mew를 사용하세요. 기본적으로 `manager`와 `owner` 계정은 서버 사용자 OS 권한으로 터미널과 에이전트를 실행할 수 있습니다. 다른 계정에 이 기능을 부여하면 같은 접근 권한을 주게 됩니다. 다른 사람에게 인스턴스를 제공하기 전에 [SECURITY.md](../../SECURITY.md)를 읽으세요.

## mew 사용하기

이 문서에서 **메뉴**는 오른쪽 위의 메뉴를 뜻합니다. 작업 공간 패널은 독에서 열고, 나머지 동작과 설정은 메뉴에서 찾습니다. 단축키는 기본 설정이며 **설정 → 단축키**에서 바꿀 수 있습니다.

- [프로젝트, 파일, 검색](#projects-files-and-search)
- [글, 코드, 미디어](#writing-code-and-media)
- [Git](#git)
- [협업과 공유](#collaboration-and-sharing)
- [터미널, 에이전트, 자동화](#terminals-agents-and-automation)
- [브라우저, Android, 원격 데스크톱](#browser-android-and-remote-desktop)
- [데이터베이스](#databases)
- [레이아웃, 설정, 계정](#layout-settings-and-accounts)
- [실행과 업데이트](#running-and-updating) · [개발](../development/getting-started.md) · [문서](#documentation)

<a id="projects-files-and-search"></a>

### 프로젝트, 파일, 검색

| 작업 | 시작 위치 | 자세한 내용 |
| --- | --- | --- |
| 프로젝트 열기와 정리 | 헤더의 **+** 또는 `Ctrl+O`. 탭을 전환하고 아이콘을 바꾸거나, 탭을 길게 눌러 프로젝트를 그룹화하고 순서를 바꿉니다(owner). | [프로젝트 탭](../guides/projects.md#%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%ED%83%AD) |
| 프로젝트 생성 또는 저장소 복제 | 프로젝트 폴더 선택기에서 폴더를 만들고 저장소를 복제하거나 Git을 초기화합니다(owner). | [프로젝트 설정](../guides/projects.md#%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%ED%83%AD) |
| 즐겨찾기 또는 클라우드 폴더로 이동 | 폴더 선택기와 서버 파일 브라우저에서 OS 폴더와 감지된 OneDrive, Google Drive, Dropbox, iCloud 폴더를 찾습니다. 즐겨찾기는 계정별로 저장됩니다. | [폴더 바로가기](../guides/projects.md#%ED%81%B4%EB%9D%BC%EC%9A%B0%EB%93%9C-%ED%8F%B4%EB%8D%94-%EB%B0%94%EB%A1%9C%EA%B0%80%EA%B8%B0) |
| Documents와 하위 프로젝트 탐색 | 사이드바에서 폴더를 펼칩니다. `.mew` 하위 프로젝트는 별도 탭에서 열고, 폴더를 오른쪽 클릭해 하위 프로젝트로 표시할 수 있습니다(owner). **Map Of Contents**는 문서 지도를 엽니다. | [사이드바 구조](../guides/projects.md#%EC%82%AC%EC%9D%B4%EB%93%9C%EB%B0%94%EC%9D%98-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8--%ED%95%98%EC%9C%84-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8--documents) |
| 프로젝트 지침 설정 | 에이전트 패널의 기본 지침에서 커밋, 언어, 응답 길이를 정합니다. **Documents**를 오른쪽 클릭하면 문서 설정, 미리보기, 누락 파일 생성을 할 수 있습니다(owner). CLI도 사용할 수 있습니다. | [지침과 설정](../guides/project-setup.md) |
| Documents 관리 | **Documents**를 오른쪽 클릭해 폴더를 바꾸거나 가져오기 및 내보내기를 합니다(owner). 가져오기는 기존 내용을 대체합니다. | [Documents 폴더](../guides/projects.md#documents-%ED%8F%B4%EB%8D%94-%EA%B3%84%EC%95%BD) |
| 파일과 폴더 관리 | 항목을 오른쪽 클릭하거나 길게 눌러 만들기, 이름 바꾸기, 복제, 복사, 이동, 삭제, 다운로드를 합니다. 파일을 끌어 이동하거나 업로드할 수 있습니다. | [파일·폴더 관리](../guides/projects.md#%ED%8C%8C%EC%9D%BC%ED%8F%B4%EB%8D%94-%EA%B4%80%EB%A6%AC) · [끌어놓기](../guides/editor.md#%EC%82%AC%EC%9D%B4%EB%93%9C%EB%B0%94-%ED%95%AD%EB%AA%A9-%EB%81%8C%EC%96%B4%EB%86%93%EA%B8%B0) |
| 프로젝트 밖 탐색 | **메뉴 → 파일 브라우저**에서 서버 파일 시스템을 엽니다(manager 또는 owner). | [서버 파일 탐색기](../guides/projects.md#%EC%84%9C%EB%B2%84-%ED%8C%8C%EC%9D%BC-%ED%83%90%EC%83%89%EA%B8%B0) |
| 파일 또는 텍스트 찾기 | `Ctrl+P`로 파일 이름을 찾고, `@`로 Documents 또는 하위 프로젝트로 범위를 좁힙니다. `Ctrl+Shift+F`로 파일 내용 전체를 대소문자 일치, 정규식, 파일 간 바꾸기와 함께 검색합니다. | [검색과 바꾸기](../configuration/search.md#%ED%8C%8C%EC%9D%BC%EB%AA%85%EB%82%B4%EC%9A%A9-%EA%B2%80%EC%83%89%EA%B3%BC-%EC%B9%98%ED%99%98) |
| 파일 제외 | **설정 → 숨김 목록**에서 검색, 파일 감시, 일부 역할의 파일 트리에 적용할 제외 이름을 관리합니다(manager 또는 owner). | [제외 규칙](../guides/projects.md#%EC%88%A8%EA%B9%80-%EB%AA%A9%EB%A1%9D-dataignorejson) |

<a id="writing-code-and-media"></a>

### 글, 코드, 미디어

| 작업 | 시작 위치 | 자세한 내용 |
| --- | --- | --- |
| Markdown 편집 | `.md` 파일을 엽니다. **Hotview**에서는 렌더링된 문서를, **Plain**에서는 원본을 편집합니다. 제목, 목록, 체크박스, 인용, 코드 블록, 인라인 서식을 사용할 수 있습니다. | [기본 편집](../guides/editor.md#%EA%B8%B0%EB%B3%B8-%ED%8E%B8%EC%A7%91) |
| 메타데이터 편집 또는 제목으로 이동 | Hotview 위의 frontmatter 필드를 편집하거나 목차를 사용합니다. | [문서 구조](../guides/editor.md#%EA%B8%B0%EB%B3%B8-%ED%8E%B8%EC%A7%91) |
| 코드 편집 | 지원 형식의 소스 파일을 열면 줄 번호, 구문 강조, 진단을 제공합니다. `Ctrl+F`로 찾기와 바꾸기를 엽니다. | [코드 편집](../guides/editor.md#%EA%B8%B0%EB%B3%B8-%ED%8E%B8%EC%A7%91) |
| 링크와 첨부 삽입 | `Ctrl+K`로 링크를 편집하고, Hotview에서 `@`로 파일을 링크합니다. 이미지를 끌어놓거나 붙여 넣고 크기를 조절하며, `/`로 파일을 업로드합니다. YouTube 노드는 삽입할 수 있지만 재생하려면 배포 CSP를 바꿔야 합니다. | [링크와 첨부](../guides/editor.md#%EB%A7%81%ED%81%AC%EC%99%80-%EC%B2%A8%EB%B6%80) |
| 표 작업 | `/`에서 표를 삽입하고 행과 열을 편집하며 열 너비를 조절하고 Markdown, CSV, 이미지로 복사합니다. | [표 편집과 복사](../guides/editor.md#%ED%91%9C-%ED%8E%B8%EC%A7%91%EA%B3%BC-%EB%B3%B5%EC%82%AC) · [열 너비](../guides/editor.md#%ED%91%9C-%EC%97%B4-%EB%84%88%EB%B9%84-mewtable-layoutjson) |
| 목록 들여쓰기 | 첫 항목을 포함해 `Tab`과 `Shift+Tab`을 사용합니다. | [목록 첫 항목 들여쓰기](../guides/editor.md#%EB%A6%AC%EC%8A%A4%ED%8A%B8-%EC%B2%AB-%ED%95%AD%EB%AA%A9-%EB%93%A4%EC%97%AC%EC%93%B0%EA%B8%B0-----b) |
| 각주 추가 | `Alt+E`로 각주를 삽입합니다. 표식과 참조 사이의 번호와 링크는 자동으로 유지됩니다. | [각주](../guides/editor.md#%EA%B0%81%EC%A3%BC-alte) |
| 미디어와 스프레드시트 보기 | 이미지, 오디오, 비디오, PDF를 미리 보고 SVG는 이미지와 소스 사이에서 전환하며 XLSX, CSV, TSV를 읽고 APK와 AAB 파일을 다운로드합니다. | [미디어와 시트 보기](../guides/editor.md#%EB%AF%B8%EB%94%94%EC%96%B4%EC%99%80-%EC%8B%9C%ED%8A%B8-%EB%B3%B4%EA%B8%B0) |
| PDF 읽기와 주석 | PDF 도구 모음에서 전체 화면, 페이지, 확대, 텍스트 선택, 펜, 형광펜을 사용합니다. PDF에 저장하거나 주석을 넣은 복사본을 다운로드합니다. | [PDF 읽기와 필기](../guides/editor.md#pdf-%EC%9D%BD%EA%B8%B0%EC%99%80-%ED%95%84%EA%B8%B0) |
| 저장과 실행 취소 | 편집 내용은 자동으로 저장됩니다. `Ctrl+Z`로 실행 취소하고 `Ctrl+Y`로 다시 실행합니다. | [자동 저장과 이력](../guides/editor.md#%EC%9E%90%EB%8F%99%EC%A0%80%EC%9E%A5%EC%BB%A4%EB%B0%8B%ED%8C%8C%EC%9D%BC-%EC%9D%B4%EB%A0%A5) |
| 편집 칸 배치 | 미리보기 탭을 고정한 뒤 탭과 핸들을 끌어 패널을 분할, 병합, 재정렬, 크기 조절합니다. | [탭과 분할](../guides/editor.md#%ED%8E%B8%EC%A7%91-%EC%B9%B8-%EB%AC%B8%EC%84%9C-%ED%83%AD--%ED%99%94%EB%A9%B4-%EB%B6%84%ED%95%A0) |
| 파일 참조 보내기 | `Ctrl+L`로 현재 경로와 선택한 줄을 터미널, 에이전트, 채팅 입력으로 보냅니다. | [경로와 줄 참조](../guides/editor.md#ctrll-%EC%B0%B8%EC%A1%B0-%EA%B2%BD%EB%A1%9C%EC%A4%84) |

<a id="git"></a>

### Git

독에서 **Git**을 누르거나 `Alt+G`를 눌러 커밋, 변경 파일, diff를 살펴봅니다(manager 또는 owner). 변경 목록에서 파일을 선택하고 아래에 메시지를 입력해 커밋합니다. 커밋을 오른쪽 클릭하면 해시 복사, 브랜치 또는 태그 생성, 체크아웃, 체리픽, 되돌리기를 할 수 있습니다.

**GitHub** 버튼은 내장 브라우저에서 기기 로그인을 진행해 서버의 Git 자격 증명을 연결합니다. 서버에 `gh`가 있어야 합니다. **AI auto-commit**은 에이전트 세트와 mew의 커밋 스킬로 선택한 변경을 여러 커밋으로 나눕니다. 실제 커밋을 만들고 해시, 포함 파일, 남은 변경을 알려 줍니다.

현재 파일을 커밋하려면 `Ctrl+S` 또는 **메뉴 → 커밋**을 사용합니다. 편집기 이력에서 이전 내용을 확인하고 복원할 수 있습니다. Git 패널은 닫았다 다시 열어도 초안을 유지하며, 데스크톱 핸들로 위치를 옮길 수 있습니다.

[Git 작업 패널](../guides/projects.md#git-%EC%9E%91%EC%97%85-%ED%8C%A8%EB%84%90), [GitHub 로그인](../guides/projects.md#github-%EB%A1%9C%EA%B7%B8%EC%9D%B8), [파일 이력](../guides/editor.md#%EC%9E%90%EB%8F%99%EC%A0%80%EC%9E%A5%EC%BB%A4%EB%B0%8B%ED%8C%8C%EC%9D%BC-%EC%9D%B4%EB%A0%A5)을 참고하세요.

<a id="collaboration-and-sharing"></a>

### 협업과 공유

| 작업 | 시작 위치 | 자세한 내용 |
| --- | --- | --- |
| 함께 편집 | 로그인한 상태에서 같은 파일을 엽니다. 편집기에 다른 참여자와 커서가 표시됩니다. | [공동 편집과 참여자](../guides/collaboration.md#%EA%B3%B5%EB%8F%99-%ED%8E%B8%EC%A7%91%EA%B3%BC-%EC%B0%B8%EC%97%AC%EC%9E%90) |
| 공유 메모 유지 | 메모 독 아이콘 또는 `Ctrl/Cmd+M`을 사용합니다. 서버 전체에서 쓰는 Markdown 메모를 실시간으로 편집하고 참여자 색상을 확인하며 제목을 끌어 옮깁니다. | [공통 메모](../guides/collaboration.md#%EA%B3%B5%ED%86%B5-%EB%A9%94%EB%AA%A8) |
| 접속자 확인 | 메뉴 옆 세션 수를 누르면 사용자, 기기, 프로젝트, 현재 파일을 볼 수 있습니다. | [접속 중인 mew 세션](../guides/collaboration.md#%EC%A0%91%EC%86%8D-%EC%A4%91%EC%9D%B8-mew-%EC%84%B8%EC%85%98) |
| 문서에 댓글 | 텍스트를 선택하고 `Alt+Shift+C`를 누릅니다. 강조 표시나 댓글 목록에서 답글, 편집, 삭제, 멘션을 합니다. | [댓글과 답글](../guides/collaboration.md#%EB%8C%93%EA%B8%80%EA%B3%BC-%EB%8B%B5%EA%B8%80) |
| 구성원과 채팅 | **메뉴 → 채팅** 또는 `Alt+C`에서 파일 참조와 읽음 확인이 있는 그룹 채팅과 DM을 엽니다. | [단체 채팅과 DM](../guides/collaboration.md#%EB%8B%A8%EC%B2%B4-%EC%B1%84%ED%8C%85%EA%B3%BC-dm) |
| 게스트와 공유 | owner는 계정 관리의 파일 및 폴더 권한에서 로그인하지 않은 방문자에게 특정 경로의 읽기 또는 편집 권한을 줄 수 있습니다. | [게스트 공유](../guides/collaboration.md#%EA%B2%8C%EC%8A%A4%ED%8A%B8-%EA%B3%B5%EC%9C%A0) |

<a id="terminals-agents-and-automation"></a>

### 터미널, 에이전트, 자동화

터미널과 에이전트 기능은 기본적으로 manager와 owner가 사용할 수 있습니다. 런타임에 따라 에이전트는 채팅 패널이나 공식 CLI 터미널에서 열립니다.

| 작업 | 시작 위치 | 자세한 내용 |
| --- | --- | --- |
| 셸 열기 | 독의 **터미널**, `Ctrl+Backtick`, 또는 `Alt+T`. tmux 세션을 만들고, 다시 연결하고, 종료합니다. | [터미널과 탭](../guides/terminal-agents.md) |
| 에이전트 선택 | 독의 **에이전트**(`Alt+L`) → **+**. 런타임에는 Claude Agent, Antigravity, Codex, Hermes, Kimi, OpenClaw, OpenCode, Cursor, Prime이 있습니다. | [런타임 지원](../configuration/agent-runtimes.md#%EB%AA%A8%EB%8D%B8%EA%B6%8C%ED%95%9C-%EA%B8%B0%EB%B3%B8%EA%B0%92%EA%B3%BC-%EB%9F%B0%ED%83%80%EC%9E%84-%EC%84%A0%ED%83%9D) |
| 런타임 설치 또는 설정 | 런타임 목록의 설치 및 설정 버튼에서 인증하고 실행 설정을 바꾸거나, 지원되는 런타임은 로그아웃하거나 제거합니다. Antigravity는 Google의 공식 ACP 서버를 사용합니다. | [런타임 설정](../configuration/agent-runtimes.md) |
| 모델, 추론, 권한 선택 | ACP 채팅 입력 옆의 컨트롤을 사용합니다. 지원하는 설정은 런타임 기본값으로 저장할 수 있습니다. | [모델과 기본값](../configuration/agent-runtimes.md#%EB%AA%A8%EB%8D%B8%EA%B6%8C%ED%95%9C-%EA%B8%B0%EB%B3%B8%EA%B0%92%EA%B3%BC-%EB%9F%B0%ED%83%80%EC%9E%84-%EC%84%A0%ED%83%9D) |
| 에이전트 설정 재사용 | 모델과 역할 사전 설정이 있는 에이전트 세트에서 탭을 만듭니다. 탭 이름과 런타임을 바꾸고 화면을 나눠 배치할 수 있습니다. | [에이전트 탭](../guides/terminal-agents.md) |
| 프롬프트에 컨텍스트 추가 | `@`로 프로젝트, 파일, 폴더를 참조하고 `/`로 로컬 스킬을 선택합니다. 파일이나 이미지를 첨부하고 화살표 키로 보낸 입력을 다시 불러옵니다. | [에이전트 입력](../specs/agent-input-mentions.md) |
| 대화 관리 | 작업을 보내거나 중지하고, 도구 실행과 경과 시간을 확인하며, 대기 중인 메시지를 편집하거나 순서를 바꾸고, `/clear`로 새 대화를 시작합니다. | [대화 진행과 기록](../guides/terminal-agents.md#%EB%8C%80%ED%99%94-%EC%A7%84%ED%96%89%EA%B3%BC-%EA%B8%B0%EB%A1%9D) |
| 채팅에서 셸 명령 실행 | 모델 선택기 옆의 터미널 아이콘을 전환합니다. 명령이 실행되는 tmux를 열거나 명령을 중지할 수 있고, 저장된 출력을 나중에 확인하거나 내려받을 수 있습니다. | [대화에서 CLI 명령 실행](../guides/terminal-agents.md#%EB%8C%80%ED%99%94%EC%97%90%EC%84%9C-cli-%EB%AA%85%EB%A0%B9-%EC%8B%A4%ED%96%89) |
| 이전 작업 이어가기 | 이력에서 세션을 선택합니다. 외부 CLI에서 작업한 뒤에는 **현재 대화 새로고침**을 사용합니다. 응답의 파일 링크는 편집기에서 열립니다. | [세션 이력](../guides/terminal-agents.md) |
| 계정과 사용량 확인 | ACP 세션의 **i** 버튼에서 사용 가능한 계정, 요금제, 제한, 토큰 사용량, API 기준 비용 정보를 확인합니다. | [계정과 구독](../configuration/agent-runtimes.md#%EC%84%A4%EC%B9%98%EB%A1%9C%EA%B7%B8%EC%9D%B8%EA%B5%AC%EB%8F%85) |
| 메시지 예약 | ACP 입력 옆 시계로 현재 세션에 한 번 보낼 메시지를 예약합니다. 실행 전 편집, 일정 변경, 삭제할 수 있습니다. | [예약 메시지](../specs/agent-scheduled-prompts.md) |
| 기능 명세로 작업 | 독의 **Features**에서 요구 사항을 바로 편집하고 에이전트 세트에 적용합니다. 원본 Markdown, 관련 파일, 커밋, 사용자 검토를 추적합니다. | [기능 중심 개발](../specs/feature-development.md) |
| 프로젝트 명령 저장 | 사이드바의 **▶** 메뉴에서 명령을 추가, 편집, 실행, 중지하며 출력은 전용 터미널 팝업에 표시됩니다. | [프로젝트 명령](../guides/commands.md#%EC%82%AC%EC%9D%B4%EB%93%9C%EB%B0%94-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8--%EB%B2%84%ED%8A%BC-mewcmd-buttonjson) |
| 셸 명령 저장 | 셸 탭의 명령 행에서 **+**를 사용해 명령과 아이콘을 추가합니다. 버튼은 활성 셸에 입력을 보냅니다. | [터미널 버튼](../guides/commands.md#%ED%84%B0%EB%AF%B8%EB%84%90-%EB%B2%84%ED%8A%BC-dataterm-buttonjson) |
| 반복 작업 실행 | **메뉴 → 예약 작업**에서 폴더, 에이전트, 프롬프트, 일정을 저장합니다. 작업을 바로 실행하고 출력을 확인하거나 삭제할 수 있습니다. | [예약 작업](../guides/commands.md#%EC%98%88%EC%95%BD-%EC%9E%91%EC%97%85-dataschedulesjson) |

에이전트 패널의 **i** 버튼 옆 **Skills**와 **MCP**에서 전역, 프로젝트, 하위 프로젝트에 설치된 확장을 확인하고 관리합니다. 지원 위치와 런타임은 [스킬과 MCP 설정](../configuration/agent-harness.md)을 참고하세요.

<a id="browser-android-and-remote-desktop"></a>

### 브라우저, Android, 원격 데스크톱

이 기능에는 추가 구성 요소가 필요하며 manager와 owner가 사용할 수 있습니다.

| 작업 | 시작 위치 | 자세한 내용 |
| --- | --- | --- |
| 서버에서 브라우징 | 독의 **브라우저** 또는 `Alt+B`. localhost 서비스, 사설 네트워크 페이지, 공개 사이트를 엽니다. 여러 탭, 양식 입력, 파일 업로드·다운로드를 지원합니다. | [서버 브라우저](../guides/browser.md#%EB%B8%8C%EB%9D%BC%EC%9A%B0%EC%A0%80-%EC%B0%BD) |
| 브라우저 로그인 유지 | 계정마다 서버에 브라우저 프로필이 저장됩니다. 팝업과 에이전트 인증을 지원하며 `/browser` 페이지를 따로 열 수도 있습니다. | [프로필과 제한](../guides/browser.md#%EB%B8%8C%EB%9D%BC%EC%9A%B0%EC%A0%80-%EC%B0%BD) |
| Android 준비 | **메뉴 → Android**에서 SDK, 가속, AVD 상태를 확인하고 설정 명령과 터미널 출력을 보며, 기존 WebRTC 게이트웨이에 연결합니다. | [Android 설정](../guides/browser.md#android-%EC%B0%BD) |
| 데스크톱 제어 | 독의 **원격 데스크톱**에서 도우미를 준비하고 로그인한 Mac 또는 Linux 데스크톱에 연결합니다. mew가 WSL에서 실행 중이면 Windows 데스크톱에도 연결합니다. OS 권한 승인이 필요합니다. 영상을 직접 연결하지 못하면 mew 서버를 경유합니다. | [원격 데스크톱 설정](../guides/remote-desktop.md) |
| 원격 입력 사용 | 마우스, 키보드, 붙여넣기, 원격 Esc, 모바일 조이스틱, 끌기, 휠, 확대, 전체 화면, 회전, 감도, 이동 가능한 단축키, 모니터 선택을 사용할 수 있습니다. | [조작](../guides/remote-desktop.md#%EC%A1%B0%EC%9E%91) · [네트워크와 검증 범위](../development/remote-desktop.md) |

<a id="databases"></a>

### 데이터베이스

Hotview에서 `/db`로 표를 삽입한 뒤, 다른 사용자와 함께 제목, 행, 셀, 열을 편집합니다. 텍스트, 숫자, 체크박스, 날짜 필드를 쓸 수 있습니다. **메뉴 → 데이터베이스**에서 현재 프로젝트의 데이터베이스를 확인합니다.

`/` 메뉴의 **Database reference**로 기존 데이터베이스나 외부 Postgres 표의 읽기 전용 참조를 삽입합니다. Postgres에 연결하려면 `DATABASE_URL`을 설정합니다. `npm run db:up`과 `npm run db:down`은 Docker Compose로 데이터베이스만 선택적으로 관리합니다.

설정과 프로젝트 분리는 [데이터베이스 안내](../guides/database.md)를 참고하세요.

<a id="layout-settings-and-accounts"></a>

### 레이아웃, 설정, 계정

| 작업 | 시작 위치 | 자세한 내용 |
| --- | --- | --- |
| 패널 배치 | 편집기, 에이전트, 터미널, 브라우저 탭이나 핸들을 끌고 Git은 본문 핸들을 사용합니다. 데스크톱 탭을 두 번 클릭하면 패널이 커지고 `Esc`로 원래 크기로 돌아갑니다. 브라우저 패널은 가로로만 배치할 수 있습니다. 문서 탭, 레이아웃, 스크롤 위치는 계정별로 복원됩니다. | [패널](../guides/editor.md#%ED%8E%B8%EC%A7%91-%EC%B9%B8-%EB%AC%B8%EC%84%9C-%ED%83%AD--%ED%99%94%EB%A9%B4-%EB%B6%84%ED%95%A0) · [복원](../guides/projects.md#%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%ED%83%AD) |
| 모바일에서 작업 | 아래 독으로 패널을 전환하고 길게 눌러 순서를 바꿉니다. 입력하는 동안 독은 숨겨집니다. 항목을 길게 눌러 컨텍스트 메뉴를 열고 뒤로 가기나 `Esc`로 가장 앞의 오버레이를 닫습니다. **메뉴 → 전체 화면** 또는 `Alt+Enter`로 전체 화면을 전환합니다. 데스크톱에서는 독이 헤더 메뉴 바로 왼쪽에 있고 아이콘 아래에 도구 설명이 표시됩니다. | [모바일과 전체 화면](../guides/editor.md#%EB%AA%A8%EB%B0%94%EC%9D%BC%EA%B3%BC-%EC%A0%84%EC%B2%B4%ED%99%94%EB%A9%B4) |
| 화면 모양 변경 | **설정 → 화면**에서 밝은/어두운 테마, 강조 색상, UI·문서·코드 글꼴, 한국어·영어·일본어·중국어를 설정합니다. | [화면 설정](../configuration/environment.md#%ED%99%94%EB%A9%B4-%EC%84%A4%EC%A0%95) |
| 단축키 맞춤 설정 | **설정 → 단축키**에서 키 조합을 바꾸거나 개별 단축키 또는 전체 단축키를 초기화합니다. | [단축키 설정](../configuration/environment.md#%EB%8B%A8%EC%B6%95%ED%82%A4-%EC%84%A4%EC%A0%95) |
| Mewcat 확인 | 고양이를 누르면 최근 알림이 열립니다. 말풍선에는 0.5초마다 갱신되는 CPU, RAM, GPU 사용량이 표시되며, 수치를 누르면 시스템 자원을 엽니다. **설정 → Mewcat**에서 스킨, 소리, 알림, 작업/휴식 타이머를 관리합니다. 강제 휴식을 켜면 작업 공간 위에 드래그로 옮길 수 있는 고양이가 표시됩니다. 기본값은 꺼짐입니다. | [Mewcat](../specs/mewcat.md) |
| 내 계정 관리 | **설정 → 계정**에서 표시 이름, 프로필 이미지, 비밀번호를 바꾸거나 로그아웃합니다. | [계정 설정](../configuration/environment.md#%EB%82%B4-%EA%B3%84%EC%A0%95%EA%B3%BC-%EA%B3%84%EC%A0%95-%EA%B4%80%EB%A6%AC) |
| 사용자 관리 | owner는 **메뉴 → 계정 관리**에서 계정을 추가하고 역할을 바꿉니다. 호스트 CLI에서도 사용자 목록 확인, 비밀번호 재설정, 계정 삭제가 가능합니다. | [사용자 관리](../configuration/environment.md#%EB%82%B4-%EA%B3%84%EC%A0%95%EA%B3%BC-%EA%B3%84%EC%A0%95-%EA%B4%80%EB%A6%AC) |
| 서버 상태 확인 | **메뉴 → 시스템 자원**에서 CPU, 메모리, GPU, 온도, 프로세스, 최근 사용량을 봅니다(manager 또는 owner). | [시스템 자원 팝업](../guides/commands.md#%EC%8B%9C%EC%8A%A4%ED%85%9C-%EC%9E%90%EC%9B%90-%ED%8C%9D%EC%97%85) |

이전 작업 공간 홈 화면의 할 일 목록과 캘린더는 더 이상 제공하지 않습니다. 문서 체크박스와 에이전트 예약은 계속 지원합니다. [현재 제공하지 않는 홈 화면](../guides/projects.md#%ED%98%84%EC%9E%AC-%EC%A0%9C%EA%B3%B5%ED%95%98%EC%A7%80-%EC%95%8A%EB%8A%94-%ED%99%88-%ED%99%94%EB%A9%B4)를 참고하세요.

<a id="running-and-updating"></a>

## 실행과 업데이트

mew 저장소에서 다음을 실행합니다. Windows에서는 Ubuntu 터미널을 사용합니다.

```bash
./mew start                    # 서버 시작
./mew stop                     # 서버 중지
./mew restart                  # 서버 재시작
./mew status                   # 상태와 경로 표시
./mew logs                     # 서버 로그 따라가기
./mew update                   # origin/main 가져오기, 설치, 빌드, 재시작
./mew desktop-setup            # mew를 재시작하지 않고 데스크톱 도우미 준비
./mew users add you@example.com owner
```

`./mew update`는 fast-forward pull을 사용합니다. `./mew start`로 실행한 경우 앱 메뉴에서도 업데이트를 확인하고 설치할 수 있습니다. systemd나 다른 supervisor가 관리하는 서버는 별도의 [배포 및 업데이트 절차](../deployment/native.md)를 따릅니다.

기본적으로 설정과 실행 데이터는 복제한 저장소 폴더 밖에 저장됩니다.

| 내용 | 위치 |
| --- | --- |
| 설정 | `~/.config/mew/config.env` |
| 계정, 세션, 완료한 에이전트 턴 | `~/.local/share/mew/` |
| 로그 | `~/.local/state/mew/` |

저장소 폴더를 삭제해도 이 파일들은 남습니다. 이 파일들과 작업 공간, Postgres 데이터를 함께 백업합니다. 경로를 바꾸려면 [서버 설정](../configuration/environment.md#%EC%84%9C%EB%B2%84-%EC%84%A4%EC%A0%95)을 참고하세요.

휴대폰이나 다른 컴퓨터에서 연결하려면 [원격 접속](#remote-access)을 따릅니다. 기본 설정에서는 mew를 실행한 컴퓨터에서만 접속할 수 있습니다. `./mew start`는 부팅 시 자동으로 시작하는 서비스를 등록하지 않습니다.

설치 중 원격 데스크톱 준비에 실패했다면 `./mew desktop-setup`으로 다시 시도합니다. 이 명령은 앱을 빌드하거나 서버를 재시작하지 않고 도우미를 설치하고 Mac 권한 설정을 엽니다. 로그인한 데스크톱과 OS 라이브러리 및 권한이 필요합니다. [OS 요구 사항](../guides/remote-desktop.md#%EC%B2%98%EC%9D%8C-%EC%97%B0%EA%B2%B0)을 참고하세요.

macOS에서 mew는 터미널을 열기 전에 `node-pty` 1.1.0의 `spawn-helper`에 빠진 실행 권한을 복구합니다. 터미널이 빈 화면으로 남으면 서버 로그에서 `[mew:tmux]` 오류를 확인하세요.

<a id="documentation"></a>

## 문서

[문서 지도](../MOC.md)에서 시작합니다. 상세 제품 명세, 사용법, 운영 절차, 작업 기록은 `docs/`에 두고 이 안내에서는 설치와 일상 사용을 다룹니다. 코드를 바꾸면 관련 문서도 함께 갱신합니다.

| 주제 | 시작 위치 |
| --- | --- |
| 프로젝트, 편집, 터미널, 브라우저, 명령, 데이터베이스 | [사용자 안내](../guides/MOC.md) |
| 환경 변수, 계정, 검색, 에이전트 런타임 | [설정](../configuration/MOC.md) |
| HTTPS, systemd, 업데이트, 백업 | [배포](../deployment/native.md) |
| 코드 구조, 패키지, UI, 협업, 에이전트 프로토콜 | [개발 문서](../development/MOC.md) |
| 제품 명세, 운영, 현재 작업, 이력 | [문서 지도](../MOC.md) |
| 계정별 기능과 파일 권한 | [계정 설정](../configuration/environment.md#%EB%82%B4-%EA%B3%84%EC%A0%95%EA%B3%BC-%EA%B3%84%EC%A0%95-%EA%B4%80%EB%A6%AC) · [접근 제어](../development/access-control.md) |
| 역할, 인증, 게스트 접속 | [보안](../../SECURITY.md) |

Linux에서는 `sh native/agent-memory/install.sh`로 에이전트 작업의 메모리 제한을 설치합니다. 활성화, 점검, 저메모리 작업 일시 중지, 큐 보류, 오류 보고는 [에이전트 메모리 보호](../operations/agent-memory.md)를 참고하세요.

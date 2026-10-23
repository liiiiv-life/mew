---
updated: "2026-10-23"
title: "mew 시작하기"
description: "s-saens/mew 소스의 한국어 설치·첫 로그인·목적별 사용법과 Mewlink·대체 외부 접속, 권한·업데이트·데이터 보존 및 미발행 CLI 경로를 안내한다. 햄버거 메뉴의 Mewlink 연결 진입을 포함한다."
---

# mew 시작하기

[한국어](getting-started-ko.md) · [English](getting-started-en.md) · [简体中文](getting-started-zh.md) · [日本語](getting-started-ja.md)

mew는 컴퓨터나 서버의 폴더를 브라우저에서 여는 작업 공간입니다. Markdown과 코드를 편집하고, 터미널과 AI 에이전트를 실행하며, Git 변경을 검토하고, 문서를 함께 작업할 수 있습니다. 휴대폰에서도 사용할 수 있습니다.

[첫 사용](#mew-%EC%82%AC%EC%9A%A9%ED%95%98%EA%B8%B0) · [외부 접속](#%EC%99%B8%EB%B6%80%EC%97%90%EC%84%9C-%EC%A0%91%EC%86%8D%ED%95%98%EA%B8%B0) · [실행·업데이트](#%EC%8B%A4%ED%96%89%EA%B3%BC-%EC%97%85%EB%8D%B0%EC%9D%B4%ED%8A%B8) · [문서](#%EB%AC%B8%EC%84%9C)

## 빠른 시작

[Windows (WSL 2)](#windows-wsl-2) · [macOS](#macos) · [Linux](#linux) · [외부에서 접속하기](#%EC%99%B8%EB%B6%80%EC%97%90%EC%84%9C-%EC%A0%91%EC%86%8D%ED%95%98%EA%B8%B0)

<a id="windows-wsl-2"></a>

### Windows (WSL 2)

Windows 네이티브 실행 계층과 npx 배포 경로를 구현했습니다. [Windows 네이티브 실행 계약](../development/windows-native.md)에서 검증 범위를 확인하세요. 전체 Windows 실기 검증과 첫 공개 발행 전에는 아래 WSL 소스 설치 절차를 사용할 수 있습니다.

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
git clone https://github.com/s-saens/mew.git
cd mew
./mew setup
```

Node를 nvm으로 설치할지 물으면 설치를 선택합니다. Linux 도구를 빠르게 쓰려면 저장소와 프로젝트를 `~/apps`, `~/mew-workspace`처럼 Linux 파일 시스템에 둡니다. `explorer.exe .`를 실행하면 현재 폴더가 Windows 탐색기에서 열립니다. 자세한 내용은 [Microsoft의 WSL 파일 저장소 안내](https://learn.microsoft.com/en-us/windows/wsl/setup/environment#file-storage)를 참고하세요.

**3. 로그인합니다.** 아래 [설치 마무리](#%EC%84%A4%EC%B9%98-%EB%A7%88%EB%AC%B4%EB%A6%AC)의 안내를 따른 후, 출력된 URL을 Edge, Chrome 등 Windows 브라우저에서 엽니다. 보통 주소는 `http://localhost:5000`입니다. [WSL은 Windows에서 localhost 접속을 전달합니다](https://learn.microsoft.com/en-us/windows/wsl/networking#accessing-linux-networking-apps-from-windows-localhost).

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
git clone https://github.com/s-saens/mew.git
cd mew
./mew setup
```

Node를 nvm으로 설치할지 물으면 설치를 선택합니다. 아래 [설치 마무리](#%EC%84%A4%EC%B9%98-%EB%A7%88%EB%AC%B4%EB%A6%AC)를 마친 후 브라우저에서 출력된 URL을 엽니다.

설치 프로그램은 원격 데스크톱 도우미도 준비합니다. mew를 실행하는 Mac에서 시스템 설정이 열리면 Electron에 **손쉬운 사용** 및 **화면 기록** 권한을 허용합니다. 권한을 허용하면 설치가 계속됩니다. 자세한 내용은 [Mac 권한 준비](../guides/remote-desktop.md#mac-%EA%B6%8C%ED%95%9C-%EC%A4%80%EB%B9%84)를 참고하세요.

<a id="linux"></a>

### Linux

Debian 또는 Ubuntu에서는 다음을 실행합니다.

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential python3 tmux
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/s-saens/mew.git
cd mew
./mew setup
```

다른 배포판에서는 먼저 같은 용도의 패키지를 설치합니다. [설치 마무리](#%EC%84%A4%EC%B9%98-%EB%A7%88%EB%AC%B4%EB%A6%AC)를 따릅니다. 부팅할 때 자동으로 시작하거나 원격 접속을 받으려면 [배포 안내](../deployment/native.md)를 사용합니다.

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

### 한 명령으로 실행하기 (릴리스 발행 후)

Node.js 24가 있으면 작업 폴더에서 다음 명령으로 사전 빌드 실행본을 받을 수 있습니다. **현재 구현은 준비됐으며 최초 npm·GitHub 릴리스 발행은 별도입니다.**

```bash
cd /내/워크스페이스
npx @liiiiv/mew-cli@latest
```

Linux glibc 2.35 이상·macOS 15 이상, x64/arm64를 지원합니다. Windows에서는 WSL 2의 Ubuntu 22.04 이상에서 실행합니다. 처음에는 owner 이메일을 입력하고 출력된 임시 비밀번호로 로그인한 뒤 비밀번호를 바꿉니다. 기존 계정·대화·기기 등록은 재사용합니다. Mewlink 등록은 아래 [외부 접속](#%EC%99%B8%EB%B6%80%EC%97%90%EC%84%9C-%EC%A0%91%EC%86%8D%ED%95%98%EA%B8%B0)을 따르며, 등록 링크와 온라인 주소의 QR이 터미널에도 표시됩니다.

Ctrl+C로 종료한 뒤 같은 명령을 다시 실행하면 최신 버전을 사용합니다. 기존 clone이 `.data/`를 사용했다면 `--data-dir /기존/mew/.data`를 지정하고 이전 서버부터 종료하세요. 원격 데스크톱은 선택 설치·OS 권한 준비가 필요합니다. [실행·데이터 계약](../development/cli-distribution.md) · [발행 절차](../deployment/cli-release.md)

<a id="remote-access"></a>

### 외부에서 접속하기

#### 1. Mewlink

[Mewlink](https://mew.saens.kr)를 사용하면 휴대폰이나 다른 컴퓨터의 브라우저에서 내 컴퓨터의 mew를 열 수 있습니다. 별도 도메인이나 공유기 포트 포워딩 설정이 필요하지 않습니다. Mewlink는 기기 등록·관리와 연결을 맡고, mew 화면과 작업 데이터는 내 컴퓨터와 접속 브라우저 사이에서 직접 전송됩니다.

1. 내 컴퓨터에서 mew를 실행하고 로컬 주소(기본값 `http://localhost:5000`)에 **owner**로 로그인합니다. 임시 비밀번호를 사용 중이라면 먼저 바꿉니다.
2. 오른쪽 위 메뉴 → **Mewlink → 원격 접속 → 기기 등록**을 누릅니다.
3. 표시된 **로그인하고 등록 완료** 링크를 열어 Mewlink에 로그인합니다. 처음이면 유저이름을 설정하고, 기기 이름을 정해 등록을 마칩니다. 기기 등록·관리에 쓰는 Mewlink 로그인은 로컬 mew의 이메일·비밀번호와 별개입니다.
4. 로컬 mew에서 **온라인** 상태와 고정 접속 주소를 확인합니다. 주소는 `https://mew.saens.kr/<유저이름>/<기기이름>` 형식입니다.
5. 휴대폰이나 다른 컴퓨터에서 이 주소를 열면 Mewlink 로그인 없이 해당 컴퓨터의 mew 로그인 화면이 뜹니다. **로컬 mew의 이메일·비밀번호**로 로그인합니다. 접속 브라우저는 별도로 등록하지 않으며, 저장된 로컬 로그인 세션이 유효하면 다음 접속에서 이어 사용할 수 있습니다. [내 기기 목록](https://mew.saens.kr/dashboard)의 등록·삭제·목록 관리는 Mewlink 로그인 후 사용합니다.

내 컴퓨터를 켜 두고 mew 실행과 인터넷 연결을 유지해야 합니다. 컴퓨터가 꺼져 있거나 절전 상태라면 접속할 수 없습니다. 직접 연결이 막힌 네트워크에서는 연결 실패를 표시합니다. Android iframe은 이 접속 방식에서 지원하지 않습니다. 제공자별 로그인·외부 모바일망·절전과 망 전환의 검증 범위는 [원격 접속 계약](../development/remote-access.md#%EA%B2%80%EC%A6%9D%EA%B3%BC-%EB%82%A8%EC%9D%80-%EA%B2%8C%EC%9D%B4%ED%8A%B8)을 참고하세요.

다른 사람에게 접근을 허용하려면 로컬 mew의 **계정 관리**에서 이메일 계정과 역할·기능·파일 권한을 설정하고 기기 주소를 알려 줍니다. 상대방은 Mewlink 계정 없이 로컬 계정으로 로그인할 수 있습니다.

비밀번호 없이 Mewlink 계정으로 접속하게 하려면 상대방에게 기기 로그인 화면의 **Mewlink로 로그인 → 접근 요청**을 누르게 합니다. owner는 **계정 관리 → Mewlink 계정 접근**에서 요청을 확인하고 기존 mew 사용자에 연결하거나 새 사용자를 만듭니다. 새 사용자의 기본 역할은 member이며 비밀번호를 만들 필요가 없습니다. 승인 후 상대방은 같은 Mewlink 계정으로 접속하고, 권한은 로컬 mew에서 관리합니다. 접근을 중단하려면 같은 화면에서 연결을 해제합니다. 기기 등록 계정과 이메일 일치는 승인을 대신하지 않습니다. 이 기능 적용에는 로컬 mew 업데이트와 Mewlink 재배포가 필요합니다. [계정 연결 계약](../development/remote-access.md#%EC%8A%B9%EC%9D%B8%EB%90%9C-mewlink-%EA%B3%84%EC%A0%95-%EB%A1%9C%EA%B7%B8%EC%9D%B8).

설치 후 `./mew remote-access account`로 등록 안내를 다시 볼 수 있습니다. Mewlink 중앙 서비스를 직접 운영하려는 경우에는 [중앙 서비스 설치](../deployment/remote-central.md)를 따릅니다.

아래 Tailscale·Cloudflare Tunnel도 사용할 수 있습니다. 두 방법은 HTTPS 트래픽을 로컬 mew 서버로 전달합니다. `MEW_BIND=127.0.0.1`은 그대로 두고, 설치 포트가 다르면 `5000`을 해당 포트로 바꿉니다.

#### 2. Tailscale

본인이 소유한 기기끼리 연결할 때 사용합니다. 도메인을 구매할 필요가 없으며 비공개 Tailscale 네트워크(tailnet)에 연결한 기기만 접속할 수 있습니다.

1. mew 호스트와 접속할 모든 기기에 [Tailscale](https://tailscale.com/download)을 설치합니다. 모든 기기를 같은 tailnet에 연결합니다.

2. mew 호스트에서 다음을 실행합니다.

   ```bash
   tailscale serve --bg http://127.0.0.1:5000
   ```

   요청되면 출력된 링크를 따라 HTTPS를 활성화합니다. Linux에서는 권한 오류가 나면 `sudo`를 사용합니다. WSL 2에서는 **Windows**에 Tailscale을 설치한 뒤, `http://localhost:5000`이 Windows 브라우저에서 열리는 것을 확인하고 PowerShell에서 이 명령을 실행합니다.

3. 휴대폰이나 다른 컴퓨터에서 Tailscale에 연결한 뒤 출력된 `https://<machine>.<tailnet>.ts.net` URL을 열어 mew에 로그인합니다.

공식 [Tailscale Serve 안내](https://tailscale.com/docs/features/tailscale-serve)와 [명령어 참고](https://tailscale.com/docs/reference/tailscale-cli/serve)를 참고하세요.

#### 3. Cloudflare Tunnel

접속하는 기기에 Tailscale을 설치하지 않고도 브라우저에서 접속할 수 있는 고정 HTTPS 주소가 필요할 때 사용합니다. **Cloudflare DNS에서 관리하는 도메인이 필요합니다.**

1. 공식 [Cloudflare 도메인 등록 안내](https://developers.cloudflare.com/registrar/get-started/register-domain/)로 도메인을 구매하거나, [기존 도메인을 Cloudflare에 추가](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/)하고 네임서버 안내를 따릅니다.
2. 공식 [Cloudflare Tunnel 설정 안내](https://developers.cloudflare.com/tunnel/get-started/)에 따라 터널을 만들고 mew 호스트에 `cloudflared`를 설치해 실행합니다. WSL 2에서는 mew와 같은 Ubuntu 환경에서 `cloudflared`를 실행합니다.
3. 호스트 이름을 `mew.example.com`처럼 정하고 서비스 URL을 `http://127.0.0.1:5000`으로 하는 **Published application** 경로를 추가합니다. mew가 `/`에서 제공되도록 경로는 비워 둡니다.
4. `cloudflared`를 실행한 상태로 유지한 뒤 다른 기기에서 `https://mew.example.com`을 열어 mew에 로그인합니다.

이 설정은 공개 HTTPS 진입점을 만듭니다. mew의 계정 권한은 계속 적용됩니다. 프록시 요구 사항과 연결 점검은 [Security](../operations/security.md) 및 [배포 안내](../deployment/native.md#2-https-%ED%94%84%EB%A1%9D%EC%8B%9C-%EB%98%90%EB%8A%94-%ED%84%B0%EB%84%90-%EC%97%B0%EA%B2%B0)를 참고하세요.

## 실행 환경과 권한

서버는 Linux 또는 macOS에서 실행하며, Windows에서는 WSL 2를 사용합니다. Node 22.18+ 또는 24+가 필요하며 Node 24를 권장합니다. 터미널은 tmux와 로컬에서 컴파일한 `node-pty`를 사용하므로 설치에 Python과 C/C++ 도구 모음이 필요합니다. Postgres에는 Docker를 선택적으로 쓸 수 있지만, mew 앱 자체를 컨테이너에서 실행하는 것은 현재 지원하지 않습니다.

신뢰할 수 있는 사람과만 mew를 사용하세요. 기본적으로 `manager`와 `owner` 계정은 서버 사용자 OS 권한으로 터미널과 에이전트를 실행할 수 있습니다. 다른 계정에 이 기능을 부여하면 같은 접근 권한을 주게 됩니다. 다른 사람에게 인스턴스를 제공하기 전에 [security.md](../operations/security.md)를 읽으세요.

<a id="first-steps"></a>

## mew 사용하기

설치 후에는 출력된 주소를 열어 owner로 로그인하고 임시 비밀번호를 바꿉니다.

1. 헤더 **+**로 작업 폴더를 엽니다.
2. 왼쪽 파일 목록에서 Markdown이나 코드 파일을 선택합니다.
3. 독에서 터미널·에이전트·Git을 필요할 때 엽니다.

[화면 둘러보기](overview.md) · [첫 사용 순서](first-steps.md) · [사용법 홈](MOC.md)

<a id="projects-files-and-search"></a>

### 프로젝트, 파일, 검색

헤더 **+**로 폴더를 열고 왼쪽 목록에서 파일을 선택합니다. `Ctrl+P`는 파일명, `Ctrl+Shift+F`는 본문 검색입니다.

[프로젝트·파일·태스크](projects.md) · [검색·치환](../configuration/search.md) · [프로젝트 지침](project-setup.md).

<a id="writing-code-and-media"></a>

### 글, 코드, 미디어

Markdown은 **Hotview**에서 바로 편집하고 **Plain**에서 원문을 봅니다. 본문은 자동저장됩니다. 코드·표·첨부·PDF·미디어도 해당 파일을 열어 사용합니다.

[편집·저장·파일 이력](editor.md).

<a id="git"></a>

### Git

독의 **Git**에서 변경 파일과 커밋 기록을 확인합니다. 파일을 열어 diff를 검토하고 커밋 대상을 선택합니다.

[Git 패널](projects.md#git-%EC%9E%91%EC%97%85-%ED%8C%A8%EB%84%90).

<a id="collaboration-and-sharing"></a>

### 협업과 공유

문서를 함께 편집하고 댓글·멘션·채팅을 사용합니다. 게스트 공유와 다른 계정의 접근은 역할·기능·파일 권한에 따라 달라집니다.

[협업·댓글·채팅·공유](collaboration.md) · [보안](../operations/security.md).

<a id="terminals-agents-and-automation"></a>

### 터미널, 에이전트, 자동화

독에서 터미널이나 에이전트를 엽니다. AI 도구는 먼저 설치·인증을 준비합니다. 대화 기록, 명령 버튼과 예약 작업은 각 안내를 따릅니다.

[터미널·에이전트](terminal-agents.md) · [런타임 설정](../configuration/agent-runtimes.md) · [명령·예약](commands.md).

<a id="browser-android-and-remote-desktop"></a>

### 브라우저, Android, 원격 데스크톱

에이전트 로그인은 호스트의 독립 Chrome 화면에서 진행하고, 개발 앱은 Mew 주소 뒤에 `/포트번호`를 붙여 엽니다. 로그인 화면·Android·원격 데스크톱은 별도 환경 준비·설치·OS 권한이 필요하며 지원 범위를 먼저 확인합니다.

[브라우저·Android](browser.md) · [원격 데스크톱](remote-desktop.md).

<a id="databases"></a>

### 데이터베이스

Postgres 연결을 설정한 뒤 문서에서 `/db`로 표를 삽입합니다. 문서의 일반 Markdown 표와 별도 기능이며 DB 없이도 문서·코드 편집은 가능합니다.

[표 데이터베이스](database.md).

<a id="layout-settings-and-accounts"></a>

### 레이아웃, 설정, 계정

독으로 패널을 열고 탭을 끌어 배치를 바꿉니다. 휴대폰에서는 아래 독으로 전환합니다. **설정**에서 테마·언어·글꼴·단축키·뮤펫·계정을 관리합니다.

[화면 분할·모바일](editor.md) · [환경·계정](../configuration/MOC.md).

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

휴대폰이나 다른 컴퓨터에서 연결하려면 [원격 접속](#%EC%99%B8%EB%B6%80%EC%97%90%EC%84%9C-%EC%A0%91%EC%86%8D%ED%95%98%EA%B8%B0)을 따릅니다. 기본 설정에서는 mew를 실행한 컴퓨터에서만 접속할 수 있습니다. `./mew start`는 부팅 시 자동으로 시작하는 서비스를 등록하지 않습니다.

설치 중 원격 데스크톱 준비에 실패했다면 `./mew desktop-setup`으로 다시 시도합니다. 이 명령은 앱을 빌드하거나 서버를 재시작하지 않고 도우미를 설치하고 Mac 권한 설정을 엽니다. 로그인한 데스크톱과 OS 라이브러리 및 권한이 필요합니다. [OS 요구 사항](../guides/remote-desktop.md#%EC%B2%98%EC%9D%8C-%EC%97%B0%EA%B2%B0)을 참고하세요.

macOS에서 mew는 터미널을 열기 전에 `node-pty` 1.1.0의 `spawn-helper`에 빠진 실행 권한을 복구합니다. 터미널이 빈 화면으로 남으면 서버 로그에서 `[mew:tmux]` 오류를 확인하세요.

## 문제 해결

WSL이 멈추거나 mew 접속이 끊긴다면 [문제 해결](troubleshooting.md)을 확인하세요. WSLg 자체의 반복 충돌과 mew 접속 장애를 구분하고, Linux GUI를 사용하지 않을 때의 우회 설정·재시작·복구 방법을 안내합니다.

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
| 계정별 기능과 파일 권한 | [계정 설정](../configuration/accounts.md#%EB%82%B4-%EA%B3%84%EC%A0%95%EA%B3%BC-%EA%B3%84%EC%A0%95-%EA%B4%80%EB%A6%AC) · [접근 제어](../development/access-control.md) |
| 역할, 인증, 게스트 접속 | [보안](../operations/security.md) |

Linux에서는 `sh native/agent-memory/install.sh`로 에이전트 작업의 메모리 제한을 설치합니다. 활성화, 점검, 저메모리 작업 일시 중지, 큐 보류, 오류 보고는 [에이전트 메모리 보호](../operations/agent-memory.md)를 참고하세요.

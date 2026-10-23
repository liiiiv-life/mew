---
title: "로그인 화면·localhost 앱·Android"
description: "독립 로그인 영상 화면, 도메인·Tailscale·Mewlink의 /포트번호 앱 접속과 기능 패널의 브랜치별 미리보기, Android 환경 점검·gateway 사용법을 안내한다."
created: "2026-09-04"
updated: "2026-10-22"
---

## 로그인 화면

에이전트의 **로그인 페이지 열기**를 누르면 해당 패널에 호스트 Chrome의 로그인 화면이 표시된다. 가상 화면의 마우스·키보드는 호스트의 실제 데스크톱과 분리된다. 로그인 후 화면을 닫으면 브라우저·영상·가상 입력을 정리하고 완료된 CLI 인증은 유지한다. 연결이 끊기면 **다시 연결**로 돌아갈 수 있다. 모바일에서는 키보드 버튼으로 입력한다.

현재 지원 호스트는 Linux/WSL이다. Chrome/Chromium, Xvfb, FFmpeg, Python 3, libX11·libXtst가 필요하다. Debian/Ubuntu 패키지는 `xvfb ffmpeg python3 libx11-6 libxtst6`이며 Chrome은 별도로 설치한다. `MEW_BROWSER_EXECUTABLE`로 실행 파일의 절대 경로를 지정할 수 있다. 일반 Chrome을 우선하며 기존 Playwright Chromium도 대체 실행 파일로 찾는다. 준비되지 않은 환경에서 실제 호스트 데스크톱을 대신 조작하지 않는다.

이 화면은 로그인·계정 관리용이다. 일반 내부 브라우저 패널·주소창·바로가기·독립 `/browser` 화면은 제거했다. 로그인 페이지에 CDP나 DOM 기록기를 연결하지 않는다. 상세 동작과 수명은 [로그인 가상 화면](../development/login-desktop.md)을 따른다. 실제 Google·Antigravity 계정 인증 성공은 사용자 환경에서 확인해야 한다.

## 호스트 localhost 앱 열기

호스트에서 실행 중인 앱이 `localhost:3333`이라면 현재 Mew 주소 뒤에 `/3333`을 붙인다.

| Mew 접속 방법 | 앱 진입 주소 예시 |
| --- | --- |
| 자체 도메인 | `https://mew.example/3333` |
| Tailscale IP | `http://100.x.y.z:5000/3333` |
| Mewlink | `https://mew.run/<user>/<device>/3333` |

Mew가 다른 포트에서 열리면 그 포트도 포함한다. 예를 들어 `http://100.x.y.z:5000`으로 Mew를 사용하면 `/3333`을 붙인다. 앱의 하위 경로와 query도 함께 전달한다.

독의 **기능** 패널에서도 브랜치별로 앱 포트·하위 경로를 저장하고 **미리보기 열기**로 같은 주소를 새 탭에서 열 수 있다. 각 worktree의 앱은 서로 다른 포트에서 먼저 실행해야 한다. 표시되는 실행 상태는 포트 연결 여부이며 검사 성공이나 사용자 확인 완료를 뜻하지 않는다. [작업 브랜치 확인 순서](projects.md#기능-패널에서-작업-브랜치-확인)를 따른다.

Mew 로그인과 **localhost 앱 접속** 권한이 필요하다. 로그인하지 않았으면 로그인 화면을 먼저 표시하고, 완료 후 앱으로 돌아온다. owner·manager는 기본 허용이며 다른 계정은 owner가 기능 권한을 허용한다. 앱은 접속한 기기의 브라우저에서 실행되고 Mew 로그인·관리 화면과 실행 영역이 분리된다. 로그아웃하거나 권한을 회수하면 열린 전달도 중단한다.

도메인·Tailscale 직접 접속은 HTTP·WebSocket 프록시를 사용하므로 HTTP IP 주소도 지원한다. Mewlink에는 중앙의 `PREVIEW_DOMAIN`과 wildcard HTTPS 준비가 필요하다. 앱에 별도 backend의 `localhost` 주소를 하드코딩했다면 접속한 기기로 향할 수 있으므로 동일 포트의 `/api` 프록시 등으로 설정한다. 설정과 호환 한계는 [localhost 앱 프리뷰](../development/port-preview.md)를 따른다.

직접 접속에서 경로를 읽는 라우터는 제공하는 프리뷰 basename에 맞춰야 한다. Next처럼 고정 basePath가 필요한 앱은 Mewlink 주소를 사용한다. 프리뷰는 30분 뒤 만료하므로 계속 사용할 때는 진입 주소를 다시 연다.

## Android 창

헤더 메뉴의 Android 버튼으로 오른쪽 끝에 여는 보조창(`components/AndroidPanel.tsx`). Android Emulator나 system image는 mew 배포물에 넣지 않는다([ADR 0058](../history/decisions/0058-mew-android-panel-optional-gateway.md)). 패널이 하는 일은 두 가지뿐이다.

- Linux·WSL에서는 `/dev/kvm`, macOS에서는 Emulator의 Hypervisor.Framework 가속 상태를 확인하고, Android SDK 도구(`sdkmanager`·`adb`·`emulator`·`avdmanager`), API 36 system image, AVD 존재 여부를 보여준다. Apple Silicon은 `arm64-v8a`, Intel/AMD는 `x86_64` image를 고르고, image가 없으면 설치 명령만 제시한 뒤 새로고침 후에 AVD 생성 명령을 제시한다.
- 안내 명령의 복사 아이콘 옆 \*\*▶\*\*는 서버가 정한 명령 ID를 전용 숨김 tmux 세션(`mewcmd-*`)에서 실행한다. 옆 터미널 아이콘은 `SessionTerminalPopup`으로 진행 화면과 대화형 입력을 열고, 명령이 끝나면 프로젝트 one-shot 명령어 버튼과 같은 경로로 자기 세션을 자동 종료한다. 브라우저가 보낸 임의 명령 문자열은 실행하지 않는다.
- 이미 떠 있는 Android WebRTC/gateway 주소를 입력하면 기존 loopback 호환 프록시로 iframe에 연다.

Android 기능 권한을 가진 로그인 계정이 사용한다. 기본 허용 역할은 **manager·owner**다. 상태 점검 API는 emulator를 실행하지 않고, 프로세스 시작·설치·system image 다운로드도 하지 않는다. 따라서 Android 창을 열지 않으면 mew 기본 실행 경로에 붙는 무게는 패널 코드와 API 라우트뿐이다.

| 라우트 | 역할 | 하는 일 |
| --- | --- | --- |
| `GET /api/android/status` | **manager·owner** | Linux·WSL KVM 또는 macOS 가속, Android SDK, 호스트 아키텍처용 AVD 상태 점검. emulator 실행 없음 |
| `POST /api/android/commands/:id/run` | **manager·owner** | 서버 등록표의 Android 안내 명령을 one-shot tmux 세션에서 실행 |

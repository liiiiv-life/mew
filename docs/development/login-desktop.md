---
title: "로그인 가상 화면"
description: "Linux/WSL 전용 OAuth·계정 관리 화면의 X 서버·일반 Chrome·영상 WebSocket·XTest 입력과 계정 프로필, 권한·프로세스 수명·준비 조건을 정의한다. 일반 DOM 브라우저와 실제 계정 인증 검증의 경계를 구분한다."
created: "2026-10-20"
updated: "2026-10-20"
---

## 실행과 지원 범위

`server/login-desktop.ts`가 로그인 작업별 가상 화면을 소유한다. 패널의 최초 크기를 받은 후 전용 Xvfb·Python X11 창 관리자와 입력 처리·Chrome·FFmpeg를 시작한다. 사이트는 호스트 Chrome에서 실행하고 패널에는 JPEG 영상 프레임과 OS 입력만 연결한다. CDP·Playwright 실행·DOM 기록기·재생기는 사용하지 않는다. Playwright는 브라우저 실행 파일의 대체 위치를 찾는 데만 사용한다.

가상 framebuffer는 최대 3840×2160이며 Chrome 창과 영상 crop은 패널 표시 영역의 크기에 맞춘다. 크기 변경 시 같은 브라우저·페이지·입력값을 유지하면서 창과 캡처를 재구성한다. 페이지 viewport와 영상 크기는 패널에 맞지만 사이트가 읽는 `screen.width/height`는 가상 framebuffer 크기다. 최소 320×240, 최대 3840×2160이며 영상 치수는 짝수로 보정한다.

Linux/WSL에서 Chrome 또는 Chromium, Xvfb, FFmpeg의 X11 캡처·MJPEG 인코더, Python 3, libX11·libXtst가 필요하다. 설치한 일반 Chrome을 우선하고 없으면 Playwright의 설치된 Chromium을 찾는다. `MEW_BROWSER_EXECUTABLE`로 실행 파일의 절대 경로를 지정할 수 있다. 디스플레이 준비 실패를 실제 데스크톱이나 headless로 대체하지 않는다. macOS·네이티브 Windows는 준비 오류를 반환한다.

`server/login-desktop-x11.py`는 별도 X 서버의 포커스·팝업·클립보드·키와 버튼을 처리한다. 실제 호스트 데스크톱의 입력·클립보드·portal과 연결하지 않는다. 브라우저의 CPU/GPU 사용까지 분리하는 것은 아니다. 개인 Chrome 프로필을 연결하지 않으며 계정별 `DATA_DIR/browser/profiles/<account-hash>`를 유지한다. 현재 계정은 한 번에 하나의 로그인 화면을 사용한다.

## API와 권한

| 경로 | 동작 |
| --- | --- |
| `POST /api/login-desktop` | `agent` 권한으로 등록된 공급자의 HTTPS 로그인·계정 관리 URL을 연다. `{id, job, url, streamUrl}` 반환 |
| `DELETE /api/login-desktop/:id` | 본인 로그인 화면을 닫고 자식 프로세스·가상 화면을 정리 |
| `WS /api/login-desktop/ws?session=<id>` | 최초 resize 후 영상 수신과 포인터·버튼·휠·키·붙여넣기 입력 |
| `POST /api/agent-runtimes/:id/auth/:method/browser` | 실행 중인 공식 CLI 출력의 등록된 URL을 검증하고 로그인 화면 생성 |
| `POST /api/git/github-auth/:id/browser` | 현재 GitHub 연결 작업의 고정 device 로그인 화면 생성 |

로그인·계정 소유권·임시 비밀번호·Origin과 목적별 기능 권한을 검사한다. 에이전트는 `agent`, GitHub 연결은 `git` 또는 `filesWrite` 권한을 적용한다. 입력 수신과 연결 유지 중에도 재검사한다. 일반 URL 탐색 API와 브라우저 탭 목록은 제공하지 않는다.

## 수명과 입력

원본 URL·영상·입력·붙여넣기·인증 코드를 로그나 전사로 저장하지 않는다. 프로필의 공급자 쿠키와 공식 CLI 자격증명은 별도 수명이다. 패널을 닫아도 완료된 CLI 로그인은 유지한다. 인증 완료·실패·중단을 확인한 기존 작업 경로도 해당 로그인 화면을 정리한다.

최대 수명은 20분이다. 일시적인 연결 끊김에는 60초 재접속 여유를 주며 명시적인 닫기는 즉시 정리한다. 키·마우스 버튼은 blur·연결 교체·종료 때 해제한다. 영상은 12FPS의 제한된 JPEG 프레임이며 전송 중인 한 장과 최신 한 장만 유지한다. 뷰어의 이미지 decode 완료 ACK 후 다음 프레임을 보내고, 5초 동안 ACK가 없으면 영상 연결을 닫아 재접속 유예를 적용한다. 프레임당 2MiB·입력당 32KiB·초당 입력 500개·붙여넣기 4096자로 제한한다.

마지막 브라우저 창에 정상 종료를 요청한 뒤 프로필 저장을 기다리고, 반응하지 않는 소유 자식에만 종료 신호를 보낸다. 가상 화면·입력·영상 시작 중 취소도 프로필 lease와 임시 Xauthority를 정리한다.

## 검증 경계

`server/login-desktop.test.ts`는 격리된 Xvfb·새 테스트 프로필·실제 Chrome과 FFmpeg로 영상·입력·팝업·한글 붙여넣기·재접속·권한 회수·시작 중 취소를 검사한다. 계정 UI·로그인 뷰어 검사는 DOM 재생 없이 영상 연결과 닫기를 확인한다. 실제 Google·Antigravity 로그인과 패스키·물리 보안키, 게임 동시 사용 성능은 이 검사에 포함하지 않는다.

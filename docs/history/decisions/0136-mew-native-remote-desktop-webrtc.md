---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: 원격 데스크톱은 OS 보조 프로세스와 WebRTC를 사용한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0136 — 원격 데스크톱은 OS 보조 프로세스와 WebRTC를 사용한다"
created: 2026-09-12
updated: 2026-09-16
---

- 날짜: 2026-09-12
- 상태: 채택
- 후속 결정: [0154](0154-mew-desktop-touchpad-motion.md) — 모바일 컨트롤의 속도 입력을 터치패드 이동량 입력으로 변경
- 후속 결정: [0148](0148-mew-macos-local-cursor.md) — macOS ScreenCaptureKit 캡처와 자체 네이티브 모듈 자동 준비
- 후속 결정: [0145](0145-mew-desktop-mouse-controls.md) — 마우스 형태 배치·커서 전용 조이스틱·좌우 즉시 드래그
- 후속 결정: [0144](0144-mew-desktop-local-cursor.md) — Windows DXGI 캡처·커서 분리; 기존 OS 권한·입력·수명 유지
- 후속 결정: [0139](0139-mew-desktop-server-transport.md) — 직접 연결 실패 시 VP8 영상·입력을 인증한 Mew WebSocket으로 전달; OS·권한·입력 수명 유지
- 후속 결정: [0137](0137-mew-windows-desktop-pipe-bridge.md) — Windows Electron의 부모 통신은 Node stdio와 인증한 로컬 named pipe로 연결; 다른 OS와 WebRTC 계약 유지
- 결정자: 사용자 (전체 화면 원격 데스크톱·OS별 화면·초저지연·모바일 조이스틱 요청), Codex (구현 설계)

## 결정

- 원격 데스크톱은 작업 패널에 속하지 않는 전체 화면 오버레이다. 내부 DOM 브라우저와 별개이며, ADR 0127의 내부 브라우저 영상 전송 금지는 그대로 유지한다.
- Mac·Linux는 해당 로그인 데스크톱에서, WSL은 Windows에서 실행되는 별도 Electron 보조 프로세스를 사용한다. WSLg 화면을 Windows 데스크톱으로 취급하지 않는다. 보조 프로세스는 원격 데스크톱 연결 동안만 실행한다.
- Electron/Chromium의 OS 화면 캡처와 WebRTC 인코더를 사용한다. 화면은 프레임 간 압축·혼잡 제어를 적용한 DTLS/SRTP로 전송한다. 기본은 직접 연결이며 네트워크가 요구하면 운영자가 지정한 STUN/TURN을 쓴다. HTTPS 터널만으로 WebRTC 경로가 생긴다고 가정하지 않는다. JPEG 폴링·영상 WebSocket 우회는 만들지 않는다.
- 입력은 별도 DataChannel을 사용한다. 이동은 재전송 없는 채널의 누적 좌표로 유실을 복구하고 버튼·키·해제는 순서가 보장되는 채널로 보낸다. 버튼 전환은 이동 스냅샷과 함께 처리한다. 중단·백그라운드·끊김·입력 유휴 타임아웃에서 누른 상태를 해제한다. 확대·뷰 이동·컨트롤 위치는 기기 안에서 처리한다.
- 입력 어댑터는 macOS CoreGraphics, Windows SendInput, Linux X11 XTest 또는 Wayland RemoteDesktop portal로 분리한다. OS 화면 공유·손쉬운 사용 동의는 우회하지 않는다. 로그인 전 화면·Windows UAC secure desktop·OS 잠금 화면 제어를 지원한다고 주장하지 않는다.
- Mew는 manager·owner 쿠키 인증과 정확한 Origin으로 연결을 허용한다. 실제 OS 데스크톱은 계정별 가상 화면이 아니므로 서버 전체에 제어 연결 하나만 허용한다. 연결 중 권한을 재검사하며 시그널링/부모 프로세스가 끊기면 보조 프로세스와 P2P도 종료한다.
- 보조 프로세스와 Mew는 부모 소유 stdin/stdout으로 통신한다. 별도 공개 제어 포트·실행 명령 API를 만들지 않는다. OS 실행 경로·ICE 설정은 서버 설정만 받는다. 화면·키 입력·시그널링·TURN 비밀번호를 디스크/로그에 남기지 않는다.
- 모바일 컨트롤은 좌클릭·휠·우클릭·뷰 이동·확대의 작은 조이스틱 다섯 개와 마지막 이동 핸들을 한 줄로 제공한다. 짧은 탭은 클릭, 곧바로 이동은 이동/스크롤, 길게 누른 뒤 이동은 버튼 드래그다. 휠의 일반 동작과 확대는 세로 축만 쓴다. 작은 시각적 반경과 높은 속도 이득을 분리한다.

구현·설치·검증 경계는 [원격 데스크톱](../../development/remote-desktop.md)에 둔다.

## 근거

이미 검증된 Chromium 캡처·코덱·혼잡 제어를 공통으로 쓰고, 플랫폼별 차이는 실행·입력·권한에 한정한다. 모달 수명주기와 네이티브 프로세스 수명주기를 연결해 제어권이 남지 않도록 한다. 직접 영상 전송과 로컬 뷰 조작은 앱 서버 부하·불필요한 재인코딩·왕복 지연을 줄인다.

공식 계약: [Electron 화면 캡처](https://www.electronjs.org/docs/latest/api/desktop-capturer), [Windows SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput), [Wayland RemoteDesktop portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html).

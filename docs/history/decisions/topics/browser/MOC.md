---
title: "Mew ADR — 서버 브라우저·Android·원격 데스크톱"
created: 2026-09-11
updated: 2026-09-23
description: "독립 전 Mew ADR의 주제별 분류를 보존한 이력 지도. 현재 계약은 Mew 자체 문서와 후속 결정을 따른다."
---

상위: [Mew ADR 지도](../MOC.md). 상태가 `채택`이어도 상단의 **후속 결정**이 있으면 변경 범위를 함께 확인한다.

## History / raw — 당시 분류

- [0188 — Mac/Linux 상주 네이티브 H.264 호스트](../../0188-mew-posix-native-desktop.md)

- [0187 — 자체 Windows 가상 디스플레이·헤드리스 GPU 캡처](../../0187-mew-independent-virtual-display.md)

- [0185 — 상주 네이티브 원격 호스트·직결](../../0185-mew-desktop-resident-direct-host.md)

- [0169 — 휠·화면 이동·확대 속도 조이스틱](../../0169-mew-desktop-view-velocity-controls.md)

- [0163 — Linux 서버 브라우저 전용 가상 디스플레이](../../0163-mew-browser-virtual-display.md)

- [0154 — 터치패드 이동량 기반 원격 컨트롤](../../0154-mew-desktop-touchpad-motion.md)
- [0148 — macOS ScreenCaptureKit·로컬 커서](../../0148-mew-macos-local-cursor.md)
- [0146 — Windows 커서 분리 캡처 fallback](../../0146-mew-desktop-cursor-capture-fallback.md)
- [0145 — 마우스 형태 조이스틱·즉시 드래그](../../0145-mew-desktop-mouse-controls.md)
- [0144 — 원격 커서·화면 갱신 분리](../../0144-mew-desktop-local-cursor.md)
- [0139 — 외부 서비스 없는 원격 데스크톱 서버 전송](../../0139-mew-desktop-server-transport.md)
- [0138 — 원격 데스크톱 자동 준비·Windows 로그인 세션 실행](../../0138-mew-desktop-automatic-preparation.md)
- [0137 — Windows 원격 데스크톱 named pipe bridge](../../0137-mew-windows-desktop-pipe-bridge.md)
- [0136 — OS별 원격 데스크톱과 WebRTC](../../0136-mew-native-remote-desktop-webrtc.md)
- [0129 — 일반 브라우저 직접 실행·CDP 연결](../../0129-mew-browser-native-launch-cdp.md)
- [0128 — 모든 브라우저형 OAuth의 내부 브라우저 통합](../../0128-mew-browser-oauth-uses-internal-browser.md)
- [0127 — 브라우저 전체의 서버 Chromium·DOM 중계](../../0127-mew-browser-server-dom-runtime.md) — DOM 실행·프로필 경계; OAuth·실행 연결은 0128·0129
- [0126 — Codex 로그인 DOM 중계 검증판](../../0126-mew-codex-auth-dom-remoting-pilot.md) — 제한 검증 helper·실험 한계; 일반 OAuth는 0128
- [0067 — Android 안내 명령은 사용자 조작 one-shot tmux](../../0067-mew-android-guided-tmux-actions.md)
- [0058 — Android 창은 optional gateway](../../0058-mew-android-panel-optional-gateway.md) — 외부 emulator·gateway; 사용자 안내 명령은 0067
- [0057 — manager·owner 전용 loopback 브라우저](../../0057-mew-localhost-browser-panel.md) — /<port>·Android 호환 프록시; 일반 Browser는 0127

- [0189 — 외부 원격 데스크톱 직결 준비·임시 NAT 수명](../../0189-mew-desktop-external-direct-connectivity.md)

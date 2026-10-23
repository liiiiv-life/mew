---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: 원격 데스크톱을 자동 준비하고 Windows 로그인 세션에서 실행한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0138 — 원격 데스크톱을 자동 준비하고 Windows 로그인 세션에서 실행한다"
created: 2026-09-14
updated: 2026-09-14
---

- 날짜: 2026-09-14
- 상태: 채택
- 후속 결정: [0185](0185-mew-desktop-resident-direct-host.md) — Windows/WSL의 상주 네이티브 호스트와 접속별 캡처·입력 수명
- 결정자: 사용자 (별도 설치 관리 없는 원격 데스크톱 진행 요청), Codex (구현 설계)
- 부분 대체: [0137](0137-mew-windows-desktop-pipe-bridge.md) — Windows 부모에서 Electron을 직접 실행하는 구간과 토큰 전달 경로

## 결정

원격 데스크톱을 열면 Mew가 필요한 런타임과 코드 버전을 확인하고 내부 tmux에서 준비한 뒤 연결한다. 사용자가 npm 명령이나 별도 앱을 관리하지 않는다. 최초 다운로드와 실패 출력은 기존 터미널에서 확인할 수 있고 OS 화면 공유·입력 권한 승인은 유지한다. Windows Node가 없으면 공식 배포본을 체크섬 검증하여 Mew 전용 디렉터리에 준비한다.

WSL 부모의 Windows 세션 번호에 의존하지 않는다. Windows Task Scheduler의 InteractiveToken으로 현재 Windows 계정의 로그인 세션에서 연결마다 한 번 실행한다. 비밀번호·관리자 권한·부팅/로그인 자동 시작·상주 서비스는 요구하지 않는다. 연결용 임시 작업은 실행 후 제거하며 실패 시에도 정리한다. 로그인하지 않았거나 작업 등록이 정책으로 차단되면 원인을 안내한다.

작업 정의에는 고정 실행 파일과 임의 bootstrap 파이프 이름만 넣는다. 토큰은 부모 stdio → 현재 Windows 사용자 SID로 접근 제한한 로컬 bootstrap 파이프 → Electron 자식 환경으로만 전달한다. 인증 전 상대 사용자와 로그인 세션을 확인한다. 기존 Node–Electron 인증 파이프와 Mew 연결 lease를 유지하여 부모가 사라지면 캡처와 입력도 종료한다. 인증 토큰·시그널링·영상·입력을 작업 정의나 파일·로그에 남기지 않는다. 공개 TCP 포트도 추가하지 않는다.

Mac/Linux는 기존 OS별 캡처·입력 구현을 사용하고 설치 준비를 자동화한다. Linux의 로그인 세션·DISPLAY/Wayland/D-Bus와 Mac의 권한 요구를 우회하지 않는다. 전체 화면 UI, WebRTC와 단일 제어권은 [0136](0136-mew-native-remote-desktop-webrtc.md)을 유지한다.

## 근거

Windows 서비스 세션은 로그인 데스크톱과 분리돼 있으므로 서버 재시작이나 재설치로 해결하지 않는다. [InteractiveToken 실행](https://learn.microsoft.com/en-us/windows/win32/taskschd/security-contexts-for-running-tasks)과 [접근 제어 가능한 named pipe](https://learn.microsoft.com/en-us/dotnet/api/system.io.pipes.namedpipeserverstream)로 로그인 사용자의 문맥에서 필요한 순간에만 캡처한다. 현재 동작과 검증 범위는 [개발 문서](../../development/remote-desktop.md)에 둔다.

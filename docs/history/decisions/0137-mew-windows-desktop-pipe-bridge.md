---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: Windows 원격 데스크톱의 부모 통신은 Node와 named pipe로 연결한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0137 — Windows 원격 데스크톱의 부모 통신은 Node와 named pipe로 연결한다"
created: 2026-09-14
updated: 2026-09-14
---

- 날짜: 2026-09-14
- 상태: 채택
- 후속 결정: [0138](0138-mew-desktop-automatic-preparation.md) — 자동 준비·Windows InteractiveToken 실행·SID로 제한한 bootstrap 토큰 전달; 기존 인증 파이프와 lease 유지
- 결정자: 사용자 (재시작 후 연결 실패 수정 요청), Codex (호환성 수정)
- 부분 대체: [0136](0136-mew-native-remote-desktop-webrtc.md) — Windows Electron과 부모의 직접 stdin/stdout 구간만 변경

## 결정

Windows Electron에서 익명 stdin 파이프가 곧바로 EOF가 되는 문제를 실제 설치 환경에서 재현했다. Windows Node에서 Electron을 다시 spawn해도 같은 문제가 발생한다. WSL Mew → Windows Node는 부모 소유 stdio를 유지하고, Windows Node → Electron은 실행마다 임의 이름과 인증 토큰을 생성하는 로컬 named pipe로 연결한다. TCP 포트는 열지 않는다.

토큰은 자식 환경으로만 전달하고 첫 메시지에서 확인한다. 인증 전 입력 크기·시간을 제한하고 인증한 자식 하나만 허용한다. 부모 stdio·named pipe·자식 종료는 서로 연결해 캡처/입력 lease가 남지 않게 한다. 기존 heartbeat와 Electron 자체 만료도 유지한다. 시그널링·인증 토큰·화면·키 입력은 디스크나 로그에 기록하지 않는다.

Mac/Linux 직접 stdio, 사용자 인증·Origin·단일 제어권, WebRTC 영상/DataChannel 입력, WSL의 Windows 화면 공유는 0136을 유지한다. [현재 구현·검증](../../development/remote-desktop.md)에 세부 계약을 둔다.

## 근거

[Electron Windows stdio 제한](https://github.com/electron/electron/issues/4552)과 [Node named pipe IPC](https://nodejs.org/api/net.html#ipc-support)를 따른다. GUI 프로세스의 콘솔 동작에 기대지 않고, 외부 네트워크 리스너를 추가하지 않는다.

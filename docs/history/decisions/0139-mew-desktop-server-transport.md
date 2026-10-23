---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: 원격 데스크톱은 외부 서비스 없이 Mew 서버 전송으로 전환한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0139 — 원격 데스크톱은 외부 서비스 없이 Mew 서버 전송으로 전환한다"
created: 2026-09-14
updated: 2026-09-15
---

- 날짜: 2026-09-14
- 상태: 채택
- 후속 결정: [0185](0185-mew-desktop-resident-direct-host.md) — 중계 없는 직접 전송·STUN과 Windows 하드웨어 H.264
- 후속 결정: [0144](0144-mew-desktop-local-cursor.md) — 커서 분리·영상 유휴 생존 확인·ACK 적응; VP8와 배포 경계 유지
- 결정자: 사용자 (외부 서비스 없는 직접 구현·배포 요구), Codex (설계)
- 부분 대체: [0136](0136-mew-native-remote-desktop-webrtc.md) — 영상 WebSocket 금지와 외부 망의 TURN 의존; 화면·권한·입력·수명 경계 유지

## 결정

WebRTC 직접 연결을 먼저 시도하고, 연결 실패나 제한 시간 초과 시 같은 Mew 연결의 인증된 WebSocket으로 VP8 압축 영상과 입력을 전달한다. 별도 서비스·계정·공개 포트·기본 STUN/TURN 공급자를 추가하지 않는다. 기존 HTTPS 프록시를 사용하는 배포에서는 그 경로를 그대로 사용한다. 외부 프록시까지 제거하는 일은 별도 배포 변경이다.

OS 캡처·입력, 전송, 화면 표시를 분리한다. 전환 중 기존 입력을 해제하고 같은 캡처 스트림을 재사용한다. 직접 연결과 서버 전송이 동시에 입력을 소유하지 않는다. 서버는 영상을 디코딩·재인코딩하지 않고 이진 프레임만 전달한다. 화면 표시 완료 ACK, 제한된 전송 중 프레임 수·바이트 수, 인코딩 전 오래된 프레임 생략, 키 프레임 재동기화로 지연과 메모리를 제한한다. 일반 브라우저 기능의 DOM 전송 계약과 JPEG 폴링 금지는 유지한다.

직접 영상과 서버 전송 모두 VP8을 사용한다. 기존 Electron/Chromium 및 브라우저의 코덱을 사용하며 GPL/AGPL 미디어 라이브러리·외부 코덱 서비스·FFmpeg 실행 파일을 추가하지 않는다. 배포물은 기존 의존성의 라이선스·고지·해당 소스 제공 조건을 보존한다. 소프트웨어 라이선스와 특허 보증을 혼동하지 않으며 확인 범위는 프로젝트 문서에 기록한다.

기존 manager/owner·Origin·단일 제어권·권한 재검사·부모 lease를 모든 전송에 적용한다. 입력과 영상은 기록하지 않는다. 서버 전송의 암호화 경계는 HTTPS/WSS 종단이다. 해당 TLS 프록시·Mew 서버는 신뢰 경계에 포함한다. 화면 공유·접근성 권한은 계속 OS가 승인한다.

## 근거

외부에서 Mew 접속이 가능해도 WebRTC의 별도 UDP 경로는 막힐 수 있다. 이미 도달 가능한 Mew 연결을 사용하면 TURN 운영 없이 연결할 수 있다. TCP 손실 시 지연과 서버 대역폭 비용은 수용하되 자동 직접 연결과 명시적 버퍼 상한으로 제어한다.

공식 근거: [WebCodecs](https://www.w3.org/TR/webcodecs/), [VP8 라이선스](https://www.webmproject.org/license/software/), [추가 특허 허여](https://www.webmproject.org/license/additional/).
구현·검증은 [작업 계획](../../work/remote-desktop-server-transport.md)과 [개발 계약](../../development/remote-desktop.md)에 둔다.

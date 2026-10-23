---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: 원격 데스크톱을 상주 네이티브 호스트와 직접 전송으로 전환한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0185 — 원격 데스크톱을 상주 네이티브 호스트와 직접 전송으로 전환한다"
created: 2026-10-01
updated: 2026-10-01
---

- 날짜: 2026-10-01
- 상태: 채택
- 부분 대체: [0138](0138-mew-desktop-automatic-preparation.md) — Windows/WSL 연결마다 Electron을 실행하는 수명
- 부분 대체: [0139](0139-mew-desktop-server-transport.md) — 서버 영상 중계·VP8 고정·빈 기본 ICE 설정
- 결정자: 사용자 (웹·보안을 유지한 아키텍처 변경, 중계 없는 직결과 상주 호스트 구현 요청), Codex (구현 설계)

**후속 결정:** [0187](0187-mew-independent-virtual-display.md)은 자체 Windows 가상 디스플레이와 일회성 관리자 설치 경계를 추가한다. 일반 사용자 호스트·직결·대기 캡처 중지는 유지한다.

**후속 결정:** [0189](0189-mew-desktop-external-direct-connectivity.md)은 OS 승인 아래 Windows UDP 허용과 활성 연결의 임시 NAT 매핑·STUN 재시도를 추가한다. 중계 없는 직결은 유지한다.

## 배경

- 후속 결정: [0188](0188-mew-posix-native-desktop.md) — Mac/Linux도 상주 네이티브 H.264 경로로 전환; 직접 전송·승인·lease 유지.

현재 시작 경로와 제약은 [최초 화면 연구](../../research/remote-desktop-startup.md)에 있다. 사용자는 별도 relay 서버 없이 직결하고, PC 절전과 별개로 대기 CPU·GPU 활동을 최소화하기를 원한다. 화면 표시 속도와 실제 입력 준비를 따로 검증한다.

## 결정

- 영상·입력은 브라우저와 로그인 데스크톱 사이의 암호화된 WebRTC 직접 경로로 보낸다. Mew 서버는 인증·인가·시그널링·단일 제어권과 lease를 소유한다. TURN과 WebSocket 영상·입력 중계를 사용하지 않는다. 공개 STUN은 외부 주소 확인에만 사용하며 명시적 빈 설정으로 끌 수 있다. 일부 NAT·방화벽에서는 도달 가능한 IPv6나 UDP 포트 매핑이 필요하다.
- 첫 구현 대상은 Windows/WSL이다. Node는 제어·수명·기존 입력 프로토콜을 맡고, node-datachannel/libdatachannel의 네이티브 WebRTC 전송과 자체 Windows D3D11·Media Foundation 모듈이 영상 경로를 맡는다. Electron의 raw pixel→IPC→canvas track을 거치지 않는다. libwebrtc 전체를 번들하는 대신 작은 네이티브 전송 모듈과 OS 하드웨어 인코더를 연결한다.
- 호스트는 Mew 서버 수명 안에서 미리 준비하고 재사용한다. Windows 로그인 세션과 SID 검증을 유지한다. 대기에는 GPU 장치 등 재사용 가능한 자원만 남기고 캡처·인코딩·입력·절전 방지는 해제한다. 로그인 자동 실행의 별도 영구 서비스나 관리자 권한을 요구하지 않는다.
- 접속별 새 세션 ID로 늦은 신호·입력을 격리한다. 종료 완료를 확인하기 전 다른 제어권을 부여하지 않는다. 권한 회수·부모 연결 소멸·lease 만료·OS 잠금은 캡처와 입력을 종료한다. 서버 종료는 상주 호스트까지 종료한다.
- Windows 영상은 하드웨어 H.264를 우선한다. 최초 화면과 연결 협상을 중첩하고 미인코딩 화면·압축 출력의 큐를 제한한다. GPU 자원 보유가 zero-copy나 낮은 소비전력을 보장한다고 주장하지 않으며 실기에서 확인한다.
- Mac/Linux의 기존 캡처·입력 어댑터는 첫 단계에서 유지하되 전송은 직결만 사용한다. 이 OS들의 Electron 제거는 별도 구현 단계이며 완료로 기록하지 않는다.
- 설치·업데이트는 사용자의 적용 단계에서 수행한다. 개발 에이전트는 실행 중인 서버나 설치본을 바꾸지 않고 임시 경로의 검증만 수행한다. 라이선스·정확한 의존성·컴파일 조건은 [배포 문서](../../development/remote-desktop-distribution.md)가 소유한다.

## 근거

프로세스·렌더러 시작과 원시 화면 복사를 접속 경로에서 제거하고, OS의 하드웨어 영상 경로를 사용한다. [libdatachannel](https://github.com/paullouisageneau/libdatachannel)은 네이티브 앱과 브라우저 사이의 WebRTC 미디어·DataChannel 전송을 제공한다. [STUN](https://www.rfc-editor.org/rfc/rfc8489.html)은 중계가 아니라 NAT 주소 확인 도구다. 인가된 활성 세션과 대기 자원의 수명을 분리하면 상주 여부와 무관하게 화면·입력 경계를 유지할 수 있다.

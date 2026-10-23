---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: 원격 데스크톱의 외부 직결 준비와 임시 NAT 수명을 자동화한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0189 — 원격 데스크톱의 외부 직결 준비와 임시 NAT 수명을 자동화한다"
created: 2026-10-02
updated: 2026-10-02
---

- 날짜: 2026-10-02
- 상태: 채택
- 부분 대체: [0185](0185-mew-desktop-resident-direct-host.md) — 네트워크 규칙을 자동 변경하지 않는 설치·연결 준비
- 결정자: 사용자 (외부 폰 연결을 별도 relay 없이 제대로 구현), Codex (설계)

## 결정

영상·입력의 WebRTC 직결, OS 승인·Mew 인증·lease는 유지한다. TURN·서버 영상 중계는 추가하지 않는다. 외부 연결은 별도 검증 범위이며 같은 PC 연결 성공을 외부 폰 연결 검증으로 보고하지 않는다.

Windows 설치기는 고정 helper의 Node 실행 파일만 대상으로 UDP 수신 허용을 준비한다. 관리자 권한이 없으면 OS UAC 승인을 요청하며, 거부·명시적 차단·조직 정책은 덮어쓰지 않는다. 승인 실패를 의존성 설치 실패나 성공으로 숨기지 않고 별도로 안내한다. 개발 중 실제 설치본·방화벽은 변경하지 않는다.

활성 연결만 OS가 선택한 IPv4 기본 게이트웨이에 PCP·NAT-PMP·UPnP IGD 임시 UDP 매핑을 요청한다. 현재 ICE 소켓의 포트·같은 인터페이스 주소만 사용한다. 짧은 lease를 요구하고 영구 매핑으로 폴백하지 않는다. 성공한 외부 주소·포트를 같은 인증된 신호 경로에 srflx 후보로 전달한다. 종료·취소 시 매핑을 삭제하며 실패·비정상 종료에서도 lease로 만료한다. 사용자가 이 자동화를 끌 수 있게 한다.

STUN은 영상 중계 없는 공개 주소 발견만 수행한다. 여러 공급자의 기본 STUN을 제공하고 네이티브 라이브러리의 한 서버 선택 한계를 고려해 제한된 협상 재시도를 제공한다. 후보 수·발견 여부 같은 제한된 진단만 표시하며 주소·SDP·ICE 자격증명을 로그에 저장하지 않는다.

모든 통신을 차단하는 망·지원 없는 CGNAT에서 직결을 보장하지 않는다. 자동 준비의 실패와 주소 탐색·경로 연결·영상 디코드 실패를 구분한다. 별도 relay를 임의 추가하거나 사용자에게 수동 포트 매핑을 기본 절차로 요구하지 않는다.

## 근거

[PCP RFC 6887](https://www.rfc-editor.org/rfc/rfc6887.html), [NAT-PMP RFC 6886](https://www.rfc-editor.org/rfc/rfc6886.html), [Microsoft 방화벽 API](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule). 설치·수명·검증 상세는 [외부 직결 계약](../../development/remote-desktop-connectivity.md)이 소유한다.

---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
title: "0203 — mewlink는 Workers에서 인증·연결만 제공하고 mew UI도 P2P로 전송한다"
description: "중앙 mew UI 배포를 연결용 프론트로 축소하고 Workers·Static Assets·D1·기기별 Durable Objects와 분리된 앱 origin을 선택한 이관 결정이다. 로컬 인증과 mew.run 도메인·본인 전용 대시보드의 후속 결정을 연결한다."
created: 2026-10-07
updated: 2026-10-07
---

- 상태: 채택
- 적용 상태: 구현·로컬 자동 검증 완료 · 미배포
- 후속 결정: [0207](0207-mewlink-device-access-local-auth.md) — 중앙 계정은 등록·관리만 담당하고 기기 주소는 비로그인 연결 후 로컬 mew 계정으로 인증한다.
- 주소 후속 결정: [Mew 0005](../../decisions/0005-mewlink-domain-and-private-dashboard.md) — 공개 주소는 `mew.run`, 앱 origin은 `app.mew.run`, 본인 전용 대시보드는 `/{username}`을 사용한다.
- 부분 대체: [0195](0195-mew-account-based-p2p-remote-access.md)의 중앙 웹 클라이언트 배포 범위와 중앙 실행·저장 선택
- 결정자: 사용자 (UI까지 로컬 P2P 제공·Cloudflare 통합 배포), Codex (구현 계약)

## 결정

중앙 서비스 이름은 mewlink다. 공개 mew의 Git에서 제외한 `mew/mewlink/`에 두고 Workers + Static Assets로 로그인·기기 선택·연결용 프론트와 백엔드를 함께 배포한다. Google·GitHub·Apple 인증은 Worker가 처리하고 계정·세션·등록·일회용 요청은 D1, 기기별 상주 WSS·시그널링은 Durable Objects가 소유한다. 별도 Pages 프로젝트는 요구하지 않는다.

실제 mew HTML·JS·CSS·worker·이미지와 작업 API는 등록된 로컬 A에서 인증된 DataChannel로 받는다. 중앙 배포는 부모 mew의 `dist/`를 포함하지 않는다. 로컬에서는 사용자 빌드의 정적 파일만 읽는 경로를 제공하며 임의 파일·포트·개발 서버 프록시를 추가하지 않는다.

로그인 origin과 P2P 앱 실행 origin을 분리한다. 로그인 호스트의 `__Host-` 세션 쿠키는 앱 호스트에 제공하지 않는다. 짧은 일회용 launch 증명으로 특정 기기·계정·세션에 연결하며 앱 호스트에서는 인증·계정 관리 API를 제공하지 않는다. 앱 프레임의 자원은 정확히 대응하는 연결 페이지·탭의 전송만 사용하며 연결 종료나 미식별 요청을 중앙 데이터 경로로 대체하지 않는다. 직접 연결·로컬 최종 인가·멤버 회수·짧은 lease·TURN 미사용 결정은 0195를 유지한다.

## 이유와 한계

A의 실행 버전에 맞는 UI를 A가 제공하여 중앙 UI 버전 동기화 부담을 줄인다. P2P 앱 코드와 로그인 origin을 분리해 로컬 코드가 중앙 로그인 쿠키나 다른 기기의 접속 승인을 인수하지 못하게 한다. 중앙의 인증·서명·연결용 코드와 A의 코드에 대한 신뢰는 남는다. 원격 기기들이 공유하는 앱 origin의 브라우저 저장소를 보안상 서로 불신하는 실행 환경으로 표현하지 않는다.

첫 UI는 P2P 연결 이후 로드되며 A가 오프라인이면 사용할 수 없다. 서비스워커와 연결 페이지가 자원 경로를 연결한다. 실제 외부망·OAuth 제공자·Cloudflare 운영 검증 전에는 출시 완료로 표시하지 않는다.

기능·운영의 기준본은 [원격 접속 계약](../../development/remote-access.md)과 [mewlink 배포](../../deployment/remote-central.md)가 소유한다.

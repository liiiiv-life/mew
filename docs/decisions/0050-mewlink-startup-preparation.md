---
title: "Mewlink 공개 코드 캐시와 브리지 사전 준비·시작 청크"
description: "대기 화면에서 Mew 표시까지의 비용을 줄이기 위해 공개 해시 런처의 제한된 HTTP 캐시·bootstrap과 앱 브리지 준비 중첩·인증 전 정적 청크 묶음을 선택한 결정. 인증·호스트 코드 재검증 유지와 운영 적용 전 검증 경계를 기록한다."
created: 2026-10-23
updated: 2026-10-23
---

## 상태

채택. 로컬 구현과 격리 검증이며 운영 빌드·배포·첫 표시 시간 개선은 별도로 확인한다.

## 배경

시작 병렬화와 요청 한도 batch 이후에도 중앙 공개 런처 코드의 `no-store`, bootstrap 뒤에야 시작하는 앱 브리지 다운로드, 여러 초기 정적 청크의 요청이 남는다. 사용자 제보의 구간은 대기 화면부터 Mew가 나타날 때까지이며 로그인 뒤 데이터 조회와 구분한다.

## 결정

중앙의 해시가 있는 공개 JS/CSS에만 제한된 브라우저 HTTP 캐시를 허용한다. 현재 기기의 HTML·인증·키·작업 응답은 저장하지 않는다. 설치된 호스트 코드의 기기별 SHA-256과 현재 P2P 재검증을 유지한다. 이 예외는 공개 중앙 코드에만 적용하며 [ADR 0018](0018-mewlink-startup-revalidation.md)의 호스트 코드 확인을 대체하지 않는다.

신뢰한 중앙 HTML의 공개 origin으로 숨은 앱 브리지를 bootstrap과 함께 준비한다. bootstrap에서 확정한 origin과 일치해야 인수하며 기기 context와 전송 포트는 기존 단계 뒤에 전달한다. 원래 기기·브라우저 키·ticket·권한 회수·복구 신원 검사를 유지하고 실패와 취소의 준비 자원을 정리한다. [ADR 0029](0029-mewlink-launcher-entries.md)의 역할별 진입과 부모/앱 origin 분리를 유지한다.

설치 Mew의 main 정적 의존성과 인증 진입점 정적 의존성을 각각 묶되 Workspace·도구의 동적 import는 유지한다. top-level await로 인증 진입점 다운로드를 기다리는 main 자체는 공통 의존 청크에서 제외해 순환 대기를 막는다.

## 근거와 영향

공개 파일의 해시 URL과 매번 받는 HTML을 조합하면 다음 방문의 동일 런처 다운로드를 줄이면서 새 배포는 새 URL로 선택할 수 있다. [HTTP 캐시](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching). 브리지 준비 중첩과 초기 요청 수 축소는 인증 검사를 생략하지 않고 대기 순서와 전송 비용을 줄인다. [Rolldown 청크 정책](https://rolldown.rs/reference/OutputOptions.codeSplitting)은 실행 순서에 영향을 줄 수 있으므로 로그인 전 Workspace 다운로드와 초기 실행·저장소 범위를 회귀 검사한다.

중앙 Worker·런처와 로컬 Mew UI의 적용 위치가 다르다. 캐시를 허용하는 정확한 응답 조건·수명, 준비 소유권과 검증 결과는 [원격 접속 계약](../development/remote-access.md), [앱 시작 계약](../development/architecture.md), [중앙 적용 기록](../deployment/remote-central.md#2026-10-23-공개-런처-캐시브리지-사전-준비초기-청크)이 소유한다. 격리 요청 수·전송량 검사는 외부망의 실제 초 단위 개선이나 즉시 연결을 보장하지 않는다.

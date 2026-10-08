---
title: "mew"
created: "2026-09-11"
updated: "2026-10-08"
description: "Documents의 mew 문서 홈이다. 사용법·기능·설정·개발·배포·운영, 태스크·연구·중앙 결정과 이전 기록을 용도별로 연결한다."
---

처음 쓰는 사람은 [소개·언어 선택](../README.md) 또는 [한국어 시작 안내](guides/getting-started-ko.md)에서 시작한다. Documents 화면에서는 이 파일이 `docs`의 대표 문서다.

에이전트는 [탐색 진입점](AGENT.md)과 [문서 규칙](README.md)을 확인하고, `node server/document-descriptions.ts`의 경로·description에서 필요한 현재 문서를 고른다. 코드 작업 전에는 [실행·검증 규칙](development/getting-started.md)을 읽는다.

## 하위파일

### 사용과 구현

- [사용법](guides/MOC.md)
- [기능별 요구사항·상세 동작·확인 기준](features/MOC.md)
- [설정](configuration/MOC.md)
- [개발 계약](development/MOC.md)
- [서버 설치·배포](deployment/MOC.md)
- [운영·복구](operations/MOC.md)
- [권한·인증·게스트 경계의 기준본](../SECURITY.md)

### 작업과 연구

- [태스크](tasks/_tasks.md) — 제목·완료·태그·기간은 각 작업 문서가 소유한다.
- [구현 계획·조사·검증 기록](work/_work.md) — 현재 계약은 해당 기능·개발 문서를 따른다.
- [연구·성능 측정](research/_research.md)
- [description·MOC 문서 탐색 비용 비교](research/desc-moc-benchmark.md) — 2026-10-06 실제 AI 측정.

### 결정과 문서 관리

- [mew 결정 기록](../../.mew/docs/decisions/mew/MOC.md)
- [문서 작성·탐색·소유권 규칙](README.md)
- [워크스페이스 공통 문서 규칙](../../.mew/docs/README.md)

### History / raw

- [이전 구현·제거된 기능·검증 원문](history/MOC.md)
- [이전 Specs 경로 — 이동 안내](specs/MOC.md)
- [RAG·MOC·일반 파일 검색 비교](research/document-discovery-benchmark.md)
- [이전 Electron 원격 데스크톱 지연·대역폭 조사](research/remote-desktop-latency.md)
- [상주 호스트 전환 이전의 첫 화면 지연 조사·일부 후속 구현](research/remote-desktop-startup.md)

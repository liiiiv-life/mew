---
title: "mew 문서"
created: "2026-09-11"
updated: "2026-10-15"
description: "설치·첫 사용·일상 작업·설정의 안내를 연결하고, 기능 명세·개발 계약·운영 절차와 작업·연구·이력의 역할을 구분하는 문서 홈."
상위파일: "../README.md"
---
# mew 문서

mew를 처음 쓴다면 **[화면 둘러보기](guides/overview.md) → [설치](guides/getting-started-ko.md) → [첫 사용](guides/first-steps.md)** 순서로 시작하세요.

## 사용하기

| 하려는 일 | 문서 |
| --- | --- |
| 설치하고 로그인하기 | [한국어](guides/getting-started-ko.md) · [English](guides/getting-started-en.md) · [简体中文](guides/getting-started-zh.md) · [日本語](guides/getting-started-ja.md) |
| 문서·파일·Git·에이전트 사용법 찾기 | [사용법 홈](guides/MOC.md) |
| 계정·화면·검색·런타임 설정하기 | [설정 홈](configuration/MOC.md) |
| 휴대폰이나 다른 컴퓨터에서 내 mew 열기 | [Mewlink 외부 접속](guides/getting-started-ko.md#외부에서-접속하기) |
| Windows에 설치하거나 WSL 접속 문제 해결하기 | [WSL 2 설치](guides/getting-started-ko.md#windows-wsl-2) · [문제 해결](guides/troubleshooting.md) |

## 개발·배포·운영

| 하려는 일 | 문서 |
| --- | --- |
| 코드를 바꾸기 전 실행·검증 규칙 확인 | [개발 시작](development/getting-started.md) |
| 특정 기능의 요구사항과 확인 기준 조회 | [기능 명세](features/MOC.md) |
| 저장·통신·권한·UI 구현 계약 조회 | [개발 계약](development/MOC.md) |
| Windows 네이티브 구현과 릴리스 조건 확인 | [Windows 실행 계약](development/windows-native.md) · [CLI 릴리스](deployment/cli-release.md) |
| 서버 설치·HTTPS·업데이트·릴리스 | [배포](deployment/_deployment.md) |
| 접근 관리·진단·복구·반영 점검 | [운영](operations/MOC.md) |
| 인증·역할·게스트 접근 경계 확인 | [보안](operations/security.md) |

## 작업과 근거

현재 동작은 기능 명세와 개발 계약에서 확인하세요. 태스크는 할 일과 완료 여부를, 작업 기록은 설계·구현·검증 근거를 보관합니다. 작업의 검증 성공이 실제 운영 반영을 의미하지는 않습니다.

- [태스크](tasks/_tasks.md)
- [구현 계획·조사·검증 기록](work/_work.md)
- [연구·성능 측정](research/_research.md)
- [description·MOC 탐색 비용 비교](research/desc-moc-benchmark.md)
- [Mew 결정 기록](decisions/README.md)

## 문서 작성과 에이전트 탐색

[문서 작성·소유권 규칙](README.md) · [에이전트 탐색 순서](AGENT.md) · [기본 문서화 스킬](configuration/agent-harness.md#언어별-문서화-스킬)

에이전트는 `node server/document-descriptions.ts`로 필요한 current 문서를 고릅니다. 이 홈은 사람이 Documents 화면에서 주제를 찾는 안내이며 모든 파일을 망라하는 필수 색인이 아닙니다.

## History / raw

- [이전 구현·제거된 기능·검증 원문](history/MOC.md)
- [이전 Specs 경로 — 이동 안내](specs/MOC.md)
- [RAG·MOC·일반 파일 검색 비교](research/document-discovery-benchmark.md)
- [이전 Electron 원격 데스크톱 조사](research/remote-desktop-latency.md)
- [상주 호스트 전환 이전의 시작 지연 조사](research/remote-desktop-startup.md)

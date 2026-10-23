---
title: "개발 계약"
created: "2026-09-11"
updated: "2026-10-14"
description: "개발 시작·아키텍처·공용 UI, 문서·저장·에이전트·권한·협업과 원격 접속 구현 계약을 분야별로 연결한다."
상위파일: "../MOC.md"
---
# 개발 계약

코드 변경 전 [개발 환경·실행 제한·검증 규칙](getting-started.md)을 읽으세요. 기능 전용 요구사항과 확인 기준은 [기능 명세](../features/MOC.md)가 소유합니다.

## 시작과 공용 계약

- [개발 환경·검증·필수 UI 규칙](getting-started.md)
- [서버 구조와 상태 파일](architecture.md)
- [공용 패키지](packages.md)
- [UI 디자인·패널·입력·단축키](ui-contracts.md)
- [사전 빌드 CLI 실행·데이터·업데이트](cli-distribution.md)
- [Windows 네이티브 실행 계층](windows-native.md)

## 문서와 저장

- [Documents 상위·하위 문서와 대표 파일](document-pages.md)
- [문서 링크 그래프와 백링크](document-graph.md)
- [PDF 렌더링·필기·저장](pdf-viewer.md)
- [브라우저 저장소·캐시·초안](browser-storage.md)
- [태스크 패널과 Markdown 저장](task-list.md)

## 에이전트·계정·협업

- [에이전트 세션과 통신](agent-sessions.md)
- [대화 저장과 구간 동기화](conversation-storage.md)
- [Skills·MCP 관리와 API](../configuration/agent-harness.md)
- [계정별 기능·파일 권한](access-control.md)
- [계정별 Git 연결·OAuth·커밋 작성자](git-connections.md)
- [협업 방과 멤버 채팅](collaboration.md)

## 원격 접속과 데스크톱

- [Mewlink·P2P 원격 접속·인증](remote-access.md)
- [네트워크 사용량 집계](network-usage.md)
- [원격 데스크톱 아키텍처·영상·입력](remote-desktop.md)
- [Mac/Linux 상주 네이티브 GPU 호스트](remote-desktop-posix.md)
- [외부망 직접 연결·NAT·OS 네트워크 승인](remote-desktop-connectivity.md)
- [Windows 가상 디스플레이·서명·헤드리스 캡처](remote-desktop-virtual-display.md)
- [배포·라이선스·재배포 경계](remote-desktop-distribution.md)

현재 계약과 실기 검증 범위를 각 문서에서 확인하세요. 조사·작업 기록은 [work](../work/_work.md), 이전 구현은 [history](../history/MOC.md)에 보존합니다.

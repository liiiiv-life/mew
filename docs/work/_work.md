---
title: "구현 계획과 작업 기록"
created: "2026-09-11"
updated: "2026-10-08"
description: "설계·조사·공개 준비와 구현·검증·적용 조건의 작업 기록을 구분하고 이전 구현·검토로 연결한다. 현재 계약은 기능·개발 문서, 작업 상태는 태스크가 소유한다."
상위파일: "../MOC.md"
---

계획·조사와 구현 당시의 검증 기록을 보관한다. 현재 동작의 기준본은 해당 [기능 문서](../features/MOC.md)와 [개발 계약](../development/MOC.md)이며, 작업 목록·완료·기간은 [태스크](../tasks/_tasks.md)에서 관리한다. 아래 분류만으로 완료나 운영 적용을 판정하지 않는다.

## 하위파일

### 설계·조사·공개 준비

- [mew 중계 기능 만들기 — 계정 기반 P2P 원격 접속 설계 · 미구현](<../tasks/mew 중계 기능 만들기.md>)
- [파일 열기 성능 개선 기준](file-open-performance.md)
- [사이드바 탐색·정확 검색 성능 설계](sidebar-explorer-search-performance.md)
- [사이드바 탐색·검색 구현 계획과 완료 범위](sidebar-explorer-search-implementation-plan.md)
- [오픈소스 공개 준비 실행 계획](open-source-release-hardening-plan.md)
- [오픈소스·클라우드 수익화 라이선스 검토](open-source-cloud-license-review.md)

### 구현·검증·적용 조건

- [상주 GPU 원격 데스크톱 직결 구현·적용 검증](remote-desktop-resident-direct.md)
- [원격 데스크톱 화면·설정·핫키·연결 시작 개선](remote-desktop-controls.md)
- [대화 저장·구간 동기화 구현과 검증](conversation-storage.md)
- [스킬·MCP 관리 구현과 검증](agent-harness-manager.md)
- [프로젝트 컨텍스트 구현과 검증](project-agent-context.md)
- [기능 문서 정리·명세 통합 기록](feature-catalog-organization.md)
- [기능 기반 개발 GUI — 구현 기록과 기획 초안](feature-driven-development.md)
- [대량 문서 변경의 AI 커밋 압축 연구·반영 기록](git-document-commit-compression.md)

### History / raw

- [원격 데스크톱 커서·지연 개선의 이전 구현·측정](../history/remote-desktop-latency.md)
- [원격 데스크톱 Electron·VP8 서버 전송의 이전 구현](../history/remote-desktop-server-transport.md)
- [Zed 에이전트·제거된 RAG 모델 상업 이용 검토 — 당시 기준](agent-model-license-review.md)
- [배포 준비·보안·사용성 검토 — 2026-09-13 기준](deployment-readiness-review.md)
- [AI 커밋 토큰 절감의 초기 검토 — 후속 압축 연구 참고](git-ai-commit-token-efficiency.md)
- [원격 접속 설계의 이전 경로 — 태스크로 이동 안내](remote-access.md)
- [원격 데스크톱 지연 개선의 이전 경로 — 이력으로 이동 안내](remote-desktop-latency.md)
- [원격 데스크톱 서버 전송의 이전 경로 — 이력으로 이동 안내](remote-desktop-server-transport.md)

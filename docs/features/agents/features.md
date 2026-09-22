---
id: "mew-agents-features"
parent: "mew-agents"
title: "기능 기반 개발·Markdown 문서"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-22"
status_hash: "701eba69573a58c7cb0cae079dbdcc13ad3125808a1b999accc26f79d331606c"
files: ["src/components/feature-development.tsx", "server/features.ts", "server/feature-documents.ts", "server/feature-service.ts", "server/feature-agent-instructions.ts"]
commits: []
---

## 요구사항

기능 단위로 요구사항을 관리하고 에이전트 구현과 사용자 검토를 연결한다.

### 범위

- 인라인 내용 입력·상단 에이전트셋 선택, 기능 계층·정렬·다섯 상태·재위임을 제공한다.
- Markdown 프론트매터와 본문을 기준본으로 사용하고 관련 파일·커밋·구현 결과를 연결한다.

### 경계와 제한

실행 큐·대화·요청 이력은 서버 소유다. 외부 문서 편집만으로 작업을 실행하지 않으며 사용자 승인 상태를 에이전트가 임의 설정하지 않는다.

### 상세 계약

[기능 GUI·저장·이전 계약](../../specs/feature-development.md)

상위: [분야 지도](MOC.md) · [상위 기능](../agents.md).

<!-- mew:implementation:start -->
## 구현 내용

메뉴와 모바일 하단 독의 기능 버튼으로 같은 작업 패널을 연다. 독 전환 시 선택 항목과 초안을 유지하며 닫기·Esc·뒤로가기는 미저장 내용을 확인한다. 현재 프로젝트·에이전트 권한을 따르고, 좁은 패널은 목록·상세를 전환한다. 기능 전체 팝업은 사용자 요청으로 제거했으며 요청 전 재도입하지 않는다.

인라인 내용 입력·상단 에이전트셋 선택, 기능 계층·정렬·다섯 상태·재위임을 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 문서 외부 편집·동시 수정·버전 충돌과 파랑/민트/초록/빨강/주황 전환, 실행 결과 연결을 확인한다.

<!-- mew:validation:end -->

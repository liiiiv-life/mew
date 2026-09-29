---
id: "mew-projects-agent-context"
parent: "mew-projects"
title: "프로젝트 문서 안내·초기화"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-29"
status_hash: "492f31ebed338f0e6fed7a6f097c12a72a55ed8cdd0e4c9a40067fe05dbed748"
files: ["src/components/docs-agent-context.tsx", "server/project-setup.ts", "server/agent-context.ts", "server/project-agent-settings.ts", "server/agent-guidance.ts", "server/prompts/agent-guidance.txt", "src/components/agent-guidance-settings.tsx"]
commits: []
---

## 요구사항

- 에이전트가 현재 프로젝트의 문서와 지침부터 찾아 읽도록 안내한다.

### 범위

- 에이전트 패널 Skills·MCP 옆 기본 지침에서 커밋 방식·응답 언어·답변 길이·서브에이전트 위임을 설정하고 파일 보기로 MD를 직접 편집한다.
- 저장은 모든 프로젝트의 다음 ACP 요청에 반영한다.
- Documents 설정에서 자동 안내·진입 문서·추가 지침을 편집하고 미리 본다.
- 없는 문서를 생성하는 프로젝트 초기화 GUI와 CLI를 제공한다.

### 경계와 제한

- 공통 자동 안내는 사용자 요청이나 프로젝트 지침을 대체하지 않는다.
- 서브에이전트 위임 설정은 런타임 기능 활성화나 강제 차단이 아니며 상위 지침·지원 범위 안에서 적용한다.
- 문서 진입점·MOC 안내를 유지하며 제거된 RAG 검색 명령은 전달하지 않는다.
- 초기화는 기존 문서·사용자 설정을 보존하는 계약을 따른다.

### 상세 계약

- [문서 설정·초기화](../../guides/project-setup.md) · [컨텍스트 전달](../../development/agent-sessions.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../projects.md).

<!-- mew:implementation:start -->
## 구현 내용

- 에이전트 패널의 기본 지침 설정은 MD 원문에서 선택값을 읽고 변경한 항목만 저장한다.
- 파일 보기로 기존 에디터에서 직접 수정한다.
- 기존 TXT와 자유 지침을 보존하며 동시 수정 충돌을 알린다.
- 모든 프로젝트의 다음 ACP 요청에서 원문을 다시 읽는다.
- 서브에이전트 위임은 별도 지정 안 함·필요할 때 자동 위임·요청할 때만 위임·사용 안 함을 제공한다. 기존 지침은 선택을 강제하지 않으며 지원 런타임에 전달할 문장만 저장한다.
- 자동 위임은 독립적인 작업에 한정하고 공유 파일 수정 조율·결과 검토 및 통합을 지시한다.

- Documents 설정에서 자동 안내·진입 문서·추가 지침을 편집하고 미리 본다.

- 로컬 RAG CLI·설정 조회와 자동 검색 안내를 제거했다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 현재 프로젝트와 Documents 경로가 안내에 반영되고 기존 문서가 덮어써지지 않는지 확인한다.

- 2026-09-28: ACP 실제 전송 컨텍스트에서 RAG 안내가 빠지고 프로젝트별 안내·큐·재접속이 유지되는지 검사했다.

- 2026-09-29: 서브에이전트 네 가지 선택값의 저장·다른 지침 보존·직접 편집·초기화와 두 프로젝트의 컨텍스트 반영을 검사했다. 격리 ACP 세션에서 재시작 없이 다음 요청으로 위임 지침이 전달되고 화면 전사에서는 숨겨지는 것을 확인했다. 데스크톱·모바일 선택/재열기·양 테마 메뉴 경계, 에디터 동기화·충돌 회귀와 타입·대상 린트·문서 검사를 통과했다.

<!-- mew:validation:end -->

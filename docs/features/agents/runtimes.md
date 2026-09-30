---
id: "mew-agents-runtimes"
parent: "mew-agents"
title: "AI 런타임 설치·인증·실행 설정"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-30"
status_hash: "ce50d3fa70fce93520dfd200e419db9b718cebd2b370a52a9250e624fc80aed1"
files: ["src/components/RuntimeSettingsModal.tsx", "src/components/agentRuntimes.tsx", "server/agentRuntimes.ts", "server/agentRuntimeInstall.ts", "server/agentDefaults.ts"]
commits: []
---

## 요구사항

- 지원하는 에이전트 런타임을 선택하고 실행에 필요한 설정을 관리한다.

### 범위

- 런타임 선택·지원되는 설치/제거·로그인/로그아웃·실행 설정과 모델·추론·권한 기본값을 제공한다.
- Codex 패널은 모델을 한 번씩 표시하고, 해당 모델의 노력도를 옆 사고 드롭다운에서 선택한다.

### 경계와 제한

- ACP 채팅과 공식 CLI 터미널 표면, 설치·인증 지원은 런타임별로 다르다.
- 공급자가 제공하지 않는 설정이나 인증 기능을 추정해 표시하지 않는다.

### 상세 계약

- [런타임 설정](../../configuration/agent-runtimes.md) · [패널·로그인 표시 계약](../../specs/agent-panel.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../agents.md).

<!-- mew:implementation:start -->
## 구현 내용

- 런타임 설정창은 공통 `DialogFrame`의 body portal로 목록 위에 표시하고, 내부 조작으로 뒤쪽 드롭다운이 닫히지 않게 한다.

- 입력칸 기본값 저장 아이콘은 옆 드롭다운과 같은 높이의 투명 컨테이너 중앙에 정렬한다.

- 런타임 선택·지원되는 설치/제거·로그인/로그아웃·실행 설정과 모델·추론·권한 기본값을 제공한다.
- `AgentPanel`은 Codex의 복합 모델 목록을 기본 모델별로 묶는다. `AgentSession`은 모델 변경·사고 변경·ACP 설정 갱신에서 노력도 지원 목록과 실제 모델 ID를 동기화한다([표시 계약](../../specs/agent-panel.md#모델노력도-선택)).

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 런타임 목록의 설정창이 리스트에 가려지지 않고 입력·저장·삭제/로그아웃 확인창을 조작해도 유지되는지 확인한다.

- 기본값 저장 아이콘이 모델·노력·권한 드롭다운과 같은 높이·중심선에 놓이는지 확인한다.

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 지원 런타임 선택·인증 상태·모델 기본값이 실제 선택과 일치하고 실패 원인을 확인할 수 있는지 검토한다.
  - Codex 모델 목록에 노력도별 중복이 없고, 모델 변경 후 사고 목록·선택값이 지원 범위와 일치하는지 확인한다. 노력도를 바꿔도 모델 이름은 유지되어야 한다.

- 2026-09-29: 모의 ACP 연결·모델 그룹화·격리 Chromium UI 테스트 총 32개가 통과했다. 1100px 다크·390px 라이트에서 모델 중복 제거·검색 선택·별도 사고 선택·모델 하나일 때의 비활성화를 확인했다. 모델 변경 시 노력도 유지·지원 범위 변경·오류 시 이전 값 보존·ACP 설정 갱신도 검증했다. 린트는 기존 경고만 있고 문서 검사는 통과했다. 전체 타입 검사는 기존 `server/agent-guidance-ui.test.ts`의 `document` 참조 오류 2개로 실패했다. 실제 공급자 요청·배포 빌드·서버 재시작은 수행하지 않았다.

<!-- mew:validation:end -->

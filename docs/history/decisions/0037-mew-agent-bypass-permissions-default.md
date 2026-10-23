---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: mew 에이전트 창: 권한 모드를 노출하고 bypassPermissions를 기본으로 둔다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0037 — mew 에이전트 창: 권한 모드를 노출하고 bypassPermissions를 기본으로 둔다"
created: 2026-08-05
updated: 2026-09-11
---

- 날짜: 2026-08-05
- 상태: 채택
- 후속 결정: [0063](0063-mew-agent-runtime-saved-defaults.md) — 고정 권한 기본값; 저장값 없는 경우의 폴백은 유지
- 결정자: 송상훈 (지시)
- 관련: [ADR 0034](0034-mew-agent-panel-acp-reintroduction.md)의 불변식 하나를 뒤집는다(나머지는 그대로 유효)

## 배경

[ADR 0034](0034-mew-agent-panel-acp-reintroduction.md)는 "`bypassPermissions`를 워크스페이스 루트에서 쓰지 않는다"를 불변식으로 박았다. 근거는 [0014](0014-mew-agent-panel-removal.md)가 지운 옛 에이전트 창의 실제 보안 구멍이었다.

그런데 그 불변식은 OS 층 격리(컨테이너)를 곧 넣는다는 전제 위에 있었다. 실제로 써 보니 전제가 서지 않는다.

- 격리를 넣어도 이 프로젝트는 못 지킨다. 컨테이너로 막히는 것은 홈 디렉터리·다른 프로젝트·`~/.ssh`이고, 마운트한 프로젝트 폴더 자체는 여전히 rw다. 그 안의 `.dev.vars` 같은 시크릿도 그대로 읽힌다. 네트워크는 `api.anthropic.com`이 열려야 해서 완전 차단도 불가능하다.
- 격리 비용이 크다. 컨테이너 안에 프로젝트별 개발환경(Flutter·Android SDK 등)을 다시 설치해야 하고, 안 하면 에이전트가 자기 변경을 검증하지 못한다. ACP 경로 매핑(`#scoped`·`UsageReader` 슬러그)도 함께 손대야 한다.
- 승인 프롬프트가 실제로 막는 것이 없다. 에이전트 창은 `authorizeTmux`(owner/manager)와 같은 게이트다. 그 사람은 이미 터미널로 같은 셸을 갖는다. 프롬프트는 이미 가진 권한을 다시 묻는 것이고, 실제 사용에서는 전부 승인하게 된다.

## 결정

### 1. 권한 모드를 창에서 고를 수 있게 한다

ACP `session/set_mode`를 그대로 쓴다. 자체 모드 개념을 만들지 않는다 — 모드 목록은 백엔드가 `session/new` 응답으로 광고한 것을 그대로 그린다(`default`·`acceptEdits`·`plan`·`dontAsk`·`bypassPermissions`). 광고에 없으면 항목이 사라질 뿐 창은 그대로 돈다.

에이전트가 스스로 모드를 바꾸면(계획 모드 종료 등) `current_mode_update` 알림이 오고, 서버가 그걸 받아 선택기를 따라가게 한다.

### 2. 기본값은 `bypassPermissions`다

ACP 세션은 제한 모드로 시작하므로, 서버가 `session/new`·`session/load` 뒤마다 기본 모드를 다시 걸어 준다. 되돌리려면 `MEW_AGENT_MODE=default`.

런타임이 늘면서([ADR 0043](0043-mew-agent-workspace-scope-and-runtimes.md)) "다 허용"의 이름이 백엔드마다 다르다는 것이 드러났다 — claude `bypassPermissions` · codex `full-access` · hermes `dont_ask`. 그래서 값 하나를 박지 않고 후보 순서로 고른다: 그 세션이 광고한 모드 중 앞에서부터 처음 맞는 것. 뜻이 반대인 이름이 섞여 있으므로(claude의 `dontAsk`는 "미리 승인 안 된 건 거절"이다) 순서가 곧 규칙이다. 이 결정은 그대로다 — 에이전트 창은 어느 런타임으로 띄우든 승인 없이 돈다. 에이전트셋(ADR 0052)의 무인 세션도 같은 길을 탄다.

즉 에이전트 창을 터미널과 같은 등급의 도구로 둔다. 게이트는 계속 `authorizeTmux`이고, 그 뒤에서는 승인 없이 돈다.

### 3. 게이트는 낮추지 않는다 — 이게 이 결정의 대가다

`bypassPermissions`가 기본이므로 owner/manager 경계가 유일한 통제가 된다. 따라서 0034의 나머지 불변식은 오히려 더 엄격하게 유지한다.

- 에이전트 WS의 `authorize`는 `authorizeTmux`와 같은 집합이어야 한다. 게스트·member에게 열지 않는다.
- 파일 도구의 프로젝트 스코프(`fs` capability + `resolveProjectPath`)는 그대로 둔다. 승인이 없어졌으므로 이게 남은 유일한 경로 방어다.
- `~/.claude/.credentials.json`을 member가 닿는 곳에 두지 않는다. `/var/run/docker.sock`을 붙이지 않는다.

## 결과

- 에이전트 창을 여는 것 = 그 사람에게 무인 셸을 주는 것이 됐다. 승인 프롬프트라는 중간 확인이 없다. 프롬프트 인젝션이 성공하면 mew 서버 사용자 권한으로 즉시 실행된다 — 신뢰하지 않는 문서·웹 내용을 에이전트에게 읽히는 것이 이제 실질적인 위험이다.
- 안전한 쪽으로 돌리는 스위치는 남는다: 창의 모드 선택기(세션 단위)와 `MEW_AGENT_MODE`(서버 기본값).
- 컨테이너 격리는 폐기가 아니라 보류다. 다시 꺼낸다면 목표는 "이 프로젝트를 지키는 것"이 아니라 "홈 디렉터리와 다른 프로젝트를 지키는 것"으로 잡아야 한다. 그때 필요한 일은 프로젝트별 이미지·`/work/<project>` 마운트(슬러그 충돌 회피)·`#scoped` 경로 매핑이다.
- 계약 테스트가 한 줄 늘었다(`server/agentAcp.test.ts`): 가짜 에이전트가 모드를 광고하면 핸드셰이크 직후 `bypassPermissions`가 걸리고, 실제로 그 모드로 턴이 돈다.

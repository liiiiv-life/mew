---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: Prime Agent는 로컬 ACP 호환 포크로 실행한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0076 — Prime Agent는 로컬 ACP 호환 포크로 실행한다"
created: 2026-08-24
updated: 2026-08-24
---

- 날짜: 2026-08-24
- 상태: 대체됨: 0089
- 결정자: 송상훈 (지시)
- 관련: [ADR 0036](0036-mew-agent-session-controls-and-usage.md), [ADR 0060](0060-mew-shared-agent-runtime-registry.md)

## 배경

Prime Agent 0.8.0은 본체 레포 `packages/coding-agent/src/modes/acp/`에 ACP 서버를 포함하고
`prime-agent --mode acp`로 실행된다. 별도 ACP 어댑터 레포는 없다. 하지만 이 버전은
`loadSession: false`를 광고하고 `session/list`·`session/load` 및 모델 상태·변경을 구현하지 않아,
mew 에이전트 창에서 대화 기록과 모델 선택기가 나타나지 않는다. Prime 내부 연결 계층에는 이미
`listSavedSessions`·`switchSession`·`getAvailableModels`·`setModel`이 있어 ACP 노출만 빠진 상태다.

upstream 수용 여부가 불확실한 기능 때문에 mew 안에서 Prime의 JSONL 저장 형식이나 TUI 명령을
직접 해석하면 ACP가 공통 인터페이스라는 기존 결정(0036·0060)을 깨고 두 구현이 함께 낡는다.

## 결정

- 공식 설치본을 덮어쓰지 않고 `/home/saens/dev/prime-agent-acp`에 Prime Agent 본체의 로컬 clone을 둔다.
- 로컬 브랜치 `feat/acp-session-history-models`가 본체 ACP에 다음 호환 기능을 더한다.
  - `session/list`와 `session/load`, 그리고 해당 capability 광고
  - 불러온 transcript를 ACP `session/update`로 재생
  - 모델 목록을 Prime namespace `_meta`의 `modelsJson`으로 전달
  - 기존 mew 클라이언트와 호환되는 `session/set_model`
- mew의 `<DATA_DIR>/agent-settings.json`에서 `prime.cmd`를 로컬 빌드
  `/home/saens/dev/prime-agent-acp/packages/coding-agent/dist/bundle/cli.js`로 지정한다. 시크릿은 이
  설정에도 문서에도 추가하지 않는다.
- mew는 Prime 저장 파일을 직접 읽지 않는다. history와 모델 조작은 계속 ACP wire를 통해서만 한다.
- 공식 `prime-agent` 설치·업데이트는 mew가 쓰는 로컬 빌드를 자동으로 바꾸지 않는다. upstream 갱신은
  당시 운영 절차(`ops/mew/prime-agent-acp-fork.md`, 현재 파일 없음; 후속 결정은 [ADR 0089](0089-mew-prime-agent-official-rpc-adapter.md))에 따라 명시적으로 rebase·검증·재빌드한다.

## 제거 조건

upstream Prime Agent가 동등한 `session/list`·`session/load`와 ACP 모델 설정을 릴리스하면 로컬 패치를
계속 복제하지 않는다. 대응 커밋을 버리고 `prime.cmd` override를 공식 실행 파일로 되돌린 뒤 이 ADR을
대체한다. 일부만 upstream에 들어오면 겹치는 로컬 커밋부터 제거한다.

## 결과

- mew의 Prime 탭에서 history와 모델 선택을 쓸 수 있다.
- upstream 업데이트는 자동 추종하지 않으며, ACP 파일이 바뀌면 rebase 충돌을 사람이 해결해야 한다.
- 로컬 포크는 배포 의존성이므로 지우거나 경로를 바꾸기 전에 mew 런타임 설정을 먼저 바꿔야 한다.
- upstream 기여는 history와 최신 ACP `configOptions` 모델 지원을 분리해 제안한다. mew 구버전 호환용
  `modelsJson`·`session/set_model`을 그대로 upstream 계약으로 요구하지 않는다.

---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: mew 에이전트 창은 CLI와 같은 도구 집합으로 돈다. ACP fs capability를 끈다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0044 — mew 에이전트 창은 CLI와 같은 도구 집합으로 돈다. ACP fs capability를 끈다"
created: 2026-08-10
updated: 2026-09-11
---

- 날짜: 2026-08-10
- 상태: 채택
- 후속 결정: [0072](0072-mew-agent-gui-authentication.md) — 인증 capability 비광고; fs 미광고와 CLI 도구 동등성은 유지
- 결정자: 송상훈 (지시)

## 배경

에이전트 창에서 터미널(Claude Code CLI)로 하던 대화를 불러오면 첫 턴에서 죽었다:

```
Internal error: API Error: 400 Tool reference 'Edit' not found in available tools
```

원인은 도구 이름이 양쪽에서 다르다는 것이다. mew는 ACP 핸드셰이크에서
`fs: { readTextFile: true, writeTextFile: true }`를 광고했고(ADR 0034·0043의 파일 도구 경계),
어댑터는 그 신호를 보고 CLI의 파일 도구를 끈다:

```js
if (clientCapabilities?.fs?.readTextFile) { allowedTools.push(acp.read); disallowedTools.push("Read") }
if (clientCapabilities?.fs?.writeTextFile) { disallowedTools.push("Write", "Edit") }
```

그래서 창의 세션은 `mcp__acp__Read`를 쓰고 CLI 세션은 `Read`·`Edit`를 쓴다. 전사에 남은 도구 이름이
지금 프로세스의 도구 목록에 없으면 API가 400으로 거부한다 — 한쪽에서 만든 대화는 다른 쪽에서
영원히 열리지 않는다. 방향은 대칭이다(창 세션을 CLI `--resume`해도 같은 이유로 깨진다).

## 결정

클라이언트 capability를 하나도 광고하지 않는다. `clientCapabilities: {}`.

- 파일은 CLI가 자기 `Read`·`Write`·`Edit`로 직접 다룬다. `mcp__acp__*`는 쓰지 않는다
- mew 쪽 `readTextFile`·`writeTextFile` 구현과 경로 검사(`#scoped`)는 삭제한다 — 광고하지 않으면
  호출될 수 없는 코드이고, 남겨 두면 없는 경계가 있는 것처럼 읽힌다
- `terminal`은 원래 광고하지 않았다. 그대로다

## 근거

- 경계가 실제로 막고 있던 것이 없다. 창을 여는 사람은 owner/manager, 곧 워크스페이스 전체에 닿는
  셸을 이미 가진 사람이다(ADR 0037). Bash는 경로 스코프가 되지 않으므로 파일 도구만 좁혀 봤자
  같은 사람이 셸로 같은 일을 한다. ADR 0043이 프로젝트 경계를 걷어낸 것과 같은 논리를 한 칸 더 민 것이다
- 대화가 양쪽에서 이어지는 값이 더 크다. 폰에서 창으로 이어 하다가 책상에서 터미널로 잇는 것이
  이 창을 만든 이유다
- 대안(창의 세션 목록에서 CLI산 세션을 걸러내기)은 증상만 가린다. 걸러도 대화는 여전히 갈린다

## 결과

- 워크스페이스 밖 경로 차단이 사라진다. 에이전트의 파일 쓰기는 mew 서버와 같은 유닉스 사용자
  권한으로 어디든 닿는다. 남은 통제는 게이트(`authorizeTmux`) 하나뿐이고, OS 층 격리는 없다.
  사용자가 이 교환을 알고 택했다 — 경계를 되살리려면 CLI 호환을 포기해야 하므로, 같은 이유로
  되돌리지 않는다. 진짜 해법은 OS 층 격리(ADR 0037이 보류한 그것)이지 fs capability가 아니다
- 이 변경 전에 에이전트 창에서 만든 세션은 이제 불러올 수 없다. 그 전사에는 `mcp__acp__Read`가
  박혀 있고 지금 프로세스에는 그 도구가 없다 — 방향만 뒤집힌 같은 400이다. 앞으로 만드는 세션은
  양쪽에서 열린다
- SECURITY.md의 "파일 도구는 mew 프로세스 안에서 실행된다" 항목은 참이 아니게 되어 고쳤다

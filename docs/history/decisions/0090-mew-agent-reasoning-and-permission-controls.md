---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: mew 에이전트의 추론 정도와 권한을 분리한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0090 — mew 에이전트의 추론 정도와 권한을 분리한다"
created: 2026-08-27
updated: 2026-08-27
---

- 날짜: 2026-08-27
- 상태: 채택
- 결정자: 송상훈 (지시)
- 관련: [0037](0037-mew-agent-bypass-permissions-default.md) · [0063](0063-mew-agent-runtime-saved-defaults.md) · [0089](0089-mew-prime-agent-official-rpc-adapter.md)

## 배경

ACP의 `mode`는 기존에 권한 모드로 화면에 노출했다. Prime의 thinking level을 같은 필드에 넣으면
사용자가 권한과 추론량을 혼동하고 권한을 바꿀 수 없게 된다. Codex·Claude 공식 ACP 어댑터는
`thought_level` session config option을 이미 광고한다.

## 결정

- Mew는 ACP의 `thought_level` config option을 별도 **추론 정도** 선택기로 그린다. 지원 런타임만 보인다.
- ACP `mode`는 계속 **권한 모드**이며 헤더의 가장 오른쪽에 둔다.
- 모델·추론 정도·권한 기본값은 런타임별로 함께 저장한다. 기존 저장 파일의 모델/권한 값은 그대로 호환한다.
- Prime은 공식 RPC thinking 제어를 `thought_level`로 변환한다. 권한은 Mew 소유 Prime extension hook이
  도구 실행 직전에 강제한다: 매 도구 승인·전체 허용·도구 사용 안 함.
- 다른 런타임은 자체 ACP가 `thought_level`을 광고할 때만 노출한다. Mew는 추론 제어가 없는 CLI에
  가짜 선택기를 만들지 않는다.

## 결과

- Codex와 Claude는 공식 어댑터만으로 모델별 지원 추론 정도를 고른다.
- Prime은 공식 실행 파일을 유지하면서 추론과 권한을 독립적으로 제어한다.

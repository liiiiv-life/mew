---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: Claude를 ACP 채팅과 공식 CLI 인증으로 연결한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0142 — Claude를 ACP 채팅과 공식 CLI 인증으로 연결한다"
created: 2026-09-14
updated: 2026-09-14
---

- 날짜: 2026-09-14
- 상태: 채택
- 부분 대체: [0117](0117-mew-terminal-agent-tabs-for-claude-and-antigravity.md) — Claude 대화형 terminal 표면·인증 배치; Antigravity·Gemini 결정은 유지
- 결정자: 사용자 (Claude ACP 복원과 Codex 수준 인증 흐름 요청), Codex (구현)

## 배경

사용자는 Mew가 공급자 사용량을 재판매하지 않고 에이전트 UI를 제공하는 구조에서 Claude ACP를 다시 사용하도록 요청했다. ACP 어댑터는 이미 예약 작업에 사용 중이며, 대화형 Claude 탭만 공식 TUI로 분리되어 있었다. 화면만 바꾸면 CLI를 전제한 계정 조회와 인증 환경이 어댑터 실행 환경과 어긋난다.

## 결정

- `claude`의 기본 대화형 표면을 ACP로 복원하고 SDK 브랜드 안내에 맞춰 `Claude Agent`로 표시한다. 고정한 `@agentclientprotocol/claude-agent-acp`와 공통 ACP 채팅·세션 복원·인증 센터를 재사용한다.
- 인증은 공식 Claude Code의 `auth login` 명령이 소유한다. 구독과 Console 선택을 구분하고 공통 내부 브라우저·CLI 종료 상태·실패/중단 재시도 흐름에 연결한다. 수동 승인 코드가 필요한 경우 해당 로그인 CLI에만 일시 전달하며 OAuth 토큰 입력·보관 API를 추가하지 않는다.
- ACP 실행·로그인·로그아웃·계정 조회는 동일한 CLI 엔진과 공급자 환경을 사용한다. CLI 경로를 명시하면 우선 사용하고, 없으면 어댑터의 공식 CLI 위임 경로를 사용한다. 상태 조회에는 대화 프롬프트를 보내지 않는다.
- 예전 terminal 설정의 Claude 실행 파일은 CLI 엔진 경로로 유지한다. ACP 어댑터 경로는 기존 `MEW_AGENT_CMD`/`MEW_AGENT_CLAUDE_CMD`가 담당한다. 공식 CLI의 임의 TUI 인자를 ACP로 잘못 전달하지 않는다.
- 기존 Claude CLI 세션 파일은 지우지 않는다. ACP 히스토리에서 원본 대화를 선택해 이어간다. 실행 중인 예전 tmux 프로세스를 배포 준비 작업에서 강제 종료하지 않는다.
- 모델/프로토콜·인증 회귀는 임시 fake CLI/ACP로 검사하며 실제 계정 로그인·유료 프롬프트를 자동 실행하지 않는다.

## 계약 해석의 범위

ACP/SDK UI 통합 자체와 사용량 재판매는 별개다. [Anthropic SDK 공지](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)는 개인 구독의 SDK 사용 변경이 보류됐다고 설명하고 [Zed](https://zed.dev/docs/ai/external-agents)도 사용자 자신의 인증을 이용한다. 동시에 [SDK 제품 안내](https://code.claude.com/docs/en/agent-sdk/overview)는 승인 없는 자체 제품의 claude.ai 로그인 제공 제한을 명시한다. 따라서 비재판매만으로 모든 상업 클라우드 구독 통합의 권한이 확보됐다고 해석하지 않는다.

이번 결정은 현재 사용자 소유 실행 환경의 ACP 연결 복원이다. 불특정 고객의 유료 클라우드 제공은 사용자별 격리와 실제 인증·청구 계약을 따로 확정한다. 상세 근거는 [라이선스 검토](../../work/agent-model-license-review.md)를 따른다.

---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: Antigravity를 Google 공식 ACP 서버로 연결한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0143 — Antigravity를 Google 공식 ACP 서버로 연결한다"
created: 2026-09-15
updated: 2026-09-15
---

- 날짜: 2026-09-15
- 상태: 채택
- 부분 대체: [0117](0117-mew-terminal-agent-tabs-for-claude-and-antigravity.md) — Antigravity의 terminal 전용 표면과 ACP 금지; Gemini 재추가 금지는 유지
- 결정자: 사용자 (Antigravity ACP 구현 요청), Codex (구현)

## 배경

Google은 ACP Registry에 공식 Antigravity 서버를 배포하고 Zed에서 개인 Google 계정의 Free·Pro·Ultra 인증을 안내한다. 사용자는 이 공식 경로로 Mew의 Antigravity를 ACP 채팅에 통합하도록 요청했다.

## 결정

- `antigravity`를 ACP 표면으로 전환한다. Google의 버전 고정 `agy_acp_server` 배포본을 사용하며 일반 `agy` CLI를 자체 프로토콜로 변환하지 않는다.
- 설치 버튼은 Google 공식 배포처에서 서버 데이터 디렉터리로 다운로드한다. 독점 바이너리를 Mew 소스나 npm 의존성에 포함하지 않는다. 사용자 기존 CLI·자격증명을 삭제하지 않는다.
- 기존 TUI의 명령·인자는 ACP로 전달하지 않는다. ACP 전용 환경변수로 실행 파일·인자를 지정하고 저장된 공급자 환경은 유지한다.
- 인증 방법은 공식 ACP initialize 응답을 따른다. Google OAuth URL이 stderr에 출력되는 경우 인증 중에만 검증된 Google HTTPS URL을 기존 인증 화면으로 전달한다. OAuth URL은 로그·전사에 저장하지 않는다. 성공·실패·취소 시 URL을 정리하고 재시도를 제공한다.
- 계정 이메일·구독·잔여량은 확인 가능한 공식 계약 없이 추정하지 않는다. Google의 인증과 이용 한도를 그대로 사용한다.
- 공통 ACP의 모델·권한·대화·에이전트셋 경로에 참여하며, 세션 복원 등은 서버가 광고하는 capability 범위에 따른다.
- 실행 중인 서버를 빌드·재시작하거나 기존 tmux를 강제 종료하지 않는다. 실제 계정 로그인과 유료 프롬프트는 자동 검증하지 않는다.

## 근거와 범위

- [Google의 Zed 인증 문서](https://antigravity.google/docs/ide/extensions/zed/)
- [공식 ACP 등록 설정](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json)
- [Google 이용약관](https://antigravity.google/terms)

공식 ACP 클라이언트 연결을 채택한다. 비공식 OAuth 추출·내부 API 프록시를 허용하는 결정이 아니며, 불특정 고객 대상 관리형 클라우드의 실행·청구 계약 전체를 확정하지 않는다.

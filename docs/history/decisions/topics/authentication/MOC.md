---
title: "Mew ADR — 인증·계정·구독"
created: 2026-09-11
updated: 2026-10-09
description: "독립 전 Mew ADR의 주제별 분류를 보존한 이력 지도. 현재 계약은 Mew 자체 문서와 후속 결정을 따른다."
---

상위: [Mew ADR 지도](../MOC.md). 상태가 `채택`이어도 상단의 **후속 결정**이 있으면 변경 범위를 함께 확인한다.

## History / raw — 당시 분류

- [0206 — mewlink 직접 이메일 코드 로그인](../../0206-mewlink-email-code-login.md) — 일회용·쿠키 결합·발송·OAuth 계정 자동 병합 없음

- [0195 — 중앙 계정 인증과 P2P 원격 접속](../../0195-mew-account-based-p2p-remote-access.md) — 외부 계정 연계·접속 증명·로컬 최종 인가; 설계 채택·미구현

- [0181 — Mew 기본 GitHub OAuth 앱](../../0181-mew-default-github-oauth-app.md)

- [0179 — Mew 계정별 Git 제공자 연결](../../0179-mew-account-git-connections.md)

- [0172 — Git 패널 GitHub CLI 로그인](../../0172-mew-github-cli-login.md)

- [0150 — 계정별 기능 권한과 파일 접근 표](../../0150-mew-account-feature-and-file-permissions.md)

- [0143 — Antigravity 공식 ACP와 Google 인증](../../0143-mew-antigravity-official-acp.md)
- [0142 — Claude ACP 채팅과 공식 CLI 인증](../../0142-mew-claude-acp-and-cli-authentication.md)
- [0130 — 로그인과 구독·사용량 제한 분리](../../0130-mew-agent-account-entitlement.md)
- [0128 — 모든 브라우저형 OAuth의 내부 브라우저 통합](../../0128-mew-browser-oauth-uses-internal-browser.md)
- [0121 — Codex OAuth는 제한된 서버 브라우저로 loopback callback까지 이어준다](../../0121-mew-codex-oauth-through-scoped-server-browser.md) — 공식 codex login 유지; 전달 문맥은 0126·0128
- [0116 — OAuth 에이전트 로그인은 외부 브라우저를 우선한다](../../0116-mew-oauth-agent-logins-use-external-browser.md) — CLI 자격증명 소유 유지; Claude·Gemini 배치는 0117, browser 표면은 0128
- [0110 — 에이전트 인증을 등록표의 선언적 작업으로 통합한다](../../0110-mew-declarative-agent-authentication-jobs.md) — 선언적 인증 작업; browser 표면은 0128
- [0109 — 에이전트 인증은 기기 코드·서버 토큰으로, 브라우저 창은 loopback으로 제한한다](../../0109-mew-agent-authentication-and-loopback-browser.md) — 범용 HTML 프록시 재시도 금지 유지; OAuth·브라우저 경계는 후속 결정 적용
- [0072 — 에이전트 인증을 GUI에서 이어간다](../../0072-mew-agent-gui-authentication.md) — ACP 인증 기본 경계; 런타임별 배치는 후속 결정 적용

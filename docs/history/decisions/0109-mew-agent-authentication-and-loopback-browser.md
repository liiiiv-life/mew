---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: 에이전트 인증은 기기 코드·서버 토큰으로, 브라우저 창은 loopback으로 제한한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0109 — 에이전트 인증은 기기 코드·서버 토큰으로, 브라우저 창은 loopback으로 제한한다"
created: 2026-09-03
updated: 2026-09-11
---

- 날짜: 2026-09-03
- 상태: 채택
- 후속 결정: [0110](0110-mew-declarative-agent-authentication-jobs.md) — Gemini 기기 코드 일반화·인증 작업
- 후속 결정: [0112](0112-mew-public-release-security-and-credential-boundaries.md) — Claude 구독 토큰 수집·저장
- 후속 결정: [0121](0121-mew-codex-oauth-through-scoped-server-browser.md) — Codex device-code
- 후속 결정: [0127](0127-mew-browser-server-dom-runtime.md) — 일반 브라우저 loopback 제한·DOM 중계 금지
- 후속 결정: [0128](0128-mew-browser-oauth-uses-internal-browser.md) — browser OAuth 외부 탭; 범용 HTML 재작성 프록시 금지는 유지
- 대체: [0108](0108-mew-server-fetch-device-render-browser-proxy.md) — 브라우저 창의 임의 HTTP(S) 프록시 범위를 폐기
- 부분 대체: [0072](0072-mew-agent-gui-authentication.md) — 에이전트 로그인 UI에 서버 실행 주체·기기 코드·Claude 서버 토큰 흐름을 명시
- 결정자: 송상훈 (요청), Codex (설계·구현)

## 배경

Mew 에이전트 CLI는 서버에서 실행되지만, 사용자는 다른 네트워크의 휴대폰에서 Mew를 연다. 서버 fetch·기기 렌더
브라우저 프록시로 Google·Claude·Gemini 로그인을 일반 웹 탐색처럼 처리하면 대상은 서버 IP를 보되, TLS·브라우저
지문·iframe 문맥은 휴대폰과 섞인다. Google의 anti-bot 검사와 OAuth 제공자의 embedded-browser 정책을 통과시키는
일반 해법이 아니며, 임의 URL을 서버에서 요청하는 SSRF 표면도 불필요하게 넓힌다.

## 선택지

1. 범용 프록시를 계속 확장한다 — 서버 IP는 보이지만 제공자별 브라우저 정책을 재구현해야 하고 호환성을 보장할 수 없다.
2. 서버 Chromium 화면을 다시 중계한다 — 지문은 일관되지만 모바일 조작이 원격 화면이 되고 브라우저 운영 비용이 생긴다.
3. 공급자 CLI의 device-code·외부 URL·서버 토큰 계약을 에이전트 로그인 화면에서 중계하고, 브라우저 창은 로컬 개발 서버에만 둔다.

## 결정

3번을 채택한다.

- 에이전트 인증 센터는 공급자가 요청한 URL을 **휴대폰의 일반 새 탭**으로만 연다. Mew 내부 브라우저/iframe은 OAuth에 쓰지
  않고, URL 승인과 기기 코드 입력은 공급자 페이지가 소유한다.
- Codex·Gemini CLI의 고정 terminal auth는 Mew 서버에서 실행해 기기 코드와 URL을 표시한다. 사용자가 휴대폰 브라우저에서
  승인하면 CLI가 서버의 기존 자격증명 저장소에 인증 결과를 기록하고 Mew는 새 ACP 세션을 연다.
- Claude Code 구독 토큰을 인증 센터에서 받아 서버 런타임 설정에 저장하던 범위는 [ADR 0112](0112-mew-public-release-security-and-credential-boundaries.md)가 대체한다.
- Mew 브라우저 창과 `/browser` 팝업은 `localhost`, `127.0.0.0/8`, `::1`의 HTTP(S)·WebSocket만 서버에서 중계한다.
  이는 WSL/호스트의 개발 서버와 Android gateway 미리보기 용도다. 공개 인터넷·사설망·OAuth callback을 범용 프록시로 여는
  기능은 제공하지 않는다.

## 근거

공급자 CLI가 이미 토큰 발급·갱신·저장 계약을 소유한다. Mew가 이를 중계하면 공급자별 OAuth callback·fingerprint를
복제하지 않고도 서버에서 실행되는 에이전트에 자격증명을 연결할 수 있다. loopback 도구를 남기면 휴대폰에서 WSL의
개발 서버를 확인하는 기존 용도는 유지한다.

## 결과

- Google 같은 사이트가 서버 IP와 모바일 브라우저 지문 불일치를 이유로 차단하는 문제를 Mew 프록시에서 해결하려 하지 않는다.
  **범용 웹 프록시 확대나 원격 화면 방식은 이 인증 문제의 재시도 경로가 아니다.** 공급자가 공식 device-code·manual
  code·server token을 제공하지 않는 경우에는 그 공급자의 지원되는 서버 인증 방식을 별도로 추가한다.
- loopback 이외의 주소를 브라우저 창에 넣으면 명시적으로 거부된다. 에이전트 인증 URL은 내부 브라우저 대신 정상 top-level
  브라우저 창에서 열린다.

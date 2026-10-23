---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: Codex 로그인은 서버 Chromium의 DOM 중계로 검증한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0126 — Codex 로그인은 서버 Chromium의 DOM 중계로 검증한다"
created: 2026-09-09
updated: 2026-09-11
---

- 날짜: 2026-09-09
- 상태: 채택
- 후속 결정: [0127](0127-mew-browser-server-dom-runtime.md) — Codex에만 한정한 적용 범위
- 후속 결정: [0128](0128-mew-browser-oauth-uses-internal-browser.md) — 일반 OAuth의 작업별 임시 문맥; 제한 검증 helper·검증 한계는 보존
- 부분 대체: [0121](0121-mew-codex-oauth-through-scoped-server-browser.md) — Codex 인증 페이지의 fetch·재작성·iframe 실행을 서버 Chromium 실행과 DOM 재생으로 교체
- 부분 대체: [0109](0109-mew-agent-authentication-and-loopback-browser.md) — 원격 브라우저 재시도 금지 중 사용자가 새로 요청한 DOM 중계 검증만 허용
- 결정자: 송상훈 (DOM 중계 검증판 구현 요청), Codex (설계·구현)

## 배경

기존 인증 프록시에서 OpenAI 로그인 페이지는 보이지만 제출이 진행되지 않는 사례가 보고됐다.
사용자는 사이트 실행·네트워크·로그인 상태가 서버 컴퓨터의 브라우저에 있어야 하며,
Mew 내부에서는 웹 요소를 직접 조작하길 원한다. 픽셀·화면 영상 중계는 명시적으로 금지한다.

## 선택지

1. HTML 재작성 확대 — 브라우저 origin·storage·페이지 코드의 모사가 계속 필요하다.
2. 서버 Chromium + DOM 변경·입력 중계 — 실제 브라우저가 사이트를 실행하고 기기는 표시만 재생한다.
3. Skia 명령 중계 — 시각적 재현에 유리하지만 엔진 수정·별도 렌더러가 필요하고 기기의 HTML 요소가 유지되지 않는다.

## 결정

2번을 Codex 인증에 한정한 검증판으로 채택한다. 일반 loopback Browser 패널은 이번 범위 밖이다.

- Chromium은 서버에서 실제 원래 URL을 실행한다. OAuth·PKCE·토큰 교환과 저장은 기존 Codex CLI가 소유한다.
- DOM 수집·증분 재생에는 rrweb의 record/replay 패키지를 활용한다. 사이트 스크립트는 재생 문서에서 실행하지 않는다.
- Mew의 세션 인증과 manager·owner 역할, 로그인 작업별 소유권을 검사한다. 연결은 원래 Mew origin만 받는다.
- 브라우저 문맥은 로그인 작업별 일회성으로 만든다. 기기에는 사이트 쿠키를 전달하지 않으며 입력·DOM 전사를 디스크나 로그에 저장하지 않는다.
- 사이트 요청은 등록된 HTTPS 호스트와 CLI가 지정한 loopback callback origin에 한정한다. 범용 fetch·임의 CDP 명령 API를 제공하지 않는다.
- 페이지 라우팅만으로는 redirect 뒤의 요청을 모두 차단하지 못하므로 Chromium 전용 연결 중계를 함께 둔다. HTTPS는 CONNECT 터널로 원래 TLS를 유지한다. QUIC·프록시 밖 WebRTC UDP는 차단한다.
- OpenAI 공개 로그인 진입에서 관찰된 `challenges.cloudflare.com`을 인증 자원 호스트로 등록한다. CAPTCHA를 우회하거나 자동 해결하는 기능은 포함하지 않는다.
- 클라이언트의 사이트 자원 요청은 서버 문맥을 통해 전달한다. Mew 세션 쿠키는 사이트로 보내지 않는다.
- 닫힘·만료·끊긴 연결의 유예 종료에서 브라우저 문맥과 메모리 상태를 정리한다. 런타임이 없으면 설치 안내를 표시한다.
- 픽셀·영상·캔버스 캡처로 자동 대체하지 않는다. 지원하지 못한 표면은 지원 한계로 표시한다.

## 근거

원래 페이지의 클릭과 인증 요청을 서버 브라우저가 처리하므로 기존 프록시가 웹 실행 환경을 재구현할 필요가 줄어든다.
다만 DOM 재생은 완전한 원격 브라우저가 아니다. 교차 출처 프레임·캔버스·OS 인증창·미디어의 완전한 호환성을 약속하지 않는다.
로컬 테스트는 원래 DOM 입력·서버 cookie·폼 제출·callback·권한·정리 경계를 확인한다. 실제 OpenAI 계정 인증 성공은 별도 실사용 검증이 필요하다.

참고: [rrweb 가이드](https://github.com/rrweb-io/rrweb/blob/main/guide.md), [Playwright BrowserContext](https://playwright.dev/docs/api/class-browsercontext).

## 결과와 검증 범위

로컬 실제 Chromium 테스트에서 DOM 입력·체크박스·서버 쿠키를 사용하는 제출·callback 이동·재접속 화면 복원을 확인했다.
공개 OpenAI 로그인 진입은 Cloudflare 확인 단계에 도달했다. 교차 출처 보안 확인 프레임의 조작은 검증판에서
지원하지 않으므로 실제 OpenAI 계정 로그인 성공으로 보고하지 않는다. 이 한계를 숨기거나 픽셀 중계로 자동 대체하지 않는다.

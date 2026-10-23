---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: mew 브라우저는 서버 fetch·기기 렌더 프록시로 연다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0108 — mew 브라우저는 서버 fetch·기기 렌더 프록시로 연다"
created: 2026-09-03
updated: 2026-09-03
---

- 날짜: 2026-09-03
- 상태: 대체됨: 0109
- 대체: [0107](0107-mew-server-chromium-browser-streaming.md) — 서버 Chromium·CDP 화면 중계·브라우저 설치를 제거
- 부분 대체: [0057](0057-mew-localhost-browser-panel.md) — 브라우저 창의 대상은 loopback에서 임의 HTTP(S)로 확대. `/<port>` 호환 경로는 loopback 전용 유지
- 결정자: 송상훈 (요청), Codex (설계·구현)

## 배경

> **2026-09-03 대체 기록:** 범용 HTTP(S) 프록시는 Google 등 제공자의 anti-bot·OAuth 경계를 우회하지 못했고,
> 에이전트 인증의 올바른 경로도 아니었다. 브라우저 창은 [0109](0109-mew-agent-authentication-and-loopback-browser.md)에 따라
> 서버 loopback 개발 주소만 연다. 이 범용 프록시 확대는 재시도하지 않는다.

서버 Chromium 화면을 JPEG로 중계하면 대상이 보는 IP와 브라우저 실행 주체는 서버가 되지만, 폰은 픽셀과 입력만
주고받아 스크롤·키보드·선택이 원격 데스크톱처럼 느려진다. 사용자가 원하는 우선순위는 **대상 서버가 보는
네트워크 출발지는 Mew 서버**이되, 화면 배치와 입력은 폰 브라우저가 직접 맡는 것이다. Tailscale exit node처럼
기기 전체 트래픽을 바꾸는 VPN은 설치·라우팅 범위가 요구보다 넓다.

OAuth에서는 제공자에서 `localhost:<port>/callback`으로 돌아오는 리다이렉트와 state cookie도 같은 서버 측
브라우징 문맥을 따라야 한다. 단순 HTML 한 장 프록시는 교차 origin 이동에서 이 문맥을 잃는다.

## 선택지

1. 서버 Chromium 화면 중계 유지 — 웹 호환성과 서버 지문은 가장 정확하지만 모바일 조작 지연과 화면 대역폭이 크다.
2. VPN/exit node — 폰 브라우저를 그대로 쓰면서 서버 IP를 얻지만 Mew 밖의 기기 트래픽과 별도 네트워크 제품까지 관리한다.
3. Mew가 HTTP(S)·WebSocket을 연결하고 폰 브라우저가 재작성된 문서를 렌더링 — 화면은 네이티브지만 웹 플랫폼을
   완전히 재현할 수 없고 페이지 URL·쿠키·저장소·동적 요청을 프록시 문맥으로 번역해야 한다.

## 결정

3번을 채택한다.

- `GET /api/browser-url`이 계정에 묶인 2시간짜리 메모리 세션과 서명 URL을 만든다. 세션마다 서버 `CookieJar`,
  origin별 local/session storage 모사 공간을 분리하며 서버 재시작과 만료 때 없어진다. sandbox와 브라우저의
  third-party-cookie 정책으로 후속 요청에 Mew login cookie가 없을 수 있으므로, 서명 URL은 그 수명 동안의
  request capability로도 동작한다. 단, 다른 Mew 계정 cookie가 제시되면 거부한다.
- 모든 대상 HTTP(S) 요청과 redirect는 `server/browserProxy.ts`가 서버에서 수행한다. 목적지로 Mew session cookie,
  방문자 IP 전달 헤더를 보내지 않는다. 대상이 보는 TCP 출발 IP는 Mew 서버이고 User-Agent·Client Hint는 접속 기기
  값을 유지한다.
- HTML은 parse5 AST로 URL attribute·inline style·CSP/SRI를 다루고, CSS와 module import URL도 프록시 안으로
  재작성한다. 문서 맨 앞의 작은 runtime이 `fetch`, XHR, EventSource, WebSocket, 동적 DOM URL, history,
  `window.open`, cookie와 Web Storage를 같은 세션에 연결한다. WebSocket frame은 서버가 양방향 중계한다.
- 교차 origin 문서 이동과 `Location`은 새 page-origin 서명 URL로 다시 감싸되 CookieJar는 유지한다. 따라서
  `로컬 앱 → OAuth 제공자 → localhost callback`도 마지막 callback을 WSL의 localhost로 요청한다.
- 대상 문서는 `allow-same-origin` 없는 iframe과 응답 CSP sandbox에서 실행한다. Mew UI DOM·localStorage와 대상
  페이지를 같은 JS origin으로 만들지 않는다. 동적 요청에는 가상 페이지 `Origin`을 보내고 대상의 CORS 허용을
  다시 적용한다. 접근 역할은 셸과 같은 manager·owner다.
- 보조창과 `/browser` 독립 팝업은 같은 네이티브 iframe UI를 쓴다. 탭을 전환해도 열린 iframe을 DOM에 보존해
  그 창이 살아 있는 동안 페이지 history와 입력 상태를 유지한다.
- 서버 Chromium, CDP WebSocket, 프로필, Chrome for Testing 설치 CLI와 `MEW_BROWSER_EXECUTABLE` 설정은 제거한다.
  `/<port>`는 기존 전체 페이지 호환을 위해 loopback 전용 진입 형태를 유지한다.

## 결과와 한계

- IP가 기준인 사이트 요청과 localhost callback은 서버에서 나가고 들어온다. 반면 JavaScript가 읽는 화면 크기,
  터치, WebGL, 폰 User-Agent 같은 **브라우저 지문은 폰**이다. 서버 Chromium처럼 보이게 하는 기능이 아니다.
- 일반 문서·SPA·form·cookie·WebSocket과 HTTP redirect를 넓게 지원하지만 완전한 범용 브라우저 가상화는 아니다.
  Service Worker, IndexedDB, 브라우저 확장 API, 난독화된 직접 `location` 대입, 강한 anti-proxy 검사는 깨질 수 있다.
- OAuth 제공자가 iframe/embedded user agent 자체를 금지하거나 redirect URI와 표시 URL의 완전한 일치를 검사하면
  로그인은 거부될 수 있다. 프록시는 등록된 `localhost` callback 값을 바꾸지 않고 서버로 되돌리는 역할까지만 보장한다.
- 대상 코드가 서버 네트워크의 공개·사설·loopback 주소에 요청하게 할 수 있으므로 이 기능은 SSRF 표면이다.
  manager·owner가 이미 같은 범위의 셸을 가진다는 경계 안에서만 허용하며 member·guest로 낮추지 않는다.
- 픽셀 스트리밍과 서버 브라우저 프로세스가 없어 화면 대역폭·메모리·입력 지연은 줄지만, 텍스트 응답 재작성 비용과
  사이트별 호환성 유지 비용이 생긴다.

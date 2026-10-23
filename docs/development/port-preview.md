---
title: "인증된 localhost 앱 프리뷰"
description: "도메인·Tailscale·Mewlink의 /포트번호 진입과 브랜치 미리보기용 공개 기기 주소 조회, 호스트 loopback HTTP·WebSocket 전달과 로그인·포트 capability, 직접 opaque sandbox·원격 raw 전송의 capability 검사 및 preview origin 격리·호환 한계를 정의한다."
created: "2026-10-20"
updated: "2026-10-22"
---

## 진입과 실행

`https://mew.example/3333`, `http://<tailscale-IP>:5000/3333`, `https://mew.run/<user>/<device>/3333`는 호스트의 `localhost:3333` 앱을 여는 진입점이다. Mew 포트가 주소에 필요하면 그대로 포함한다. 호스트에서 앱이 실행되어 있어야 하며 Mew가 빌드하거나 개발 서버를 시작하지 않는다.

직접 접속은 `server/port-preview.ts`의 HTTP·WebSocket 프록시를 사용한다. 미로그인은 `/?preview=3333&previewPath=...`로 이동해 로그인을 마친 후 원래 주소로 돌아온다. `portPreview` 기능은 owner·manager가 기본 허용하며 다른 계정은 owner가 허용한다. 기존 `browser` 덮어쓰기는 `portPreview`로 읽어 이관한다. guest와 임시 비밀번호 상태는 사용할 수 없다.

기능 패널의 브랜치 미리보기도 같은 공개 진입점을 새 탭으로 연다. 직접 접속에서는 `/포트번호`를 사용하고, Mewlink 내부 프레임에서는 `GET /api/port-preview/access-url`로 확인한 공개 기기 주소 뒤에 붙인다. 이 조회는 로그인과 `portPreview` 권한을 검사하고 `{url: string | null}`만 반환하며 등록 토큰·프리뷰 토큰을 노출하지 않는다. 호스트의 공개 주소 조회 결과는 60초 동안 재사용하며 HTTP 응답은 저장하지 않는다. 공개 주소를 확인하지 못하면 미리보기 열기를 제공하지 않고 새로고침으로 다시 조회한다.

앱의 HTML·JavaScript·스타일과 API 응답은 접속한 기기에서 실행한다. 직접 프록시는 URL·스크립트·CookieJar·storage를 재작성하고 `allow-same-origin` 없는 sandbox를 강제한다. 호스트 Chrome이나 DOM 재생 화면을 사용하지 않는다. Android gateway도 `GET /api/android-url`과 같은 loopback 프록시 경계를 사용한다.

## 권한과 포트 경계

`POST /api/port-preview/session`은 `{port, path?}`를 받아 해당 포트에 한정한 토큰·URL을 발급한다. 서명 토큰은 계정과 원래 Mew 인증 세션에 결합한다. 매 요청·열린 소켓에서 로그인·현재 권한·만료를 확인하고 로그아웃·권한 회수에서 전달을 중단한다. 토큰은 30분 뒤 만료하며 자동 갱신하지 않으므로 계속 사용할 때는 진입 주소를 다시 연다. 토큰만으로 다른 포트나 Mew API를 열 수 없다. Mew 자체 수신 포트는 차단한다.

대상은 HTTP(S) loopback이다. Mew 쿠키·인증 헤더·방문자 IP는 upstream에 넘기지 않으며 앱 쿠키는 프록시별 CookieJar로 분리한다. 외부 주소·다른 포트로의 redirect도 세션 경계를 검사한다. 포트 프리뷰를 허용하면 해당 로컬 서비스의 기능을 사용할 수 있으므로 파일 ACL의 샌드박스로 보지 않는다.

## Mewlink

Mewlink는 기존 기기 연결·Mew 로그인을 거친 뒤 포트에 한정한 HTTP·WS 브리지를 만든다. `shared/remote-access.ts`의 `capability: 'port-preview'`는 프리뷰 raw/cookie/WS 경로만 허용한다. 앱에 Mew 전체 API 전송이나 인증 토큰을 전달하지 않는다. 원격 앱 본문·자원은 기존 직접 전송을 사용하며 중앙은 실행용 launcher·Service Worker만 제공한다.

raw HTML과 앱 쿠키 API는 검증된 P2P dispatcher가 해당 요청의 `port-preview` capability를 부여한 연결에서만 허용한다. 유효한 로컬 로그인·프리뷰 토큰이 있어도 직접 HTTP는 403으로 거부하며, 일반 Mew 원격 요청은 전송 프로토콜에서 거부한다. HTTP 헤더로 capability를 지정할 수 없다. 따라서 직접 주소는 계속 opaque sandbox 프록시를 사용하고, 원격 raw HTML은 분리된 preview origin에서만 실행한다.

`PREVIEW_DOMAIN=preview.mew.run` 설정과 `*.preview.mew.run`의 Worker 경로·DNS·HTTPS가 필요하다. 프리뷰마다 임의의 하위 호스트를 생성해 Mew와 다른 앱의 origin·storage·Service Worker를 분리한다. 주소창의 `/user/device/3333` 진입 주소는 유지한다. 이 설정이 없으면 명확한 준비 오류를 표시하며 Mew의 기존 origin으로 앱을 실행하지 않는다.

브라우저의 native WebSocket은 Service Worker가 가로채지 못하므로 프리뷰 전용 브리지를 앱 실행 전에 연결한다. upstream이 실제 선택한 subprotocol을 뷰어까지 전달한다. 앱 요청·소켓에는 해당 프리뷰 포트 권한만 적용한다. 프리뷰를 닫으면 MessagePort·소켓·세션을 정리한다. 공용 launcher·Service Worker·runtime의 기준은 루트 `public/port-preview-*.js`이며 중앙 빌드가 같은 자산을 포함한다. 중앙 변경 적용과 wildcard HTTPS 준비는 사용자가 수행한다.

## 호환성과 검증

루트 자산·API·POST·WebSocket/HMR을 전달한다. POST 본문은 JSON을 포함해 원본 바이트를 유지한다. HTML·CSS·JS·XML만 8MiB 한도 안에서 재작성하며 SSE·바이너리는 역압을 적용해 전달한다. 클라이언트 종료는 upstream 요청을 취소한다.

직접 프록시의 `location.pathname`에는 프록시 접두사가 남는다. 런타임 basename을 지원하는 라우터는 읽기 전용 `window.__MEW_PORT_PREVIEW_BASE_PATH__`를 사용해야 한다. Location의 native 속성을 위장하지 않는다. Next처럼 빌드 시점의 고정 basePath가 필요한 앱은 원래 경로를 유지하는 Mewlink의 별도 origin 경로를 사용한다. Mewlink의 SPA 경로는 실제 브라우저 URL·history와 함께 유지한다.

JS에 하드코딩된 다른 `localhost` 포트는 접속한 기기를 가리키므로 앱의 동일 포트 API 프록시 또는 명시적인 주소 설정을 사용한다. PWA 자체 Service Worker·특수 CSP/COOP/COEP·외부 OAuth 콜백·브라우저 원본 쿠키 동작까지 모든 웹앱을 무수정으로 보장하지 않는다.

포트 프리뷰 테스트는 격리 HTTP/WS 서버와 브라우저에서 로그인 거부·포트 제한·자산/API·쿠키·HMR·권한 회수와 origin 분리를 검사한다. 실제 Mewlink 중앙 배포·사용자 도메인·Tailscale·외부망 확인은 별도 적용 검사다.

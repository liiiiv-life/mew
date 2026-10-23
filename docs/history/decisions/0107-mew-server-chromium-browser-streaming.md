---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: mew 브라우저는 계정별 서버 Chromium 화면을 중계한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0107 — mew 브라우저는 계정별 서버 Chromium 화면을 중계한다"
created: 2026-09-03
updated: 2026-09-11
---

- 날짜: 2026-09-03
- 상태: 대체됨: 0108
- 대체 확인: 2026-09-11 — [0108](0108-mew-server-fetch-device-render-browser-proxy.md). JPEG 화면 중계·당시 런타임을 제거했다. 이후 DOM 중계는 0127·0129의 별도 계약이다.
- 부분 대체: [0057](0057-mew-localhost-browser-panel.md) — Mew 브라우저 보조창의 loopback HTTP 프록시. `/<port>`와 Android gateway의 loopback 프록시는 유지
- 결정자: 송상훈 (요청), Codex (설계·구현)

## 배경

[ADR 0057](0057-mew-localhost-browser-panel.md)의 sandbox iframe 프록시는 원격 기기에서 WSL의
`localhost`를 보는 문제는 풀었지만, root-relative URL을 추측해 재작성한다. 쿠키·same-origin·WebSocket을
의도적으로 제한하므로 복잡한 앱이 깨지고, 공개 사이트는 열 수 없다. 사용자는 `localhost:3100`부터 Google까지
어떤 HTTP(S) 주소든 **Mew가 도는 서버에서 실제로 접속한 결과**를 폰의 Mew에서 조작하고, 기존 보조창과 별개로
독립 팝업에도 띄우길 원한다.

## 선택지

1. 기존 역방향 프록시의 허용 주소와 재작성 범위를 늘린다 — 구현은 이어지지만 웹 플랫폼의 origin·쿠키·CSP·
   WebSocket 의미를 불완전하게 복제해야 하고, 외부 페이지 코드가 Mew origin에서 실행되는 위험이 커진다.
2. 서버 headless Chromium의 화면과 입력을 CDP로 중계한다 — 실제 브라우저 호환성과 origin 격리를 얻지만
   서버 메모리·화면 대역폭을 쓴다.
3. X11 데스크톱 전체를 VNC/WebRTC로 전달한다 — 브라우저 외 도구와 오디오까지 확장하기 쉽지만 별도 데몬·
   디스플레이·인코더·포트와 운영 복잡도가 Mew 브라우저 하나에 비해 크다.

## 결정

2번을 채택한다.

- Mew 서버가 Chrome DevTools Protocol로 Chromium target을 만들고, `Page.startScreencast` JPEG 프레임과
  검증한 마우스·터치·키보드·탐색 명령만 `/api/browser/ws`로 중계한다. URL은 HTTP(S)만 허용한다.
- 런타임과 영속 프로필은 로그인 계정별로 분리한다. 디버그 포트는 서버 loopback 임의 포트에만 열고,
  WebSocket은 manager·owner 세션과 same-origin `Origin`을 확인한다.
- Chrome은 첫 탭 연결 때 지연 시작한다. 변화 프레임은 8바이트 viewport 헤더를 붙인 binary JPEG로, ack 간격상 최대 10fps까지 보내며, 소비가 느린
  클라이언트에는 프레임을 버린다. 연결된 화면이 없는 채 10분이면 프로세스를 종료한다.
- 안정 Chrome for Testing은 `./mew browser install`로 `<MEW_DATA_DIR>/browser/runtime/`에 선택 설치한다.
  시스템 Chromium과 `MEW_BROWSER_EXECUTABLE` 절대경로도 허용한다. Playwright와 브라우저 바이너리를 npm
  의존성·Mew 상주 프로세스에 넣지 않는다.
- 탭 목록과 활성 탭은 같은 Mew origin의 localStorage에 두고, 서버는 불투명한 탭 ID만 안다. 보조창의 떼기
  버튼과 헤더의 직접 진입은 `/browser` 독립 팝업을 열며 같은 서버 탭 ID에 다시 붙는다.
- 현재 전송 계약은 화면·입력·탐색·JS 대화상자다. 오디오와 파일 업로드는 전송하지 않고 다운로드는 서버
  디스크에 예기치 않게 쌓이지 않도록 차단한다.
- 기존 `server/browserProxy.ts`는 `/<port>` 전체 페이지 호환과 Android gateway에만 남긴다. 이 경로의
  loopback 제한·헤더 제거·sandbox·서명 토큰은 ADR 0057을 그대로 따른다.

## 근거

픽셀 경계는 외부 페이지의 origin을 그대로 유지하면서 Mew 인증 origin과 완전히 분리한다. HTTP 응답 재작성보다
현대 웹 호환성이 높고, 폰은 URL 요청 주체가 아니라 화면·입력 클라이언트가 된다. VNC보다 Mew 탭·권한 모델에
맞는 표면만 작게 노출할 수 있다. Chromium의 메모리 비용은 설치 선택화, 지연 시작, 프레임 제한, 유휴 종료로
운영 중 쓰지 않을 때 0에 가깝게 만든다.

## 결과

- 대상 사이트에는 서버의 외부 IP와 서버 Chromium 특성이 보인다. headless 탐지를 하는 사이트는 CAPTCHA나
  추가 인증을 요구할 수 있다.
- 사이트 로그인·쿠키는 Mew 계정별 서버 프로필에 이어지지만, manager·owner는 셸로 다른 프로필을 읽을 수 있어
  상호 불신 사용자 간 OS 보안 경계는 아니다.
- 화면 대역폭과 입력 지연은 로컬 iframe보다 크다. 오디오·다운로드·업로드를 추가하려면 각각 수명·용량·권한
  계약을 먼저 정하고 이 ADR을 확장하거나 대체한다.

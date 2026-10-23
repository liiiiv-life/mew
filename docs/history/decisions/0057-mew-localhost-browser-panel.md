---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: mew 브라우저 창은 manager·owner 전용 loopback 프록시로 연다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0057 — mew 브라우저 창은 manager·owner 전용 loopback 프록시로 연다"
created: 2026-08-19
updated: 2026-09-11
---

- 날짜: 2026-08-19
- 상태: 채택
- 후속 결정: [0127](0127-mew-browser-server-dom-runtime.md) — 일반 Browser 패널의 loopback iframe; /<port>·Android 프록시는 유지
- 결정자: Codex + 사용자 요청

## 배경

mew를 원격에서 열었을 때 WSL 안에서 떠 있는 `localhost:3100` 같은 개발 서버를 같은 화면에서 보고 싶다.
브라우저 주소창에 `localhost:3100`을 치면 방문자 기기의 localhost를 보므로 목적이 다르다. 매번 Tailscale
호스트명을 붙여 접속하는 방식도 번거롭다.

하지만 mew 서버가 대신 URL을 열어 주면 SSRF 표면이 된다. 내부망 탐색, mew 세션 쿠키 전달, proxied 앱이
같은 origin 권한으로 mew API를 호출하는 문제가 생길 수 있다.

## 선택지

1. iframe을 `http://<mew-host>:3100`으로 직접 연다 — 구현은 작지만 WSL localhost를 보장하지 못하고, 대상
   포트를 tailnet에 따로 노출해야 한다.
2. 임의 URL 프록시를 만든다 — 편하지만 내부망·메타데이터 주소·공개 URL을 모두 대신 열 수 있어 위험하다.
3. loopback 전용 프록시를 manager·owner에게만 열고, iframe을 sandbox로 격리한다.

## 결정

3번. `Alt+B` 브라우저 창을 추가하되, 서버 프록시는 `localhost`, `127.0.0.0/8`, `::1`만 허용한다. 접근 권한은
터미널과 같은 manager·owner다. iframe에는 `allow-same-origin`을 주지 않고, 프록시는 mew 쿠키·Authorization을
대상 서버로 전달하지 않는다.

전체 페이지가 필요하면 `/<port>`를 같은 프록시로 연다. 예: `/3100`은 `http://localhost:3100/`이다.
첫 요청에서 manager·owner 세션을 확인한 뒤 짧은 서명 토큰이 들어간 내부 경로로 리다이렉트하고, 응답에는
`Content-Security-Policy: sandbox`를 걸어 iframe 없이도 같은 origin 권한을 주지 않는다.

## 근거

- 로컬 개발 서버는 인증이 없거나 관리자 권한을 전제하는 경우가 많다. member에게는 워크스페이스 파일 읽기·쓰기
  권한은 있지만 셸과 내부 서비스 접근 권한은 없다. 브라우저 창도 같은 이유로 터미널 게이트를 따른다.
- loopback만 허용하면 사용자가 원하는 `med-app` 같은 WSL 로컬 서버는 볼 수 있고, mew를 내부망 스캐너로 쓰는
  경로는 닫힌다.
- 프록시 경로는 mew와 같은 origin이므로 sandbox가 없으면 대상 앱 JavaScript가 mew API를 호출할 수 있다.
  `allow-same-origin`을 빼면 일부 개발 편의(localStorage, HMR WebSocket)는 줄지만, 세션 경계가 더 중요하다.

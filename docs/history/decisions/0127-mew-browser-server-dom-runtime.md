---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: Mew 브라우저 전체는 서버 Chromium과 DOM 중계를 쓴다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0127 — Mew 브라우저 전체는 서버 Chromium과 DOM 중계를 쓴다"
created: 2026-09-09
updated: 2026-09-11
---

- 날짜: 2026-09-09
- 상태: 채택
- 후속 결정: [0150](0150-mew-account-feature-and-file-permissions.md) — 고정 역할 게이트를 계정별 기능 권한으로 변경
- 후속 결정: [0128](0128-mew-browser-oauth-uses-internal-browser.md) — Codex만 별도 제한 문맥으로 실행
- 후속 결정: [0129](0129-mew-browser-native-launch-cdp.md) — 일반 프로필 Chromium 실행·CDP 연결
- 부분 대체: [0126](0126-mew-codex-auth-dom-remoting-pilot.md) — Codex에 한정한 적용 범위를 일반 Browser 패널까지 확대
- 부분 대체: [0109](0109-mew-agent-authentication-and-loopback-browser.md) — 일반 Browser 패널의 loopback 대상 제한과 원격 브라우저 재시도 금지
- 부분 대체: [0108](0108-mew-server-fetch-device-render-browser-proxy.md) — 일반 Browser 패널의 서버 fetch·기기 실행 방식. 범용 HTML 재작성 프록시는 재도입하지 않는다.
- 결정자: 송상훈 (브라우저 기능 전체를 서버 브라우저와 같은 실행 주체로 바꾸라고 명시), Codex (구현)

## 배경

사용자의 요청은 Codex 로그인 수정이 아니라 Mew 내부 브라우저 기능 전체다.
브라우저는 서버에서 실제로 실행하되 화면 픽셀·영상 전송은 금지한다.
사이트 스크립트·네트워크·쿠키·탭 관계가 서버 Chromium에 있고 Mew는 DOM 표시와 사용자 입력을 연결해야 한다.

## 결정

- 일반 Browser 패널과 독립 `/browser` 화면 모두 서버 DOM 브라우저를 사용한다. HTTP(S) 공개 사이트·서버 loopback·서버에서 접근 가능한 사설망을 연다.
- 역할은 manager·owner로 유지한다. 이는 서버 셸과 같은 네트워크 접근 범위다. 페이지 코드와 Mew 원본의 실행 문맥은 분리한다.
- 일반 탭은 Mew 계정별 전용 Chromium 프로필을 공유한다. 쿠키·localStorage·IndexedDB 등은 Chromium이 관리하고 프로필은 Mew 데이터 폴더에 남긴다. 기존 개인 Chrome 프로필은 사용하지 않는다.
- 주소 입력·history·새로고침·중지·탭 닫기는 실제 서버 페이지를 조작한다. 사이트가 연 팝업은 같은 프로필의 실제 Page로 유지하고 Mew 탭에 표시한다.
- DOM 변경은 증분 전달하고 원래 JavaScript는 서버에서만 실행한다. 탭과 하위 프레임은 각각 서버 노드 ID와 탐색 세대로 입력 대상을 판정한다.
- 확인/입력 대화상자와 기기 파일 업로드·서버 다운로드를 Mew UI에서 연결한다. 파일은 해당 계정과 실제 선택창/다운로드에 묶고 임의 서버 경로는 받지 않는다.
- 웹소켓·서비스 워커는 일반 서버 브라우저에서 동작한다. Codex 전용 인증 작업은 기존 일회성 호스트 제한 문맥을 유지한다.
- 모든 탭이 정리되면 프로필을 닫는다. 연결이 끊긴 일반 탭은 유예 기간 동안 유지하며 브라우저 창 재열기는 같은 서버 탭으로 연결한다. 사용하지 않는 서버 브라우저를 무기한 남기지 않는다.
- 기존 `/<port>` 및 Android loopback 호환 프록시는 별도 유지한다. 일반 Browser 패널에서 이 경로로 되돌아가지 않는다.

## 지원 경계

서버에서 웹사이트가 실행된다는 사실과 모든 웹 표면이 동일하게 재현된다는 주장은 다르다.
DOM으로 표현되지 않는 Canvas/WebGL·DRM·OS 장치 인증·카메라 등은 완전한 재현을 보장하지 않는다.
미지원 표면을 숨기거나 화면 캡처로 자동 대체하지 않는다. 일반 사이트 흐름·폼·탭·프레임·실제 서버 상태는 테스트로 검증한다.

참고: [Chromium 영속 프로필](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context), [브라우저 Frame](https://playwright.dev/docs/api/class-frame).

현재 기능은 [결정 0023](../../decisions/0023-login-desktop-and-port-preview.md)에 따라 독립 로그인 영상 화면과 localhost 앱 접속으로 대체했다. 이 문서는 이전 결정의 근거로 보존한다.

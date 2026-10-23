---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: Codex OAuth는 제한된 서버 브라우저로 loopback callback까지 이어준다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0121 — Codex OAuth는 제한된 서버 브라우저로 loopback callback까지 이어준다"
created: 2026-09-07
updated: 2026-09-11
---

- 날짜: 2026-09-07
- 상태: 채택
- 후속 결정: [0126](0126-mew-codex-auth-dom-remoting-pilot.md) — fetch·재작성·iframe 인증
- 후속 결정: [0128](0128-mew-browser-oauth-uses-internal-browser.md) — Codex 전용 호스트 제한 임시 문맥; 공식 codex login은 유지
- 부분 대체: [0109](0109-mew-agent-authentication-and-loopback-browser.md) — Codex 로그인을 device-code와 접속 기기의 외부 브라우저에 고정한 범위
- 부분 대체: [0110](0110-mew-declarative-agent-authentication-jobs.md) — Codex의 `codex login --device-auth` 실행 계약
- 부분 대체: [0116](0116-mew-oauth-agent-logins-use-external-browser.md) — Codex OAuth를 접속 기기의 top-level 브라우저로 여는 범위
- 결정자: 송상훈 (지시·실기기 검증), Codex (설계·구현)

## 배경

Mew 서버에서 실행한 기본 `codex login`은 브라우저 OAuth 주소를 출력하고
`localhost` callback listener를 연다. 원격 휴대폰의 일반 브라우저에서 승인하면 callback이
휴대폰 localhost로 가서 실패하지만, 그 callback URL을 Mew 내장 브라우저에 넣으면 서버
loopback으로 전달돼 로그인이 완료됨을 실기기에서 확인했다. 기존 device-code 흐름은
추가 설정·코드 입력을 요구해 일반 OAuth보다 번거롭다.

공식 OpenAI 문서도 Codex CLI의 기본 로그인을 `codex login` 후 브라우저 흐름을 완료하는
것으로 정의한다. 다만 기존 Mew 브라우저는 SSRF 경계 때문에 loopback만 허용하므로,
일반 브라우저 탭을 범용 외부 프록시로 풀어서는 안 된다.

## 선택지

1. Codex device-code를 유지한다 — 안전하지만 사용자가 확인한 간단한 기본 OAuth를 쓰지 못한다.
2. 내장 브라우저의 모든 외부 주소를 허용한다 — 흐름은 간단하지만 manager·owner 셸 권한 밖에
   범용 SSRF·credential proxy 표면을 만든다.
3. 등록된 Codex 로그인 작업이 발급한 URL만 서버 브라우저 세션으로 열고, 인증 호스트와
   loopback으로 대상을 한정한다.

## 결정

3번을 채택한다.

- Codex 등록 로그인 명령은 `codex login`이다. `--device-auth`를 넘기지 않아 공식 기본
  브라우저 OAuth를 쓴다.
- 브라우저형 인증 작업의 pane에서 등록표 allowlist를 통과한 URL을 찾은 뒤, 서버가
  계정·인증 작업에 묶인 짧은 브라우저 capability URL을 발급한다.
- 해당 브라우저 세션은 등록표의 HTTPS 인증 호스트와 `localhost`·127/8·`::1`만 요청한다.
  서명 URL을 변조해 다른 origin을 지정해도 서버의 세션 allowlist가 차단한다.
- 로그인 페이지는 에이전트 인증 화면 안의 일회성 내장 브라우저로 연다. 외부 주소를
  일반 Browser 패널 탭·localStorage에 보존하지 않는다.
- OAuth가 loopback callback을 호출하면 같은 서버 브라우저 세션이 Codex CLI의 로컬
  listener로 요청한다. CLI가 0으로 종료하면 인증 브라우저를 내리고 같은 탭의 ACP
  인증을 재시도해 채팅 화면으로 복귀한다.
- 범용 Browser 패널은 기존처럼 loopback 전용이다. 다른 런타임은 별도 검증·등록 없이
  이 경로를 사용하지 않는다.

## 근거

OAuth client·PKCE·token 저장은 계속 Codex CLI가 소유한다. Mew는 등록된 명령의 출력과
서버 loopback 사이의 브라우저 전달만 담당하므로 토큰 교환 계약을 복제하지 않는다.
범용 외부 프록시 대신 작업별 allowlist capability를 쓰면 사용자가 원한 서버쪽 OAuth를
제공하면서 0109·0112의 기본 SSRF 경계를 유지할 수 있다.

## 결과

- 인증 공급자가 sandbox fetch proxy를 거부하거나 새 호스트로 이동하면 작업은 실패할 수 있다.
  호스트 추가는 실제 OAuth 흐름과 보안 경계를 같이 검토한 뒤 등록표에서만 한다.
- 기본 OAuth가 사용 불가능한 환경을 위한 device-code 재도입은 금지하지 않지만, 기본 버튼으로
  다시 복귀하지 않는다.

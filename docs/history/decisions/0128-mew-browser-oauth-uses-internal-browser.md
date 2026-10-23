---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: 브라우저형 OAuth는 공통 내부 서버 브라우저를 사용한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0128 — 브라우저형 OAuth는 공통 내부 서버 브라우저를 사용한다"
created: 2026-09-09
updated: 2026-09-09
---

- 날짜: 2026-09-09
- 상태: 채택
- 부분 대체: [0110](0110-mew-declarative-agent-authentication-jobs.md), [0116](0116-mew-oauth-agent-logins-use-external-browser.md) — browser 인증의 외부 기기 탭 열기
- 부분 대체: [0126](0126-mew-codex-auth-dom-remoting-pilot.md), [0127](0127-mew-browser-server-dom-runtime.md) — Codex 인증만 별도 호스트 제한 임시 문맥으로 실행하는 범위
- 결정자: 송상훈 (모든 브라우저 기반 OAuth를 내부 브라우저로 통합하도록 지시), Codex (구현)

## 결정

- 등록표의 `browser` 인증 방법은 공통 내부 서버 Chromium·DOM 브라우저를 사용한다. 현재 Codex, Kimi Code `.com`·`.ai`, Cursor CLI가 해당한다. 앞으로 추가하는 browser 방법에도 동일하게 적용한다.
- CLI 출력에서 최초 승인 URL을 얻을 때는 등록된 HTTPS 호스트 검증을 유지한다. 이후 로그인·SSO·callback·팝업은 일반 내부 브라우저와 같은 서버 프로필에서 실행한다. 공급자 자원 호스트 목록을 임의로 추측해 재작성하거나 외부 기기 탭으로 우회하지 않는다.
- 인증 탭과 그 팝업은 인증 작업에 묶고 일반 탭 목록과 분리한다. 완료·실패·중단·만료 시 작업의 탭을 정리한다. 사이트 로그인 상태는 계정별 일반 브라우저 프로필에 남으며 CLI 자격증명과 토큰 교환은 계속 공식 CLI가 소유한다.
- ACP URL 인증 요청도 사용자 열기 동작에서 같은 내부 브라우저를 사용한다. 브라우저 생성 실패 시 승인 응답을 보내지 않고 재시도 오류를 표시한다.
- 기기 승인 코드와 SSO 팝업은 내부 인증 화면에 표시한다. 사이트가 DOM 밖 표면이나 자동화 거부를 요구하면 성공을 보장하지 않으며 픽셀 스트리밍은 도입하지 않는다.
- TUI에서 공급자·키·모델 선택을 수행하는 terminal 인증과 API key 입력은 기존 계약을 유지한다. terminal 자체를 browser 방식으로 재분류하지 않는다.

## 범위

권한은 manager·owner와 계정 소유권을 유지한다. 일반 서버 브라우저의 네트워크·프로필 경계는 [0127](0127-mew-browser-server-dom-runtime.md)을 따른다. 과거 외부 탭 예약 방식은 브라우저형 인증에서 재도입하지 않는다.

현재 기능은 [결정 0023](../../decisions/0023-login-desktop-and-port-preview.md)에 따라 독립 로그인 영상 화면과 localhost 앱 접속으로 대체했다. 이 문서는 이전 결정의 근거로 보존한다.

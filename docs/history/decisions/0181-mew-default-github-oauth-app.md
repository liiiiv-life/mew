---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: Mew 기본 GitHub OAuth 앱. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0181 — Mew 기본 GitHub OAuth 앱"
created: 2026-09-29
updated: 2026-09-29
---

- 날짜: 2026-09-29
- 상태: 채택
- 부분 대체: [0179](0179-mew-account-git-connections.md) — 설치 운영자마다 OAuth 앱 등록을 요구하던 설정; 계정별 토큰·실행 경계는 유지
- 결정자: 사용자(공용 Client ID 제공·기본 배포 요청), Codex(구현)

## 배경

셀프호스팅 설치마다 OAuth 앱을 등록하게 하면 GitHub 연결의 초기 설정 부담이 크다.

## 결정

- 사용자 제공 Mew OAuth 앱의 공개 Client ID를 서버 코드의 기본값으로 배포한다. Client secret은 배포하거나 사용하지 않는다.
- `MEW_GITHUB_CLIENT_ID`의 앞뒤 공백을 제거한 값이 있으면 자체 앱으로 대체한다. 미설정·빈 값·공백은 기본 앱을 사용한다.
- 기본 앱 운영자는 Device Flow를 활성화한다. 개별 설치자는 앱 등록 없이 각자 GitHub에서 승인한다. 토큰은 각 설치 서버에서 계정별로 관리한다.
- 공용 앱의 인증 제한·사칭 위험을 없애는 결정은 아니다. 자체 앱 설정을 유지하며 실제 GitHub 승인은 별도로 검증한다.

## 현행 계약

[환경 설정](../../configuration/environment.md#github-oauth-연결)과 [Git 연결 계약](../../development/git-connections.md)을 따른다.

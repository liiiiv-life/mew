---
title: "Mewlink의 mew.run 이전과 본인 전용 대시보드"
description: "공개 기기 주소를 mew.run으로 옮기고 사용자 경로의 비공개 대시보드, 이전 등록·신원·OAuth 유지와 같은 site 내부 앱 origin 및 제한된 UDP 수신 범위를 선택한 결정."
created: 2026-10-15
updated: 2026-10-16
---

# Mewlink 도메인과 대시보드

상태: 승인됨.

## 배경

사용자가 구입한 `mew.run`으로 기존 기기 주소를 이전하고 `/{username}`에 로그인한 본인의 기기 목록을 요청했다. 별도 폰의 비로그인 접속 실패도 보고했다. 기존 등록과 로컬 승인 신원은 이전 중앙 origin을 검증하므로 주소 문자열만 바꾸면 연결과 승인이 끊길 수 있다.

## 결정

- 공개 기기 주소는 `mew.run/{username}/{device}`이며 중앙 로그인 없이 연결을 시작한다. 작업 접근은 로컬 mew 인증을 따른다.
- `mew.run/{username}`은 중앙 로그인한 본인의 기기 대시보드다. 다른 계정의 목록을 공개하지 않는다. 이전 `/dashboard`는 호환 이동만 제공한다.
- 내부 앱은 같은 site의 별도 origin인 `app.mew.run`에서 실행한다. 중앙 인증 cookie와 API 격리를 유지한다.
- 명시한 이전 중앙 origin의 등록·상시 연결을 지원한다. 기기 ID·키·DB와 승인된 신원은 유지하며 ticket은 실제 host의 origin으로 검증한다. 직접 이메일 계정의 issuer namespace도 유지한다.
- 제공자 콘솔의 기존 콜백을 유지하는 동안 고정 OAuth origin과 새 관리 origin 사이에서 브라우저 쿠키에 결합한 60초·일회용 로그인 증명을 교환한다. 앱 origin과 임의 이동 주소는 허용하지 않는다.
- 네이티브 Mewlink UDP 포트는 `55000–55031`로 제한해 WSL의 필요한 수신 범위만 허용할 수 있게 한다.

## 근거와 영향

같은 site의 앱 origin은 모바일 브라우저의 cross-site 저장소 제한을 줄인다. 이전 등록의 키와 정확한 origin 검증을 함께 유지하면 재등록 없이 이전할 수 있다. 대시보드의 인증과 공개 기기의 연결 시작은 다른 권한 경계다.

2026-10-15 운영 WSL의 mirrored 모드에서 STUN 후보 생성과 같은 PC의 익명 모바일 Chromium 연결은 확인했지만 Hyper-V 기본 수신은 차단이었고 Mewlink 전용 UDP 허용 규칙이 없었다. 범위 규칙 추가는 관리자 권한 부족으로 거부됐다. 이 관찰은 외부 폰 실패의 단일 원인 확정이나 외부망 검증 완료를 뜻하지 않는다.

현재 구현·운영 절차는 [원격 접속 계약](../development/remote-access.md)과 [중앙 배포](../deployment/remote-central.md)가 소유한다. 이 결정은 이전 [Workers/P2P UI 결정](../history/decisions/0203-mewlink-workers-p2p-ui.md)의 도메인과 별도 대시보드 주소를 변경하며 로컬 인증 경계는 유지한다.

제한된 UDP 범위의 자동 준비와 임시 공유기 매핑은 후속 [0006](0006-mewlink-direct-network-preparation.md)에서 정한다.

---
title: "Mew ADR — 배포·보안·저장·문서"
created: 2026-09-11
updated: 2026-10-07
description: "독립 전 Mew ADR의 주제별 분류를 보존한 이력 지도. 현재 계약은 Mew 자체 문서와 후속 결정을 따른다."
---

상위: [Mew ADR 지도](../MOC.md). 상태가 `채택`이어도 상단의 **후속 결정**이 있으면 변경 범위를 함께 확인한다.

## History / raw — 당시 분류

- [0201 — Windows 포터블 관리 앱과 WSL 실행 계층](../../0201-mew-windows-manager-wsl.md) — 독립 Tauri 앱·전용 WSL 2·비관리자 서버·localhost

- [0195 — 중앙 계정 인증과 P2P 원격 접속](../../0195-mew-account-based-p2p-remote-access.md) — mew.saens.kr·서버 한 번 등록·작업 데이터 직결; 설계 채택·미구현

- [0178 — README 소개와 네 언어 사용법](../../0178-mew-multilingual-readme-router.md) — mew README 본문·문서 진입 경로

- [0132 — 프로젝트 문서는 소유 프로젝트, ADR은 중앙](../../0132-docs-project-owned-documentation.md)
- [0120 — 에셋은 프로젝트의 .mew에 저장](../../0120-mew-project-local-assets-replace-r2.md)
- [0112 — 공개 배포의 보안·자격증명 경계](../../0112-mew-public-release-security-and-credential-boundaries.md)
- [0111 — 지원 배포는 네이티브 설치와 감독 프로세스로 한정한다](../../0111-mew-native-deployment-and-supervisor.md)
- [0023 — 공개 가능한 자립 레포와 네이티브 설치](../../0023-mew-selfhost-packaging-repo.md) — 자립 레포·XDG; 배포·자산은 0111·0120

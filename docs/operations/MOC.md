---
title: "운영과 복구"
created: "2026-09-11"
updated: "2026-10-22"
description: "공유 전 보안 기준·서버 반영 점검·설치 위치와 접근 경계·에이전트 메모리 복구를 연결한다. 대체된 DOM 브라우저 실험은 과거 검증 근거로 구분한다."
상위파일: "../MOC.md"
---
# 운영과 복구

실제 운영에 반복 사용하는 점검과 복구 안내입니다.

| 필요한 작업 | 문서 |
| --- | --- |
| 공개·업데이트·반영 전후 점검 | [배포 운영 런북](deployment.md) |
| 계정 공유·역할·게스트·기기 회수·데이터 보관 확인 | [보안 운영 기준](security.md) |
| 설치 위치·포트·OS 실행 경계 확인 | [접근 모델](access-model.md) |
| 에이전트 메모리 한도 설치·진단·작업 재개 | [메모리 보호와 복구](agent-memory.md) |
| Windows 접속·WSLg 충돌 진단 | [사용자 문제 해결](../guides/troubleshooting.md) |

제품의 역할·권한 기준은 [보안](security.md), 설정값은 [환경 설정](../configuration/environment.md), 설치 절차는 [배포](../deployment/_deployment.md)가 소유합니다.

## 과거 검증 근거

[DOM 브라우저 Google OAuth 실험](../history/browser-dom-oauth.md)은 2026-09-11 당시의 실행 방식과 검증 조건입니다. 현재 로그인은 [로그인 가상 화면](../development/login-desktop.md)을 따릅니다.

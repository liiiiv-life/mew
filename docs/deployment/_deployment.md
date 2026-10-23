---
title: "배포"
created: "2026-09-11"
updated: "2026-10-15"
description: "소스 서버 설치·HTTPS·업데이트와 사전 빌드 CLI 발행, 별도 Mewlink 중앙 서비스 및 이메일 로그인 배포를 구분해 연결한다."
상위파일: "../MOC.md"
---
# 배포

개인 컴퓨터에 처음 설치하려면 [사용자 설치 안내](../guides/getting-started-ko.md)를 따르세요. 이곳은 서버 운영자와 릴리스 담당자를 위한 절차입니다.

| 배포 대상 | 안내 |
| --- | --- |
| mew 서버 — 전용 OS 사용자·HTTPS·systemd·백업 | [네이티브 서버 배포](native.md) |
| 사전 빌드 실행본·npm·GitHub 릴리스 | [CLI 릴리스](cli-release.md) — 최초 발행·플랫폼 실기 검증은 별도 |
| Mewlink 기기 등록·관리·중앙 인증 서비스 | [중앙 서비스 배포](remote-central.md) |
| 중앙 이메일 로그인 코드 발송 | [이메일 로그인 배포](email-login.md) |

반영 전후의 점검은 [운영 런북](../operations/deployment.md)을 따릅니다. 로컬 mew와 Mewlink는 별도 배포 대상이며, 각 문서의 실제 반영·검증 상태를 확인하세요.

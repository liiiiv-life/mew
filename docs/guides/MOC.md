---
title: "사용법"
created: "2026-09-11"
updated: "2026-10-15"
description: "설치와 첫 사용 이후 문서·파일·Git·에이전트·협업·원격 작업의 사용법을 연결하고, 추가 준비가 필요한 기능과 화면·언어·스킬 설정을 안내한다."
상위파일: "../MOC.md"
---
# 사용법

필요한 작업을 골라 해당 안내로 이동하세요. 구현 세부사항은 [기능 명세](../features/MOC.md)와 [개발 계약](../development/MOC.md)에서 확인합니다.

## 처음 시작하기

- [mew 소개와 화면 둘러보기](overview.md)
- 설치: [한국어](getting-started-ko.md) · [English](getting-started-en.md) · [简体中文](getting-started-zh.md) · [日本語](getting-started-ja.md)
- [첫 프로젝트와 문서 열기](first-steps.md)

현재 공개 설치는 Linux·macOS와 Windows의 WSL 2를 사용합니다. 사전 빌드 CLI와 Windows 네이티브 실행본의 발행·검증 상태는 [CLI 릴리스](../deployment/cli-release.md)에서 확인하세요.

## 문서와 프로젝트

| 하려는 일 | 안내 |
| --- | --- |
| 폴더 열기·프로젝트 전환·파일 탐색·Git·태스크 | [프로젝트와 파일](projects.md) |
| Markdown·코드·표·첨부·PDF 편집과 자동저장 | [편집기](editor.md) |
| Documents 연결·기본 지침·에이전트 자동 안내 | [프로젝트 설정](project-setup.md) |
| 공동 편집·댓글·멘션·채팅·게스트 공유 | [협업과 공유](collaboration.md) |
| 파일 이름·본문 검색과 치환 | [검색](../configuration/search.md) |

## 실행과 자동화

- [터미널·AI 에이전트·대화와 탭](terminal-agents.md)
- [명령 버튼·예약 작업·시스템 자원](commands.md)
- [Postgres 표·문서 DB·읽기 전용 참조](database.md)

## 원격 접속과 화면

| 하려는 일 | 안내 |
| --- | --- |
| 휴대폰·다른 컴퓨터의 브라우저에서 내 mew 열기 | [Mewlink·Tailscale·Cloudflare Tunnel](getting-started-ko.md#외부에서-접속하기) |
| 서버에서 웹페이지 열기·Android 환경 확인 | [브라우저와 Android](browser.md) |
| 컴퓨터 화면에 접속·키보드·터치 입력 | [원격 데스크톱](remote-desktop.md) |

외부 접속은 실행 중인 mew를 다른 브라우저에서 여는 방법입니다. 원격 데스크톱은 컴퓨터의 화면과 입력을 전달하며 별도 구성 요소와 OS 권한이 필요합니다. Android는 별도 기기·gateway, Postgres 표는 DB 연결을 준비해야 합니다.

## 설정과 문제 해결

| 필요한 설정·확인 | 안내 |
| --- | --- |
| 테마·글꼴·독·단축키·알림·계정 바꾸기 | [환경과 계정](../configuration/MOC.md) |
| AI 런타임 설치·인증·모델 선택하기 | [런타임 설정](../configuration/agent-runtimes.md) |
| 기본 문서화 스킬과 추가 스킬·MCP 확인하기 | [Skills·MCP 관리](../configuration/agent-harness.md) |
| Documents 연결·에이전트 기본 지침·응답 언어 바꾸기 | [프로젝트 설정](project-setup.md) |
| WSL 접속·WSLg 충돌 진단하기 | [문제 해결](troubleshooting.md) |
| 다른 사람에게 계정·공유 권한 주기 전 확인하기 | [보안](../operations/security.md) |

네 언어의 시작 안내는 설치와 첫 사용을 같은 범위로 다룹니다. 세부 사용법은 현재 한국어이며, 기능·절차 변경 시 언어별 안내도 함께 갱신합니다.

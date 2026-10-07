---
title: "계정 접속 중앙 서비스 설치"
description: "중앙 Node 서비스의 별도 진입점·HTTPS·OAuth/OIDC 환경변수·키와 SQLite 보관, A의 owner 등록·멤버 승인·폐기와 배포 전 실제 로그인·외부망 검증을 안내한다. 중앙 서비스는 아직 배포하지 않았다."
created: 2026-10-07
updated: 2026-10-07
---

# 계정 접속 중앙 서비스

[구현·전송 계약](../development/remote-access.md) · [로컬 설치](native.md) · [작업과 출시 게이트](<../tasks/mew 중계 기능 만들기.md>)

이 진입점은 계정·등록·시그널링과 정적 UI를 제공한다. 사용자 워크스페이스를 호스팅하지 않는다. **구현과 격리 테스트는 완료했고, `mew.saens.kr`의 실제 설치·DNS·인증서·로그인 제공자 설정은 수행하지 않았다.** 아래는 운영자가 적용할 절차다. 에이전트의 빌드·서버 실행 제한은 [실행 규칙](../development/getting-started.md)을 따른다.

## 중앙 운영자 설정

Node 22.18+ 또는 24+와 HTTPS를 종료하는 프록시가 필요하다. UI는 같은 저장소 버전의 사용자 빌드 `dist/`를 사용한다. 중앙 프로세스는 레포나 배포 파일 밖의 절대 데이터 폴더를 요구하며 기존 로컬 `.data`, `MEW_WORKSPACE`, Git/에이전트 계정 데이터를 사용하지 않는다.

| 환경변수 | 값과 의미 |
| --- | --- |
| `MEW_CENTRAL_ORIGIN` | 기본 `https://mew.saens.kr`. 경로·query·자격증명이 없는 정확한 HTTPS origin |
| `MEW_CENTRAL_DATA_DIR` | 필수 절대 경로. `dist/`와 그 아래를 금지하며 symlink의 실제 대상도 검사 |
| `MEW_CENTRAL_BIND` / `MEW_CENTRAL_PORT` | 기본 `127.0.0.1` / `5002`. 공개 HTTPS 프록시 뒤에서 운영 |
| `MEW_GOOGLE_OAUTH_CLIENT_ID` / `MEW_GOOGLE_OAUTH_CLIENT_SECRET` | 중앙 로그인용 Google OAuth 앱 |
| `MEW_GITHUB_OAUTH_CLIENT_ID` / `MEW_GITHUB_OAUTH_CLIENT_SECRET` | 중앙 로그인용 GitHub OAuth 앱. A의 Git Device Flow 설정과 별도 |
| `MEW_APPLE_OAUTH_CLIENT_ID` / `MEW_APPLE_OAUTH_CLIENT_SECRET` | Apple Services ID와 운영자가 발급·갱신하는 client secret JWT |
| `MEW_EMAIL_OIDC_ISSUER` | 이메일 로그인 방식(메일 링크/비밀번호)을 운영하는 OIDC 제공자의 HTTPS issuer |
| `MEW_EMAIL_OAUTH_CLIENT_ID` / `MEW_EMAIL_OAUTH_CLIENT_SECRET` | 해당 이메일 OIDC 앱의 ID·secret |

각 제공자에 `${MEW_CENTRAL_ORIGIN}/auth/<google|github|apple|email>/callback`을 정확한 redirect URI로 등록한다. 설정된 제공자만 로그인 화면에 표시한다. email은 OIDC 제공자에서 이메일 로그인을 운영하며 자체 SMTP·비밀번호 저장·메일 링크 발송 서버는 구현하지 않았다. Apple은 `form_post`와 state cookie, nonce·ID token 검증 경로를 제공한다. 공급자의 실제 설정·심사·secret 만료와 로그인 성공은 운영 검증 대상이다. Apple 계약의 근거는 [공식 인증 요청](https://developer.apple.com/documentation/signinwithapplerestapi/request-an-authorization-to-the-sign-in-with-apple-server.)과 [공식 OIDC metadata](https://appleid.apple.com/.well-known/openid-configuration)를 따른다.

설정은 중앙 서비스 관리자의 보호된 환경 파일/secret 주입으로 전달한다. 중앙 진입점은 A용 설정 파일이나 레포 `.env`를 자동으로 읽지 않는다. 운영자가 의존성을 설치하고 UI를 빌드한 뒤 `npm run serve:central`로 중앙 프로세스를 시작한다. 프로세스 감독·부팅 시 자동 시작은 운영 환경의 서비스 관리자가 담당한다.

프록시는 동일 origin에서 정적 앱·`/auth`·`/central`·`/central/signal`을 전달하고 WS upgrade를 허용한다. OAuth callback query/form body·Cookie·등록 코드·SDP·ICE·접속 증명을 접근/오류 로그에 남기지 않는다. 원격 작업 API를 A로 HTTP proxy하는 경로를 만들지 않는다. 중앙 API·로그인 페이지와 HTML·worker는 장기 캐시하지 않는다. A와 B 모두 이 중앙 서비스에 HTTPS/WSS로 접속할 수 있어야 한다.

## 키·DB·수명

데이터 폴더는 0700, signing-key와 SQLite 파일은 OS 사용자 전용으로 운영한다. 처음 생성한 `signing-key.json`과 `central.sqlite`를 영구 보관한다. 손상된 키 파일은 새 키로 덮어쓰지 않는다. DB의 활성 기기 이름은 owner별로 유일하며 삭제된 이름은 다시 등록할 수 있다. 계정·신원·등록·멤버십·폐기 기록은 DB에 남고, 만료 세션은 신규 세션 생성 시 정리한다. 로그아웃은 해당 세션을 삭제한다. 보관/개인정보 안내와 계정 삭제 운영 정책은 출시 전에 확정한다.

중앙 세션은 해시로 저장하고 Secure·HttpOnly·SameSite Lax인 `__Host-mew_central` cookie로 최대 7일 유지한다. OAuth 트랜잭션과 미완료 등록은 5분, SDP·ICE·협상은 연결 수명 동안 메모리에만 둔다. 프로세스 재시작은 열린 신호 연결과 미완료 등록/로그인을 종료하지만 승인된 A 등록은 DB에 보존한다.

운영 백업은 SQLite의 일관된 snapshot과 서명 키를 함께 보관한다. 실행 중 DB 파일만 복사하는 방식을 백업 완료로 간주하지 않는다. 중앙 공개 키는 A가 최초 등록 때 고정하므로 키를 삭제·교체하면 기존 A의 접속 증명 검증이 실패한다. 자동 키 회전은 제공하지 않으며 승인된 재등록·긴급 발급 중단·복구 실습을 출시 전에 검증한다.

## A 등록과 멤버 관리

1. A에 새 버전을 사용자가 설치·빌드·적용한다. `./mew setup`의 원격 접속 안내에서 `account`를 선택하거나, 나중에 `./mew remote-access account`로 같은 안내를 확인한다. 기존 Tunnel/Tailscale은 기존 네트워크 설정을 사용한다.
2. A의 로컬 UI에 owner로 로그인하고 임시 비밀번호를 먼저 바꾼다. 메뉴 → **계정 관리 → 원격 접속 → 기기 등록**을 누른다. CLI는 자격증명을 받거나 owner 인가를 대신하지 않는다.
3. 표시된 일회용 URL을 열어 중앙에 로그인하고 1–48자의 영문/숫자/하이픈/밑줄 기기 이름을 정한다. 등록 URL은 5분 안에 사용한다.
4. A에서 등록 완료와 온라인 상태를 확인한다. 중앙 `/dashboard`와 `/<중앙 계정 ID>/<기기 이름>`에서 접속한다. 접속 브라우저는 등록하지 않는다.
5. 허용할 멤버가 먼저 중앙에 로그인한다. 대시보드 헤더의 자신의 이름을 눌러 중앙 계정 ID를 복사한다. A의 owner가 **멤버 접근**에서 이 ID와 이미 생성한 로컬 계정을 연결한다. 로컬 역할·기능·파일 범위를 별도로 승인한다.
6. 멤버 회수는 A에서 수행한다. 중앙 기기 삭제는 중앙 owner의 대시보드 또는 A의 로컬 등록 해제로 수행한다. 중앙에서 삭제한 A는 로컬에 남은 등록도 해제한 뒤 다시 등록한다. 중앙 반영 오류가 난 로컬 폐기는 대시보드에서 남은 등록을 삭제한다.

A의 중앙 주소를 바꾸려면 A의 기존 설정에 `MEW_REMOTE_ORIGIN`을 넣고 사용자가 서버에 적용한다. 기본은 `https://mew.saens.kr`이다. 이미 등록된 A는 저장한 origin·키를 사용하므로 주소 변경은 등록 해제·재등록으로 처리한다. A의 HTTP 포트와 `MEW_BIND=127.0.0.1`은 유지할 수 있다. 앱용 `node-datachannel`은 선택 의존성이며 설치 불가 시 원격 연결에 구성 요소 오류를 표시하고 기존 로컬 앱은 유지한다.

## 운영 전 확인

실제 Google/Apple/GitHub/이메일 OIDC 로그인·callback·세션 회수, A 재시작/키 분실/폐기/재등록, 멤버 회수·중앙 단절, 실제 Windows/WSL·Mac/Linux ↔ Android/PC 외부망을 확인해야 한다. 직접 경로가 없는 NAT/UDP 차단망에서는 실패할 수 있고 TURN·작업 데이터 중계로 대체하지 않는다. 외부망 성공률·지원 OS/브라우저·개인정보 안내·복구/키 운영·보안 검토가 끝나기 전에는 일반 출시 완료로 표시하지 않는다.

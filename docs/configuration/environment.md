---
title: "서버 환경변수와 CLI 설정"
description: "호스트의 설정 파일 우선순위·환경변수·데이터 위치·Mewlink origin, 자체 GitHub OAuth 앱과 사전 빌드 CLI 옵션을 안내한다. 화면과 계정 조작은 각 설정 문서가 소유한다."
updated: "2026-10-22"
상위파일: "MOC.md"
---

# 서버 환경변수와 CLI 설정

호스트 운영자가 설정 파일과 실행 옵션을 바꿀 때 읽는다. [설치·실행](../guides/getting-started-ko.md), [화면·알림·단축키](appearance.md), [계정·권한 관리](accounts.md)는 각 안내를 따른다.

## 서버 설정

서버 설정 파일은 Linux·macOS에서 `~/.config/mew/config.env`(`XDG_CONFIG_HOME` 존중), Windows 네이티브에서 `%LOCALAPPDATA%\mew\config\config.env`다. 소스 설치는 이어서 저장소의 `.env`도 읽는다. `server/config.ts`가 `process.loadEnvFile()`로 읽으므로 **명시한 프로세스 환경변수 → config.env → 저장소 .env** 순으로 기존 값이 우선한다. `.env`는 앞에서 정하지 않은 값을 보충하며 이미 설정한 값을 덮지 않는다.

읽는 순서와 기본 경로는 `server/config.ts` 한 곳이 정한다. **서버 진입점에서 다른 서버 모듈보다 먼저 import해야 한다.** 뒤로 밀리면 `MEW_DATA_DIR` 같은 값을 다른 모듈이 먼저 읽어 설정 파일의 값이 반영되지 않을 수 있다.

| 변수 | 기본값 | 무엇 |
| --- | --- | --- |
| `MEW_WORKSPACE` | 앱 폴더의 부모 | 프로젝트들이 사는 폴더. `server/paths.ts`의 `WORKSPACE_ROOT`를 고정 경로로 되돌리지 않는다 — 앱과 워크스페이스를 분리해야 다른 폴더·다른 서버에 안전하게 배포할 수 있다 |
| `MEW_GITHUB_CLIENT_ID` | 내장 Mew OAuth 앱 | 자체 GitHub OAuth 앱 Client ID로 교체하는 선택 설정. 미설정·빈 값·공백은 기본 앱 사용 |
| `MEW_DATA_DIR` | Linux·macOS: `~/.local/share/mew`(`XDG_DATA_HOME` 존중), Windows: `%LOCALAPPDATA%\mew\data`. 옛 설치의 `<앱>/.data`가 있으면 우선 사용 | 계정·세션·기능/파일 권한·아이콘 |
| `MEW_AGENT_MEMORY_SCOPE` | `auto` | 설치된 systemd slice에 ACP·CLI 작업 메모리 제한 적용. `required`는 미설치 시 실행 거부, `off`는 OS 제한만 해제. [설치·메모리 보호](../operations/agent-memory.md) |
| `MEW_REMOTE_ORIGIN` | `https://mew.run` | 새 원격 등록에 사용할 중앙 HTTPS origin. 등록 후에는 저장된 origin을 사용한다. 기존 `mew.saens.kr` 등록은 중앙의 허용된 이전 origin 지원으로 유지한다. 임의 서비스로 변경하려면 등록을 해제한 뒤 다시 등록한다. [중앙 서비스 운영](../deployment/remote-central.md) |
| `MEW_TEAM_PORT` | 5000 | 서버 포트 |
| `MEW_DESKTOP_HELPER_DIR` | 프로젝트의 `native/remote-desktop`, WSL은 Windows LocalAppData의 `Mew/remote-desktop` | [원격 데스크톱 보조 앱](../guides/remote-desktop.md) 설치 경로. WSL은 Windows 절대 경로 |
| `MEW_DESKTOP_ICE_SERVERS` | `[{"urls":["stun:stun.l.google.com:19302","stun:stun.cloudflare.com:3478"]}]` | WebRTC 주소 발견용 STUN JSON 배열. `[]`로 외부 조회 비활성화. TURN·영상 중계는 지원하지 않으며 NAT/방화벽에 따라 직접 연결이 불가능할 수 있음 |
| `MEW_DESKTOP_AUTO_NAT` | `1` | 활성 직결이 지연되면 OS 기본 게이트웨이의 PCP/NAT-PMP/UPnP 임시 UDP 매핑을 시도. `0`으로 비활성화. [수명·OS 네트워크 승인](../development/remote-desktop-connectivity.md) |
| `MEW_DESKTOP_UDP_PORT` | 자동 선택 | Windows/WSL·Mac·Linux 네이티브 호스트의 고정 UDP 포트(1024–65535). 운영자 선택 설정. 기본 연결은 포트 지정 없이 STUN과 짧은 자동 NAT 매핑을 사용함 |
| `MEW_BIND` | `127.0.0.1` | 서버가 들을 주소. 공개 기본값은 loopback이며, LAN 직접 접속이 꼭 필요할 때만 노출 주소를 명시한다. 서버 배포는 HTTPS 프록시·터널 뒤 `127.0.0.1`로 유지한다 |
| `MEW_COLLAB_RUST` | 없음(=JS Yjs) | `1`이면 협업 방 상태를 Rust(yrs)로 — 먼저 `npm run build:native` ([협업 방](../development/collaboration.md)) |
| `DATABASE_URL` | 없음 | `/db`용 Postgres. 없거나 접속 불가면 `/db` API만 503 |

전부 선택이다 — 하나도 없어도 뜬다. 지금 값이 어디서 오는지는 `./mew status`.

중앙 mewlink는 로컬 A와 별도 Cloudflare Worker이며 자체 vars·secret·OAuth 자격증명을 사용한다. 로컬 GitHub Device Flow 설정과 공유하지 않는다. 전체 중앙 설정은 [중앙 서비스 운영](../deployment/remote-central.md)을 따른다.

## GitHub OAuth 연결

Mew는 공개 Client ID를 코드에 포함하므로 기본 설치에는 OAuth 앱 등록이나 환경변수 설정이 필요 없다. 각 사용자는 GitHub 로그인에서 자기 계정으로 승인한다. 토큰은 설치 서버에 계정별로 저장하며 앱 소유자의 계정 권한을 공유하지 않는다.

자체 앱을 쓰려면 GitHub Settings → Developer settings → OAuth Apps에서 등록하고 **Enable Device Flow**를 켠다. 등록 화면의 URL 필드는 실제 서비스 주소로 채우지만 현재 기기 코드 흐름은 callback을 사용하지 않는다. 레포 밖 서버 설정에 `MEW_GITHUB_CLIENT_ID=발급된_ID`를 넣고 사용자가 서버를 재시작하면 기본 앱을 대체한다. 앞뒤 공백은 제거하며 미설정·빈 값·공백은 내장 앱을 사용한다. Client secret은 사용하지 않는다. 기본값 구현은 `server/git-providers.ts`가 소유한다.

앱은 `repo read:user` 범위를 요청한다. 회사/조직 저장소는 별도 앱 승인과 SSO가 필요할 수 있다. 토큰 만료·승인 철회 시 재로그인하며 OS의 기존 로그인으로 대체하지 않는다. 기본 앱도 GitHub의 앱 단위 인증 제한을 받는다. 실제 앱 승인·Device Flow 활성화 여부는 사용자 확인 대상이다.

사용법은 [GitHub 로그인](../guides/projects.md#github-로그인), 키·암호문 백업과 저장 경계는 [Git 연결 계약](../development/git-connections.md)을 따른다.

## 사전 빌드 CLI 설정

[CLI 배포 계약](../development/cli-distribution.md)은 기존 config.env·명시 환경변수의 데이터 경로를 재사용한다. `--data-dir`·`--port` 등 명시 옵션이 우선하며 작업 폴더는 현재 폴더 또는 `--workspace`이다. 기존 clone 내부 `.data/`는 `--data-dir`로 지정한다. `MEW_DISTRIBUTION=release`는 런처가 내부적으로 설정하며 source 업데이트·빌드·재시작과 번들 tmux 개별 업데이트를 차단한다. 최초 발행 전의 npm 명령은 아직 공개 설치 경로가 아니다.

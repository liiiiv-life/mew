---
title: "CLI 릴리스와 npm 발행"
description: "s-saens/mew의 Linux·macOS·Windows x64/arm64 실행본과 고정 tmux·psmux·Job Object helper, 체크섬·제3자 고지·Windows CI 검증 및 @liiiiv/mew-cli의 npm 발행·저장소 이전 후 OIDC 설정·업데이트 절차를 안내한다. Mew 자체 라이선스 사본·메타데이터·npm 동봉 검사도 포함하며, 첫 공개 발행과 전체 플랫폼 실기는 아직 수행하지 않았다."
updated: "2026-10-23"
상위파일:
  - "native.md"
  - "../development/cli-distribution.md"
---

## 배포 구성

사용 계약은 [CLI 배포 계약](../development/cli-distribution.md)을 따른다. GitHub 실행본은 `s-saens/mew`에 게시한다. root 앱은 개발용 private workspace로 유지하고, `apps/cli/`만 `@liiiiv/mew-cli` npm 패키지로 발행한다. GitHub 소유자 이전으로 npm 스코프나 패키지 이름이 바뀌지는 않는다. 다른 프로젝트가 이미 사용 중인 unscoped `mew-cli` 이름을 사용하지 않는다. npm `@liiiiv` scope의 관리 권한과 최초 패키지 생성은 실제 발행 담당자가 확인한다.

`server/release-runtime.ts`는 사전 빌드된 `dist/`와 서버·공유 소스·workspace 패키지를 독립 임시 폴더로 준비한다. TypeScript를 JS로 변환하고 relative import, child worker 경로, package exports, JSON import attribute를 보정한다. 별도 production 의존성 설치 뒤 node-pty와 node-datachannel을 실제 로드하고 tmux helper·공유 패키지 import를 확인한다. oxlint는 서버의 코드 검사 기능이 사용하므로 production 의존성이다.

공식 [tmux-builds v3.7c](https://github.com/tmux/tmux-builds/releases/tag/v3.7c)의 OS별 바이너리를 고정 SHA-256으로 검사하고 `bin/tmux`로 포함한다. Linux 바이너리는 upstream static build, macOS 바이너리는 system library 의존성만 허용한다. upstream 라이선스 archive와 sources·출처·해시는 `notices/tmux/`에 함께 보존한다. npm 의존성의 자체 라이선스 파일도 runtime node_modules에 유지한다.

Windows 실행본은 [psmux v3.4.0](https://github.com/psmux/psmux/releases/tag/v3.4.0)의 x64/arm64 zip을 고정 SHA-256으로 검증해 `bin/psmux.exe`만 복사한다. `native/windows/process-host.cpp`는 MSVC로 컴파일해 실행본에 포함한다. `notices/psmux/`에는 체크섬을 고정한 MIT 원문·수정된 crate 고지·Cargo.lock과, locked 의존성 247개의 원문 고지가 들어 있는 전체 `.crate` 소스 압축본을 보존한다. `dependencies.json`은 선언된 라이선스와 선택한 허용 라이선스·출처·해시를 기록하며, 검토 목록에서 선택할 수 없는 라이선스는 패키징을 중단한다.

Windows 내부 workspace 링크는 압축본에 symlink를 넣는 대신 `runtime-links.json`에 기록한다. CLI가 검증된 `packages/` 대상만 관리자 권한 없이 junction으로 복원한다. 전체 설계·현재 검증 범위는 [Windows 네이티브 계약](../development/windows-native.md)을 따른다.

원격 데스크톱의 설치 스크립트·프로토콜 원본은 포함하지만 Electron·캡처 바이너리·브라우저 다운로드·OS 권한 준비는 선택 기능의 기존 설치 경로에 맡긴다. `.env`·`.data`·숨김 상태·test fixture·로컬 native build 결과를 릴리스에 넣지 않는다. Mewlink 중앙의 비공개 소스도 포함하지 않는다.

## 라이선스 동봉

Mew 자체 신규 배포는 [Mew Source Available License 1.0](../../LICENSE)을 따른다. 개인·회사 내부 사용과 결과물 판매는 허용하지만, Mew·수정본 판매와 유료 호스팅·SaaS 제공은 별도 서면 허락 없이 금지한다. 상세 범위와 기존 MIT 허여는 [결정 0053](../decisions/0053-source-available-license.md), 외부 기여 권한은 [기여 수락 기준](../development/contributing.md)을 따른다.

발행 전 루트 `LICENSE`, `apps/cli/LICENSE`, `native/remote-desktop/LICENSE` 전문이 같은지 확인한다. 이 세 패키지의 package.json과 각 lockfile의 자체 패키지 항목은 `SEE LICENSE IN LICENSE`를 사용한다. CLI npm 패키지에는 `LICENSE`와 `README.md`가 들어가야 하며 `npm pack --dry-run --ignore-scripts`로 확인한다. 실행본 패키징은 루트 LICENSE를 복사한다. 제3자 구성 요소의 개별 라이선스·고지·대응 소스 의무는 그대로 유지하며 이 제한형 라이선스로 대체하지 않는다.

## 자동 릴리스

`.github/workflows/cli-release.yml`은 다음 순서로 실행한다.

1. `apps/cli/package.json` 버전과 `mew-cli-v<버전>` 태그를 대조한다.
2. Linux Ubuntu 22.04 x64/arm64, macOS 15 x64/arm64, Windows Server 2025 x64·Windows 11 arm64에서 Node.js 24를 사용한다. 의존성 설치·격리 테스트·앱 빌드·플랫폼별 패키징을 수행한다. Windows에는 MSVC 환경을 준비하고 패키징 뒤 `release-windows-verify.ts`로 실제 junction 추출, Job Object·psmux·ConPTY fixture와 컴파일된 host의 별도 workspace 시작·인증·HTML 응답·종료를 검사한다. 생성된 `mew-runtime-<OS>-<arch>.tar.gz`와 개별 `.sha256`을 Actions artifact로 보관한다.
3. 태그 실행만 보호 환경 `cli-release`를 통과한 뒤 GitHub Release에 실행본 6개와 `SHA256SUMS`를 게시한다. 기존 버전의 실행본을 덮어쓰지 않는다.
4. npm 발행은 일치하는 태그를 선택한 `workflow_dispatch`에서 `publish_npm=true`를 지정한다. 이미 게시된 runtime 6개와 전체 체크섬을 검증한 후 보호 환경 `npm-publish`에서 npm 발행을 진행한다. release cache 버전은 변경하지 않는다.

저장소 설정에서 두 environment의 검토자를 지정한다. workflow는 `${{ github.repository }}`로 현재 저장소를 사용한다. 이전 후에는 [저장소 이전 점검](../operations/project-location.md#github-소유자-이전)에 따라 두 environment의 검토자·허용 태그·보호 규칙과 조직에서 제공하던 설정을 확인한다. 앱 빌드·배포를 금지한 [에이전트 실행 규칙](../development/getting-started.md)은 유지되며, 에이전트가 태그 push·workflow 실행·배포를 대신 수행하지 않는다.

## 최초 발행과 다음 버전

최초 발행은 담당자의 npm 계정에서 scope 권한을 확인하고 진행한다. 먼저 runtime 태그 릴리스를 만든 뒤 `apps/cli/`에서 패키지 목록을 검토하고 발행한다.

```bash
# 발행 담당자가 실행. 앱 빌드는 release CI에서 이미 완료되어 있어야 한다.
cd apps/cli
npm ci
npm test
npm pack --dry-run
npm publish --access public
```

npm 패키지 설정의 Trusted publisher에 GitHub 조직/사용자 `s-saens`, 저장소 `mew`, workflow 파일 `cli-release.yml`, environment `npm-publish`를 등록한다. 이전 소유자로 등록한 설정이 있다면 삭제 후 새로 만든다. 현재 workflow가 쓰는 직접 `npm publish`를 허용하고 발행 직전에 설정한다. 새 설정은 등록 후 2일 안에 첫 발행을 완료해야 한다. `apps/cli/package.json`의 `repository.url`도 새 저장소와 일치해야 한다. 이후 발행은 workflow의 OIDC를 사용하며 장기 npm token을 레포에 넣지 않는다. [공식 npm trusted publishing 안내](https://docs.npmjs.com/trusted-publishers/).

다음 버전에서는 CLI package version과 해당 lockfile의 root version을 함께 갱신하고 일치하는 새 태그로 실행본을 만든다. npm 패키지의 버전과 runtime 태그는 항상 대응해야 한다. 사용자 업데이트는 CLI를 종료하고 작업 폴더에서 `npx @liiiiv/mew-cli@latest` 재실행이다. 이전 버전은 `npx @liiiiv/mew-cli@<버전>`으로 선택할 수 있지만 영구 데이터 schema의 역호환은 별도 확인해야 한다.

## 발행 게이트

- 여섯 환경의 실제 네이티브 모듈 import와 `tmux -V` 또는 `psmux -V`, runtime relative import·링크 검사를 통과한다. Windows 두 아키텍처의 Job Object·CMD shim·psmux attach·출력 저장/취소·compiled host fixture도 통과해야 한다.
- 배포 파일에 개인 데이터·시크릿·비공개 중앙 소스가 없고 native 재배포 고지가 포함됐는지 확인한다.
- 각 지원 OS의 빈 작업 폴더에서 새 owner 생성·비밀번호 변경·편집·터미널·재실행과 계정/기기 등록 보존을 실제 확인한다. 현재 구현 작업의 fixture 검증은 이 실기 검증을 대신하지 않는다.
- Mewlink 첫 등록과 온라인 QR, 외부 브라우저의 로컬 로그인·편집·터미널을 확인한다. 다른 NAT·모바일망 및 원격 데스크톱은 [기존 원격 검증 범위](../development/remote-access.md#검증과-남은-게이트)를 따른다.

현재 코드와 격리 검증은 준비됐으며 실제 CI build, GitHub Release, npm package 최초 발행과 위 실기 확인은 미수행이다.

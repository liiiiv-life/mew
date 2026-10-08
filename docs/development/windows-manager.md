---
title: "Windows 관리 앱 빌드·검증"
created: 2026-10-07
updated: 2026-10-07
description: "mewnager 독립 apps/manager Tauri 앱의 프런트엔드·Rust·PowerShell·GUI·승격 오류 전달 검증, Windows 및 Linux 교차 exe 생성과 CI 산출물·실기 검증 경계를 설명한다."
---

제품 동작·UI·실행 경계는 [기능 문서](../features/화면·계정·운영/Windows%20설치·관리%20앱.md), 사용자 설치는 [사용법](../guides/windows-manager.md), 플랫폼 선택은 [ADR 0201](../../../.mew/docs/decisions/0201-mew-windows-manager-wsl.md)이 소유한다.

## 독립 빌드

`apps/manager`는 본 앱과 다른 npm 프로젝트다. React/TypeScript 화면을 자체 `dist/`에 만들고 Tauri/Rust가 포함해 GUI PE exe를 생성한다. 본 mew의 `dist/`나 실행 중인 서버를 바꾸지 않는다. 기본 Windows 창 1160×820, 최소 760×620이며 WebView2를 사용한다.

Windows 빌드 기기는 Node 24, Rust stable(1.90 이상)의 MSVC 툴체인, Visual Studio Build Tools의 Desktop development with C++/Windows SDK가 필요하다. 공식 [Tauri Windows 빌드 안내](https://v2.tauri.app/distribute/windows-installer/)를 따른다.

저장소 루트에서:

```powershell
npm ci --prefix apps/manager
npm run exe --prefix apps/manager
```

결과는 `apps/manager/src-tauri/target/x86_64-pc-windows-msvc/release/mewnager.exe`다. `--no-bundle`로 MSI/NSIS 설치기를 만들지 않는다. `npm run package --prefix apps/manager`는 배포 폴더에 `mewnager-<버전>-windows-x64` 이름의 exe·고지문·SHA-256·zip을 모은다. WebView2는 exe에 번들하지 않으며 실행 기기에 필요하다. 코드 서명은 현재 포함하지 않는다.

`.github/workflows/manager-windows.yml`은 Windows 빌드와 검사 후 위 파일을 Actions 아티팩트로 올린다. 앱 소스·공유 폰트/마크·워크플로 변경 또는 수동 실행을 대상으로 한다. 리포지토리에 exe/target/dist/node_modules를 커밋하지 않는다. mewnager 버전은 npm package와 Tauri config, Cargo package에서 함께 갱신한다.

## 검증

```bash
npm run build --prefix apps/manager
npm test --prefix apps/manager
cargo test --manifest-path apps/manager/src-tauri/Cargo.toml
pwsh -NoProfile -File apps/manager/tests/windows.ps1
bash -n apps/manager/src-tauri/scripts/install.sh
```

GUI 테스트에는 Chromium이 필요하다. `apps/manager`에서 `npx playwright-core install chromium`을 실행하거나 `MEW_MANAGER_CHROMIUM`으로 설치된 실행 경로를 지정한다. 없으면 GUI 테스트만 skip한다. CI에서는 브라우저를 준비한다. GUI fixture는 Windows IPC를 모의하며 OS 작업을 실행하지 않는다. screenshots 환경 변수 `MEW_MANAGER_SCREENSHOTS`는 절대 경로를 사용한다. 캡처에는 테스트 데이터라는 표시를 넣고 `artifacts/` 등 무시된 경로에 저장한다.

PowerShell 회귀 검사는 WSL 도움말 옵션 선택·UTF-8/UTF-16 출력·signed 실패 코드와 원문 보존·생성된 자식 wrapper를 확인한다. Windows에서는 UAC 호출만 모의해 부모의 로그 전달·재부팅 코드·임시 결과 정리도 검사한다. 실제 선택 기능 활성화/WSL 설치는 실행하지 않는다. `tests/windows.ps1`은 Windows PowerShell 5.1을 위해 UTF-8 BOM을 사용하고 스크립트 소스를 명시적으로 UTF-8로 읽는다.

브라우저에서 UI만 확인하려면 `npm run dev --prefix apps/manager`를 사용한다(127.0.0.1:1420). 명시적 미리보기 안내와 비활성 설치 조작이 표시된다. 사용자 실행 파일의 설치 가능 상태를 위조하지 않는다.

## Linux에서 Windows exe 교차 빌드

[Tauri의 MSVC 교차 빌드 경로](https://v2.tauri.app/distribute/windows-installer/#cross-compilation)는 cargo-xwin·clang·LLD·llvm-rc가 필요하다.

```bash
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
npm ci --prefix apps/manager
npm run tauri --prefix apps/manager -- build --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle
npm run package --prefix apps/manager
```

PATH에서 clang/llvm-rc/lld-link를 찾을 수 있어야 한다. cargo-xwin은 Microsoft SDK/CRT를 별도 캐시에 준비한다. Microsoft CRT의 PDB 부재 경고는 Linux 교차 링크 시 디버그 심볼 경고이며 배포 exe 생성 실패와 구분한다. Windows의 기본 `npm run exe`는 cargo-xwin을 요구하지 않는다.

## Windows 수락 확인

Linux 검사는 Windows에서의 UAC·선택 기능·실제 WSL 등록·localhost 전달을 대신하지 않는다. 2026-10-07 Windows 호스트 연동으로 PowerShell 5.1 검사·WSL 상태 조회·최종 exe의 WebView2 시작과 네이티브 IPC/화면 로딩을 확인했다. 전체 신규 설치는 아직 검증하지 않았다. 실기 검증은 기존 배포판을 보존한 별도 Windows VM/기기에서 다음을 확인한다.

1. WSL 미설치·지원하지 않는 Windows·가상화 비활성·같은 이름의 다른 배포판의 상태/오류.
2. 일반 사용자 앱 → 필요한 단계 UAC → 재부팅 → 같은 exe로 재개.
3. Ubuntu checksum/import·root 도구 준비·mew 사용자 clone/setup·최초 owner 로그인.
4. 중단·네트워크 실패 후 복구, 공백 경로, 손상된 관리 설정.
5. 서버 시작·창 닫은 후 유지·다시 열어 조회·중지·재부팅 후 수동 시작.
6. clean main 업데이트, dirty/ahead/non-main 차단, 다운로드/빌드 실패 출력과 재시도.
7. 원래 Ubuntu·기본 배포판·다른 서버 유지, 비밀번호가 작업 로그/설정에 없음.

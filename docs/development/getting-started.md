---
title: "Development setup and rules"
created: 2026-09-29
updated: 2026-10-22
description: "개발 명령과 저장소 내부 문서 검사·CLI 및 Postgres 격리 테스트·타입·테스트·린트 검증, 에이전트의 빌드·서버 실행 제한, 브랜치 미리보기와 별개인 문서 소유권·갱신 및 필수 UI 구현 규칙을 정한다."
상위파일:
  - "../MOC.md"
  - "MOC.md"
---

[Installation and usage](../guides/getting-started-en.md)

Run commands from the repository root:

```bash
npm run dev     # Vite development server with HMR, port 4999
npm run build   # TypeScript checks + Vite build into dist/
npm run serve   # Serve dist/, default port 5000
npm start       # Build and serve
npm test        # node:test
npm run test:cli # standalone launcher fixtures, no app server or bundle build
npm run lint    # oxlint
npx tsc -b      # Type-check without building the app bundle
```

The server serves `dist/` directly. Building changes what a running instance serves; it is not an isolated validation step. Keep the development server private.

Mew owns its development rules, documentation, and decision records. Run documentation checks from the repository root without another workspace's scripts or hooks:

```bash
npm run check:docs
```

This checks descriptions, including history, and local links within the repository. MOC registration is optional. Repair existing links when files move. New decisions belong in [Mew's decision records](../decisions/README.md); imported decisions remain in history. If this clone still has a Liiiiv shared hook configured, remove that local setting with `git config --local --unset core.hooksPath`.

**Coding agents must not run** `mew`**, build, deploy, or restart the server.** This includes `npm run build`, `npm start`, `./mew start|stop|restart|update`, killing server processes, and starting them in the background. Agents may run checks that leave the running instance alone, such as `npm test`, `npm run lint`, and `npx tsc -b`. The user runs builds and applies changes.

Browser tests under `server/` use the Node.js TypeScript configuration, which excludes DOM globals. For DOM operations in Playwright callbacks, use `locator.evaluate` and its element argument (or `el.ownerDocument`) instead of directly referencing `document`.

If a file edited from the terminal reverts unexpectedly, an open mew editor may have saved an older copy over it. Check the file again, then ask the user to close that editor or use **Revert File**.

For feature work, select the owning current document from its frontmatter `description` using `node server/document-descriptions.ts`. Follow the [documentation rules](../README.md); MOC registration is optional. **Features** in the dock displays local branch work and preview links; feature documents remain in Documents. Keep the feature's scope, detailed behavior, implementation notes, and acceptance criteria in the owning feature document; update linked shared contracts when they change. Follow the [feature documentation rules](../features/README.md). Preview links do not build or start an app, and they do not change the execution restrictions above.

### Required UI rules

**Keep working UI compact.** Avoid decorative whitespace, stacked container padding, and unnecessary minimum heights. Reduce outer spacing before shrinking readable text or usable click/touch targets. Follow the [spacing and information density rules](ui-contracts.md#디자인-지침-여백과-정보-밀도).

**Prefer icon buttons for familiar actions.** Close, refresh, copy, cancel, and disconnect controls should normally use the established icon set with a translated accessible name and a shared tooltip. Keep short text where an icon alone makes the primary action or its consequences unclear. Use small padding and gaps by default; see the [UI button and spacing contract](ui-contracts.md#디자인-지침-여백과-정보-밀도).

**Do not add permanent instructions, shortcut hints, or explanatory copy that repeats what the interface already makes clear.** Use the button or field label when it is enough. Show additional information where it helps someone decide or recover from an error. See [UI copy](ui-contracts.md#%ED%99%94%EB%A9%B4-%EB%AC%B8%EA%B5%AC).

**Do not use native** `<select>` **or** `<datalist>` **popups for app-owned choices.** Reuse an existing custom component, or create a shared one if none fits. Changing a native control's border or `appearance` does not satisfy this rule. It applies on desktop and mobile, including when modifying an existing native dropdown.

Prefer `SelectField` from `@mew/ui` for single-choice fields. Follow the [selection component contract](ui-contracts.md#%EB%93%9C%EB%A1%AD%EB%8B%A4%EC%9A%B4%EA%B3%BC-%EC%84%A0%ED%83%9D-%EC%BB%B4%ED%8F%AC%EB%84%8C%ED%8A%B8) for themes, keyboard and touch input, focus, Esc/Back dismissal, and viewport boundaries.

### Postgres 데이터베이스 검증

DB 서비스·라우트·행 페이지 통합 테스트는 `MEW_DB_TEST_DATABASE_URL`로 명시한 격리 테스트 DB만 사용한다. 일반 실행 환경의 `.env`나 `DATABASE_URL`을 자동 사용하지 않으며 전용 URL이 없으면 건너뛴다. 테스트는 임시 프로젝트·스키마를 만들고 종료 시 정리한다. 운영 DB URL을 지정하지 않는다.

```bash
MEW_DB_TEST_DATABASE_URL='<격리 테스트 DB URL>' node --test server/db/databaseService.test.ts server/db/routes.test.ts server/db/rowPages.test.ts
```

### CLI 릴리스 검증

사전 빌드 런처의 기준은 [CLI 배포 계약](cli-distribution.md)·[릴리스 절차](../deployment/cli-release.md)다. `npm ci --prefix apps/cli --ignore-scripts`와 `npm run test:cli`, `node --test server/cli-host.test.ts server/instance-lock.test.ts server/release-runtime.test.ts server/mew-release-actions.test.ts`는 실제 서버·dist를 바꾸지 않는 격리 검사다. `npm run release:runtime -- --output <폴더>`는 이미 빌드된 dist와 플랫폼별 네이티브 의존성을 패키징하는 발행 담당자/CI 명령이며 에이전트의 앱 빌드·배포·재시작 금지 규칙을 변경하지 않는다.

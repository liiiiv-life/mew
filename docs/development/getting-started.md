---
title: "Development setup and rules"
created: 2026-09-29
updated: 2026-10-03
---

# Development

[Document map](../MOC.md) · [Development docs](MOC.md) · [Installation and usage](../guides/getting-started-en.md)

Run commands from the repository root:

```bash
npm run dev     # Vite development server with HMR, port 4999
npm run build   # TypeScript checks + Vite build into dist/
npm run serve   # Serve dist/, default port 5000
npm start       # Build and serve
npm test        # node:test
npm run lint    # oxlint
npx tsc -b      # Type-check without building the app bundle
```

The server serves `dist/` directly. Building changes what a running instance serves; it is not an isolated validation step. Keep the development server private.

**Coding agents must not run** `mew`**, build, deploy, or restart the server.** This includes `npm run build`, `npm start`, `./mew start|stop|restart|update`, killing server processes, and starting them in the background. Agents may run checks that leave the running instance alone, such as `npm test`, `npm run lint`, and `npx tsc -b`. The user runs builds and applies changes.

Browser tests under `server/` use the Node.js TypeScript configuration, which excludes DOM globals. For DOM operations in Playwright callbacks, use `locator.evaluate` and its element argument (or `el.ownerDocument`) instead of directly referencing `document`.

If a file edited from the terminal reverts unexpectedly, an open mew editor may have saved an older copy over it. Check the file again, then ask the user to close that editor or use **Revert File**.

For feature work, start with the [feature map](../features/MOC.md), also available through **Features** in the dock in the mew project. Update the feature's scope, implementation notes, and acceptance criteria together with its linked detailed documentation. Follow the [feature documentation rules](../features/README.md).

### Required UI rules

**Keep working UI compact.** Avoid decorative whitespace, stacked container padding, and unnecessary minimum heights. Reduce outer spacing before shrinking readable text or usable click/touch targets. Follow the [spacing and information density rules](ui-contracts.md#디자인-지침-여백과-정보-밀도).

**Prefer icon buttons for familiar actions.** Close, refresh, copy, cancel, and disconnect controls should normally use the established icon set with a translated accessible name and a shared tooltip. Keep short text where an icon alone makes the primary action or its consequences unclear. Use small padding and gaps by default; see the [UI button and spacing contract](ui-contracts.md#디자인-지침-여백과-정보-밀도).

**Do not add permanent instructions, shortcut hints, or explanatory copy that repeats what the interface already makes clear.** Use the button or field label when it is enough. Show additional information where it helps someone decide or recover from an error. See [UI copy](ui-contracts.md#%ED%99%94%EB%A9%B4-%EB%AC%B8%EA%B5%AC).

**Do not use native** `<select>` **or** `<datalist>` **popups for app-owned choices.** Reuse an existing custom component, or create a shared one if none fits. Changing a native control's border or `appearance` does not satisfy this rule. It applies on desktop and mobile, including when modifying an existing native dropdown.

Prefer `SelectField` from `@mew/ui` for single-choice fields. Follow the [selection component contract](ui-contracts.md#%EB%93%9C%EB%A1%AD%EB%8B%A4%EC%9A%B4%EA%B3%BC-%EC%84%A0%ED%83%9D-%EC%BB%B4%ED%8F%AC%EB%84%8C%ED%8A%B8) for themes, keyboard and touch input, focus, Esc/Back dismissal, and viewport boundaries.

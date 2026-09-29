# mew

## Quick start

[Windows (WSL 2)](#windows-wsl-2) · [macOS](#macos) · [Linux](#linux)

### Windows (WSL 2)

Run mew inside Ubuntu on WSL 2, then open it in your Windows browser.

**1. Install WSL and Ubuntu.** Open PowerShell as administrator and run:

```powershell
wsl --install -d Ubuntu
```

Restart Windows, open **Ubuntu** from the Start menu, and create a Linux username and password. This is a separate account from your Windows login. The command requires Windows 11 or Windows 10 version 2004 (build 19041) or later. See [Microsoft's WSL installation guide](https://learn.microsoft.com/en-us/windows/wsl/install) if installation fails.

If you already have Ubuntu installed, check it from PowerShell with `wsl -l -v`. If its version is `1`, run `wsl --set-version Ubuntu 2`, using the distribution name shown in the list.

**2. Install mew.** Run these commands in **Ubuntu**:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential python3 tmux
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/liiiiv-life/mew.git
cd mew
./mew setup
```

Accept the offer to install Node with nvm if prompted. Keep the repository and your projects in the Linux filesystem, such as `~/apps` and `~/mew-workspace`, for better performance with Linux tools. You can open the current folder in Windows Explorer with `explorer.exe .`. See [Microsoft's WSL file storage guidance](https://learn.microsoft.com/en-us/windows/wsl/setup/environment#file-storage).

**3. Sign in.** Follow the [setup prompts below](#finish-setup), then open the printed URL in Edge, Chrome, or another Windows browser. It is usually `http://localhost:5000`; [WSL forwards localhost access from Windows](https://learn.microsoft.com/en-us/windows/wsl/networking#accessing-linux-networking-apps-from-windows-localhost).

### macOS

**1. Install Apple's command line tools.** Open Terminal and run:

```bash
xcode-select --install
```

Wait for the installation window to finish. If the tools are already installed, continue.

**2. Install Homebrew and the required tools.** If `brew` is not installed, run the command from [Homebrew](https://brew.sh/):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the installer's **Next steps** to add Homebrew to your shell, then run:

```bash
brew install tmux python
```

**3. Install mew.** In the same Terminal window:

```bash
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/liiiiv-life/mew.git
cd mew
./mew setup
```

Accept the offer to install Node with nvm if prompted. Follow the [setup prompts below](#finish-setup), then open the printed URL in your browser.

Setup also prepares the remote desktop helper. On the Mac running mew, approve **Accessibility** and **Screen Recording** for Electron when System Settings opens. Setup continues once it detects the permissions. See [Mac permission setup](docs/guides/remote-desktop.md#mac-권한-준비) for details.

### Finish setup

The installer asks for:

- **Workspace folder:** the parent folder of your projects. The default is `~/mew-workspace`; each folder inside it becomes a project.
- **Port:** `5000` by default. If it is busy, setup chooses an available port nearby.
- **Postgres connection:** optional, for database tables. You can skip it and add it later.
- **Owner email:** your first mew account. Setup prints a temporary password.

Setup installs dependencies, prepares remote desktop components, builds the app, and starts the server. The first download can take a few minutes. A remote desktop preparation failure is reported as a warning and does not stop the rest of the installation.

Open the URL printed by setup, sign in, and change the temporary password. Use **+** in the header to open a project folder, then select a file in the sidebar.

After a reboot, open Ubuntu or Terminal and start mew from its installation folder:

```bash
cd ~/apps/mew
./mew start
```

### Linux

On Debian or Ubuntu:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential python3 tmux
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/liiiiv-life/mew.git
cd mew
./mew setup
```

On other distributions, install the equivalent packages first. Follow [Finish setup](#finish-setup) above. For a server that should start on boot or accept remote connections, use the [deployment guide](docs/deployment/native.md).

## What is mew?

mew opens folders on your computer or server in a browser. Edit Markdown and code, run a terminal, work with AI agents, review Git changes, and share a document with someone else without leaving the workspace. The same interface works on a phone.

The server runs on Linux or macOS; Windows uses WSL 2. It needs Node 22.18+ or 24+, with Node 24 recommended. Terminals use tmux and a locally compiled `node-pty`, which is why setup needs Python and a C/C++ toolchain. Docker is optional for Postgres; running the mew app in a container is not currently supported.

Use mew with people you trust. By default, `manager` and `owner` accounts can run terminals and agents with the server user's OS permissions. Granting those features to another account gives it the same access. Read [SECURITY.md](SECURITY.md) before making an instance available to others.

## Using mew

**Menu** below means the menu in the top-right corner. Open workspace panels from the dock; the menu holds the remaining actions and settings. Shortcuts use the default bindings; change them under **Settings → Shortcuts**. Most of the detailed guides linked here are currently in Korean.

- [Projects, files, and search](#projects-files-and-search)
- [Writing, code, and media](#writing-code-and-media)
- [Git](#git)
- [Collaboration and sharing](#collaboration-and-sharing)
- [Terminals, agents, and automation](#terminals-agents-and-automation)
- [Browser, Android, and remote desktop](#browser-android-and-remote-desktop)
- [Databases](#databases)
- [Layout, settings, and accounts](#layout-settings-and-accounts)
- [Running and updating](#running-and-updating) · [Development](#development) · [Documentation](#documentation)

### Projects, files, and search

| Task | Where to start | Details |
| --- | --- | --- |
| Open and organize projects | Header **+** or `Ctrl+O`. Switch tabs, change icons, or hold a tab to group and reorder projects (owner). | [Project tabs](docs/guides/projects.md#프로젝트-탭) |
| Create a project or clone a repository | Use the actions in the project folder picker to create a folder, clone a repository, or initialize Git (owner). | [Project setup](docs/guides/projects.md#프로젝트-탭) |
| Jump to a favorite or cloud folder | The folder picker and server file browser list OS folders and detected OneDrive, Google Drive, Dropbox, and iCloud folders. Favorites belong to your account. | [Folder shortcuts](docs/guides/projects.md#클라우드-폴더-바로가기) |
| Browse Documents and subprojects | Expand folders in the sidebar. Open a `.mew` subproject in its own tab, or right-click a folder to mark it as a subproject (owner). **Map Of Contents** opens its document map. | [Sidebar structure](docs/guides/projects.md#사이드바의-프로젝트--하위-프로젝트--documents) |
| Set up project instructions | Use the agent panel's default instructions to set commit, language, and response-length preferences. Right-click **Documents** for document setup, previews, and missing-file creation (owner). A CLI is also available. | [Instructions and setup](docs/guides/project-setup.md) |
| Manage Documents | Right-click **Documents** to change its folder, import, or export (owner). Import replaces the existing contents. | [Documents folders](docs/guides/projects.md#documents-폴더-계약) |
| Manage files and folders | Right-click or hold an item to create, rename, duplicate, copy, move, delete, or download it. Drag files to move or upload them. | [File operations](docs/guides/projects.md#파일폴더-관리) · [Drag and drop](docs/guides/editor.md#사이드바-항목-끌어놓기) |
| Browse outside the project | **Menu → File browser** opens the server filesystem (manager or owner). | [Server file browser](docs/guides/projects.md#서버-파일-탐색기) |
| Find files or text | `Ctrl+P` finds filenames; `@` narrows the scope to Documents or a subproject. `Ctrl+Shift+F` searches contents, with case matching, regular expressions, and replacement across files. | [Search and replace](docs/configuration/search.md#파일명내용-검색과-치환) |
| Search by meaning | Open **RAG** from the dock to search project context, inspect indexed files, rebuild an index, and manage agent search guidance. | [Local semantic search](docs/configuration/search.md#로컬-의미-검색-rag) |
| Exclude files | **Settings → Ignore list** controls excluded names for search, file watching, and some roles' file trees (manager or owner). | [Ignore rules](docs/guides/projects.md#숨김-목록-dataignorejson) |

### Writing, code, and media

| Task | Where to start | Details |
| --- | --- | --- |
| Edit Markdown | Open a `.md` file. **Hotview** edits the rendered document; **Plain** edits its source. Use headings, lists, checkboxes, quotes, code blocks, and inline formatting. | [Editing basics](docs/guides/editor.md#기본-편집) |
| Edit metadata or jump to a heading | Edit frontmatter fields above Hotview, or use the table of contents. | [Document structure](docs/guides/editor.md#기본-편집) |
| Edit code | Open a source file for line numbers, syntax highlighting, and diagnostics for supported formats. `Ctrl+F` opens find and replace. | [Code editing](docs/guides/editor.md#기본-편집) |
| Insert links and attachments | `Ctrl+K` edits links; `@` links files in Hotview. Drop or paste images, resize them, or use `/` to upload a file. YouTube nodes can be inserted, but playback needs deployment CSP changes. | [Links and attachments](docs/guides/editor.md#링크와-첨부) |
| Work with tables | Insert a table from `/`, edit rows and columns, resize columns, and copy as Markdown, CSV, or an image. | [Tables](docs/guides/editor.md#표-편집과-복사) · [Column widths](docs/guides/editor.md#표-열-너비-mewtable-layoutjson) |
| Indent lists | Use `Tab` and `Shift+Tab`, including on the first item. | [List indentation](docs/guides/editor.md#리스트-첫-항목-들여쓰기-----b) |
| Add footnotes | `Alt+E` inserts a footnote. Numbering and links between markers and references are maintained automatically. | [Footnotes](docs/guides/editor.md#각주-alte) |
| View media and spreadsheets | Preview images, audio, video, and PDFs; switch SVG between image and source; read XLSX, CSV, and TSV files; download APK and AAB files. | [File previews](docs/guides/editor.md#미디어와-시트-보기) |
| Read and annotate PDFs | Use the PDF toolbar for fullscreen, pages, zoom, text selection, pen, and highlighter. Save to the PDF or download an annotated copy. | [PDF tools](docs/guides/editor.md#pdf-읽기와-필기) |
| Save and undo | Edits save automatically. Use `Ctrl+Z` to undo and `Ctrl+Y` to redo. | [Saving and history](docs/guides/editor.md#자동저장커밋파일-이력) |
| Arrange editor panes | Pin preview tabs, then drag tabs and handles to split, merge, reorder, or resize panes. | [Tabs and splits](docs/guides/editor.md#편집-칸-문서-탭--화면-분할) |
| Send a file reference | `Ctrl+L` sends the current path and selected lines to terminal, agent, or chat input. | [Path and line references](docs/guides/editor.md#ctrll-참조-경로줄) |

### Git

Click **Git** in the dock or press `Alt+G` to browse commits, changed files, and diffs (manager or owner). Select files in the changes list, enter a message at the bottom, and commit. Right-click a commit to copy its hash, create a branch or tag, check it out, cherry-pick, or revert it.

The **GitHub** button connects the server's Git credentials through a device login in the built-in browser; it requires `gh` on the server. **AI auto-commit** uses an agent set and mew's commit skill to split selected changes into commits. It creates real commits and reports their hashes, included files, and remaining changes.

For the current file, use `Ctrl+S` or **Menu → Commit**. The editor's history lets you inspect and restore earlier contents. The Git panel keeps its draft when closed and reopened, and can be moved with its desktop handle.

See [Git workbench](docs/guides/projects.md#git-작업-패널), [GitHub login](docs/guides/projects.md#github-로그인), and [file history](docs/guides/editor.md#자동저장커밋파일-이력).

### Collaboration and sharing

| Task | Where to start | Details |
| --- | --- | --- |
| Edit together | Open the same file while signed in. Other participants and their cursors appear in the editor. | [Collaborative editing](docs/guides/collaboration.md#공동-편집과-참여자) |
| Keep a shared memo | Use the memo dock icon or `Ctrl/Cmd+M`. The server-wide Markdown memo supports live editing, participant colors, and dragging by its title. | [Shared memo](docs/guides/collaboration.md#공통-메모) |
| See who's connected | Click the session count beside the menu for users, devices, projects, and current files. | [Active sessions](docs/guides/collaboration.md#접속-중인-mew-세션) |
| Comment on a document | Select text and press `Alt+Shift+C`. Reply, edit, delete, or mention someone through the highlight or comment list. | [Comments](docs/guides/collaboration.md#댓글과-답글) |
| Chat with members | **Menu → Chat** or `Alt+C` opens group chat and direct messages, with file references and read receipts. | [Chat](docs/guides/collaboration.md#단체-채팅과-dm) |
| Share with guests | An owner can grant unsigned visitors read or edit access to specific paths under account management's file and folder permissions. | [Guest sharing](docs/guides/collaboration.md#게스트-공유) |

### Terminals, agents, and automation

Terminal and agent features are available to managers and owners by default. Depending on the runtime, an agent opens in a chat panel or its official CLI terminal.

| Task | Where to start | Details |
| --- | --- | --- |
| Open a shell | **Terminal** in the dock, `Ctrl+Backtick`, or `Alt+T`. Create, reconnect to, and end tmux sessions. | [Terminals and tabs](docs/guides/terminal-agents.md) |
| Choose an agent | **Agent** in the dock (`Alt+L`) → **+**. Runtimes include Claude Agent, Antigravity, Codex, Hermes, Kimi, OpenClaw, OpenCode, Cursor, and Prime. | [Runtime support](docs/configuration/agent-runtimes.md#모델권한-기본값과-런타임-선택) |
| Install or configure a runtime | Use the install and settings buttons in the runtime list for authentication, launch settings, and supported sign-out or removal actions. Antigravity uses Google's official ACP server. | [Runtime setup](docs/configuration/agent-runtimes.md) |
| Choose model, reasoning, and permissions | Use the controls beside ACP chat input. Save supported settings as runtime defaults. | [Models and defaults](docs/configuration/agent-runtimes.md#모델권한-기본값과-런타임-선택) |
| Reuse an agent setup | Create tabs from agent sets with model and role presets. Rename tabs, switch runtimes, and arrange splits. | [Agent tabs](docs/guides/terminal-agents.md) |
| Add context to a prompt | `@` references projects, files, and folders; `/` selects local skills. Attach files or images and use the arrow keys to recall sent input. | [Agent input](docs/specs/agent-input-mentions.md) |
| Manage a conversation | Send or stop work, inspect tool activity and elapsed time, edit or reorder queued messages, and use `/clear` to start a new conversation. | [Conversation controls](docs/guides/terminal-agents.md#대화-진행과-기록) |
| Run a shell command from chat | Toggle the terminal icon beside the model selector. Open the command's tmux, stop it, or view and download saved output afterward. | [CLI command mode](docs/guides/terminal-agents.md#대화에서-cli-명령-실행) |
| Resume earlier work | Choose a session from history. After working in an external CLI, use **Refresh current conversation**. File links in replies open in the editor. | [Session history](docs/guides/terminal-agents.md) |
| Check account and usage | The ACP session's **i** button shows available account, plan, limits, token usage, and API-equivalent cost information. | [Accounts and subscriptions](docs/configuration/agent-runtimes.md#설치로그인구독) |
| Schedule a message | The clock beside ACP input schedules a one-time message to the current session. Edit, reschedule, or delete it before it runs. | [Scheduled messages](docs/specs/agent-scheduled-prompts.md) |
| Work from a feature spec | **Features** in the dock lets you edit requirements inline and apply them to an agent set. Track the source Markdown, related files, commits, and user review. | [Feature-driven development](docs/specs/feature-development.md) |
| Save project commands | The sidebar's **▶** menu adds, edits, runs, and stops commands, with output in a dedicated terminal popup. | [Project commands](docs/guides/commands.md#사이드바-프로젝트--버튼-mewcmd-buttonjson) |
| Save shell commands | Use **+** in a shell tab's command row to add a command and icon. Buttons send input to the active shell. | [Terminal buttons](docs/guides/commands.md#터미널-버튼-dataterm-buttonjson) |
| Run recurring jobs | **Menu → Scheduled tasks** saves a folder, agent, prompt, and schedule. Run a job immediately, inspect output, or delete it. | [Recurring tasks](docs/guides/commands.md#예약-작업-dataschedulesjson) |

Use **Skills** and **MCP**, beside the agent panel's **i** button, to inspect and manage extensions at global, project, and subproject scope. See [skills and MCP configuration](docs/configuration/agent-harness.md) for supported locations and runtimes.

### Browser, Android, and remote desktop

These features require additional components and are available to managers and owners.

| Task | Where to start | Details |
| --- | --- | --- |
| Browse from the server | **Browser** in the dock or `Alt+B`. Open localhost services, private-network pages, or public sites, with tabs, forms, uploads, and downloads. | [Server browser](docs/guides/browser.md#브라우저-창) |
| Keep browser logins | Each account has a server-side browser profile. Popups and agent authentication are supported, along with a standalone `/browser` page. | [Profiles and limitations](docs/guides/browser.md#브라우저-창) |
| Prepare Android | **Menu → Android** checks SDK, acceleration, and AVD status, shows setup commands and terminal output, and connects to an existing WebRTC gateway. | [Android setup](docs/guides/browser.md#android-창) |
| Control the desktop | **Remote desktop** in the dock prepares the helper and connects to the logged-in Mac or Linux desktop, or the Windows desktop when mew runs in WSL. OS permission approval is required. If direct video fails, it falls back to the mew server. | [Remote desktop setup](docs/guides/remote-desktop.md) |
| Use remote input | Mouse, keyboard, paste, remote Esc, mobile joystick, drag, wheel, zoom, fullscreen, rotation, sensitivity, movable hotkeys, and monitor selection are available. | [Controls](docs/guides/remote-desktop.md#조작) · [Network and validation scope](docs/development/remote-desktop.md) |

### Databases

Insert a table with `/db` in Hotview, then edit its title, rows, cells, and columns together with other users. Supported fields include text, numbers, checkboxes, and dates. **Menu → Database** lists the current project's databases.

Use **Database reference** in the `/` menu to embed a read-only reference to an existing database or external Postgres table. Configure `DATABASE_URL` to connect Postgres; `npm run db:up` and `npm run db:down` optionally manage just the database through Docker Compose.

See the [database guide](docs/guides/database.md) for setup and project isolation.

### Layout, settings, and accounts

| Task | Where to start | Details |
| --- | --- | --- |
| Arrange panels | Drag editor, agent, terminal, and browser tabs or handles; use the body handle for Git. Double-click a desktop tab to expand its panel; `Esc` restores it. Browser panels support horizontal placement only. Document tabs, layout, and scroll positions restore per account. | [Panes](docs/guides/editor.md#편집-칸-문서-탭--화면-분할) · [Restoration](docs/guides/projects.md#프로젝트-탭) |
| Work on mobile | Switch panels with the bottom dock; hold to reorder it. The dock hides while typing. Hold items for context menus, and use Back or `Esc` to close the frontmost overlay. **Menu → Fullscreen** or `Alt+Enter` toggles fullscreen. On desktop, the dock sits immediately left of the header menu, with tooltips below its icons. | [Mobile and fullscreen](docs/guides/editor.md#모바일과-전체화면) |
| Change appearance | **Settings → Appearance** controls light/dark themes, accent colors, UI/document/code fonts, and Korean, English, Japanese, or Chinese. | [Appearance](docs/configuration/environment.md#화면-설정) |
| Customize shortcuts | **Settings → Shortcuts** changes bindings or resets individual shortcuts or all of them. | [Shortcuts](docs/configuration/environment.md#단축키-설정) |
| Check Mewcat | Click the cat for recent notifications. Its bubble shows CPU, RAM, and GPU usage, updated every half-second; click the readings for system resources. **Settings → Mewcat** controls skins, sounds, notifications, and work/break timers. Optional enforced breaks put a draggable cat over the workspace; this is off by default. | [Mewcat](docs/specs/mewcat.md) |
| Manage your account | **Settings → Account** changes your display name, profile image, and password, or signs you out. | [Account settings](docs/configuration/environment.md#내-계정과-계정-관리) |
| Manage users | Owners use **Menu → Account management** to add accounts and change roles. The host CLI also lists users, resets passwords, and deletes accounts. | [User management](docs/configuration/environment.md#내-계정과-계정-관리) |
| Inspect the server | **Menu → System resources** shows CPU, memory, GPU, temperatures, processes, and recent usage (manager or owner). | [System resources](docs/guides/commands.md#시스템-자원-팝업) |

The former workspace home screen's to-do list and calendar are no longer available. Document checkboxes and agent scheduling remain supported. See [current project scope](docs/guides/projects.md#현재-제공하지-않는-홈-화면).

## Running and updating

Run these from the mew repository. On Windows, use the Ubuntu terminal.

```bash
./mew start                    # Start the server
./mew stop                     # Stop it
./mew restart                  # Restart it
./mew status                   # Show status and paths
./mew logs                     # Follow the server log
./mew update                   # Pull origin/main, install, build, and restart
./mew desktop-setup            # Prepare the desktop helper without restarting mew
./mew users add you@example.com owner
```

`./mew update` uses a fast-forward pull. For installations started with `./mew start`, you can also check for updates and install them from the app menu. Servers managed by systemd or another supervisor follow the separate [deployment and update procedure](docs/deployment/native.md).

Settings and runtime data live outside the clone by default:

| Contents | Location |
| --- | --- |
| Configuration | `~/.config/mew/config.env` |
| Accounts, sessions, and completed agent turns | `~/.local/share/mew/` |
| Logs | `~/.local/state/mew/` |

Deleting the clone leaves these files in place. Back them up along with your workspace and any Postgres data. See [server configuration](docs/configuration/environment.md#서버-설정) for overrides.

To connect from a phone or another computer, follow the [HTTPS/VPN deployment guide](docs/deployment/native.md). The default server binding is local to the host. A personal `./mew start` installation does not register an automatic startup service.

If remote desktop preparation failed during setup, retry with `./mew desktop-setup`. This installs the helper and handles Mac permission setup without building the app or restarting the server. A logged-in desktop and the relevant OS libraries and permissions are still required; see [OS requirements](docs/guides/remote-desktop.md#처음-연결).

On macOS, mew repairs a missing execute permission on `node-pty` 1.1.0's `spawn-helper` before opening a terminal. If a terminal stays blank, check the server log for `[mew:tmux]` errors.

## Development

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

**Coding agents must not run `mew`, build, deploy, or restart the server.** This includes `npm run build`, `npm start`, `./mew start|stop|restart|update`, killing server processes, and starting them in the background. Agents may run checks that leave the running instance alone, such as `npm test`, `npm run lint`, and `npx tsc -b`. The user runs builds and applies changes.

If a file edited from the terminal reverts unexpectedly, an open mew editor may have saved an older copy over it. Check the file again, then ask the user to close that editor or use **Revert File**.

For feature work, start with the [feature map](docs/features/MOC.md), also available through **Features** in the dock in the mew project. Update the feature's scope, implementation notes, and acceptance criteria together with its linked detailed documentation. Follow the [feature documentation rules](docs/features/README.md).

### Required UI rules

**Do not add permanent instructions, shortcut hints, or explanatory copy that repeats what the interface already makes clear.** Use the button or field label when it is enough. Show additional information where it helps someone decide or recover from an error. See [UI copy](docs/development/ui-contracts.md#화면-문구).

**Do not use native `<select>` or `<datalist>` popups for app-owned choices.** Reuse an existing custom component, or create a shared one if none fits. Changing a native control's border or `appearance` does not satisfy this rule. It applies on desktop and mobile, including when modifying an existing native dropdown.

Prefer `SelectField` from `@mew/ui` for single-choice fields. Follow the [selection component contract](docs/development/ui-contracts.md#드롭다운과-선택-컴포넌트) for themes, keyboard and touch input, focus, Esc/Back dismissal, and viewport boundaries.

## Documentation

Start at the [document map](docs/MOC.md). Detailed product specs, usage, operating procedures, and work records belong in `docs/`; this README covers setup and entry points. Update the relevant documentation whenever code changes.

| Topic | Start here |
| --- | --- |
| Projects, editing, terminals, browsers, commands, and databases | [User guides](docs/guides/MOC.md) |
| Environment variables, accounts, search, and agent runtimes | [Configuration](docs/configuration/MOC.md) |
| HTTPS, systemd, updates, and backups | [Deployment](docs/deployment/native.md) |
| Code structure, packages, UI, collaboration, and agent protocols | [Development docs](docs/development/MOC.md) |
| Product specs, operations, current work, and history | [Document map](docs/MOC.md) |
| Per-account features and file permissions | [Account settings](docs/configuration/environment.md#내-계정과-계정-관리) · [Access control](docs/development/access-control.md) |
| Roles, authentication, and guest access | [Security](SECURITY.md) |

On Linux, `sh native/agent-memory/install.sh` installs memory limits for agent work. See [agent memory protection](docs/operations/agent-memory.md) for activation, checks, low-memory job suspension, queue holds, and error reporting.

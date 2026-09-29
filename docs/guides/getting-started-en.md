# mew user guide

[한국어](getting-started-ko.md) · [English](getting-started-en.md) · [简体中文](getting-started-zh.md) · [日本語](getting-started-ja.md)

mew opens folders on your computer or server in a browser. Edit Markdown and code, run terminals and AI agents, review Git changes, and work on documents together. You can use it from your phone, too.

## Quick start

[Windows (WSL 2)](#windows-wsl-2) · [macOS](#macos) · [Linux](#linux) · [Remote access](#remote-access)

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

Setup also prepares the remote desktop helper. On the Mac running mew, approve **Accessibility** and **Screen Recording** for Electron when System Settings opens. Setup continues once it detects the permissions. See [Mac permission setup](remote-desktop.md#mac-%EA%B6%8C%ED%95%9C-%EC%A4%80%EB%B9%84) for details.

### Finish setup

During setup, enter:

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

On other distributions, install the equivalent packages first. Follow [Finish setup](#finish-setup) above. For a server that should start on boot or accept remote connections, use the [deployment guide](../deployment/native.md).

### Remote access

After setup, use either option below to open mew from a phone or another computer. Keep the host awake and mew running. Both options forward HTTPS traffic to the local mew server; keep `MEW_BIND=127.0.0.1` and replace `5000` with your setup port if different.

#### 1. Tailscale (recommended)

Use this for your own devices. No domain purchase is needed, and access stays within your private Tailscale network (tailnet).

1. [Install Tailscale](https://tailscale.com/download) on the mew host and each device you want to connect from. Sign in to the same tailnet on all devices.

2. On the mew host, run:

   ```bash
   tailscale serve --bg http://127.0.0.1:5000
   ```

   Follow the printed link to enable HTTPS if prompted. On Linux, use `sudo` if the command reports a permission error. For WSL 2, install Tailscale on **Windows** and run this command in **PowerShell** after confirming that `http://localhost:5000` opens in your Windows browser.

3. With Tailscale connected on your phone or other computer, open the printed `https://<machine>.<tailnet>.ts.net` URL and sign in to mew.

See the official [Tailscale Serve guide](https://tailscale.com/docs/features/tailscale-serve) and [command reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

#### 2. Cloudflare Tunnel

Use this for a stable HTTPS address that works in a browser without installing Tailscale on connecting devices. **A domain managed through Cloudflare DNS is required for this setup.**

1. Buy a domain using the official [Cloudflare domain registration guide](https://developers.cloudflare.com/registrar/get-started/register-domain/), or [add an existing domain to Cloudflare](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/) and follow its nameserver instructions.
2. Follow the official [Cloudflare Tunnel setup guide](https://developers.cloudflare.com/tunnel/get-started/) to create a tunnel and install and run `cloudflared` on the mew host. For WSL 2, run `cloudflared` inside the same Ubuntu environment as mew.
3. Add a **Published application** route with a hostname such as `mew.example.com` and service URL `http://127.0.0.1:5000`. Leave the path empty so mew is served at `/`.
4. Keep `cloudflared` running, then open `https://mew.example.com` from another device and sign in to mew.

This creates a public HTTPS entry point; mew's account permissions still apply. See [Security](../../SECURITY.md) and the [deployment guide](../deployment/native.md#2-https-%ED%94%84%EB%A1%9D%EC%8B%9C-%EB%98%90%EB%8A%94-%ED%84%B0%EB%84%90-%EC%97%B0%EA%B2%B0) for proxy requirements and connection checks.

## Requirements and permissions

The server runs on Linux or macOS; Windows uses WSL 2. It needs Node 22.18+ or 24+, with Node 24 recommended. Terminals use tmux and a locally compiled `node-pty`, which is why setup needs Python and a C/C++ toolchain. Docker is optional for Postgres; running the mew app in a container is not currently supported.

Share your mew instance only with people you trust. By default, `manager` and `owner` accounts can run terminals and agents with the server user's OS permissions. Granting those features to another account gives it the same access. Read [SECURITY.md](../../SECURITY.md) before making an instance available to others.

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
- [Running and updating](#running-and-updating) · [Development](../development/getting-started.md) · [Documentation](#documentation)

### Projects, files, and search

| Task | Where to start | Details |
| --- | --- | --- |
| Open and organize projects | Header **+** or `Ctrl+O`. Switch tabs, change icons, or hold a tab to group and reorder projects (owner). | [Project tabs](projects.md#%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%ED%83%AD) |
| Create a project or clone a repository | Use the actions in the project folder picker to create a folder, clone a repository, or initialize Git (owner). | [Project setup](projects.md#%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%ED%83%AD) |
| Jump to a favorite or cloud folder | The folder picker and server file browser list OS folders and detected OneDrive, Google Drive, Dropbox, and iCloud folders. Favorites belong to your account. | [Folder shortcuts](projects.md#%ED%81%B4%EB%9D%BC%EC%9A%B0%EB%93%9C-%ED%8F%B4%EB%8D%94-%EB%B0%94%EB%A1%9C%EA%B0%80%EA%B8%B0) |
| Browse Documents and subprojects | Expand folders in the sidebar. Open a `.mew` subproject in its own tab, or right-click a folder to mark it as a subproject (owner). **Map Of Contents** opens its document map. | [Sidebar structure](projects.md#%EC%82%AC%EC%9D%B4%EB%93%9C%EB%B0%94%EC%9D%98-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8--%ED%95%98%EC%9C%84-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8--documents) |
| Set up project instructions | Use the agent panel's default instructions to set commit, language, and response-length preferences. Right-click **Documents** for document setup, previews, and missing-file creation (owner). A CLI is also available. | [Instructions and setup](project-setup.md) |
| Manage Documents | Right-click **Documents** to change its folder, import, or export (owner). Import replaces the existing contents. | [Documents folders](projects.md#documents-%ED%8F%B4%EB%8D%94-%EA%B3%84%EC%95%BD) |
| Manage files and folders | Right-click or hold an item to create, rename, duplicate, copy, move, delete, or download it. Drag files to move or upload them. | [File operations](projects.md#%ED%8C%8C%EC%9D%BC%ED%8F%B4%EB%8D%94-%EA%B4%80%EB%A6%AC) · [Drag and drop](editor.md#%EC%82%AC%EC%9D%B4%EB%93%9C%EB%B0%94-%ED%95%AD%EB%AA%A9-%EB%81%8C%EC%96%B4%EB%86%93%EA%B8%B0) |
| Browse outside the project | **Menu → File browser** opens the server filesystem (manager or owner). | [Server file browser](projects.md#%EC%84%9C%EB%B2%84-%ED%8C%8C%EC%9D%BC-%ED%83%90%EC%83%89%EA%B8%B0) |
| Find files or text | `Ctrl+P` finds filenames; `@` narrows the scope to Documents or a subproject. `Ctrl+Shift+F` searches contents, with case matching, regular expressions, and replacement across files. | [Search and replace](../configuration/search.md#%ED%8C%8C%EC%9D%BC%EB%AA%85%EB%82%B4%EC%9A%A9-%EA%B2%80%EC%83%89%EA%B3%BC-%EC%B9%98%ED%99%98) |
| Exclude files | **Settings → Ignore list** controls excluded names for search, file watching, and some roles' file trees (manager or owner). | [Ignore rules](projects.md#%EC%88%A8%EA%B9%80-%EB%AA%A9%EB%A1%9D-dataignorejson) |

### Writing, code, and media

| Task | Where to start | Details |
| --- | --- | --- |
| Edit Markdown | Open a `.md` file. **Hotview** edits the rendered document; **Plain** edits its source. Use headings, lists, checkboxes, quotes, code blocks, and inline formatting. | [Editing basics](editor.md#%EA%B8%B0%EB%B3%B8-%ED%8E%B8%EC%A7%91) |
| Edit metadata or jump to a heading | Edit frontmatter fields above Hotview, or use the table of contents. | [Document structure](editor.md#%EA%B8%B0%EB%B3%B8-%ED%8E%B8%EC%A7%91) |
| Edit code | Open a source file for line numbers, syntax highlighting, and diagnostics for supported formats. `Ctrl+F` opens find and replace. | [Code editing](editor.md#%EA%B8%B0%EB%B3%B8-%ED%8E%B8%EC%A7%91) |
| Insert links and attachments | `Ctrl+K` edits links; `@` links files in Hotview. Drop or paste images, resize them, or use `/` to upload a file. YouTube nodes can be inserted, but playback needs deployment CSP changes. | [Links and attachments](editor.md#%EB%A7%81%ED%81%AC%EC%99%80-%EC%B2%A8%EB%B6%80) |
| Work with tables | Insert a table from `/`, edit rows and columns, resize columns, and copy as Markdown, CSV, or an image. | [Tables](editor.md#%ED%91%9C-%ED%8E%B8%EC%A7%91%EA%B3%BC-%EB%B3%B5%EC%82%AC) · [Column widths](editor.md#%ED%91%9C-%EC%97%B4-%EB%84%88%EB%B9%84-mewtable-layoutjson) |
| Indent lists | Use `Tab` and `Shift+Tab`, including on the first item. | [List indentation](editor.md#%EB%A6%AC%EC%8A%A4%ED%8A%B8-%EC%B2%AB-%ED%95%AD%EB%AA%A9-%EB%93%A4%EC%97%AC%EC%93%B0%EA%B8%B0-----b) |
| Add footnotes | `Alt+E` inserts a footnote. Numbering and links between markers and references are maintained automatically. | [Footnotes](editor.md#%EA%B0%81%EC%A3%BC-alte) |
| View media and spreadsheets | Preview images, audio, video, and PDFs; switch SVG between image and source; read XLSX, CSV, and TSV files; download APK and AAB files. | [File previews](editor.md#%EB%AF%B8%EB%94%94%EC%96%B4%EC%99%80-%EC%8B%9C%ED%8A%B8-%EB%B3%B4%EA%B8%B0) |
| Read and annotate PDFs | Use the PDF toolbar for fullscreen, pages, zoom, text selection, pen, and highlighter. Save to the PDF or download an annotated copy. | [PDF tools](editor.md#pdf-%EC%9D%BD%EA%B8%B0%EC%99%80-%ED%95%84%EA%B8%B0) |
| Save and undo | Edits save automatically. Use `Ctrl+Z` to undo and `Ctrl+Y` to redo. | [Saving and history](editor.md#%EC%9E%90%EB%8F%99%EC%A0%80%EC%9E%A5%EC%BB%A4%EB%B0%8B%ED%8C%8C%EC%9D%BC-%EC%9D%B4%EB%A0%A5) |
| Arrange editor panes | Pin preview tabs, then drag tabs and handles to split, merge, reorder, or resize panes. | [Tabs and splits](editor.md#%ED%8E%B8%EC%A7%91-%EC%B9%B8-%EB%AC%B8%EC%84%9C-%ED%83%AD--%ED%99%94%EB%A9%B4-%EB%B6%84%ED%95%A0) |
| Send a file reference | `Ctrl+L` sends the current path and selected lines to terminal, agent, or chat input. | [Path and line references](editor.md#ctrll-%EC%B0%B8%EC%A1%B0-%EA%B2%BD%EB%A1%9C%EC%A4%84) |

### Git

Click **Git** in the dock or press `Alt+G` to browse commits, changed files, and diffs (manager or owner). Select files in the changes list, enter a message at the bottom, and commit. Right-click a commit to copy its hash, create a branch or tag, check it out, cherry-pick, or revert it.

The **GitHub** button connects the server's Git credentials through a device login in the built-in browser; it requires `gh` on the server. **AI auto-commit** uses an agent set and mew's commit skill to split selected changes into commits. It creates real commits and reports their hashes, included files, and remaining changes.

For the current file, use `Ctrl+S` or **Menu → Commit**. The editor's history lets you inspect and restore earlier contents. The Git panel keeps its draft when closed and reopened, and can be moved with its desktop handle.

See [Git workbench](projects.md#git-%EC%9E%91%EC%97%85-%ED%8C%A8%EB%84%90), [GitHub login](projects.md#github-%EB%A1%9C%EA%B7%B8%EC%9D%B8), and [file history](editor.md#%EC%9E%90%EB%8F%99%EC%A0%80%EC%9E%A5%EC%BB%A4%EB%B0%8B%ED%8C%8C%EC%9D%BC-%EC%9D%B4%EB%A0%A5).

### Collaboration and sharing

| Task | Where to start | Details |
| --- | --- | --- |
| Edit together | Open the same file while signed in. Other participants and their cursors appear in the editor. | [Collaborative editing](collaboration.md#%EA%B3%B5%EB%8F%99-%ED%8E%B8%EC%A7%91%EA%B3%BC-%EC%B0%B8%EC%97%AC%EC%9E%90) |
| Keep a shared memo | Use the memo dock icon or `Ctrl/Cmd+M`. The server-wide Markdown memo supports live editing, participant colors, and dragging by its title. | [Shared memo](collaboration.md#%EA%B3%B5%ED%86%B5-%EB%A9%94%EB%AA%A8) |
| See who's connected | Click the session count beside the menu for users, devices, projects, and current files. | [Active sessions](collaboration.md#%EC%A0%91%EC%86%8D-%EC%A4%91%EC%9D%B8-mew-%EC%84%B8%EC%85%98) |
| Comment on a document | Select text and press `Alt+Shift+C`. Reply, edit, delete, or mention someone through the highlight or comment list. | [Comments](collaboration.md#%EB%8C%93%EA%B8%80%EA%B3%BC-%EB%8B%B5%EA%B8%80) |
| Chat with members | **Menu → Chat** or `Alt+C` opens group chat and direct messages, with file references and read receipts. | [Chat](collaboration.md#%EB%8B%A8%EC%B2%B4-%EC%B1%84%ED%8C%85%EA%B3%BC-dm) |
| Share with guests | An owner can grant unsigned visitors read or edit access to specific paths under account management's file and folder permissions. | [Guest sharing](collaboration.md#%EA%B2%8C%EC%8A%A4%ED%8A%B8-%EA%B3%B5%EC%9C%A0) |

### Terminals, agents, and automation

Terminal and agent features are available to managers and owners by default. Depending on the runtime, an agent opens in a chat panel or its official CLI terminal.

| Task | Where to start | Details |
| --- | --- | --- |
| Open a shell | **Terminal** in the dock, `Ctrl+Backtick`, or `Alt+T`. Create, reconnect to, and end tmux sessions. | [Terminals and tabs](terminal-agents.md) |
| Choose an agent | **Agent** in the dock (`Alt+L`) → **+**. Runtimes include Claude Agent, Antigravity, Codex, Hermes, Kimi, OpenClaw, OpenCode, Cursor, and Prime. | [Runtime support](../configuration/agent-runtimes.md#%EB%AA%A8%EB%8D%B8%EA%B6%8C%ED%95%9C-%EA%B8%B0%EB%B3%B8%EA%B0%92%EA%B3%BC-%EB%9F%B0%ED%83%80%EC%9E%84-%EC%84%A0%ED%83%9D) |
| Install or configure a runtime | Use the install and settings buttons in the runtime list for authentication, launch settings, and supported sign-out or removal actions. Antigravity uses Google's official ACP server. | [Runtime setup](../configuration/agent-runtimes.md) |
| Choose model, reasoning, and permissions | Use the controls beside ACP chat input. Save supported settings as runtime defaults. | [Models and defaults](../configuration/agent-runtimes.md#%EB%AA%A8%EB%8D%B8%EA%B6%8C%ED%95%9C-%EA%B8%B0%EB%B3%B8%EA%B0%92%EA%B3%BC-%EB%9F%B0%ED%83%80%EC%9E%84-%EC%84%A0%ED%83%9D) |
| Reuse an agent setup | Create tabs from agent sets with model and role presets. Rename tabs, switch runtimes, and arrange splits. | [Agent tabs](terminal-agents.md) |
| Add context to a prompt | `@` references projects, files, and folders; `/` selects local skills. Attach files or images and use the arrow keys to recall sent input. | [Agent input](../specs/agent-input-mentions.md) |
| Manage a conversation | Send or stop work, inspect tool activity and elapsed time, edit or reorder queued messages, and use `/clear` to start a new conversation. | [Conversation controls](terminal-agents.md#%EB%8C%80%ED%99%94-%EC%A7%84%ED%96%89%EA%B3%BC-%EA%B8%B0%EB%A1%9D) |
| Run a shell command from chat | Toggle the terminal icon beside the model selector. Open the command's tmux, stop it, or view and download saved output afterward. | [CLI command mode](terminal-agents.md#%EB%8C%80%ED%99%94%EC%97%90%EC%84%9C-cli-%EB%AA%85%EB%A0%B9-%EC%8B%A4%ED%96%89) |
| Resume earlier work | Choose a session from history. After working in an external CLI, use **Refresh current conversation**. File links in replies open in the editor. | [Session history](terminal-agents.md) |
| Check account and usage | The ACP session's **i** button shows available account, plan, limits, token usage, and API-equivalent cost information. | [Accounts and subscriptions](../configuration/agent-runtimes.md#%EC%84%A4%EC%B9%98%EB%A1%9C%EA%B7%B8%EC%9D%B8%EA%B5%AC%EB%8F%85) |
| Schedule a message | The clock beside ACP input schedules a one-time message to the current session. Edit, reschedule, or delete it before it runs. | [Scheduled messages](../specs/agent-scheduled-prompts.md) |
| Work from a feature spec | **Features** in the dock lets you edit requirements inline and apply them to an agent set. Track the source Markdown, related files, commits, and user review. | [Feature-driven development](../specs/feature-development.md) |
| Save project commands | The sidebar's **▶** menu adds, edits, runs, and stops commands, with output in a dedicated terminal popup. | [Project commands](commands.md#%EC%82%AC%EC%9D%B4%EB%93%9C%EB%B0%94-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8--%EB%B2%84%ED%8A%BC-mewcmd-buttonjson) |
| Save shell commands | Use **+** in a shell tab's command row to add a command and icon. Buttons send input to the active shell. | [Terminal buttons](commands.md#%ED%84%B0%EB%AF%B8%EB%84%90-%EB%B2%84%ED%8A%BC-dataterm-buttonjson) |
| Run recurring jobs | **Menu → Scheduled tasks** saves a folder, agent, prompt, and schedule. Run a job immediately, inspect output, or delete it. | [Recurring tasks](commands.md#%EC%98%88%EC%95%BD-%EC%9E%91%EC%97%85-dataschedulesjson) |

Use **Skills** and **MCP**, beside the agent panel's **i** button, to inspect and manage extensions at global, project, and subproject scope. See [skills and MCP configuration](../configuration/agent-harness.md) for supported locations and runtimes.

### Browser, Android, and remote desktop

These features require additional components and are available to managers and owners.

| Task | Where to start | Details |
| --- | --- | --- |
| Browse from the server | **Browser** in the dock or `Alt+B`. Open localhost services, private-network pages, or public sites, with tabs, forms, uploads, and downloads. | [Server browser](browser.md#%EB%B8%8C%EB%9D%BC%EC%9A%B0%EC%A0%80-%EC%B0%BD) |
| Keep browser logins | Each account has a server-side browser profile. Popups and agent authentication are supported, along with a standalone `/browser` page. | [Profiles and limitations](browser.md#%EB%B8%8C%EB%9D%BC%EC%9A%B0%EC%A0%80-%EC%B0%BD) |
| Prepare Android | **Menu → Android** checks SDK, acceleration, and AVD status, shows setup commands and terminal output, and connects to an existing WebRTC gateway. | [Android setup](browser.md#android-%EC%B0%BD) |
| Control the desktop | **Remote desktop** in the dock prepares the helper and connects to the logged-in Mac or Linux desktop, or the Windows desktop when mew runs in WSL. OS permission approval is required. If direct video fails, it falls back to the mew server. | [Remote desktop setup](remote-desktop.md) |
| Use remote input | Mouse, keyboard, paste, remote Esc, mobile joystick, drag, wheel, zoom, fullscreen, rotation, sensitivity, movable hotkeys, and monitor selection are available. | [Controls](remote-desktop.md#%EC%A1%B0%EC%9E%91) · [Network and validation scope](../development/remote-desktop.md) |

### Databases

Insert a table with `/db` in Hotview, then edit its title, rows, cells, and columns together with other users. Supported fields include text, numbers, checkboxes, and dates. **Menu → Database** lists the current project's databases.

Use **Database reference** in the `/` menu to embed a read-only reference to an existing database or external Postgres table. Configure `DATABASE_URL` to connect Postgres; `npm run db:up` and `npm run db:down` optionally manage just the database through Docker Compose.

See the [database guide](database.md) for setup and project isolation.

### Layout, settings, and accounts

| Task | Where to start | Details |
| --- | --- | --- |
| Arrange panels | Drag editor, agent, terminal, and browser tabs or handles; use the body handle for Git. Double-click a desktop tab to expand its panel; `Esc` restores it. Browser panels support horizontal placement only. Document tabs, layout, and scroll positions restore per account. | [Panes](editor.md#%ED%8E%B8%EC%A7%91-%EC%B9%B8-%EB%AC%B8%EC%84%9C-%ED%83%AD--%ED%99%94%EB%A9%B4-%EB%B6%84%ED%95%A0) · [Restoration](projects.md#%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%ED%83%AD) |
| Work on mobile | Switch panels with the bottom dock; hold to reorder it. The dock hides while typing. Hold items for context menus, and use Back or `Esc` to close the frontmost overlay. **Menu → Fullscreen** or `Alt+Enter` toggles fullscreen. On desktop, the dock sits immediately left of the header menu, with tooltips below its icons. | [Mobile and fullscreen](editor.md#%EB%AA%A8%EB%B0%94%EC%9D%BC%EA%B3%BC-%EC%A0%84%EC%B2%B4%ED%99%94%EB%A9%B4) |
| Change appearance | **Settings → Appearance** controls light/dark themes, accent colors, UI/document/code fonts, and Korean, English, Japanese, or Chinese. | [Appearance](../configuration/environment.md#%ED%99%94%EB%A9%B4-%EC%84%A4%EC%A0%95) |
| Customize shortcuts | **Settings → Shortcuts** changes bindings or resets individual shortcuts or all of them. | [Shortcuts](../configuration/environment.md#%EB%8B%A8%EC%B6%95%ED%82%A4-%EC%84%A4%EC%A0%95) |
| Check Mewcat | Click the cat for recent notifications. Its bubble shows CPU, RAM, and GPU usage, updated every half-second; click the readings for system resources. **Settings → Mewcat** controls skins, sounds, notifications, and work/break timers. Optional enforced breaks put a draggable cat over the workspace; this is off by default. | [Mewcat](../specs/mewcat.md) |
| Manage your account | **Settings → Account** changes your display name, profile image, and password, or signs you out. | [Account settings](../configuration/environment.md#%EB%82%B4-%EA%B3%84%EC%A0%95%EA%B3%BC-%EA%B3%84%EC%A0%95-%EA%B4%80%EB%A6%AC) |
| Manage users | Owners use **Menu → Account management** to add accounts and change roles. The host CLI also lists users, resets passwords, and deletes accounts. | [User management](../configuration/environment.md#%EB%82%B4-%EA%B3%84%EC%A0%95%EA%B3%BC-%EA%B3%84%EC%A0%95-%EA%B4%80%EB%A6%AC) |
| Inspect the server | **Menu → System resources** shows CPU, memory, GPU, temperatures, processes, and recent usage (manager or owner). | [System resources](commands.md#%EC%8B%9C%EC%8A%A4%ED%85%9C-%EC%9E%90%EC%9B%90-%ED%8C%9D%EC%97%85) |

The former workspace home screen's to-do list and calendar are no longer available. Document checkboxes and agent scheduling remain supported. See [current project scope](projects.md#%ED%98%84%EC%9E%AC-%EC%A0%9C%EA%B3%B5%ED%95%98%EC%A7%80-%EC%95%8A%EB%8A%94-%ED%99%88-%ED%99%94%EB%A9%B4).

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

`./mew update` uses a fast-forward pull. For installations started with `./mew start`, you can also check for updates and install them from the app menu. Servers managed by systemd or another supervisor follow the separate [deployment and update procedure](../deployment/native.md).

Settings and runtime data live outside the clone by default:

| Contents | Location |
| --- | --- |
| Configuration | `~/.config/mew/config.env` |
| Accounts, sessions, and completed agent turns | `~/.local/share/mew/` |
| Logs | `~/.local/state/mew/` |

Deleting the clone leaves these files in place. Back them up along with your workspace and any Postgres data. See [server configuration](../configuration/environment.md#%EC%84%9C%EB%B2%84-%EC%84%A4%EC%A0%95) for overrides.

To connect from a phone or another computer, follow [Remote access](#remote-access). The default server binding is local to the host. A personal `./mew start` installation does not register an automatic startup service.

If remote desktop preparation failed during setup, retry with `./mew desktop-setup`. This installs the helper and handles Mac permission setup without building the app or restarting the server. A logged-in desktop and the relevant OS libraries and permissions are still required; see [OS requirements](remote-desktop.md#%EC%B2%98%EC%9D%8C-%EC%97%B0%EA%B2%B0).

On macOS, mew repairs a missing execute permission on `node-pty` 1.1.0's `spawn-helper` before opening a terminal. If a terminal stays blank, check the server log for `[mew:tmux]` errors.

## Documentation

Start at the [document map](../MOC.md). Detailed product specs, usage, operating procedures, and work records belong in `docs/`; this guide covers setup and everyday use. Update the relevant documentation whenever code changes.

| Topic | Start here |
| --- | --- |
| Projects, editing, terminals, browsers, commands, and databases | [User guides](MOC.md) |
| Environment variables, accounts, search, and agent runtimes | [Configuration](../configuration/MOC.md) |
| HTTPS, systemd, updates, and backups | [Deployment](../deployment/native.md) |
| Code structure, packages, UI, collaboration, and agent protocols | [Development docs](../development/MOC.md) |
| Product specs, operations, current work, and history | [Document map](../MOC.md) |
| Per-account features and file permissions | [Account settings](../configuration/environment.md#%EB%82%B4-%EA%B3%84%EC%A0%95%EA%B3%BC-%EA%B3%84%EC%A0%95-%EA%B4%80%EB%A6%AC) · [Access control](../development/access-control.md) |
| Roles, authentication, and guest access | [Security](../../SECURITY.md) |

On Linux, `sh native/agent-memory/install.sh` installs memory limits for agent work. See [agent memory protection](../operations/agent-memory.md) for activation, checks, low-memory job suspension, queue holds, and error reporting.

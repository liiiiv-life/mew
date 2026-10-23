---
title: "Getting started with mew"
updated: "2026-10-23"
description: "s-saens/mew 소스의 영어 설치·첫 로그인·목적별 사용법과 Mewlink·대체 외부 접속, 권한·업데이트·데이터 보존 및 미발행 CLI 경로를 안내한다. 햄버거 메뉴의 Mewlink 연결 진입을 포함한다."
---

# Getting started with mew

[한국어](getting-started-ko.md) · [English](getting-started-en.md) · [简体中文](getting-started-zh.md) · [日本語](getting-started-ja.md)

mew opens folders on your computer or server in a browser. Edit Markdown and code, run terminals and AI agents, review Git changes, and work on documents together. You can use it from your phone, too.

[First steps](#first-steps) · [Remote access](#remote-access) · [Running and updating](#running-and-updating) · [Documentation](#documentation)

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
git clone https://github.com/s-saens/mew.git
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
git clone https://github.com/s-saens/mew.git
cd mew
./mew setup
```

Accept the offer to install Node with nvm if prompted. Follow the [setup prompts below](#finish-setup), then open the printed URL in your browser.

Setup also prepares the remote desktop helper. On the Mac running mew, approve **Accessibility** and **Screen Recording** for Electron when System Settings opens. Setup continues once it detects the permissions. See [Mac permission setup](remote-desktop.md#mac-%EA%B6%8C%ED%95%9C-%EC%A4%80%EB%B9%84) for details.

### Linux

On Debian or Ubuntu:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential python3 tmux
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/s-saens/mew.git
cd mew
./mew setup
```

On other distributions, install the equivalent packages first. Follow [Finish setup](#finish-setup) above. For a server that should start on boot or accept remote connections, use the [deployment guide](../deployment/native.md).

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

### Run with one command (after the first release)

With Node.js 24 installed, run this from your workspace to download a prebuilt app. **The implementation is ready; the first npm package and GitHub runtime release still need to be published.**

```bash
cd /path/to/workspace
npx @liiiiv/mew-cli@latest
```

Supports Linux glibc 2.35+ and macOS 15+, on x64/arm64. On Windows, use Ubuntu 22.04+ inside WSL 2. On first use, enter the owner email, sign in with the printed temporary password, and change it. Existing accounts, conversations, and device registration are reused. Follow [remote access](#remote-access) to register with Mewlink; the terminal also prints registration and online address QR codes.

Press Ctrl+C to stop. Run the same command again to use the latest release. If your old clone uses `.data/`, pass `--data-dir /path/to/old/mew/.data` and stop the old server first. Remote desktop requires its optional components and OS permissions. [Runtime and data contract](../development/cli-distribution.md) · [Release procedure](../deployment/cli-release.md)

<a id="remote-access"></a>

### Remote access

Use Mewlink to connect from another browser, or choose Tailscale or Cloudflare Tunnel below. Keep the host awake, online, and running mew. For the proxy alternatives, keep `MEW_BIND=127.0.0.1` and replace `5000` with your setup port.

#### 1. Mewlink

1. Sign in as owner on your local mew and change the temporary password.
2. Open **Menu → Mewlink → Register device**. Follow the one-time URL, sign in to Mewlink, and choose your username and device name.
3. Wait for Online and copy the fixed URL, `https://mew.saens.kr/<username>/<device-name>`.
4. Open that URL from another PC or phone. It connects without a Mewlink sign-in and shows the host's mew login screen. Sign in with **that computer's local mew email and password**. Connecting browsers need no registration. A valid saved local session can resume on later visits.

Mewlink sign-in is used for registration, your device list and device removal. To give someone access, create their local mew account and configure its role, features and file permissions; a Mewlink account is not needed for local password sign-in. Application data remains blocked until local sign-in succeeds.

The host must stay running and online. Networks that block direct connections show an error. Android iframe access is unavailable in this mode. Run `./mew remote-access account` to see the registration instructions again. Operators should follow [Central service setup](../deployment/remote-central.md). Applying this authentication change requires updating local mew and redeploying Mewlink; real external-network validation is separate.

For passwordless access, the visitor can choose **Sign in with Mewlink → Request access** on the device login screen. The owner approves the identity under **Account management → Mewlink account access**, linking it to an existing local user or creating one (member by default). Permissions remain local; remove the identity link to revoke access. The registration account and matching email do not grant access automatically. Local mew and Mewlink must both be updated for this flow; provider sign-in and external-network validation remain separate. See the [remote-access contract](../development/remote-access.md#검증과-남은-게이트).

#### 2. Tailscale

Use this for your own devices. No domain purchase is needed, and access stays within your private Tailscale network (tailnet).

1. [Install Tailscale](https://tailscale.com/download) on the mew host and each device you want to connect from. Sign in to the same tailnet on all devices.

2. On the mew host, run:

   ```bash
   tailscale serve --bg http://127.0.0.1:5000
   ```

   Follow the printed link to enable HTTPS if prompted. On Linux, use `sudo` if the command reports a permission error. For WSL 2, install Tailscale on **Windows** and run this command in **PowerShell** after confirming that `http://localhost:5000` opens in your Windows browser.

3. With Tailscale connected on your phone or other computer, open the printed `https://<machine>.<tailnet>.ts.net` URL and sign in to mew.

See the official [Tailscale Serve guide](https://tailscale.com/docs/features/tailscale-serve) and [command reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

#### 3. Cloudflare Tunnel

Use this for a stable HTTPS address that works in a browser without installing Tailscale on connecting devices. **A domain managed through Cloudflare DNS is required for this setup.**

1. Buy a domain using the official [Cloudflare domain registration guide](https://developers.cloudflare.com/registrar/get-started/register-domain/), or [add an existing domain to Cloudflare](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/) and follow its nameserver instructions.
2. Follow the official [Cloudflare Tunnel setup guide](https://developers.cloudflare.com/tunnel/get-started/) to create a tunnel and install and run `cloudflared` on the mew host. For WSL 2, run `cloudflared` inside the same Ubuntu environment as mew.
3. Add a **Published application** route with a hostname such as `mew.example.com` and service URL `http://127.0.0.1:5000`. Leave the path empty so mew is served at `/`.
4. Keep `cloudflared` running, then open `https://mew.example.com` from another device and sign in to mew.

This creates a public HTTPS entry point; mew's account permissions still apply. See [Security](../operations/security.md) and the [deployment guide](../deployment/native.md#2-https-%ED%94%84%EB%A1%9D%EC%8B%9C-%EB%98%90%EB%8A%94-%ED%84%B0%EB%84%90-%EC%97%B0%EA%B2%B0) for proxy requirements and connection checks.

## Requirements and permissions

The server runs on Linux or macOS; Windows uses WSL 2. It needs Node 22.18+ or 24+, with Node 24 recommended. Terminals use tmux and a locally compiled `node-pty`, which is why setup needs Python and a C/C++ toolchain. Docker is optional for Postgres; running the mew app in a container is not currently supported.

Share your mew instance only with people you trust. By default, `manager` and `owner` accounts can run terminals and agents with the server user's OS permissions. Granting those features to another account gives it the same access. Read [Security](../operations/security.md) before making an instance available to others.

<a id="first-steps"></a>

## Using mew

Open the printed address, sign in as owner, and change the temporary password.

1. Open a working folder with the header **+**.
2. Select a Markdown or code file from the file list.
3. Open terminals, agents, or Git from the dock when needed.

[Screenshot tour](overview.md) · [First-use walkthrough](first-steps.md) · [User guides](MOC.md). Detailed guides are currently in Korean.

<a id="projects-files-and-search"></a>

### Projects, files, and search

Open a folder with the header **+**, then select a file on the left. `Ctrl+P` finds filenames; `Ctrl+Shift+F` searches file contents.

[Projects, files, and tasks](projects.md) · [Search and replace](../configuration/search.md) · [Project instructions](project-setup.md).

<a id="writing-code-and-media"></a>

### Writing, code, and media

Use **Hotview** to edit rendered Markdown and **Plain** for its source. File content saves automatically. Open code, tables, attachments, PDFs, and media from the file list.

[Editing, saving, and file history](editor.md).

<a id="git"></a>

### Git

Open **Git** from the dock to see changed files and commit history. Open a file to review its diff and select files for a commit.

[Git panel](projects.md#git-작업-패널).

<a id="collaboration-and-sharing"></a>

### Collaboration and sharing

Edit documents together and use comments, mentions, and chat. Roles, features, and file permissions control access for other accounts and guests.

[Collaboration and sharing](collaboration.md) · [Security](../operations/security.md).

<a id="terminals-agents-and-automation"></a>

### Terminals, agents, and automation

Open a terminal or agent from the dock. Install and authenticate your AI runtime first. Follow the guides for conversations, command buttons, and schedules.

[Terminals and agents](terminal-agents.md) · [Runtime setup](../configuration/agent-runtimes.md) · [Commands and schedules](commands.md).

<a id="browser-android-and-remote-desktop"></a>

### Browser, Android, and remote desktop

Use the server browser for webpages. Android and remote desktop need separate environment preparation, installation, and OS permissions; check their support limits first.

[Browser and Android](browser.md) · [Remote desktop](remote-desktop.md).

<a id="databases"></a>

### Databases

After configuring Postgres, use `/db` to insert a database table in a document. This is separate from Markdown tables; editing documents and code does not require a DB.

[Database tables](database.md).

<a id="layout-settings-and-accounts"></a>

### Layout, settings, and accounts

Open panels from the dock and drag tabs to arrange them. On phones, switch panels with the bottom dock. **Settings** controls theme, language, fonts, shortcuts, Mewpet, and your account.

[Split views and mobile](editor.md) · [Environment and accounts](../configuration/MOC.md).

<a id="running-and-updating"></a>

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

<a id="documentation"></a>

## Documentation

Start at the [document map](../MOC.md). Detailed product specs, usage, operating procedures, and work records belong in `docs/`; this guide covers setup and everyday use. Update the relevant documentation whenever code changes.

| Topic | Start here |
| --- | --- |
| Projects, editing, terminals, browsers, commands, and databases | [User guides](MOC.md) |
| Environment variables, accounts, search, and agent runtimes | [Configuration](../configuration/MOC.md) |
| HTTPS, systemd, updates, and backups | [Deployment](../deployment/native.md) |
| Code structure, packages, UI, collaboration, and agent protocols | [Development docs](../development/MOC.md) |
| Product specs, operations, current work, and history | [Document map](../MOC.md) |
| Per-account features and file permissions | [Account settings](../configuration/accounts.md#%EB%82%B4-%EA%B3%84%EC%A0%95%EA%B3%BC-%EA%B3%84%EC%A0%95-%EA%B4%80%EB%A6%AC) · [Access control](../development/access-control.md) |
| Roles, authentication, and guest access | [Security](../operations/security.md) |

On Linux, `sh native/agent-memory/install.sh` installs memory limits for agent work. See [agent memory protection](../operations/agent-memory.md) for activation, checks, low-memory job suspension, queue holds, and error reporting.

---
title: "开始使用 mew"
updated: "2026-10-23"
description: "s-saens/mew 소스의 중국어 간체 설치·첫 로그인·목적별 사용법과 Mewlink·대체 외부 접속, 권한·업데이트·데이터 보존 및 미발행 CLI 경로를 안내한다. 햄버거 메뉴의 Mewlink 연결 진입을 포함한다."
---

# 开始使用 mew

[한국어](getting-started-ko.md) · [English](getting-started-en.md) · [简体中文](getting-started-zh.md) · [日本語](getting-started-ja.md)

mew 可在浏览器中打开电脑或服务器上的文件夹。你可以编辑 Markdown 和代码，运行终端和 AI agent，审查 Git 更改，并与他人一起处理文档；也可在手机上使用。

<a id="quick-start"></a>

[首次使用](#first-steps) · [远程访问](#remote-access) · [运行与更新](#running-and-updating) · [文档](#documentation)

## 快速开始

[Windows（WSL 2）](#windows-wsl-2) · [macOS](#macos) · [Linux](#linux) · [远程访问](#remote-access)

<a id="windows-wsl-2"></a>

### Windows（WSL 2）

在 WSL 2 的 Ubuntu 中运行 mew，再用 Windows 浏览器打开它。

**1. 安装 WSL 和 Ubuntu。**以管理员身份打开 PowerShell，运行：

```powershell
wsl --install -d Ubuntu
```

重启 Windows，从开始菜单打开 **Ubuntu**，创建 Linux 用户名和密码。它与 Windows 登录账户相互独立。该命令要求 Windows 11 或 Windows 10 版本 2004（内部版本 19041）及以上。安装失败时请参阅 [Microsoft 的 WSL 安装指南](https://learn.microsoft.com/en-us/windows/wsl/install)。

若已安装 Ubuntu，请在 PowerShell 中以 `wsl -l -v` 查看其状态。如果版本为 `1`，使用列表中显示的发行版名称运行 `wsl --set-version Ubuntu 2`。

**2. 安装 mew。**在 **Ubuntu** 中运行：

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential python3 tmux
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/s-saens/mew.git
cd mew
./mew setup
```

如出现提示，请接受通过 nvm 安装 Node 的选项。将仓库和项目放在 Linux 文件系统中，例如 `~/apps` 和 `~/mew-workspace`，Linux 工具的性能会更好。可用 `explorer.exe .` 在 Windows 资源管理器中打开当前文件夹。参阅 [Microsoft 的 WSL 文件存储说明](https://learn.microsoft.com/en-us/windows/wsl/setup/environment#file-storage)。

**3. 登录。**按照下面的[完成设置](#finish-setup)操作，然后在 Edge、Chrome 或其他 Windows 浏览器中打开终端显示的 URL。通常是 `http://localhost:5000`；[WSL 会将 localhost 访问从 Windows 转发过来](https://learn.microsoft.com/en-us/windows/wsl/networking#accessing-linux-networking-apps-from-windows-localhost)。

<a id="macos"></a>

### macOS

**1. 安装 Apple 命令行工具。**打开终端并运行：

```bash
xcode-select --install
```

等待安装窗口完成。如果工具已安装，直接继续。

**2. 安装 Homebrew 和所需工具。**若未安装 `brew`，运行 [Homebrew](https://brew.sh/) 提供的命令：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

按安装程序的 **Next steps** 将 Homebrew 加入 shell，然后运行：

```bash
brew install tmux python
```

**3. 安装 mew。**在同一终端窗口运行：

```bash
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/s-saens/mew.git
cd mew
./mew setup
```

如出现提示，请接受通过 nvm 安装 Node 的选项。按下面的[完成设置](#finish-setup)操作，然后在浏览器中打开终端显示的 URL。

设置还会准备远程桌面助手。在运行 mew 的 Mac 上，系统设置打开时，请为 Electron 批准 **Accessibility** 和 **Screen Recording** 权限。检测到这些权限后，设置会继续。详见 [Mac 权限准备](../guides/remote-desktop.md#mac-%EA%B6%8C%ED%95%9C-%EC%A4%80%EB%B9%84)。

<a id="linux"></a>

### Linux

在 Debian 或 Ubuntu 上：

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential python3 tmux
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/s-saens/mew.git
cd mew
./mew setup
```

其他发行版请先安装等效软件包。然后按上面的[完成设置](#finish-setup)操作。服务器需要开机启动或接受远程连接时，请使用[部署指南](../deployment/native.md)。

<a id="finish-setup"></a>

### 完成设置

安装程序会询问：

- **工作区文件夹：**项目的父目录。默认是 `~/mew-workspace`；其中的每个文件夹都会成为一个项目。
- **端口：**默认 `5000`。若端口已被占用，setup 会选择附近可用的端口。
- **Postgres 连接：**可选，用于数据库表。可跳过，之后再添加。
- **所有者邮箱：**第一个 mew 账户。设置程序会显示临时密码。

设置会安装依赖、准备远程桌面组件、构建应用并启动服务器。首次下载可能需要几分钟。远程桌面准备失败会显示为警告，不会阻止其余安装。

打开 setup 显示的 URL，登录后修改临时密码。使用页眉中的 **+** 打开项目文件夹，再从侧边栏选择文件。

重启后，打开 Ubuntu 或终端，在安装目录中启动 mew：

```bash
cd ~/apps/mew
./mew start
```

### 一条命令运行（首次发布后）

安装 Node.js 24 后，可在工作文件夹运行以下命令，下载预构建的应用。**实现已准备好，但首次 npm 包和 GitHub 运行包尚未发布。**

```bash
cd /path/to/workspace
npx @liiiiv/mew-cli@latest
```

支持 Linux glibc 2.35 以上、macOS 15 以上的 x64/arm64。Windows 请在 WSL 2 的 Ubuntu 22.04 以上运行。首次输入 owner 邮箱，用终端显示的临时密码登录并修改密码。已有账户、会话和设备注册会被保留。按[远程访问](#remote-access)步骤注册 Mewlink，终端也会显示注册链接和在线地址的二维码。

按 Ctrl+C 停止，再次运行相同命令即可使用最新发布版本。如果旧 clone 使用 `.data/`，先停止旧服务器，再传入 `--data-dir /path/to/old/mew/.data`。远程桌面仍需准备可选组件和操作系统权限。[运行与数据约定](../development/cli-distribution.md) · [发布步骤](../deployment/cli-release.md)

<a id="remote-access"></a>

### 远程访问

可用 Mewlink 从其他浏览器连接，也可选择 Tailscale 或 Cloudflare Tunnel。请保持主机唤醒、mew 运行及网络连接。使用代理方案时，保持 `MEW_BIND=127.0.0.1`，并将 `5000` 替换为安装时选择的端口。

#### 1. Mewlink

1. 在本机 mew 中以 owner 登录并修改临时密码，打开**菜单 → Mewlink → 远程访问 → 注册设备**。
2. 打开注册 URL，登录 Mewlink 并设置用户名和设备名称。
3. 确认在线状态并复制 `https://mew.saens.kr/<用户名>/<设备名>` 连接地址。
4. 在另一台设备打开该地址，无需登录 Mewlink 即可连接并显示主机的 mew 登录页。使用**该电脑的本地 mew 邮箱和密码**登录。连接端无需注册设备；保存的本地会话仍有效时，下次可继续使用。

Mewlink 登录仅用于设备注册、列表和删除。要让其他人使用，请创建其本地 mew 账户并设置角色、功能和文件权限，使用本地密码登录时不需要 Mewlink 账户。本地登录成功前禁止访问工作数据。

主机必须保持运行和联网；阻止直接连接的网络会显示连接错误。此模式不支持 Android iframe。运行 `./mew remote-access account` 可再次查看注册说明。运营者请参阅[中央服务配置](../deployment/remote-central.md)。应用此改动需要更新本地 mew 并重新部署 Mewlink，真实外网验证另行进行。

如需无密码访问，访问者可在设备登录页面选择 **使用 Mewlink 登录 → 请求访问**。owner 在 **账户管理 → Mewlink 账户访问** 中批准身份，将其关联到现有本地用户或创建新用户（默认角色为 member）。权限由本地 mew 管理，解除关联即可撤销访问。注册账户或相同邮箱不会自动授予访问权。此流程需要更新本地 mew 并重新部署 Mewlink；登录提供者及外网验证范围请参阅[远程访问契约](../development/remote-access.md#검증과-남은-게이트)。

#### 2. Tailscale

用于自己的设备。不需要购买域名，访问限制在私有 Tailscale 网络（tailnet）内。

1. 在 mew 主机以及每一台需要连接的设备上[安装 Tailscale](https://tailscale.com/download)。所有设备登录同一个 tailnet。

2. 在 mew 主机上运行：

   ```bash
   tailscale serve --bg http://127.0.0.1:5000
   ```

   若出现提示，请打开显示的链接以启用 HTTPS。在 Linux 上，如命令提示权限错误，请使用 `sudo`。对于 WSL 2，请在确认 `http://localhost:5000` 能在 Windows 浏览器中打开后，将 Tailscale 安装在 **Windows** 上，并在 **PowerShell** 中运行此命令。

3. 在手机或另一台电脑连接 Tailscale 后，打开显示的 `https://<machine>.<tailnet>.ts.net` URL，登录 mew。

参阅官方 [Tailscale Serve 指南](https://tailscale.com/docs/features/tailscale-serve)和[命令参考](https://tailscale.com/docs/reference/tailscale-cli/serve)。

#### 3. Cloudflare Tunnel

如需稳定的 HTTPS 地址，并且连接设备无需安装 Tailscale，请使用此方式。**该设置要求域名由 Cloudflare DNS 管理。**

1. 按官方 [Cloudflare 域名注册指南](https://developers.cloudflare.com/registrar/get-started/register-domain/)购买域名，或将[现有域名添加到 Cloudflare](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/)，并按其说明设置名称服务器。
2. 按官方 [Cloudflare Tunnel 设置指南](https://developers.cloudflare.com/tunnel/get-started/)创建隧道，在 mew 主机上安装并运行 `cloudflared`。对于 WSL 2，请在与 mew 相同的 Ubuntu 环境中运行 `cloudflared`。
3. 添加一条 **Published application** 路由，主机名可为 `mew.example.com`，服务 URL 为 `http://127.0.0.1:5000`。路径留空，使 mew 在 `/` 提供服务。
4. 保持 `cloudflared` 运行，然后从另一台设备打开 `https://mew.example.com` 并登录 mew。

这会创建公开的 HTTPS 入口；mew 的账户权限仍然生效。有关代理要求和连接检查，请参阅 [Security](../operations/security.md) 和[部署指南](../deployment/native.md#2-https-%ED%94%84%EB%A1%9D%EC%8B%9C-%EB%98%90%EB%8A%94-%ED%84%B0%EB%84%90-%EC%97%B0%EA%B2%B0)。

## 系统要求与权限

服务器运行在 Linux 或 macOS；Windows 通过 WSL 2 使用。它需要 Node 22.18+ 或 24+，建议使用 Node 24。终端使用 tmux 和本地编译的 `node-pty`，因此 setup 需要 Python 和 C/C++ 工具链。Docker 可选，仅用于 Postgres；目前不支持在容器中运行 mew 应用。

仅与信任的人共同使用 mew。默认情况下，`manager` 和 `owner` 账户可按服务器用户的操作系统权限运行终端和 agent。向其他账户授予这些功能，就等于授予相同的访问权限。在向他人提供实例前，请阅读 [安全](../operations/security.md)。

<a id="first-steps"></a>

## 使用 mew

打开安装程序显示的地址，以 owner 登录并更改临时密码。

1. 用页眉的 **+** 打开工作文件夹。
2. 从左侧列表选择 Markdown 或代码文件。
3. 按需从 dock 打开终端、agent 或 Git。

[界面截图](overview.md) · [首次操作指南](first-steps.md) · [用户指南](MOC.md)。详细指南目前为韩文。

<a id="projects-files-and-search"></a>

### 项目、文件与搜索

用页眉的 **+** 打开文件夹，再从左侧选择文件。`Ctrl+P` 搜索文件名，`Ctrl+Shift+F` 搜索文件内容。

[项目、文件和任务](projects.md) · [搜索与替换](../configuration/search.md) · [项目设置](project-setup.md).

<a id="writing-code-and-media"></a>

### 写作、代码与媒体

用 **Hotview** 编辑渲染后的 Markdown，用 **Plain** 查看源文本。内容会自动保存。代码、表格、附件、PDF 和媒体都从文件列表打开。

[编辑、保存与文件历史](editor.md).

<a id="git"></a>

### Git

从 dock 打开 **Git**，查看更改文件与提交记录。打开文件检查 diff，再选择要提交的文件。

[Git 面板](projects.md#git-작업-패널).

<a id="collaboration-and-sharing"></a>

### 协作与共享

支持共同编辑、评论、提及和聊天。其他账户与访客的访问受角色、功能和文件权限控制。

[协作与共享](collaboration.md) · [安全](../operations/security.md).

<a id="terminals-agents-and-automation"></a>

### 终端、agent 与自动化

从 dock 打开终端或 agent。先安装并认证 AI 运行时。对话、命令按钮和计划任务请参阅相应指南。

[终端与 agent](terminal-agents.md) · [运行时设置](../configuration/agent-runtimes.md) · [命令与计划任务](commands.md).

<a id="browser-android-and-remote-desktop"></a>

### 浏览器、Android 与远程桌面

用服务器浏览器打开网页。Android 与远程桌面需要单独准备环境、安装组件和授予操作系统权限；请先检查支持范围。

[浏览器与 Android](browser.md) · [远程桌面](remote-desktop.md).

<a id="databases"></a>

### 数据库

配置 Postgres 后，用 `/db` 在文档中插入数据库表。这与 Markdown 表格是不同功能；编辑文档和代码不需要数据库。

[数据库表](database.md).

<a id="layout-settings-and-accounts"></a>

### 布局、设置与账户

用 dock 打开面板并拖动标签调整布局。手机上用底部 dock 切换。**Settings** 控制主题、语言、字体、快捷键、Mewpet 和账户。

[分屏与移动界面](editor.md) · [环境与账户](../configuration/MOC.md).

<a id="running-and-updating"></a>

## 运行与更新

请在 mew 仓库中运行以下命令。Windows 请使用 Ubuntu 终端。

```bash
./mew start                    # 启动服务器
./mew stop                     # 停止服务器
./mew restart                  # 重启服务器
./mew status                   # 显示状态和路径
./mew logs                     # 跟踪服务器日志
./mew update                   # 拉取 origin/main、安装、构建并重启
./mew desktop-setup            # 准备桌面助手，不重启 mew
./mew users add you@example.com owner
```

`./mew update` 使用 fast-forward 拉取。由 `./mew start` 启动的安装也可从应用菜单检查和安装更新。由 systemd 或其他监督程序管理的服务器，请遵循单独的[部署和更新流程](../deployment/native.md)。

设置和运行时数据默认保存在克隆目录外：

| 内容 | 位置 |
| --- | --- |
| 配置 | `~/.config/mew/config.env` |
| 账户、会话和已完成的 agent 轮次 | `~/.local/share/mew/` |
| 日志 | `~/.local/state/mew/` |

删除克隆目录不会删除这些文件。请将它们与工作区和所有 Postgres 数据一同备份。覆盖设置请参阅[服务器配置](../configuration/environment.md#%EC%84%9C%EB%B2%84-%EC%84%A4%EC%A0%95)。

要从手机或另一台电脑连接，请按[远程访问](#remote-access)操作。默认服务器绑定到主机本地。个人 `./mew start` 安装不会注册自动启动服务。

若设置期间远程桌面准备失败，请用 `./mew desktop-setup` 重试。它会安装助手并处理 Mac 权限设置，无需构建应用或重启服务器。仍需已登录的桌面、相关操作系统库和权限；参阅[操作系统要求](../guides/remote-desktop.md#%EC%B2%98%EC%9D%8C-%EC%97%B0%EA%B2%B0)。

在 macOS 上，mew 会在打开终端前修复 `node-pty` 1.1.0 的 `spawn-helper` 缺失的执行权限。终端持续空白时，请在服务器日志中检查 `[mew:tmux]` 错误。

<a id="documentation"></a>

## 文档

从[文档地图](../MOC.md)开始。详细产品规格、使用说明、操作流程和工作记录位于 `docs/`；本指南介绍设置和日常使用。代码更改时，请同步更新相关文档。

| 主题 | 从这里开始 |
| --- | --- |
| 项目、编辑、终端、浏览器、命令和数据库 | [用户指南](../guides/MOC.md) |
| 环境变量、账户、搜索和 agent 运行时 | [配置](../configuration/MOC.md) |
| HTTPS、systemd、更新和备份 | [部署](../deployment/native.md) |
| 代码结构、包、界面、协作和 agent 协议 | [开发文档](../development/MOC.md) |
| 产品规格、运营、当前工作和历史 | [文档地图](../MOC.md) |
| 按账户划分的功能和文件权限 | [账户设置](../configuration/accounts.md#%EB%82%B4-%EA%B3%84%EC%A0%95%EA%B3%BC-%EA%B3%84%EC%A0%95-%EA%B4%80%EB%A6%AC) · [访问控制](../development/access-control.md) |
| 角色、身份验证和访客访问 | [安全](../operations/security.md) |

在 Linux 上，`sh native/agent-memory/install.sh` 会为 agent 工作安装内存限制。有关启用、检查、低内存时暂停任务、队列保持和错误报告，请参阅 [agent 内存保护](../operations/agent-memory.md)。

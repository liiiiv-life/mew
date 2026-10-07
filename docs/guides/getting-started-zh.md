---
description: "중국어 간체판 mew 시작 안내로 Windows WSL·macOS·Linux 설치와 HTTPS·계정 기반 P2P 원격 접속, 주요 기능·권한·실행·업데이트 방법을 설명한다."
---
# 使用 mew

[한국어](getting-started-ko.md) · [English](getting-started-en.md) · [简体中文](getting-started-zh.md) · [日本語](getting-started-ja.md)

mew 可在浏览器中打开电脑或服务器上的文件夹。你可以编辑 Markdown 和代码，运行终端和 AI agent，审查 Git 更改，并与他人一起处理文档；也可在手机上使用。

<a id="quick-start"></a>

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
git clone https://github.com/liiiiv-life/mew.git
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
git clone https://github.com/liiiiv-life/mew.git
cd mew
./mew setup
```

如出现提示，请接受通过 nvm 安装 Node 的选项。按下面的[完成设置](#finish-setup)操作，然后在浏览器中打开终端显示的 URL。

设置还会准备远程桌面助手。在运行 mew 的 Mac 上，系统设置打开时，请为 Electron 批准 **Accessibility** 和 **Screen Recording** 权限。检测到这些权限后，设置会继续。详见 [Mac 权限准备](../guides/remote-desktop.md#mac-%EA%B6%8C%ED%95%9C-%EC%A4%80%EB%B9%84)。

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

<a id="linux"></a>

### Linux

在 Debian 或 Ubuntu 上：

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential python3 tmux
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/liiiiv-life/mew.git
cd mew
./mew setup
```

其他发行版请先安装等效软件包。然后按上面的[完成设置](#finish-setup)操作。服务器需要开机启动或接受远程连接时，请使用[部署指南](../deployment/native.md)。

<a id="remote-access"></a>

### 远程访问

设置完成后，可用以下任一方式从手机或另一台电脑打开 mew。保持主机唤醒且 mew 正在运行。Tailscale 和 Cloudflare Tunnel 会将 HTTPS 流量转发到本地 mew 服务器；保持 `MEW_BIND=127.0.0.1`，如设置端口不是 `5000`，请替换命令中的端口。

#### 1. Tailscale（推荐）

用于自己的设备。不需要购买域名，访问限制在私有 Tailscale 网络（tailnet）内。

1. 在 mew 主机以及每一台需要连接的设备上[安装 Tailscale](https://tailscale.com/download)。所有设备登录同一个 tailnet。

2. 在 mew 主机上运行：

   ```bash
   tailscale serve --bg http://127.0.0.1:5000
   ```

   若出现提示，请打开显示的链接以启用 HTTPS。在 Linux 上，如命令提示权限错误，请使用 `sudo`。对于 WSL 2，请在确认 `http://localhost:5000` 能在 Windows 浏览器中打开后，将 Tailscale 安装在 **Windows** 上，并在 **PowerShell** 中运行此命令。

3. 在手机或另一台电脑连接 Tailscale 后，打开显示的 `https://<machine>.<tailnet>.ts.net` URL，登录 mew。

参阅官方 [Tailscale Serve 指南](https://tailscale.com/docs/features/tailscale-serve)和[命令参考](https://tailscale.com/docs/reference/tailscale-cli/serve)。

#### 2. Cloudflare Tunnel

如需稳定的 HTTPS 地址，并且连接设备无需安装 Tailscale，请使用此方式。**该设置要求域名由 Cloudflare DNS 管理。**

1. 按官方 [Cloudflare 域名注册指南](https://developers.cloudflare.com/registrar/get-started/register-domain/)购买域名，或将[现有域名添加到 Cloudflare](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/)，并按其说明设置名称服务器。
2. 按官方 [Cloudflare Tunnel 设置指南](https://developers.cloudflare.com/tunnel/get-started/)创建隧道，在 mew 主机上安装并运行 `cloudflared`。对于 WSL 2，请在与 mew 相同的 Ubuntu 环境中运行 `cloudflared`。
3. 添加一条 **Published application** 路由，主机名可为 `mew.example.com`，服务 URL 为 `http://127.0.0.1:5000`。路径留空，使 mew 在 `/` 提供服务。
4. 保持 `cloudflared` 运行，然后从另一台设备打开 `https://mew.example.com` 并登录 mew。

这会创建公开的 HTTPS 入口；mew 的账户权限仍然生效。有关代理要求和连接检查，请参阅 [Security](../../SECURITY.md) 和[部署指南](../deployment/native.md#2-https-%ED%94%84%EB%A1%9D%EC%8B%9C-%EB%98%90%EB%8A%94-%ED%84%B0%EB%84%90-%EC%97%B0%EA%B2%B0)。

#### 3. 使用 mew 账户连接（需要配置中央服务）

1. 在本机 mew 中以 owner 登录并修改临时密码，打开**账户管理 → 远程访问**。
2. 打开注册 URL，登录中央服务并确认设备名称。每台主机只需注册一次。
3. 在另一台设备打开生成的连接 URL 或 `/dashboard`，使用同一中央账户登录。连接端浏览器无需再次注册设备。
4. 允许其他用户时，将其中央账户 ID 映射到已有的本地 mew 账户。本地权限和工作目录限制继续生效。

中央服务部署、OAuth 配置以及真实网络测试仍需单独完成，详见[运营说明](../deployment/remote-central.md)。工作数据通过主机与浏览器之间的 WebRTC 直连传输；无法直连的网络会显示连接错误。此模式暂不支持 Android 面板或通用 iframe 代理。也可运行 `./mew remote-access account` 查看注册步骤。

## 系统要求与权限

服务器运行在 Linux 或 macOS；Windows 通过 WSL 2 使用。它需要 Node 22.18+ 或 24+，建议使用 Node 24。终端使用 tmux 和本地编译的 `node-pty`，因此 setup 需要 Python 和 C/C++ 工具链。Docker 可选，仅用于 Postgres；目前不支持在容器中运行 mew 应用。

仅与信任的人共同使用 mew。默认情况下，`manager` 和 `owner` 账户可按服务器用户的操作系统权限运行终端和 agent。向其他账户授予这些功能，就等于授予相同的访问权限。在向他人提供实例前，请阅读 [SECURITY.md](../../SECURITY.md)。

## 使用 mew

下文的 **Menu** 指右上角菜单。工作区面板从 dock 打开，其他操作和设置在菜单中。快捷键使用默认绑定；可在 **Settings → Shortcuts** 中修改。这里链接的大部分详细指南目前为韩文。

- [项目、文件与搜索](#projects-files-and-search)
- [写作、代码与媒体](#writing-code-and-media)
- [Git](#git)
- [协作与共享](#collaboration-and-sharing)
- [终端、agent 与自动化](#terminals-agents-and-automation)
- [浏览器、Android 与远程桌面](#browser-android-and-remote-desktop)
- [数据库](#databases)
- [布局、设置与账户](#layout-settings-and-accounts)
- [运行与更新](#running-and-updating) · [开发](../development/getting-started.md) · [文档](#documentation)

<a id="projects-files-and-search"></a>

### 项目、文件与搜索

| 任务 | 从这里开始 | 详情 |
| --- | --- | --- |
| 打开和整理项目 | 页眉 **+** 或 `Ctrl+O`。切换标签、修改图标，或长按标签以分组和重新排序项目（owner）。 | [项目标签](../guides/projects.md#%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%ED%83%AD) |
| 创建项目或克隆仓库 | 在项目文件夹选择器中创建文件夹、克隆仓库或初始化 Git（owner）。 | [项目设置](../guides/projects.md#%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%ED%83%AD) |
| 前往收藏夹或云端文件夹 | 文件夹选择器和服务器文件浏览器会列出操作系统文件夹，以及检测到的 OneDrive、Google Drive、Dropbox 和 iCloud 文件夹。收藏夹归你的账户所有。 | [文件夹快捷方式](../guides/projects.md#%ED%81%B4%EB%9D%BC%EC%9A%B0%EB%93%9C-%ED%8F%B4%EB%8D%94-%EB%B0%94%EB%A1%9C%EA%B0%80%EA%B8%B0) |
| 浏览 Documents 和子项目 | 在侧边栏展开文件夹。在独立标签中打开 `.mew` 子项目，或右键文件夹将其标为子项目（owner）。**Map Of Contents** 会打开其文档地图。 | [侧边栏结构](../guides/projects.md#%EC%82%AC%EC%9D%B4%EB%93%9C%EB%B0%94%EC%9D%98-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8--%ED%95%98%EC%9C%84-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8--documents) |
| 设置项目指令 | 使用 agent 面板的默认指令设定提交、语言和回复长度偏好。右键 **Documents** 可设置文档、预览及创建缺失文件（owner）。也可使用 CLI。 | [指令与设置](../guides/project-setup.md) |
| 管理 Documents | 右键 **Documents** 可修改其文件夹、导入或导出（owner）。导入会替换现有内容。 | [Documents 文件夹](../guides/projects.md#documents-%ED%8F%B4%EB%8D%94-%EA%B3%84%EC%95%BD) |
| 管理文件和文件夹 | 右键或长按项目以创建、重命名、复制、拷贝、移动、删除或下载。拖动文件即可移动或上传。 | [文件操作](../guides/projects.md#%ED%8C%8C%EC%9D%BC%ED%8F%B4%EB%8D%94-%EA%B4%80%EB%A6%AC) · [拖放](../guides/editor.md#%EC%82%AC%EC%9D%B4%EB%93%9C%EB%B0%94-%ED%95%AD%EB%AA%A9-%EB%81%8C%EC%96%B4%EB%86%93%EA%B8%B0) |
| 浏览项目外的文件 | **Menu → File browser** 打开服务器文件系统（manager 或 owner）。 | [服务器文件浏览器](../guides/projects.md#%EC%84%9C%EB%B2%84-%ED%8C%8C%EC%9D%BC-%ED%83%90%EC%83%89%EA%B8%B0) |
| 查找文件或文本 | `Ctrl+P` 查找文件名；`@` 将范围缩小至 Documents 或子项目。`Ctrl+Shift+F` 跨文件搜索内容，支持区分大小写、正则表达式和替换。 | [搜索与替换](../configuration/search.md#%ED%8C%8C%EC%9D%BC%EB%AA%85%EB%82%B4%EC%9A%A9-%EA%B2%80%EC%83%89%EA%B3%BC-%EC%B9%98%ED%99%98) |
| 排除文件 | **Settings → Ignore list** 控制搜索、文件监视及某些角色文件树中排除的名称（manager 或 owner）。 | [忽略规则](../guides/projects.md#%EC%88%A8%EA%B9%80-%EB%AA%A9%EB%A1%9D-dataignorejson) |

<a id="writing-code-and-media"></a>

### 写作、代码与媒体

| 任务 | 从这里开始 | 详情 |
| --- | --- | --- |
| 编辑 Markdown | 打开 `.md` 文件。**Hotview** 编辑渲染后的文档；**Plain** 编辑源代码。可使用标题、列表、复选框、引用、代码块和行内格式。 | [编辑基础](../guides/editor.md#%EA%B8%B0%EB%B3%B8-%ED%8E%B8%EC%A7%91) |
| 编辑元数据或跳转到标题 | 编辑 Hotview 上方的 frontmatter 字段，或使用目录。 | [文档结构](../guides/editor.md#%EA%B8%B0%EB%B3%B8-%ED%8E%B8%EC%A7%91) |
| 编辑代码 | 打开源文件，可获得行号、语法高亮及受支持格式的诊断。`Ctrl+F` 打开查找和替换。 | [代码编辑](../guides/editor.md#%EA%B8%B0%EB%B3%B8-%ED%8E%B8%EC%A7%91) |
| 插入链接和附件 | `Ctrl+K` 编辑链接；在 Hotview 中用 `@` 链接文件。拖入或粘贴图像后可调整大小，也可用 `/` 上传文件。可插入 YouTube 内容块，但播放需要修改部署 CSP。 | [链接与附件](../guides/editor.md#%EB%A7%81%ED%81%AC%EC%99%80-%EC%B2%A8%EB%B6%80) |
| 使用表格 | 通过 `/` 插入表格，编辑行列、调整列宽，并复制为 Markdown、CSV 或图像。 | [表格](../guides/editor.md#%ED%91%9C-%ED%8E%B8%EC%A7%91%EA%B3%BC-%EB%B3%B5%EC%82%AC) · [列宽](../guides/editor.md#%ED%91%9C-%EC%97%B4-%EB%84%88%EB%B9%84-mewtable-layoutjson) |
| 缩进列表 | 使用 `Tab` 和 `Shift+Tab`，包括第一个项目。 | [列表缩进](../guides/editor.md#%EB%A6%AC%EC%8A%A4%ED%8A%B8-%EC%B2%AB-%ED%95%AD%EB%AA%A9-%EB%93%A4%EC%97%AC%EC%93%B0%EA%B8%B0-----b) |
| 添加脚注 | `Alt+E` 插入脚注。编号以及标记和引用之间的链接会自动维护。 | [脚注](../guides/editor.md#%EA%B0%81%EC%A3%BC-alte) |
| 查看媒体和电子表格 | 预览图像、音频、视频和 PDF；在 SVG 的图像与源代码间切换；读取 XLSX、CSV 和 TSV 文件；下载 APK 和 AAB 文件。 | [文件预览](../guides/editor.md#%EB%AF%B8%EB%94%94%EC%96%B4%EC%99%80-%EC%8B%9C%ED%8A%B8-%EB%B3%B4%EA%B8%B0) |
| 阅读和标注 PDF | 使用 PDF 工具栏进行全屏、翻页、缩放、选择文本、画笔和高亮。保存到 PDF，或下载标注副本。 | [PDF 工具](../guides/editor.md#pdf-%EC%9D%BD%EA%B8%B0%EC%99%80-%ED%95%84%EA%B8%B0) |
| 保存和撤销 | 编辑会自动保存。使用 `Ctrl+Z` 撤销，`Ctrl+Y` 重做。 | [保存与历史](../guides/editor.md#%EC%9E%90%EB%8F%99%EC%A0%80%EC%9E%A5%EC%BB%A4%EB%B0%8B%ED%8C%8C%EC%9D%BC-%EC%9D%B4%EB%A0%A5) |
| 安排编辑器窗格 | 固定预览标签，然后拖动标签和手柄以拆分、合并、重新排序或调整窗格大小。 | [标签与拆分](../guides/editor.md#%ED%8E%B8%EC%A7%91-%EC%B9%B8-%EB%AC%B8%EC%84%9C-%ED%83%AD--%ED%99%94%EB%A9%B4-%EB%B6%84%ED%95%A0) |
| 发送文件引用 | `Ctrl+L` 将当前路径和所选行发送到终端、agent 或聊天输入框。 | [路径和行引用](../guides/editor.md#ctrll-%EC%B0%B8%EC%A1%B0-%EA%B2%BD%EB%A1%9C%EC%A4%84) |

<a id="git"></a>

### Git

点击 dock 中的 **Git** 或按 `Alt+G`，浏览提交、已更改的文件和差异（manager 或 owner）。在更改列表中选择文件，在底部输入消息并提交。右键提交可复制其哈希、创建分支或标签、检出、cherry-pick 或还原。

**GitHub** 按钮会通过内置浏览器中的设备登录连接服务器 Git 凭据；服务器必须安装 `gh`。**AI auto-commit** 使用 agent 集合和 mew 的提交技能，将所选更改拆分成多个提交。它会创建真实提交，并报告哈希、包含的文件和剩余更改。

对于当前文件，使用 `Ctrl+S` 或 **Menu → Commit**。编辑器历史可检查和恢复较早内容。关闭再打开 Git 面板时，其草稿会保留，也可用桌面手柄移动。

参阅 [Git 工作台](../guides/projects.md#git-%EC%9E%91%EC%97%85-%ED%8C%A8%EB%84%90)、[GitHub 登录](../guides/projects.md#github-%EB%A1%9C%EA%B7%B8%EC%9D%B8)和[文件历史](../guides/editor.md#%EC%9E%90%EB%8F%99%EC%A0%80%EC%9E%A5%EC%BB%A4%EB%B0%8B%ED%8C%8C%EC%9D%BC-%EC%9D%B4%EB%A0%A5)。

<a id="collaboration-and-sharing"></a>

### 协作与共享

| 任务 | 从这里开始 | 详情 |
| --- | --- | --- |
| 共同编辑 | 登录后打开同一文件。编辑器会显示其他参与者和他们的光标。 | [协同编辑](../guides/collaboration.md#%EA%B3%B5%EB%8F%99-%ED%8E%B8%EC%A7%91%EA%B3%BC-%EC%B0%B8%EC%97%AC%EC%9E%90) |
| 保留共享备忘录 | 使用备忘录 dock 图标或 `Ctrl/Cmd+M`。服务器共用的 Markdown 备忘录支持实时编辑、参与者颜色，也可拖动标题移动它。 | [共享备忘录](../guides/collaboration.md#%EA%B3%B5%ED%86%B5-%EB%A9%94%EB%AA%A8) |
| 查看谁已连接 | 点击菜单旁的会话数，查看用户、设备、项目和当前文件。 | [活动会话](../guides/collaboration.md#%EC%A0%91%EC%86%8D-%EC%A4%91%EC%9D%B8-mew-%EC%84%B8%EC%85%98) |
| 为文档添加评论 | 选择文本并按 `Alt+Shift+C`。可通过高亮或评论列表回复、编辑、删除或提及他人。 | [评论](../guides/collaboration.md#%EB%8C%93%EA%B8%80%EA%B3%BC-%EB%8B%B5%EA%B8%80) |
| 与成员聊天 | **Menu → Chat** 或 `Alt+C` 打开群组聊天和私信，支持文件引用和已读回执。 | [聊天](../guides/collaboration.md#%EB%8B%A8%EC%B2%B4-%EC%B1%84%ED%8C%85%EA%B3%BC-dm) |
| 与访客共享 | owner 可在账户管理的文件与文件夹权限中，向未登录访客授予特定路径的读取或编辑权限。 | [访客共享](../guides/collaboration.md#%EA%B2%8C%EC%8A%A4%ED%8A%B8-%EA%B3%B5%EC%9C%A0) |

<a id="terminals-agents-and-automation"></a>

### 终端、agent 与自动化

终端和 agent 功能默认向 manager 和 owner 开放。取决于运行时，agent 会在聊天面板或其官方 CLI 终端中打开。

| 任务 | 从这里开始 | 详情 |
| --- | --- | --- |
| 打开 shell | dock 中的 **Terminal**、`Ctrl+Backtick` 或 `Alt+T`。可创建、重新连接和结束 tmux 会话。 | [终端与标签](../guides/terminal-agents.md) |
| 选择 agent | dock 中的 **Agent**（`Alt+L`）→ **+**。运行时包括 Claude Agent、Antigravity、Codex、Hermes、Kimi、OpenClaw、OpenCode、Cursor 和 Prime。 | [运行时支持](../configuration/agent-runtimes.md#%EB%AA%A8%EB%8D%B8%EA%B6%8C%ED%95%9C-%EA%B8%B0%EB%B3%B8%EA%B0%92%EA%B3%BC-%EB%9F%B0%ED%83%80%EC%9E%84-%EC%84%A0%ED%83%9D) |
| 安装或配置运行时 | 在运行时列表中使用安装和设置按钮进行身份验证、启动设置，以及受支持的退出登录或移除操作。Antigravity 使用 Google 官方 ACP 服务器。 | [运行时设置](../configuration/agent-runtimes.md) |
| 选择模型、推理与权限 | 使用 ACP 聊天输入框旁的控件。将支持的设置保存为运行时默认值。 | [模型与默认值](../configuration/agent-runtimes.md#%EB%AA%A8%EB%8D%B8%EA%B6%8C%ED%95%9C-%EA%B8%B0%EB%B3%B8%EA%B0%92%EA%B3%BC-%EB%9F%B0%ED%83%80%EC%9E%84-%EC%84%A0%ED%83%9D) |
| 复用 agent 设置 | 从带有模型和角色预设的 agent 集合创建标签。可重命名标签、切换运行时和安排拆分。 | [Agent 标签](../guides/terminal-agents.md) |
| 向提示添加上下文 | `@` 引用项目、文件和文件夹；`/` 选择本地技能。可附加文件或图像，并用方向键调出已发送的输入。 | [Agent 输入](../features/%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94/%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%20%EC%9E%85%EB%A0%A5%C2%B7%EB%A9%98%EC%85%98%C2%B7%EC%8A%A4%ED%82%AC%C2%B7%EC%B2%A8%EB%B6%80.md) |
| 管理对话 | 发送或停止工作，查看工具活动和经过时间，编辑或重排排队消息，并用 `/clear` 开始新对话。 | [对话控制](../guides/terminal-agents.md#%EB%8C%80%ED%99%94-%EC%A7%84%ED%96%89%EA%B3%BC-%EA%B8%B0%EB%A1%9D) |
| 从聊天运行 shell 命令 | 切换模型选择器旁的终端图标。随后可打开命令的 tmux、停止命令，或查看和下载保存的输出。 | [CLI 命令模式](../guides/terminal-agents.md#%EB%8C%80%ED%99%94%EC%97%90%EC%84%9C-cli-%EB%AA%85%EB%A0%B9-%EC%8B%A4%ED%96%89) |
| 继续之前的工作 | 从历史记录选择会话。在外部 CLI 中工作后，使用 **Refresh current conversation**。回复中的文件链接会在编辑器中打开。 | [会话历史](../guides/terminal-agents.md) |
| 查看账户和用量 | ACP 会话的 **i** 按钮显示可用账户、套餐、限额、令牌用量和 API 等效费用信息。 | [账户与订阅](../configuration/agent-runtimes.md#%EC%84%A4%EC%B9%98%EB%A1%9C%EA%B7%B8%EC%9D%B8%EA%B5%AC%EB%8F%85) |
| 安排消息 | ACP 输入框旁的时钟可向当前会话安排一次性消息。运行前可编辑、重新安排或删除。 | [定时消息](../features/%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94/%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%20%EC%98%88%EC%95%BD%20%EB%A9%94%EC%8B%9C%EC%A7%80.md) |
| 根据功能规格工作 | dock 中的 **Features** 可内联编辑需求并应用到 agent 集合。跟踪源 Markdown、相关文件、提交和用户审查。 | [功能驱动开发](../features/%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94/%EA%B8%B0%EB%8A%A5%20%EA%B8%B0%EB%B0%98%20%EA%B0%9C%EB%B0%9C%C2%B7Markdown%20%EB%AC%B8%EC%84%9C.md) |
| 保存项目命令 | 侧边栏的 **▶** 菜单可添加、编辑、运行和停止命令，输出显示在专用终端弹窗中。 | [项目命令](../guides/commands.md#%EC%82%AC%EC%9D%B4%EB%93%9C%EB%B0%94-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8--%EB%B2%84%ED%8A%BC-mewcmd-buttonjson) |
| 保存 shell 命令 | 使用 shell 标签命令行中的 **+** 添加命令和图标。按钮会向活动 shell 发送输入。 | [终端按钮](../guides/commands.md#%ED%84%B0%EB%AF%B8%EB%84%90-%EB%B2%84%ED%8A%BC-dataterm-buttonjson) |
| 运行周期性任务 | **Menu → Scheduled tasks** 保存文件夹、agent、提示和日程。可立即运行任务、检查输出或删除。 | [周期性任务](../guides/commands.md#%EC%98%88%EC%95%BD-%EC%9E%91%EC%97%85-dataschedulesjson) |

使用 agent 面板 **i** 按钮旁的 **Skills** 和 **MCP**，可在全局、项目和子项目范围检查和管理扩展。关于支持的位置和运行时，请参阅 [skills 与 MCP 配置](../configuration/agent-harness.md)。

<a id="browser-android-and-remote-desktop"></a>

### 浏览器、Android 与远程桌面

这些功能需要额外组件，并向 manager 和 owner 开放。

| 任务 | 从这里开始 | 详情 |
| --- | --- | --- |
| 从服务器浏览 | dock 中的 **Browser** 或 `Alt+B`。可通过标签、表单、上传和下载打开 localhost 服务、私有网络页面或公网网站。 | [服务器浏览器](../guides/browser.md#%EB%B8%8C%EB%9D%BC%EC%9A%B0%EC%A0%80-%EC%B0%BD) |
| 保留浏览器登录 | 每个账户都有服务器端浏览器配置文件。支持弹出窗口和 agent 身份验证，也有独立的 `/browser` 页面。 | [配置文件与限制](../guides/browser.md#%EB%B8%8C%EB%9D%BC%EC%9A%B0%EC%A0%80-%EC%B0%BD) |
| 准备 Android | **Menu → Android** 检查 SDK、加速和 AVD 状态，显示设置命令与终端输出，并连接到已有 WebRTC 网关。 | [Android 设置](../guides/browser.md#android-%EC%B0%BD) |
| 控制桌面 | dock 中的 **Remote desktop** 会准备助手，并连接到已登录的 Mac 或 Linux 桌面，或 mew 在 WSL 中运行时的 Windows 桌面。需要批准操作系统权限。直接视频失败时，会回退到 mew 服务器。 | [远程桌面设置](../guides/remote-desktop.md) |
| 使用远程输入 | 可用鼠标、键盘、粘贴、远程 Esc、手机摇杆、拖动、滚轮、缩放、全屏、旋转、灵敏度、可移动热键和显示器选择。 | [控制](../guides/remote-desktop.md#%EC%A1%B0%EC%9E%91) · [网络与验证范围](../development/remote-desktop.md) |

<a id="databases"></a>

### 数据库

在 Hotview 中使用 `/db` 插入表格，再与其他用户一起编辑标题、行、单元格和列。支持文本、数字、复选框和日期字段。**Menu → Database** 列出当前项目的数据库。

在 `/` 菜单中使用 **Database reference**，可嵌入对现有数据库或外部 Postgres 表的只读引用。配置 `DATABASE_URL` 以连接 Postgres；`npm run db:up` 和 `npm run db:down` 可选择仅通过 Docker Compose 管理数据库。

设置和项目隔离请参阅[数据库指南](../guides/database.md)。

<a id="layout-settings-and-accounts"></a>

### 布局、设置与账户

| 任务 | 从这里开始 | 详情 |
| --- | --- | --- |
| 安排面板 | 拖动编辑器、agent、终端和浏览器的标签或手柄；Git 使用主体手柄。双击桌面标签可展开面板；`Esc` 恢复。浏览器面板只支持水平放置。文档标签、布局和滚动位置会按账户恢复。 | [窗格](../guides/editor.md#%ED%8E%B8%EC%A7%91-%EC%B9%B8-%EB%AC%B8%EC%84%9C-%ED%83%AD--%ED%99%94%EB%A9%B4-%EB%B6%84%ED%95%A0) · [恢复](../guides/projects.md#%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%ED%83%AD) |
| 在手机上工作 | 用底部 dock 切换面板；长按可重新排序。输入时 dock 会隐藏。长按项目打开上下文菜单，使用返回键或 `Esc` 关闭最前方的覆盖层。**Menu → Fullscreen** 或 `Alt+Enter` 切换全屏。桌面端 dock 位于页眉菜单正左侧，图标提示显示在图标下方。 | [手机与全屏](../guides/editor.md#%EB%AA%A8%EB%B0%94%EC%9D%BC%EA%B3%BC-%EC%A0%84%EC%B2%B4%ED%99%94%EB%A9%B4) |
| 更改外观 | **Settings → Appearance** 控制浅色/深色主题、强调色、界面/文档/代码字体，以及韩文、英文、日文或中文。 | [外观](../configuration/environment.md#%ED%99%94%EB%A9%B4-%EC%84%A4%EC%A0%95) |
| 自定义快捷键 | **Settings → Shortcuts** 修改绑定，或重置单个或全部快捷键。 | [快捷键](../configuration/environment.md#%EB%8B%A8%EC%B6%95%ED%82%A4-%EC%84%A4%EC%A0%95) |
| 查看 Mewcat | 点击猫查看最近通知。气泡每半秒更新 CPU、RAM 和 GPU 使用率；点击读数查看系统资源。**Settings → Mewcat** 控制皮肤、声音、通知及工作/休息计时器。可选的强制休息会在工作区上放置一只可拖动的猫；默认关闭。 | [Mewcat](../features/%ED%99%94%EB%A9%B4%C2%B7%EA%B3%84%EC%A0%95%C2%B7%EC%9A%B4%EC%98%81/Mewcat%20%EB%A7%88%EC%8A%A4%EC%BD%94%ED%8A%B8%C2%B7%EC%95%8C%EB%A6%BC%C2%B7%ED%9C%B4%EC%8B%9D.md) |
| 管理自己的账户 | **Settings → Account** 可修改显示名称、头像和密码，或退出登录。 | [账户设置](../configuration/environment.md#%EB%82%B4-%EA%B3%84%EC%A0%95%EA%B3%BC-%EA%B3%84%EC%A0%95-%EA%B4%80%EB%A6%AC) |
| 管理用户 | owner 使用 **Menu → Account management** 添加账户和更改角色。主机 CLI 也可列出用户、重置密码和删除账户。 | [用户管理](../configuration/environment.md#%EB%82%B4-%EA%B3%84%EC%A0%95%EA%B3%BC-%EA%B3%84%EC%A0%95-%EA%B4%80%EB%A6%AC) |
| 检查服务器 | **Menu → System resources** 显示 CPU、内存、GPU、温度、进程和近期用量（manager 或 owner）。 | [系统资源](../guides/commands.md#%EC%8B%9C%EC%8A%A4%ED%85%9C-%EC%9E%90%EC%9B%90-%ED%8C%9D%EC%97%85) |

此前工作区主页的待办清单和日历已不可用。文档复选框和 agent 日程仍受支持。参阅[当前项目范围](../guides/projects.md#%ED%98%84%EC%9E%AC-%EC%A0%9C%EA%B3%B5%ED%95%98%EC%A7%80-%EC%95%8A%EB%8A%94-%ED%99%88-%ED%99%94%EB%A9%B4)。

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
| 按账户划分的功能和文件权限 | [账户设置](../configuration/environment.md#%EB%82%B4-%EA%B3%84%EC%A0%95%EA%B3%BC-%EA%B3%84%EC%A0%95-%EA%B4%80%EB%A6%AC) · [访问控制](../development/access-control.md) |
| 角色、身份验证和访客访问 | [安全](../../SECURITY.md) |

在 Linux 上，`sh native/agent-memory/install.sh` 会为 agent 工作安装内存限制。有关启用、检查、低内存时暂停任务、队列保持和错误报告，请参阅 [agent 内存保护](../operations/agent-memory.md)。

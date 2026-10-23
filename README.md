# mew : my easy workspace

**A browser workspace for your documents, code, and AI agents.**

Open a folder on your computer or server and work with it in your browser. Write Markdown, edit code, run AI agents, and review their changes in Git — with your files in the same place. Connect from your desktop or phone.

[Get started](#get-started) · [Screenshot tour](docs/guides/overview.md) · [User guides](docs/guides/MOC.md) · [Documentation](docs/MOC.md)

**Installation guides:** [한국어](docs/guides/getting-started-ko.md) · [English](docs/guides/getting-started-en.md) · [简体中文](docs/guides/getting-started-zh.md) · [日本語](docs/guides/getting-started-ja.md)

![mew in the dark theme, with a Markdown note and TypeScript code side by side and the capybara Mewpet at the bottom](docs/assets/screenshots/split.png)

*The mew interface in the dark theme with Mewpet enabled, captured with example files. [Explore the screens and capture details](docs/guides/overview.md).*

## What you can do

### Write documents next to your code

Edit Markdown as a rendered document or switch to its source. Use checklists, tables, links, and document properties; open code files in the same editor. Split the workspace to keep your notes beside the implementation. Content saves automatically to files in your folder.

[Document editing](docs/guides/editor.md) · [Projects and file search](docs/guides/projects.md)

### Run terminals and AI agents

Open a project terminal or an AI conversation from the dock. Configure your runtime, attach files, use skills and MCP tools, and return to saved conversations. Arrange panels around the work you are doing.

[Terminals and agents](docs/guides/terminal-agents.md) · [Runtime setup](docs/configuration/agent-runtimes.md)

Mew includes documentation skills for Korean, English, Japanese, and Simplified Chinese, plus a shared commit skill. Open **Skills management → Mew** in the agent panel to inspect them. [Skills and MCP](docs/configuration/agent-harness.md).

### Review the work in Git

See changed files and commit history without leaving the workspace. Open a diff, check what an agent changed, and choose the files to commit. Autosave and Git commits are separate, so you decide when to record a change.

![mew showing a project document alongside Git commit history and changed files](docs/assets/screenshots/git.png)

[Git workflow](docs/guides/projects.md#git-%EC%9E%91%EC%97%85-%ED%8C%A8%EB%84%90)

### Work together, or connect from your phone

Edit documents together, leave comments, chat, and share documents with guests. Account roles and file permissions control access. On a phone, switch between the editor and tools with the bottom dock.

[Collaboration and sharing](docs/guides/collaboration.md) · [Mobile controls](docs/guides/editor.md#%EB%AA%A8%EB%B0%94%EC%9D%BC%EA%B3%BC-%EC%A0%84%EC%B2%B4%ED%99%94%EB%A9%B4)

Also available: [PDF annotation](docs/guides/editor.md#pdf-%EC%9D%BD%EA%B8%B0%EC%99%80-%ED%95%84%EA%B8%B0), a [sign-in screens, localhost apps, and Android](docs/guides/browser.md), [remote desktop](docs/guides/remote-desktop.md), [Postgres tables](docs/guides/database.md), and [command buttons and schedules](docs/guides/commands.md). Remote desktop and Android need their own environment setup; database tables need a Postgres connection.

## Get started

The server runs on **Linux or macOS**. On **Windows**, run it inside **WSL 2** and open it in your Windows browser.

Choose your platform guide for prerequisites and installation:

[Windows / WSL 2](docs/guides/getting-started-en.md#windows-wsl-2) · [macOS](docs/guides/getting-started-en.md#macos) · [Linux](docs/guides/getting-started-en.md#linux)

After installing the prerequisites, clone the repository and run setup:

```bash
git clone https://github.com/s-saens/mew.git
cd mew
./mew setup
```

Setup installs dependencies, asks for your workspace folder and owner email, then builds and starts mew.

1. Open the printed address, usually `http://localhost:5000`.
2. Sign in with the owner email and temporary password, then change the password.
3. Click the current project in the header, choose **Add project**, open a working folder, and select a file.

[Follow the first-use walkthrough](docs/guides/first-steps.md).

> **Prebuilt CLI:** `npx @liiiiv/mew-cli@latest` is implemented, but the first npm package and GitHub runtime release have not been published. Use source installation for now. [Release status](docs/deployment/cli-release.md).

## Open it from another device

[Mewlink](https://mew.run) helps another browser connect to your running mew instance. It handles device registration and connection setup; workspace data travels directly between the host and the connecting browser. You do not need your own domain or router port forwarding.

1. On the host, sign in as owner and open **Menu → Mewlink → Register device**.
2. Follow the registration link, sign in to Mewlink, and choose your username and device name.
3. Open the displayed device address on another device, such as `https://mew.run/you/laptop`. Sign in with the host's **local mew email and password**. Opening this address does not require a Mewlink account.

Sign in at `https://mew.run/you` to see your registered devices. This dashboard is visible only to its account owner.

Keep the host awake, online, and running mew. Networks that block direct connections can prevent access. Mewlink registration and local mew sign-in are separate; connecting devices do not need registration.

[한국어 연결 안내](docs/guides/getting-started-ko.md#%EC%99%B8%EB%B6%80%EC%97%90%EC%84%9C-%EC%A0%91%EC%86%8D%ED%95%98%EA%B8%B0) · [English instructions, account access, and alternatives](docs/guides/getting-started-en.md#remote-access) · [Connection validation scope](docs/development/remote-access.md#%EA%B2%80%EC%A6%9D%EA%B3%BC-%EB%82%A8%EC%9D%80-%EA%B2%8C%EC%9D%B4%ED%8A%B8)

## Documentation

| Topic | Start here |
| --- | --- |
| Open a folder, edit a document, and review changes | [First steps](docs/guides/first-steps.md) |
| Find a feature's everyday controls | [User guides](docs/guides/MOC.md) |
| Accounts, appearance, search, agents, skills, and MCP | [Configuration](docs/configuration/MOC.md) |
| Server installation, HTTPS, updates, and recovery | [Deployment](docs/deployment/_deployment.md) · [Operations](docs/operations/MOC.md) |
| Architecture, implementation contracts, and verification | [Development](docs/development/MOC.md) |
| Features, work records, research, and history | [Documentation home](docs/MOC.md) |

Getting-started guides are available in four languages. Most detailed guides are currently in Korean.

## Security

- Passwords use salted hashes. Login attempts are rate limited, and password changes invalidate existing password sessions.
- The server enforces file and feature permissions and rechecks active connections when access changes.
- Origin checks protect state-changing requests and browser WebSocket connections. Raw file views and localhost app previews use sandboxing or separate origins.
- Workspace file APIs block access to server account data. Stored GitHub tokens are encrypted and removed when an account is deleted.

Terminal and agent access uses the server user's OS permissions. Read [Security](docs/operations/security.md) before sharing an instance.

## Development

Read the [development setup and execution rules](docs/development/getting-started.md) before changing code.

Mew is an independent project. This repository owns its [agent instructions](AGENTS.md), [documentation rules](docs/README.md), and [decision records](docs/decisions/README.md).

```bash
npm ci
npm run dev     # Private development UI, port 4999
npx tsc -b      # Type checks
npm test
npm run lint
npm run check:docs
```

The server serves `dist/` directly, so a build changes what a running instance serves. Coding agents must not build, deploy, run the launcher, or restart the server. The user applies those changes.

For documentation work, follow the [writing rules](docs/README.md); agents start at [docs/AGENT.md](docs/AGENT.md).

## License

[Mew Source Available License 1.0](LICENSE). Personal and internal business use,
including paid work and private modifications, is permitted. Selling Mew or
modified versions, or offering them as paid hosting or SaaS, requires a separate
commercial license. Renaming or bundling Mew does not remove these restrictions.
You retain the rights to your own documents, code, and other output.

The project owner retains commercial rights to code they own or are authorized
to license. Third-party licenses and rights already granted for earlier MIT
releases remain in effect. Mew is source-available with commercial restrictions.
See the [license decision](docs/decisions/0053-source-available-license.md) for the
scope and [contribution requirements](docs/development/contributing.md) before
submitting changes.

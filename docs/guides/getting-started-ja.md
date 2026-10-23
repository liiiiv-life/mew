---
title: "mew を始める"
updated: "2026-10-23"
description: "s-saens/mew 소스의 일본어 설치·첫 로그인·목적별 사용법과 Mewlink·대체 외부 접속, 권한·업데이트·데이터 보존 및 미발행 CLI 경로를 안내한다. 햄버거 메뉴의 Mewlink 연결 진입을 포함한다."
---

# mew を始める

[한국어](getting-started-ko.md) · [English](getting-started-en.md) · [简体中文](getting-started-zh.md) · [日本語](getting-started-ja.md)

mew は、コンピューターやサーバー上のフォルダーをブラウザーで開くアプリです。Markdown とコードの編集、ターミナルと AI エージェントの実行、Git の変更確認、ドキュメントの共同作業ができます。スマートフォンからも使えます。

<a id="quick-start"></a>

[最初の操作](#first-steps) · [リモートアクセス](#remote-access) · [実行と更新](#running-and-updating) · [ドキュメント](#documentation)

## すぐに始める

[Windows（WSL 2）](#windows-wsl-2) · [macOS](#macos) · [Linux](#linux) · [リモートアクセス](#remote-access)

<a id="windows-wsl-2"></a>

### Windows（WSL 2）

WSL 2 の Ubuntu 内で mew を実行し、Windows のブラウザーで開きます。

**1. WSL と Ubuntu をインストールします。** 管理者として PowerShell を開き、次を実行します。

```powershell
wsl --install -d Ubuntu
```

Windows を再起動し、スタートメニューから **Ubuntu** を開いて Linux のユーザー名とパスワードを作成します。これは Windows のサインイン用アカウントとは別です。このコマンドには Windows 11、または Windows 10 バージョン 2004（ビルド 19041）以降が必要です。インストールに失敗した場合は、[Microsoft の WSL インストールガイド](https://learn.microsoft.com/en-us/windows/wsl/install)を確認してください。

Ubuntu がすでに入っている場合は、PowerShell で `wsl -l -v` を実行して確認します。バージョンが `1` なら、一覧に表示されたディストリビューション名を使って `wsl --set-version Ubuntu 2` を実行してください。

**2. mew をインストールします。** **Ubuntu** で次を実行します。

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential python3 tmux
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/s-saens/mew.git
cd mew
./mew setup
```

Node を nvm でインストールするか確認されたら、インストールを選んでください。Linux のツールをより速く使うため、リポジトリーとプロジェクトは `~/apps` や `~/mew-workspace` のように Linux ファイルシステム内に置きます。現在のフォルダーは `explorer.exe .` で Windows エクスプローラーから開けます。[Microsoft の WSL ファイル保存ガイド](https://learn.microsoft.com/en-us/windows/wsl/setup/environment#file-storage)も参照してください。

**3. サインインします。** 下の[セットアップを完了する](#finish-setup)に従い、表示された URL を Edge、Chrome などの Windows ブラウザーで開きます。通常は `http://localhost:5000` です。[WSL は Windows からの localhost アクセスを転送します](https://learn.microsoft.com/en-us/windows/wsl/networking#accessing-linux-networking-apps-from-windows-localhost)。

### macOS

**1. Apple のコマンドラインツールをインストールします。** ターミナルを開き、次を実行します。

```bash
xcode-select --install
```

インストールが終わるまで待ちます。すでにツールが入っている場合は次へ進みます。

**2. Homebrew と必要なツールをインストールします。** `brew` が入っていない場合は、[Homebrew](https://brew.sh/) のコマンドを実行します。

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

インストーラーの **Next steps** に従って Homebrew をシェルに追加してから、次を実行します。

```bash
brew install tmux python
```

**3. mew をインストールします。** 同じターミナルで次を実行します。

```bash
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/s-saens/mew.git
cd mew
./mew setup
```

Node を nvm でインストールするか確認されたら、インストールを選んでください。下の[セットアップを完了する](#finish-setup)に従い、表示された URL をブラウザーで開きます。

セットアップではリモートデスクトップ用ヘルパーも準備します。mew を実行する Mac でシステム設定が開いたら、Electron に **アクセシビリティ** と **画面収録** を許可してください。権限を検出するとセットアップが続行されます。詳しくは[Mac の権限準備](../guides/remote-desktop.md#mac-%EA%B6%8C%ED%95%9C-%EC%A4%80%EB%B9%84)を参照してください。

### Linux

Debian または Ubuntu では次を実行します。

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential python3 tmux
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/s-saens/mew.git
cd mew
./mew setup
```

その他のディストリビューションでは、まず同等のパッケージをインストールしてください。上の[セットアップを完了する](#finish-setup)に従います。起動時にサーバーを開始する場合やリモート接続を受け付ける場合は、[デプロイガイド](../deployment/native.md)を使ってください。

<a id="finish-setup"></a>

### セットアップを完了する

セットアップ中に次の項目を入力します。

- **ワークスペースフォルダー:** プロジェクトを入れる親フォルダーです。既定値は `~/mew-workspace` で、その中の各フォルダーがプロジェクトになります。
- **ポート:** 既定値は `5000` です。使用中の場合、セットアップが近い空きポートを選びます。
- **Postgres 接続:** データベーステーブル用の任意設定です。スキップして後から追加できます。
- **オーナーのメールアドレス:** 最初の mew アカウントです。セットアップが一時パスワードを表示します。

セットアップは依存関係をインストールし、リモートデスクトップのコンポーネントを準備してアプリをビルドし、サーバーを起動します。最初のダウンロードには数分かかることがあります。リモートデスクトップの準備に失敗しても警告として表示され、残りのインストールは続きます。

セットアップが表示した URL を開き、サインインして一時パスワードを変更します。ヘッダーの **+** でプロジェクトフォルダーを開き、サイドバーでファイルを選択します。

再起動後は Ubuntu またはターミナルを開き、インストールフォルダーから mew を起動します。

```bash
cd ~/apps/mew
./mew start
```

### 1つのコマンドで実行（初回リリース公開後）

Node.js 24 があれば、作業フォルダーで次を実行してビルド済みアプリを取得できます。**実装は用意されていますが、初回の npm パッケージと GitHub リリース公開は未実施です。**

```bash
cd /path/to/workspace
npx @liiiiv/mew-cli@latest
```

Linux glibc 2.35 以上・macOS 15 以上の x64/arm64 を対象にします。Windows は WSL 2 の Ubuntu 22.04 以上で実行します。初回は owner のメールアドレスを入力し、表示された仮パスワードでログインして変更します。既存のアカウント・会話・機器登録を再利用します。Mewlink 登録は [リモートアクセス](#remote-access) の手順で行い、登録リンクとオンライン接続先の QR もターミナルに表示されます。

Ctrl+C で終了し、同じコマンドを再実行すると最新リリースを使用します。以前の clone が `.data/` を使用している場合は、以前のサーバーを終了して `--data-dir /path/to/old/mew/.data` を指定してください。リモートデスクトップには任意の構成要素と OS 権限の準備が必要です。[実行とデータの契約](../development/cli-distribution.md) · [公開手順](../deployment/cli-release.md)

<a id="remote-access"></a>

### リモートアクセス

Mewlink で別のブラウザーから接続できます。Tailscale や Cloudflare Tunnel も選べます。ホストを起動したまま、mew とインターネット接続を維持してください。プロキシ方式では `MEW_BIND=127.0.0.1` を維持し、`5000` を設定したポートに置き換えます。

#### 1. Mewlink

1. ローカルの mew に owner としてログインし、仮パスワードを変更します。**メニュー → Mewlink → リモートアクセス → 端末登録**を開きます。
2. 登録用 URL で Mewlink にログインし、ユーザー名と端末名を設定します。
3. オンライン状態と `https://mew.saens.kr/<ユーザー名>/<端末名>` の接続 URL を確認します。
4. 別のデバイスでこの URL を開くと、Mewlink にログインせずにホストの mew ログイン画面が表示されます。**そのコンピューターのローカル mew のメールアドレスとパスワード**でログインします。接続元の登録は不要で、有効な保存済みセッションがあれば次回も利用できます。

Mewlink のログインは端末の登録・一覧・削除に使います。他の利用者にはローカル mew アカウントを作成し、役割・機能・ファイル権限を設定します。ローカルのパスワードでログインする場合、Mewlink アカウントは不要です。ローカルのログイン前は作業データへのアクセスを拒否します。

ホストを起動し、インターネット接続を維持してください。直接接続が遮断されるネットワークではエラーを表示します。Android iframe は利用できません。`./mew remote-access account` で登録手順を再表示できます。[中央サービスの運用](../deployment/remote-central.md)も参照してください。この変更の適用にはローカル mew の更新と Mewlink の再デプロイが必要で、外部ネットワークの実測は別途行います。

パスワードなしで接続するには、訪問者が機器のログイン画面で **Mewlink でログイン → アクセスを要求** を選びます。owner は **アカウント管理 → Mewlink アカウントアクセス** で承認し、既存のローカルユーザーに接続するか新規ユーザーを作ります（初期ロールは member）。権限はローカルで管理し、接続解除でアクセスを取り消します。登録アカウントやメールアドレスの一致だけではアクセスできません。この方式にはローカル mew の更新と Mewlink の再デプロイが必要です。提供者ログインと外部ネットワークの検証範囲は[接続契約](../development/remote-access.md#검증과-남은-게이트)を参照してください。

#### 2. Tailscale

自分のデバイス間で使う方法です。ドメインを購入する必要はなく、アクセスはプライベートな Tailscale ネットワーク（tailnet）内に留まります。

1. mew のホストと接続元の各デバイスに [Tailscale](https://tailscale.com/download) をインストールします。すべてのデバイスで同じ tailnet にサインインしてください。

2. mew のホストで次を実行します。

   ```bash
   tailscale serve --bg http://127.0.0.1:5000
   ```

   求められたら、表示されたリンクを開いて HTTPS を有効にします。Linux で権限エラーが出る場合は `sudo` を使います。WSL 2 では Tailscale を **Windows** にインストールし、Windows ブラウザーで `http://localhost:5000` が開くことを確認してから **PowerShell** でこのコマンドを実行してください。

3. スマートフォンまたは別のコンピューターで Tailscale に接続し、表示された `https://<machine>.<tailnet>.ts.net` URL を開いて mew にサインインします。

公式の [Tailscale Serve ガイド](https://tailscale.com/docs/features/tailscale-serve)と[コマンドリファレンス](https://tailscale.com/docs/reference/tailscale-cli/serve)を参照してください。

#### 3. Cloudflare Tunnel

接続元のデバイスに Tailscale を入れず、ブラウザーから安定した HTTPS アドレスを使いたい場合に向いています。**この設定には Cloudflare DNS で管理するドメインが必要です。**

1. 公式の [Cloudflare ドメイン登録ガイド](https://developers.cloudflare.com/registrar/get-started/register-domain/)でドメインを購入するか、既存ドメインを[Cloudflare に追加](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/)してネームサーバーの手順に従います。
2. 公式の [Cloudflare Tunnel セットアップガイド](https://developers.cloudflare.com/tunnel/get-started/)に従ってトンネルを作成し、mew ホストで `cloudflared` をインストール、実行します。WSL 2 では mew と同じ Ubuntu 環境内で `cloudflared` を実行します。
3. `mew.example.com` のようなホスト名とサービス URL `http://127.0.0.1:5000` を指定して **Published application** ルートを追加します。mew を `/` で提供するため、パスは空のままにします。
4. `cloudflared` を実行したままにし、別のデバイスから `https://mew.example.com` を開いて mew にサインインします。

これにより公開 HTTPS の入口ができますが、mew のアカウント権限は引き続き適用されます。プロキシの要件と接続確認は [Security](../operations/security.md) および[デプロイガイド](../deployment/native.md#2-https-%ED%94%84%EB%A1%9D%EC%8B%9C-%EB%98%90%EB%8A%94-%ED%84%B0%EB%84%90-%EC%97%B0%EA%B2%B0)を参照してください。

## 動作要件と権限

サーバーは Linux または macOS で動作し、Windows では WSL 2 を使います。Node 22.18 以降または 24 以降が必要で、Node 24 を推奨します。ターミナルは tmux とローカルでコンパイルされた `node-pty` を使うため、セットアップには Python と C/C++ ツールチェーンが必要です。Postgres 用に Docker を任意で使えますが、mew アプリ自体をコンテナーで実行することは現在サポートしていません。

mew は信頼できる人とだけ使ってください。既定では `manager` と `owner` アカウントが、サーバーユーザーの OS 権限でターミナルとエージェントを実行できます。ほかのアカウントにこれらの機能を与えると、そのアカウントにも同じアクセス権が渡ります。ほかの人にインスタンスを公開する前に [セキュリティ](../operations/security.md) を読んでください。

<a id="first-steps"></a>

## mew を使う

表示されたアドレスを開き、owner としてログインして仮パスワードを変更します。

1. ヘッダーの **+** で作業フォルダーを開きます。
2. 左側の一覧から Markdown やコードを選びます。
3. 必要に応じて dock からターミナル・エージェント・Git を開きます。

[画面紹介](overview.md) · [初回操作ガイド](first-steps.md) · [使い方一覧](MOC.md)。詳細ガイドは現在韓国語です。

<a id="projects-files-and-search"></a>

### プロジェクト、ファイル、検索

ヘッダーの **+** でフォルダーを開き、左側でファイルを選びます。`Ctrl+P` はファイル名、`Ctrl+Shift+F` は本文の検索です。

[プロジェクトとタスク](projects.md) · [検索と置換](../configuration/search.md) · [プロジェクト設定](project-setup.md).

<a id="writing-code-and-media"></a>

### 文章、コード、メディア

Markdown は **Hotview** で表示しながら編集し、**Plain** でソースを確認します。本文は自動保存されます。コード・表・添付・PDF・メディアもファイルを開いて使います。

[編集・保存・ファイル履歴](editor.md).

<a id="git"></a>

### Git

dock の **Git** で変更ファイルとコミット履歴を確認します。ファイルを開いて diff を確認し、コミットするファイルを選びます。

[Git パネル](projects.md#git-작업-패널).

<a id="collaboration-and-sharing"></a>

### 共同作業と共有

共同編集、コメント、メンション、チャットを使えます。他のアカウントとゲストのアクセスはロール・機能・ファイル権限に従います。

[共同作業と共有](collaboration.md) · [セキュリティ](../operations/security.md).

<a id="terminals-agents-and-automation"></a>

### ターミナル、エージェント、自動化

dock からターミナルやエージェントを開きます。AI ランタイムは先にインストールと認証を行います。会話、コマンドボタン、スケジュールは各ガイドを参照してください。

[ターミナルとエージェント](terminal-agents.md) · [ランタイム設定](../configuration/agent-runtimes.md) · [コマンドと予約](commands.md).

<a id="browser-android-and-remote-desktop"></a>

### ブラウザー、Android、リモートデスクトップ

サーバーブラウザーでウェブページを開けます。Android とリモートデスクトップは別途環境準備・インストール・OS 権限が必要です。対応範囲を先に確認してください。

[ブラウザーと Android](browser.md) · [リモートデスクトップ](remote-desktop.md).

<a id="databases"></a>

### データベース

Postgres 接続を設定した後、`/db` でデータベース表を文書に挿入します。Markdown 表とは別の機能です。文書やコードの編集に DB は不要です。

[データベース表](database.md).

<a id="layout-settings-and-accounts"></a>

### レイアウト、設定、アカウント

dock でパネルを開き、タブをドラッグして配置します。スマートフォンは下部 dock で切り替えます。**Settings** でテーマ・言語・フォント・ショートカット・Mewpet・アカウントを設定します。

[画面分割とモバイル](editor.md) · [環境とアカウント](../configuration/MOC.md).

<a id="running-and-updating"></a>

## 実行と更新

mew のリポジトリーで次を実行します。Windows では Ubuntu のターミナルを使います。

```bash
./mew start                    # サーバーを起動する
./mew stop                     # 停止する
./mew restart                  # 再起動する
./mew status                   # 状態とパスを表示する
./mew logs                     # サーバーログを追跡する
./mew update                   # origin/main を取得し、インストール、ビルド、再起動する
./mew desktop-setup            # mew を再起動せずデスクトップヘルパーを準備する
./mew users add you@example.com owner
```

`./mew update` は fast-forward pull を使います。`./mew start` で開始したインストールでは、アプリメニューから更新を確認してインストールすることもできます。systemd などのスーパーバイザーで管理するサーバーには、別の[デプロイと更新の手順](../deployment/native.md)を使ってください。

設定と実行時データは、既定でクローンの外にあります。

| 内容 | 場所 |
| --- | --- |
| 設定 | `~/.config/mew/config.env` |
| アカウント、セッション、完了済みエージェントターン | `~/.local/share/mew/` |
| ログ | `~/.local/state/mew/` |

クローンを削除してもこれらのファイルは残ります。ワークスペースと Postgres データと一緒にバックアップしてください。上書き設定は[サーバー設定](../configuration/environment.md#%EC%84%9C%EB%B2%84-%EC%84%A4%EC%A0%95)を参照してください。

スマートフォンまたは別のコンピューターから接続するには、[リモートアクセス](#remote-access)に従います。既定のサーバーバインドはホストローカルです。個人用の `./mew start` インストールでは自動起動サービスは登録されません。

セットアップ中のリモートデスクトップ準備に失敗した場合は、`./mew desktop-setup` で再試行します。これはアプリをビルドまたはサーバーを再起動せずにヘルパーをインストールし、Mac の権限設定を処理します。サインイン済みのデスクトップと、該当 OS のライブラリー・権限は引き続き必要です。[OS 要件](../guides/remote-desktop.md#%EC%B2%98%EC%9D%8C-%EC%97%B0%EA%B2%B0)を参照してください。

macOS では、ターミナルを開く前に mew が `node-pty` 1.1.0 の `spawn-helper` にない実行権限を修復します。ターミナルが空白のままなら、サーバーログで `[mew:tmux]` エラーを確認してください。

<a id="documentation"></a>

## ドキュメント

[ドキュメントマップ](../MOC.md)から始めます。詳細な製品仕様、使い方、運用手順、作業記録は `docs/` にあり、このガイドはセットアップと日常的な使い方を扱います。コードを変更したときは、関連するドキュメントも更新してください。

| トピック | 開始場所 |
| --- | --- |
| プロジェクト、編集、ターミナル、ブラウザー、コマンド、データベース | [ユーザーガイド](../guides/MOC.md) |
| 環境変数、アカウント、検索、エージェント実行環境 | [設定](../configuration/MOC.md) |
| HTTPS、systemd、更新、バックアップ | [デプロイ](../deployment/native.md) |
| コード構造、パッケージ、UI、共同作業、エージェントプロトコル | [開発ドキュメント](../development/MOC.md) |
| 製品仕様、運用、現在の作業、履歴 | [ドキュメントマップ](../MOC.md) |
| アカウントごとの機能とファイル権限 | [アカウント設定](../configuration/accounts.md#%EB%82%B4-%EA%B3%84%EC%A0%95%EA%B3%BC-%EA%B3%84%EC%A0%95-%EA%B4%80%EB%A6%AC) · [アクセス制御](../development/access-control.md) |
| ロール、認証、ゲストアクセス | [Security](../operations/security.md) |

Linux では `sh native/agent-memory/install.sh` を実行すると、エージェント作業用のメモリー制限をインストールします。有効化、確認、低メモリー時のジョブ中断、キューの保留、エラー報告については[エージェントのメモリー保護](../operations/agent-memory.md)を参照してください。

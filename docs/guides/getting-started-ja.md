# mew の使い方

[한국어](getting-started-ko.md) · [English](getting-started-en.md) · [简体中文](getting-started-zh.md) · [日本語](getting-started-ja.md)

mew は、コンピューターやサーバー上のフォルダーをブラウザーで開くアプリです。Markdown とコードの編集、ターミナルと AI エージェントの実行、Git の変更確認、ドキュメントの共同作業ができます。スマートフォンからも使えます。

<a id="quick-start"></a>

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
git clone https://github.com/liiiiv-life/mew.git
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
git clone https://github.com/liiiiv-life/mew.git
cd mew
./mew setup
```

Node を nvm でインストールするか確認されたら、インストールを選んでください。下の[セットアップを完了する](#finish-setup)に従い、表示された URL をブラウザーで開きます。

セットアップではリモートデスクトップ用ヘルパーも準備します。mew を実行する Mac でシステム設定が開いたら、Electron に **アクセシビリティ** と **画面収録** を許可してください。権限を検出するとセットアップが続行されます。詳しくは[Mac の権限準備](../guides/remote-desktop.md#mac-%EA%B6%8C%ED%95%9C-%EC%A4%80%EB%B9%84)を参照してください。

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

### Linux

Debian または Ubuntu では次を実行します。

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential python3 tmux
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/liiiiv-life/mew.git
cd mew
./mew setup
```

その他のディストリビューションでは、まず同等のパッケージをインストールしてください。上の[セットアップを完了する](#finish-setup)に従います。起動時にサーバーを開始する場合やリモート接続を受け付ける場合は、[デプロイガイド](../deployment/native.md)を使ってください。

<a id="remote-access"></a>

### リモートアクセス

セットアップ後、以下のいずれかでスマートフォンや別のコンピューターから mew を開けます。ホストを起動したままにし、mew も実行し続けてください。どちらも HTTPS トラフィックをローカルの mew サーバーへ転送します。`MEW_BIND=127.0.0.1` を維持し、セットアップ時のポートが異なる場合は `5000` をそのポートに置き換えます。

#### 1. Tailscale（推奨）

自分のデバイス間で使う方法です。ドメインを購入する必要はなく、アクセスはプライベートな Tailscale ネットワーク（tailnet）内に留まります。

1. mew のホストと接続元の各デバイスに [Tailscale](https://tailscale.com/download) をインストールします。すべてのデバイスで同じ tailnet にサインインしてください。

2. mew のホストで次を実行します。

   ```bash
   tailscale serve --bg http://127.0.0.1:5000
   ```

   求められたら、表示されたリンクを開いて HTTPS を有効にします。Linux で権限エラーが出る場合は `sudo` を使います。WSL 2 では Tailscale を **Windows** にインストールし、Windows ブラウザーで `http://localhost:5000` が開くことを確認してから **PowerShell** でこのコマンドを実行してください。

3. スマートフォンまたは別のコンピューターで Tailscale に接続し、表示された `https://<machine>.<tailnet>.ts.net` URL を開いて mew にサインインします。

公式の [Tailscale Serve ガイド](https://tailscale.com/docs/features/tailscale-serve)と[コマンドリファレンス](https://tailscale.com/docs/reference/tailscale-cli/serve)を参照してください。

#### 2. Cloudflare Tunnel

接続元のデバイスに Tailscale を入れず、ブラウザーから安定した HTTPS アドレスを使いたい場合に向いています。**この設定には Cloudflare DNS で管理するドメインが必要です。**

1. 公式の [Cloudflare ドメイン登録ガイド](https://developers.cloudflare.com/registrar/get-started/register-domain/)でドメインを購入するか、既存ドメインを[Cloudflare に追加](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/)してネームサーバーの手順に従います。
2. 公式の [Cloudflare Tunnel セットアップガイド](https://developers.cloudflare.com/tunnel/get-started/)に従ってトンネルを作成し、mew ホストで `cloudflared` をインストール、実行します。WSL 2 では mew と同じ Ubuntu 環境内で `cloudflared` を実行します。
3. `mew.example.com` のようなホスト名とサービス URL `http://127.0.0.1:5000` を指定して **Published application** ルートを追加します。mew を `/` で提供するため、パスは空のままにします。
4. `cloudflared` を実行したままにし、別のデバイスから `https://mew.example.com` を開いて mew にサインインします。

これにより公開 HTTPS の入口ができますが、mew のアカウント権限は引き続き適用されます。プロキシの要件と接続確認は [Security](../../SECURITY.md) および[デプロイガイド](../deployment/native.md#2-https-%ED%94%84%EB%A1%9D%EC%8B%9C-%EB%98%90%EB%8A%94-%ED%84%B0%EB%84%90-%EC%97%B0%EA%B2%B0)を参照してください。

## 動作要件と権限

サーバーは Linux または macOS で動作し、Windows では WSL 2 を使います。Node 22.18 以降または 24 以降が必要で、Node 24 を推奨します。ターミナルは tmux とローカルでコンパイルされた `node-pty` を使うため、セットアップには Python と C/C++ ツールチェーンが必要です。Postgres 用に Docker を任意で使えますが、mew アプリ自体をコンテナーで実行することは現在サポートしていません。

mew は信頼できる人とだけ使ってください。既定では `manager` と `owner` アカウントが、サーバーユーザーの OS 権限でターミナルとエージェントを実行できます。ほかのアカウントにこれらの機能を与えると、そのアカウントにも同じアクセス権が渡ります。ほかの人にインスタンスを公開する前に [SECURITY.md](../../SECURITY.md) を読んでください。

## mew を使う

以下の **Menu** は右上のメニューを指します。ワークスペースのパネルはドックから開き、残りの操作と設定はメニューにあります。ショートカットは既定の割り当てです。**Settings → Shortcuts** で変更できます。ここでリンクする詳しいガイドの多くは現在韓国語です。

- [プロジェクト、ファイル、検索](#projects-files-and-search)
- [文章、コード、メディア](#writing-code-and-media)
- [Git](#git)
- [共同作業と共有](#collaboration-and-sharing)
- [ターミナル、エージェント、自動化](#terminals-agents-and-automation)
- [ブラウザー、Android、リモートデスクトップ](#browser-android-and-remote-desktop)
- [データベース](#データベース)
- [レイアウト、設定、アカウント](#layout-settings-and-accounts)
- [実行と更新](#running-and-updating) · [開発](../development/getting-started.md) · [ドキュメント](#documentation)

<a id="projects-files-and-search"></a>

### プロジェクト、ファイル、検索

| 操作 | 開始場所 | 詳細 |
| --- | --- | --- |
| プロジェクトを開く、整理する | ヘッダーの **+** または `Ctrl+O`。タブを切り替え、アイコンを変え、タブを長押ししてプロジェクトをグループ化・並べ替えできます（owner）。 | [プロジェクトタブ](../guides/projects.md#%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%ED%83%AD) |
| プロジェクトを作成する、リポジトリーをクローンする | プロジェクトフォルダーの選択画面で、フォルダーの作成、リポジトリーのクローン、Git の初期化ができます（owner）。 | [プロジェクトの準備](../guides/projects.md#%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%ED%83%AD) |
| お気に入りまたはクラウドフォルダーを開く | フォルダー選択画面とサーバーのファイルブラウザーには、OS のフォルダーと検出された OneDrive、Google Drive、Dropbox、iCloud のフォルダーが表示されます。お気に入りはアカウントごとです。 | [フォルダーショートカット](../guides/projects.md#%ED%81%B4%EB%9D%BC%EC%9A%B0%EB%93%9C-%ED%8F%B4%EB%8D%94-%EB%B0%94%EB%A1%9C%EA%B0%80%EA%B8%B0) |
| Documents とサブプロジェクトを見る | サイドバーでフォルダーを展開します。`.mew` サブプロジェクトは独立したタブで開くか、フォルダーを右クリックしてサブプロジェクトにできます（owner）。**Map Of Contents** でドキュメントマップを開きます。 | [サイドバーの構造](../guides/projects.md#%EC%82%AC%EC%9D%B4%EB%93%9C%EB%B0%94%EC%9D%98-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8--%ED%95%98%EC%9C%84-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8--documents) |
| プロジェクトの指示を設定する | エージェントパネルの既定の指示で、コミット、言語、回答の長さの設定をします。**Documents** を右クリックすると、ドキュメントの設定、プレビュー、不足ファイルの作成ができます（owner）。CLI も使えます。 | [指示とセットアップ](../guides/project-setup.md) |
| Documents を管理する | **Documents** を右クリックしてフォルダーを変更、インポート、エクスポートします（owner）。インポートすると既存の内容は置き換えられます。 | [Documents フォルダー](../guides/projects.md#documents-%ED%8F%B4%EB%8D%94-%EA%B3%84%EC%95%BD) |
| ファイルとフォルダーを管理する | 項目を右クリックまたは長押しして、作成、名前変更、複製、コピー、移動、削除、ダウンロードができます。ファイルをドラッグして移動またはアップロードします。 | [ファイル操作](../guides/projects.md#%ED%8C%8C%EC%9D%BC%ED%8F%B4%EB%8D%94-%EA%B4%80%EB%A6%AC) · [ドラッグ＆ドロップ](../guides/editor.md#%EC%82%AC%EC%9D%B4%EB%93%9C%EB%B0%94-%ED%95%AD%EB%AA%A9-%EB%81%8C%EC%96%B4%EB%86%93%EA%B8%B0) |
| プロジェクト外を閲覧する | **Menu → File browser** でサーバーのファイルシステムを開きます（manager または owner）。 | [サーバーファイルブラウザー](../guides/projects.md#%EC%84%9C%EB%B2%84-%ED%8C%8C%EC%9D%BC-%ED%83%90%EC%83%89%EA%B8%B0) |
| ファイルまたはテキストを探す | `Ctrl+P` でファイル名を探します。`@` で Documents またはサブプロジェクトに範囲を絞れます。`Ctrl+Shift+F` は大文字小文字の一致、正規表現、複数ファイルの置換に対応します。 | [検索と置換](../configuration/search.md#%ED%8C%8C%EC%9D%BC%EB%AA%85%EB%82%B4%EC%9A%A9-%EA%B2%80%EC%83%89%EA%B3%BC-%EC%B9%98%ED%99%98) |
| ファイルを除外する | **Settings → Ignore list** で、検索、ファイル監視、一部ロールのファイルツリーから除外する名前を設定します（manager または owner）。 | [除外ルール](../guides/projects.md#%EC%88%A8%EA%B9%80-%EB%AA%A9%EB%A1%9D-dataignorejson) |

<a id="writing-code-and-media"></a>

### 文章、コード、メディア

| 操作 | 開始場所 | 詳細 |
| --- | --- | --- |
| Markdown を編集する | `.md` ファイルを開きます。**Hotview** は表示済みドキュメントを、**Plain** はソースを編集します。見出し、リスト、チェックボックス、引用、コードブロック、インライン書式が使えます。 | [基本編集](../guides/editor.md#%EA%B8%B0%EB%B3%B8-%ED%8E%B8%EC%A7%91) |
| メタデータを編集する、見出しへ移動する | Hotview の上にある frontmatter フィールドを編集するか、目次を使います。 | [ドキュメント構造](../guides/editor.md#%EA%B8%B0%EB%B3%B8-%ED%8E%B8%EC%A7%91) |
| コードを編集する | 対応形式のソースファイルを開くと、行番号、構文ハイライト、診断が使えます。`Ctrl+F` で検索と置換を開きます。 | [コード編集](../guides/editor.md#%EA%B8%B0%EB%B3%B8-%ED%8E%B8%EC%A7%91) |
| リンクと添付を挿入する | `Ctrl+K` でリンクを編集し、Hotview では `@` でファイルをリンクします。画像をドロップまたは貼り付けてサイズを変更するか、`/` でファイルをアップロードします。YouTube ノードも挿入できますが、再生にはデプロイ時の CSP 変更が必要です。 | [リンクと添付](../guides/editor.md#%EB%A7%81%ED%81%AC%EC%99%80-%EC%B2%A8%EB%B6%80) |
| 表を扱う | `/` から表を挿入し、行と列を編集、列幅を変更して、Markdown、CSV、画像としてコピーできます。 | [表](../guides/editor.md#%ED%91%9C-%ED%8E%B8%EC%A7%91%EA%B3%BC-%EB%B3%B5%EC%82%AC) · [列幅](../guides/editor.md#%ED%91%9C-%EC%97%B4-%EB%84%88%EB%B9%84-mewtable-layoutjson) |
| リストをインデントする | 最初の項目を含め、`Tab` と `Shift+Tab` を使います。 | [リストのインデント](../guides/editor.md#%EB%A6%AC%EC%8A%A4%ED%8A%B8-%EC%B2%AB-%ED%95%AD%EB%AA%A9-%EB%93%A4%EC%97%AC%EC%93%B0%EA%B8%B0-----b) |
| 脚注を追加する | `Alt+E` で脚注を挿入します。番号とマーカー・参照間のリンクは自動で維持されます。 | [脚注](../guides/editor.md#%EA%B0%81%EC%A3%BC-alte) |
| メディアとスプレッドシートを見る | 画像、音声、動画、PDF をプレビューし、SVG は画像とソースを切り替えられます。XLSX、CSV、TSV ファイルを読み、APK と AAB ファイルをダウンロードできます。 | [ファイルプレビュー](../guides/editor.md#%EB%AF%B8%EB%94%94%EC%96%B4%EC%99%80-%EC%8B%9C%ED%8A%B8-%EB%B3%B4%EA%B8%B0) |
| PDF を読み、注釈を付ける | PDF ツールバーで全画面、ページ、ズーム、テキスト選択、ペン、蛍光ペンを使います。PDF に保存するか、注釈入りのコピーをダウンロードできます。 | [PDF ツール](../guides/editor.md#pdf-%EC%9D%BD%EA%B8%B0%EC%99%80-%ED%95%84%EA%B8%B0) |
| 保存と取り消し | 編集は自動保存されます。`Ctrl+Z` で取り消し、`Ctrl+Y` でやり直します。 | [保存と履歴](../guides/editor.md#%EC%9E%90%EB%8F%99%EC%A0%80%EC%9E%A5%EC%BB%A4%EB%B0%8B%ED%8C%8C%EC%9D%BC-%EC%9D%B4%EB%A0%A5) |
| エディターペインを配置する | プレビュータブをピン留めし、タブとハンドルをドラッグしてペインを分割、結合、並べ替え、リサイズします。 | [タブと分割](../guides/editor.md#%ED%8E%B8%EC%A7%91-%EC%B9%B8-%EB%AC%B8%EC%84%9C-%ED%83%AD--%ED%99%94%EB%A9%B4-%EB%B6%84%ED%95%A0) |
| ファイル参照を送る | `Ctrl+L` で現在のパスと選択した行を、ターミナル、エージェント、チャットの入力欄へ送ります。 | [パスと行の参照](../guides/editor.md#ctrll-%EC%B0%B8%EC%A1%B0-%EA%B2%BD%EB%A1%9C%EC%A4%84) |

### Git

ドックの **Git** をクリックするか `Alt+G` を押すと、コミット、変更ファイル、差分を確認できます（manager または owner）。変更リストでファイルを選択し、下部にメッセージを入力してコミットします。コミットを右クリックすると、ハッシュのコピー、ブランチまたはタグの作成、チェックアウト、cherry-pick、revert ができます。

**GitHub** ボタンは、内蔵ブラウザーのデバイスログインを通じてサーバーの Git 認証情報を接続します。サーバーに `gh` が必要です。**AI auto-commit** はエージェントセットと mew のコミットスキルを使い、選択した変更を複数のコミットに分けます。実際のコミットを作成し、そのハッシュ、含まれるファイル、残った変更を報告します。

現在のファイルは `Ctrl+S` または **Menu → Commit** でコミットします。エディターの履歴では過去の内容を確認して復元できます。Git パネルは閉じて再度開いても下書きを保持し、デスクトップハンドルで移動できます。

[Git ワークベンチ](../guides/projects.md#git-%EC%9E%91%EC%97%85-%ED%8C%A8%EB%84%90)、[GitHub ログイン](../guides/projects.md#github-%EB%A1%9C%EA%B7%B8%EC%9D%B8)、[ファイル履歴](../guides/editor.md#%EC%9E%90%EB%8F%99%EC%A0%80%EC%9E%A5%EC%BB%A4%EB%B0%8B%ED%8C%8C%EC%9D%BC-%EC%9D%B4%EB%A0%A5)も参照してください。

<a id="collaboration-and-sharing"></a>

### 共同作業と共有

| 操作 | 開始場所 | 詳細 |
| --- | --- | --- |
| 一緒に編集する | サインインした状態で同じファイルを開きます。他の参加者とそのカーソルがエディターに表示されます。 | [共同編集](../guides/collaboration.md#%EA%B3%B5%EB%8F%99-%ED%8E%B8%EC%A7%91%EA%B3%BC-%EC%B0%B8%EC%97%AC%EC%9E%90) |
| 共有メモを残す | メモのドックアイコンまたは `Ctrl/Cmd+M` を使います。サーバー全体の Markdown メモは、ライブ編集、参加者の色分け、タイトルをドラッグしての移動に対応します。 | [共有メモ](../guides/collaboration.md#%EA%B3%B5%ED%86%B5-%EB%A9%94%EB%AA%A8) |
| 接続中の人を見る | メニュー横のセッション数をクリックすると、ユーザー、デバイス、プロジェクト、現在のファイルを確認できます。 | [アクティブセッション](../guides/collaboration.md#%EC%A0%91%EC%86%8D-%EC%A4%91%EC%9D%B8-mew-%EC%84%B8%EC%85%98) |
| ドキュメントにコメントする | テキストを選択して `Alt+Shift+C` を押します。ハイライトまたはコメントリストから返信、編集、削除、メンションができます。 | [コメント](../guides/collaboration.md#%EB%8C%93%EA%B8%80%EA%B3%BC-%EB%8B%B5%EA%B8%80) |
| メンバーとチャットする | **Menu → Chat** または `Alt+C` で、ファイル参照と既読通知に対応したグループチャットとダイレクトメッセージを開きます。 | [チャット](../guides/collaboration.md#%EB%8B%A8%EC%B2%B4-%EC%B1%84%ED%8C%85%EA%B3%BC-dm) |
| ゲストと共有する | owner はアカウント管理のファイル・フォルダー権限から、未認証の訪問者に特定パスの閲覧または編集を許可できます。 | [ゲスト共有](../guides/collaboration.md#%EA%B2%8C%EC%8A%A4%ED%8A%B8-%EA%B3%B5%EC%9C%A0) |

<a id="terminals-agents-and-automation"></a>

### ターミナル、エージェント、自動化

ターミナルとエージェントの機能は、既定で manager と owner が使えます。実行環境により、エージェントはチャットパネルまたは公式 CLI ターミナルで開きます。

| 操作 | 開始場所 | 詳細 |
| --- | --- | --- |
| シェルを開く | ドックの **Terminal**、`Ctrl+Backtick`、または `Alt+T`。tmux セッションの作成、再接続、終了ができます。 | [ターミナルとタブ](../guides/terminal-agents.md) |
| エージェントを選ぶ | ドックの **Agent**（`Alt+L`）→ **+**。Claude Agent、Antigravity、Codex、Hermes、Kimi、OpenClaw、OpenCode、Cursor、Prime を実行環境として使えます。 | [実行環境の対応状況](../configuration/agent-runtimes.md#%EB%AA%A8%EB%8D%B8%EA%B6%8C%ED%95%9C-%EA%B8%B0%EB%B3%B8%EA%B0%92%EA%B3%BC-%EB%9F%B0%ED%83%80%EC%9E%84-%EC%84%A0%ED%83%9D) |
| 実行環境をインストール、設定する | 実行環境リストのインストールボタンと設定ボタンで、認証、起動設定、対応したサインアウトまたは削除を行います。Antigravity は Google の公式 ACP サーバーを使います。 | [実行環境の設定](../configuration/agent-runtimes.md) |
| モデル、推論、権限を選ぶ | ACP チャット入力欄の横にあるコントロールを使います。対応する設定は実行環境の既定値として保存できます。 | [モデルと既定値](../configuration/agent-runtimes.md#%EB%AA%A8%EB%8D%B8%EA%B6%8C%ED%95%9C-%EA%B8%B0%EB%B3%B8%EA%B0%92%EA%B3%BC-%EB%9F%B0%ED%83%80%EC%9E%84-%EC%84%A0%ED%83%9D) |
| エージェントの設定を再利用する | モデルとロールのプリセットを持つエージェントセットからタブを作成します。タブ名の変更、実行環境の切り替え、分割の配置ができます。 | [エージェントタブ](../guides/terminal-agents.md) |
| プロンプトにコンテキストを加える | `@` でプロジェクト、ファイル、フォルダーを参照し、`/` でローカルスキルを選びます。ファイルまたは画像を添付し、矢印キーで送信済みの入力を呼び出せます。 | [エージェント入力](../specs/agent-input-mentions.md) |
| 会話を管理する | 作業の送信・停止、ツールの活動と経過時間の確認、待機中メッセージの編集・並べ替え、`/clear` による新しい会話の開始ができます。 | [会話の操作](../guides/terminal-agents.md#%EB%8C%80%ED%99%94-%EC%A7%84%ED%96%89%EA%B3%BC-%EA%B8%B0%EB%A1%9D) |
| チャットからシェルコマンドを実行する | モデルセレクター横のターミナルアイコンを切り替えます。コマンドの tmux を開き、停止し、後から保存済み出力を表示・ダウンロードできます。 | [CLI コマンドモード](../guides/terminal-agents.md#%EB%8C%80%ED%99%94%EC%97%90%EC%84%9C-cli-%EB%AA%85%EB%A0%B9-%EC%8B%A4%ED%96%89) |
| 以前の作業を再開する | 履歴からセッションを選びます。外部 CLI で作業した後は **Refresh current conversation** を使います。返信内のファイルリンクはエディターで開きます。 | [セッション履歴](../guides/terminal-agents.md) |
| アカウントと利用状況を確認する | ACP セッションの **i** ボタンに、利用可能なアカウント、プラン、制限、トークン使用量、API 換算コストが表示されます。 | [アカウントとサブスクリプション](../configuration/agent-runtimes.md#%EC%84%A4%EC%B9%98%EB%A1%9C%EA%B7%B8%EC%9D%B8%EA%B5%AC%EB%8F%85) |
| メッセージを予約する | ACP 入力欄の横の時計で、現在のセッションへ一回だけ送るメッセージを予約します。実行前に編集、再予約、削除できます。 | [予約メッセージ](../specs/agent-scheduled-prompts.md) |
| 機能仕様から作業する | ドックの **Features** で要件をインライン編集し、エージェントセットに適用します。元の Markdown、関連ファイル、コミット、ユーザーレビューを追跡できます。 | [機能駆動開発](../specs/feature-development.md) |
| プロジェクトコマンドを保存する | サイドバーの **▶** メニューでコマンドを追加、編集、実行、停止します。出力は専用のターミナルポップアップに表示されます。 | [プロジェクトコマンド](../guides/commands.md#%EC%82%AC%EC%9D%B4%EB%93%9C%EB%B0%94-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8--%EB%B2%84%ED%8A%BC-mewcmd-buttonjson) |
| シェルコマンドを保存する | シェルタブのコマンド行にある **+** でコマンドとアイコンを追加します。ボタンはアクティブなシェルへ入力を送ります。 | [ターミナルボタン](../guides/commands.md#%ED%84%B0%EB%AF%B8%EB%84%90-%EB%B2%84%ED%8A%BC-dataterm-buttonjson) |
| 定期ジョブを実行する | **Menu → Scheduled tasks** でフォルダー、エージェント、プロンプト、スケジュールを保存します。ジョブを即時実行し、出力を確認、削除できます。 | [定期タスク](../guides/commands.md#%EC%98%88%EC%95%BD-%EC%9E%91%EC%97%85-dataschedulesjson) |

エージェントパネルの **i** ボタンの横にある **Skills** と **MCP** では、グローバル、プロジェクト、サブプロジェクトの範囲で拡張機能を確認・管理できます。対応する場所と実行環境は [skills と MCP の設定](../configuration/agent-harness.md)を参照してください。

<a id="browser-android-and-remote-desktop"></a>

### ブラウザー、Android、リモートデスクトップ

これらの機能には追加コンポーネントが必要で、manager と owner が使えます。

| 操作 | 開始場所 | 詳細 |
| --- | --- | --- |
| サーバーからブラウズする | ドックの **Browser** または `Alt+B`。タブ、フォーム、アップロード、ダウンロードを使って、localhost サービス、プライベートネットワーク上のページ、公開サイトを開けます。 | [サーバーブラウザー](../guides/browser.md#%EB%B8%8C%EB%9D%BC%EC%9A%B0%EC%A0%80-%EC%B0%BD) |
| ブラウザーのログインを保持する | アカウントごとにサーバー側のブラウザープロフィールがあります。ポップアップとエージェント認証に対応し、単独の `/browser` ページも使えます。 | [プロフィールと制限](../guides/browser.md#%EB%B8%8C%EB%9D%BC%EC%9A%B0%EC%A0%80-%EC%B0%BD) |
| Android を準備する | **Menu → Android** で SDK、アクセラレーション、AVD の状態を確認し、セットアップコマンドとターミナル出力を表示して、既存の WebRTC ゲートウェイへ接続します。 | [Android のセットアップ](../guides/browser.md#android-%EC%B0%BD) |
| デスクトップを操作する | ドックの **Remote desktop** はヘルパーを準備し、サインイン済みの Mac または Linux デスクトップ、mew が WSL で動く場合は Windows デスクトップへ接続します。OS の権限許可が必要です。直接映像に失敗した場合は mew サーバーへフォールバックします。 | [リモートデスクトップのセットアップ](../guides/remote-desktop.md) |
| リモート入力を使う | マウス、キーボード、貼り付け、リモート Esc、モバイルジョイスティック、ドラッグ、ホイール、ズーム、全画面、回転、感度、移動可能なホットキー、モニター選択が使えます。 | [操作](../guides/remote-desktop.md#%EC%A1%B0%EC%9E%91) · [ネットワークと検証範囲](../development/remote-desktop.md) |

### データベース

Hotview で `/db` を入力してテーブルを挿入し、タイトル、行、セル、列をほかのユーザーと一緒に編集できます。対応するフィールドはテキスト、数値、チェックボックス、日付です。**Menu → Database** に現在のプロジェクトのデータベースが一覧表示されます。

`/` メニューの **Database reference** を使うと、既存のデータベースまたは外部 Postgres テーブルの読み取り専用参照を埋め込めます。Postgres へ接続するには `DATABASE_URL` を設定します。`npm run db:up` と `npm run db:down` は、Docker Compose を通じてデータベースだけを任意で管理します。

セットアップとプロジェクト分離については[データベースガイド](../guides/database.md)を参照してください。

<a id="layout-settings-and-accounts"></a>

### レイアウト、設定、アカウント

| 操作 | 開始場所 | 詳細 |
| --- | --- | --- |
| パネルを配置する | エディター、エージェント、ターミナル、ブラウザーのタブまたはハンドルをドラッグします。Git は本体ハンドルを使います。デスクトップのタブをダブルクリックするとパネルを拡大し、`Esc` で戻せます。ブラウザーパネルは横方向にしか配置できません。ドキュメントタブ、レイアウト、スクロール位置はアカウントごとに復元されます。 | [ペイン](../guides/editor.md#%ED%8E%B8%EC%A7%91-%EC%B9%B8-%EB%AC%B8%EC%84%9C-%ED%83%AD--%ED%99%94%EB%A9%B4-%EB%B6%84%ED%95%A0) · [復元](../guides/projects.md#%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%ED%83%AD) |
| モバイルで作業する | 下部ドックでパネルを切り替え、長押しで並べ替えます。入力中はドックが隠れます。項目を長押しするとコンテキストメニューが開き、Back または `Esc` で最前面のオーバーレイを閉じます。**Menu → Fullscreen** または `Alt+Enter` で全画面を切り替えます。デスクトップでは、ドックはヘッダーメニューのすぐ左にあり、アイコンの下にツールチップが表示されます。 | [モバイルと全画面](../guides/editor.md#%EB%AA%A8%EB%B0%94%EC%9D%BC%EA%B3%BC-%EC%A0%84%EC%B2%B4%ED%99%94%EB%A9%B4) |
| 外観を変える | **Settings → Appearance** でライト・ダークテーマ、アクセントカラー、UI・ドキュメント・コードのフォント、韓国語・英語・日本語・中国語を設定します。 | [外観](../configuration/environment.md#%ED%99%94%EB%A9%B4-%EC%84%A4%EC%A0%95) |
| ショートカットをカスタマイズする | **Settings → Shortcuts** で割り当てを変更するか、個別またはすべてのショートカットをリセットします。 | [ショートカット](../configuration/environment.md#%EB%8B%A8%EC%B6%95%ED%82%A4-%EC%84%A4%EC%A0%95) |
| Mewcat を確認する | 猫をクリックすると最近の通知が開きます。吹き出しには CPU、RAM、GPU の使用量が 0.5 秒ごとに更新され、数値をクリックするとシステムリソースを表示します。**Settings → Mewcat** でスキン、音、通知、作業・休憩タイマーを設定します。任意の強制休憩では、ドラッグできる猫がワークスペース上に表示されます。既定ではオフです。 | [Mewcat](../specs/mewcat.md) |
| 自分のアカウントを管理する | **Settings → Account** で表示名、プロフィール画像、パスワードを変更するか、サインアウトします。 | [アカウント設定](../configuration/environment.md#%EB%82%B4-%EA%B3%84%EC%A0%95%EA%B3%BC-%EA%B3%84%EC%A0%95-%EA%B4%80%EB%A6%AC) |
| ユーザーを管理する | owner は **Menu → Account management** でアカウントを追加し、ロールを変更します。ホストの CLI からもユーザーの一覧、パスワードのリセット、アカウントの削除ができます。 | [ユーザー管理](../configuration/environment.md#%EB%82%B4-%EA%B3%84%EC%A0%95%EA%B3%BC-%EA%B3%84%EC%A0%95-%EA%B4%80%EB%A6%AC) |
| サーバーを確認する | **Menu → System resources** に CPU、メモリー、GPU、温度、プロセス、最近の使用状況が表示されます（manager または owner）。 | [システムリソース](../guides/commands.md#%EC%8B%9C%EC%8A%A4%ED%85%9C-%EC%9E%90%EC%9B%90-%ED%8C%9D%EC%97%85) |

以前のワークスペースホーム画面にあった To-do リストとカレンダーは、現在は使えません。ドキュメントのチェックボックスとエージェントのスケジューリングは引き続き使えます。[現在提供していないホーム画面の機能](../guides/projects.md#%ED%98%84%EC%9E%AC-%EC%A0%9C%EA%B3%B5%ED%95%98%EC%A7%80-%EC%95%8A%EB%8A%94-%ED%99%88-%ED%99%94%EB%A9%B4)を参照してください。

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
| アカウントごとの機能とファイル権限 | [アカウント設定](../configuration/environment.md#%EB%82%B4-%EA%B3%84%EC%A0%95%EA%B3%BC-%EA%B3%84%EC%A0%95-%EA%B4%80%EB%A6%AC) · [アクセス制御](../development/access-control.md) |
| ロール、認証、ゲストアクセス | [Security](../../SECURITY.md) |

Linux では `sh native/agent-memory/install.sh` を実行すると、エージェント作業用のメモリー制限をインストールします。有効化、確認、低メモリー時のジョブ中断、キューの保留、エラー報告については[エージェントのメモリー保護](../operations/agent-memory.md)を参照してください。

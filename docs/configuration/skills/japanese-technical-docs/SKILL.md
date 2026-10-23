---
name: japanese-technical-docs
description: "日本語の技術文書作業を既存の専門スキルに接続する。documentationで構成を設計し、yomiyasuで日本語を推敲する。原文確定後、依頼された言語へ直接翻訳し、翻訳・対象言語・最終確認の専門スキルを順番に適用する。"
---

# 日本語の技術文書スキル接続

このスキルは作業段階と言語を選ぶ入口である。推敲と翻訳では、同梱された既存の専門スキルの原文を読む。

1. [共通の作業手順](../technical-docs-common/workflow.md)で範囲、読者、原文の言語を決める。新規文書の既定言語はmewの実際の応答言語に従い、明示的な依頼や既存のプロジェクト・ファイル規則を優先する。
2. 原文の構成設計には[documentation](../.vendor/documentation/SKILL.md)を使う。内部仕様や開発契約の既存形式は維持する。
3. 日本語原文を[yomiyasu](../.vendor/yomiyasu/SKILL.md)で推敲する。文書に合わせてtechまたはbusinessの参照を選び、保存時には付属の検査も行う。条件、意味、コード、リンクを確認して原文を確定する。
4. 翻訳の依頼がある場合は[翻訳の接続順序](../technical-docs-common/translation.md)に従う。日本語への翻訳は`translating-japanese`の後に`yomiyasu`で表現を整え、最後に`reviewing-translations`で確定した原文と照合する。

日本語が翻訳先だけなら、実際の原文言語の入口から始める。専門スキルを読まずに要約だけで代用しない。共通ファイルはこのSKILL.mdの実体の位置から解決する。

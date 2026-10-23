---
name: chinese-technical-docs
description: "把简体中文技术文档工作连接到已安装的专业技能：用documentation设计结构，用tech-doc-style-chinese润色原文；确认原文后直接翻译到所请求的语言，依次应用翻译、目标语言润色和reviewing-translations。"
---

# 简体中文技术文档技能连接

本技能负责选择阶段和语言。润色与翻译均读取并应用随包安装的现有专业技能，而不是用本入口代替它们的规则。

1. 按[共用工作流程](../technical-docs-common/workflow.md)确定范围、读者与原文语言。新文档默认跟随mew的实际回复语言；明确的文档语言要求和现有项目、文件规则优先。
2. 设计原文结构时读取[documentation](../.vendor/documentation/SKILL.md)。保留内部规格和开发契约的既有格式。
3. 使用[tech-doc-style-chinese](../.vendor/tech-doc-style-chinese/SKILL.md)润色简体中文原文。按文档用途读取受控技术写作、术语排版等参考，并保留已经确定的结构。核对条件、技术含义、代码和链接后确认原文。
4. 用户要求翻译时，遵循[翻译连接顺序](../technical-docs-common/translation.md)。简体中文译文先应用`translating-chinese`，再用`tech-doc-style-chinese`润色，最后由`reviewing-translations`与确定后的原文对照。

简体中文仅为目标语言时，从实际原文语言的入口开始。不得用摘要代替专业技能的SKILL.md。共用文件的路径以本SKILL.md的实际位置为准。

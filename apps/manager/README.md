---
description: "mewnager 독립 Windows Tauri 관리 앱의 사용자 안내·기능 계약·빌드 문서로 연결하는 진입점."
---
# mewnager

Portable Windows GUI for installing and managing mew in a dedicated WSL 2 distribution.

- [Install and use](../../docs/guides/windows-manager.md)
- [Behavior and UI contract](../../docs/features/화면·계정·운영/Windows%20설치·관리%20앱.md)
- [Build, checks, and Windows acceptance](../../docs/development/windows-manager.md)

This app has its own npm/Cargo lockfiles and build output. The initial x64 executable is an unsigned development build. Native Windows startup and WSL status queries were verified; full fresh-WSL installation validation is pending.

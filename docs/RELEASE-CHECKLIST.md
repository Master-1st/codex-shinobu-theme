# Windows Release 检查表

1. 同步 `package.json`、`manifest.json`、README、CHANGELOG 的版本号。
2. 确认 README 顶部仍明确写明 Windows-only 和 Codex++ 依赖。
3. 运行 `npm test`，所有测试必须通过。
4. 运行 `npm run package`。
5. 确认 ZIP 文件名以 `-windows.zip` 结尾，并重新计算 SHA-256 与 `.sha256` 对比。
6. 检查 ZIP 包含安装、只读分析、优化、卸载脚本和完整 docs。
7. 在 Windows 11 x64 的当前 Store Codex + Codex++ 上覆盖安装。
8. 验证最大化、恢复窗口、窄窗口、长输出、审批卡、菜单、设置、换图和辅助悬浮窗。
9. 确认安装目录中的 README 相对链接可打开。
10. 推送分支并更新草稿 PR，再创建同版本 GitHub Release。
11. 验证 Release 直链返回 200，并记录最终 ZIP SHA-256。

不要把 `WindowsApps`、`app.asar`、登录数据、任务内容或本机导入图片打进发布包。

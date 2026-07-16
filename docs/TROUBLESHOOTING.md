# 故障排查

## 双击脚本没有反应

1. 确认已经完整解压 ZIP，而不是在压缩包中双击。
2. 右键 ZIP 或脚本 → 属性；如果有“解除锁定”，勾选后再试。
3. 从解压目录打开 PowerShell，运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1` 查看完整错误。
4. 不要使用另一个管理员账户运行，否则会写入另一个用户的 `%APPDATA%`。

## 提示没有安装 Codex++

先按 Codex++ 官方说明安装并启动一次，再运行 `install.cmd`。本主题不会直接修改受保护的 `WindowsApps`。

## 安装完成但主题没有出现

- 完全退出所有 Codex 窗口和托盘进程后重启；
- 启动 `Codex++` 快捷方式，不是 Microsoft Store 原版 `Codex`；
- 检查 `%APPDATA%\codex-plusplus\tweaks\io.github.master1st.codex-shinobu-theme\manifest.json`；
- 在 `设置 → Tweaks` 中确认主题已启用；
- Codex 更新后先更新或修复 Codex++，再覆盖安装主题。

## 顶部出现白条、标题错位或缩小后内容被裁

确认主题为最新版本并完全重启。若仍发生，请截图最大化与恢复窗口两个状态，并附上 Codex、Codex++、主题版本以及 Windows 缩放比例提交 issue。不要手工修改 `app.asar`。

## 自定义图片导入失败

- 只支持 PNG、JPG、WebP；
- 源文件不得超过 16 MB；
- 转换后的本地 WebP 数据仍过大时，请先缩小分辨率；
- 使用有读取权限的本地普通文件，不要直接选择尚未下载的云端占位文件。

## Codex 打开或切换任务很卡

1. 先开启主题设置中的“性能优先”；
2. 双击 `Analyze-Codex.cmd`，确认是否有超大日志、缓存或超过 50 MB 的单任务文件；
3. 保存内容后运行 `Optimize-Codex.cmd`；
4. 超大任务不会被工具删除，建议在 Codex 内归档不常用任务；
5. 清理缓存后的第一次启动会重建缓存，可能暂时更慢。

本工具不修改官方 Codex 核心代码。网络、代理、沙箱写权限和某个超大任务造成的卡顿需要分别根据日志诊断，不能靠主题或清缓存统一解决。

## 回滚或恢复

主题旧版本位于 `%APPDATA%\codex-plusplus\theme-backups`。诊断日志备份位于 `%USERPROFILE%\.codex\maintenance-backups`。恢复前必须完全退出 Codex，并先保留现有同名文件的副本。

## 提交问题时请附带

- Windows 版本和显示缩放比例；
- Codex Desktop、Codex++、主题版本；
- 最大化/恢复窗口截图；
- 问题是否在关闭主题后消失；
- `Analyze-Codex.cmd` 的摘要，但不要公开任务正文、账号信息或私有路径截图。

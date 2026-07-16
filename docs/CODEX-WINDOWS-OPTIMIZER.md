# Codex Windows 优化器

仓库根目录的 `Optimize-Codex.cmd` 用于处理 Codex Desktop 长时间运行后出现的窗口打开慢、切换任务顿一下、内存持续上涨等问题。它是独立维护工具，不依赖小忍主题，也不修改 Codex 程序文件。

## 它会做什么

1. 显示当前 Codex 进程总内存、活动日志库、可再生缓存、临时文件与任务文件大小。
2. 关闭 Codex，避免操作正在使用的数据库。
3. 当 `%USERPROFILE%\.codex\logs_2.sqlite` 超过 128 MB 时，将数据库及其 WAL/SHM 文件移到带时间戳的备份目录，让 Codex 下次启动创建新的日志库。
4. 清理 Chromium 的网页缓存、代码缓存、GPU 缓存、WebGPU 缓存和着色器缓存。
5. 重新启动 Codex；如果安装了 Codex++，优先使用 Codex++ 快捷方式。

日志备份默认位于：

```text
%USERPROFILE%\.codex\maintenance-backups\yyyyMMdd-HHmmss
```

## 它不会做什么

- 不删除 `sessions`、`archived_sessions`、`attachments`、`skills`、`plugins` 或 `pets`。
- 不删除 `state_5.sqlite`、登录 Cookie、设置和本地图片。
- 不修改 Microsoft Store 的 `WindowsApps` 文件。
- 不关闭硬件加速，也不写入未经官方说明的 Electron 启动参数。
- 不自动删除大型任务；单个任务超过 50 MB 时只给出提示。

## 最简单的使用方式

1. 保存手头正在编辑的内容。
2. 双击仓库根目录的 `Optimize-Codex.cmd`。
3. 阅读提示并输入 `Y`。
4. 等待 Codex 自动重新启动。

## 只分析，不更改

在 PowerShell 中运行：

```powershell
.\tools\Optimize-Codex.ps1 -Mode Analyze
```

## 可选的深度临时文件清理

默认不会清理 `.codex\.tmp`。确认其中没有需要保留的临时构建产物后，可以额外运行：

```powershell
.\tools\Optimize-Codex.ps1 -Mode Optimize -ForceClose -Restart -CleanStaleTemp -TempRetentionDays 30
```

## 为什么不直接删除聊天记录

任务 JSONL 可能接近或超过 100 MB，打开这类任务时仍可能短暂卡顿，但这些文件就是可恢复的任务记录。优化器把数据安全放在第一位，只报告大型任务。建议先在 Codex 里归档已经完成的超大任务，再按需手工备份。

## 恢复日志备份

正常情况下无需恢复诊断日志。若需要排查问题，请先完全退出 Codex，再将最近备份目录中的 `logs_2.sqlite`、`logs_2.sqlite-wal` 和 `logs_2.sqlite-shm` 移回 `%USERPROFILE%\.codex`。恢复前请先保留现有同名文件的副本。

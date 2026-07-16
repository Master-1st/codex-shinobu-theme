# Codex Windows 优化器

> 仅支持 Windows。该工具维护本机日志与可再生缓存，不修改 Codex 官方程序、`app.asar`、`WindowsApps`、私有数据库结构或未经官方说明的 Electron 参数。

## 先只读分析

双击 `Analyze-Codex.cmd`，或运行：

```powershell
.\tools\Optimize-Codex.ps1 -Mode Analyze
```

它会显示 Codex 进程内存、`logs_2.sqlite` 主库/WAL/SHM、可再生网页与 GPU 缓存、临时文件、任务总量，以及超过 50 MB 的大型任务。分析模式不会关闭 Codex 或修改文件。

## 一键维护

1. 保存未发送内容。
2. 双击 `Optimize-Codex.cmd` 并输入 `Y`。
3. 按提示正常退出全部 Codex 窗口，再按 Enter。
4. 如果仍有残留进程，只有输入大写 `FORCE` 才会强制终止；直接按 Enter 会安全取消。
5. 工具按主库 + WAL + SHM 总大小判断，超过 128 MB 时整体移动到时间戳备份目录。
6. 清理精确列出的 Chromium、GPU、WebGPU、着色器以及 `codex-browser-app` 分区缓存。
7. 优先从刚才实际运行的可执行文件重启。

缓存会由 Codex 重建，所以第一次启动可能暂时比平时慢。

## 保留的数据

- `sessions`、`archived_sessions`、任务正文；
- `attachments`、`skills`、`plugins`、`pets`；
- `state_5.sqlite`、登录 Cookie、设置；
- Codex++ 主题、自定义图片；
- `.codex\.tmp`，除非显式使用 `-CleanStaleTemp`。

## 备份与恢复

日志备份位于：

```text
%USERPROFILE%\.codex\maintenance-backups\yyyyMMdd-HHmmss
```

要恢复，请完全退出 Codex，把当前同名日志文件另存一份，再将备份中的 `logs_2.sqlite`、`logs_2.sqlite-wal`、`logs_2.sqlite-shm` 移回 `%USERPROFILE%\.codex`。

## 高级参数

预演但不关闭程序或改文件：

```powershell
.\tools\Optimize-Codex.ps1 -Mode Optimize -WhatIf
```

额外清理 30 天前的临时文件：

```powershell
.\tools\Optimize-Codex.ps1 -Mode Optimize -CleanStaleTemp -TempRetentionDays 30
```

`-CodexHome` 和 `-WebProfile` 默认只允许系统标准位置。测试或便携环境使用其他根目录时，必须显式增加 `-AllowCustomPaths`；清理器仍会拒绝目录联接和重解析点。

## 仍然卡顿时

清缓存不能解决所有问题。单个超大任务、网络/代理、GPU 驱动、沙箱边界或 Codex 本身缺陷需要分别诊断。优化器只报告大型任务，不会代替用户删除记录。

# Codex Shinobu Theme（仅 Windows）

> [!IMPORTANT]
> **本项目只能用于 Windows 版 Codex Desktop，并且必须通过 Codex++ 加载。** 不支持 macOS、Linux/WSL、Codex Web、Codex CLI、VS Code 扩展，也不能直接加载到未经 Codex++ 处理的 Microsoft Store 原版程序中。Windows 11 x64 已实机验证；Windows 10 x64 仅作兼容目标，尚未完成同等实机验收。

给 Windows 版 Codex Desktop 使用的小忍主题：柠檬黄、薄荷绿、奶油粉配色，内置人物位于右侧安全区的 16:9 横版背景，并支持换成你有权使用的本地 PNG、JPG 或 WebP。人物位于主界面背景层，对话、回复、审批卡和输入框以半透明玻璃层叠在画面上方。

[直接下载 v1.2.0 Windows 安装包](https://github.com/Master-1st/codex-shinobu-theme/releases/download/v1.2.0/codex-shinobu-theme-v1.2.0-windows.zip) · [查看最新 Release](https://github.com/Master-1st/codex-shinobu-theme/releases/latest)

![Codex Shinobu Theme preview](assets/preview.png)

## 三步安装

1. 先安装并至少启动一次 [Codex++](https://github.com/b-nnett/codex-plusplus)。
2. 下载上面的 Windows ZIP，**完整解压**；不要在压缩包预览窗口里直接双击。
3. 双击 `install.cmd`，安装完成后完全退出所有 Codex 窗口，再从 **Codex++** 快捷方式启动。

首次安装 Codex++ 时，可在 PowerShell 运行其官方命令：

```powershell
irm https://raw.githubusercontent.com/b-nnett/codex-plusplus/main/install.ps1 | iex
```

主题安装到：

```text
%APPDATA%\codex-plusplus\tweaks\io.github.master1st.codex-shinobu-theme
```

再次运行 `install.cmd` 即可更新。旧主题代码会进入 `theme-backups`，自定义图片数据不会被覆盖。安装器只修复已知 Codex++ 镜像目录中的失效快捷方式，不修改 Microsoft Store 原版快捷方式或 `WindowsApps`。

完整步骤、回滚和数据目录见 [Windows 使用说明书](docs/WINDOWS-USER-GUIDE.md)。双击无反应、主题不显示或更新后布局异常见 [故障排查](docs/TROUBLESHOOTING.md)。

## v1.2.0 的重点

- 顶部菜单保留原生全长布局；右侧任务标题栏只覆盖约三分之一窗口，并使用 Codex 实际的 36 px 工具栏基线定位。
- 对话和输入框继续在侧栏之外居中，缩放、恢复窗口和覆盖式侧栏都由同一套测量逻辑处理。
- 默认开启“性能优先”：流式长回复不再逐条执行毛玻璃重绘，持续呼吸动画关闭；可在主题设置中恢复完整效果。
- DOM 监听只响应结构变化和布局相关过渡，已卸载的任务节点会解除观察，减少长时间运行后的额外开销。
- 新增完整 Windows 说明书、故障排查、只读分析和双击卸载入口。
- 优化器按日志主库、WAL、SHM 总大小判断，并识别 Codex 内嵌浏览器分区缓存。

## 双击工具

| 文件 | 用途 | 是否改动数据 |
| --- | --- | --- |
| `install.cmd` | 一键安装或覆盖更新主题 | 只写入 Codex++ 主题目录，并备份旧主题 |
| `Analyze-Codex.cmd` | 查看进程内存、日志、缓存和大型任务 | 否，只读 |
| `Optimize-Codex.cmd` | 经确认后轮换过大日志并清理可再生缓存 | 是，可回滚日志备份；不删任务和登录 |
| `Uninstall-Theme.cmd` | 卸载主题，可选择保留或清除导入图片 | 只处理本主题目录 |

## 换成自己的原版图片

打开 `设置 → Tweaks → 小忍主题`，点击“选择本地图片”。支持 PNG、JPG、WebP，单张最大 16 MB。图片会在本机转换为 WebP，不会上传。

设置页可以：

- 显示或隐藏角色背景；
- 根据图片自动生成整套主题色；
- 开关轻微动效和“性能优先”；
- 在无缝铺满与完整显示之间切换；
- 设置图片靠左、居中或靠右；
- 一键恢复内置插画。

建议使用 16:9 横图，把人物放在右侧约 40%，中部保留低细节区域。完整取色流程见 [换图后自动生成主题配色](docs/AUTO-PALETTE.md)。

## Codex 卡顿维护边界

本仓库不会修改 OpenAI 的签名程序、`app.asar`、私有数据库结构或未经说明的 Electron 参数。可以安全优化的是：

- 本主题自己的 DOM 监听、动画和毛玻璃开销；
- 过大的 Codex 诊断日志；
- 可由 Codex 自动重建的 Chromium / GPU / 内嵌浏览器缓存；
- 大型任务的只读提示。

双击 `Analyze-Codex.cmd` 可先做只读检查。需要维护时再运行 `Optimize-Codex.cmd`；详细备份、首次重建缓存和恢复方法见 [Codex Windows 优化器](docs/CODEX-WINDOWS-OPTIMIZER.md)。

## 卸载

双击 `Uninstall-Theme.cmd`：

- `K`：卸载主题，保留导入图片；
- `P`：卸载主题并清除导入图片；
- `C`：取消。

也可以在 PowerShell 使用 `uninstall.ps1`。Codex++ 本身需单独使用 `codexplusplus uninstall` 卸载。

## 支持矩阵

| 环境 | 状态 |
| --- | --- |
| Windows 11 x64 + Microsoft Store Codex Desktop + Codex++ | 已验证 |
| Windows 10 x64 + Microsoft Store Codex Desktop + Codex++ | 兼容目标，未完成同等实机验证 |
| 未经 Codex++ 处理的商店原版 Codex | 不支持加载主题 |
| macOS、Linux、WSL、Web、CLI、VS Code 扩展 | 不支持 |

当前选择器基线：Codex Desktop `26.707.12708.0`。Codex 更新后若局部样式异常，请附上 Codex、Codex++ 和主题版本提交 issue。

## 文档

- [Windows 使用说明书](docs/WINDOWS-USER-GUIDE.md)
- [故障排查](docs/TROUBLESHOOTING.md)
- [主题配色与背景设计](docs/THEME-DESIGN.md)
- [换图后自动生成主题配色](docs/AUTO-PALETTE.md)
- [视觉与功能验收](docs/VISUAL-QA.md)
- [Codex Windows 优化器](docs/CODEX-WINDOWS-OPTIMIZER.md)
- [发布检查表](docs/RELEASE-CHECKLIST.md)
- [图片与素材授权边界](ASSET-LICENSE.md)

## 从源码构建

仅在 Windows 上构建发布包，需 Node.js 20 或更新版本：

```powershell
npm test
npm run package
```

输出位于 `output/`。项目没有 npm 第三方运行依赖；默认 WebP 会嵌入 renderer tweak，运行时不下载图片或脚本。

> 非官方同人项目，与 OpenAI、《物语》系列及其权利方无关联。MIT License 只覆盖软件代码，不覆盖角色、参考图、预览图或插画，详见 [NOTICE.md](NOTICE.md) 与 [ASSET-LICENSE.md](ASSET-LICENSE.md)。

## 致谢

- Windows tweak loader：[Codex++](https://github.com/b-nnett/codex-plusplus)
- 结构参考：[HeiGeAi/codex-miku-theme](https://github.com/HeiGeAi/codex-miku-theme)

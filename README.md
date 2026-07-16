# Codex Shinobu Theme（Windows）

给 Windows 版 Codex Desktop 使用的小忍主题：柠檬黄、薄荷绿、奶油粉配色，内置根据你指定图片重新构图的竖版忍野忍背景，并支持在设置中换成任意本地 PNG、JPG 或 WebP。宽屏下聊天区与右侧全高背景分列显示，对话、回复和输入框不会盖住角色画面。

![Codex Shinobu Theme preview](assets/preview.png)

> 非官方同人项目，与 OpenAI、《物语》系列及其权利方无关联。代码使用 MIT License；角色与图片权利不包含在 MIT 授权内，详见 [NOTICE.md](NOTICE.md)。

## 为什么 Windows 版这样安装

Microsoft Store 版 Codex 位于受保护、带签名的 `WindowsApps` 目录。直接替换 `app.asar` 容易造成权限、更新或启动问题。

本项目使用 [Codex++](https://github.com/b-nnett/codex-plusplus) 的 Windows 可写副本与 tweak 接口：

- 不夺取 `WindowsApps` 所有权；
- 不覆盖商店版 Codex；
- Codex 更新后可由 Codex++ 修复加载器；
- 主题可以单独停用或删除；
- 自定义图片只保存在本机。

## 安装

### 1. 安装 Codex++

在 PowerShell 中运行 Codex++ 官方安装命令：

```powershell
irm https://raw.githubusercontent.com/b-nnett/codex-plusplus/main/install.ps1 | iex
```

### 2. 安装小忍主题

1. 从本仓库的 Releases 下载 `codex-shinobu-theme-v1.0.0-windows.zip`。
2. 完整解压 ZIP。
3. 双击 `install.cmd`。
4. 从开始菜单或桌面启动 **Codex++** 快捷方式。

安装器把主题放到：

```text
%APPDATA%\codex-plusplus\tweaks\io.github.master1st.codex-shinobu-theme
```

更新主题时再次运行 `install.cmd` 即可；旧主题代码会自动备份，自定义图片数据不会被覆盖。

## 使用你自己的原版图片

打开：

```text
设置 → Tweaks → 小忍主题
```

然后点击“选择本地图片”。主题会在本机完成缩放与 WebP 转换，不会上传图片。设置页还可以：

- 开关角色主视觉；
- 开关轻微动效；
- 切换“铺满右侧背景 / 完整显示”；
- 设置角色靠左、居中或靠右；
- 一键恢复仓库内置图片。

支持 PNG、JPG、WebP，单张最大 16 MB。建议使用 16:9、人物偏右的 1920×1080 图片。

## 卸载

在解压后的目录运行：

```powershell
.\uninstall.ps1
```

默认保留你导入的图片数据，方便以后重装。需要一并删除时：

```powershell
.\uninstall.ps1 -PurgeData
```

Codex++ 本身可用 `codexplusplus uninstall` 单独卸载。

## 从源码构建

需要 Node.js 20 或更新版本：

```powershell
npm test
npm run package
```

输出文件位于 `output/`。项目不依赖 npm 第三方包；构建过程会把压缩后的默认 WebP 嵌入 tweak，从而避免 Electron 沙箱中的本地路径问题。

## 兼容范围

- Windows 10/11 x64
- Microsoft Store Codex Desktop
- Codex++ 1.0.0 或更新版本
- 当前选择器基线：Codex Desktop `26.707.9981.0`

Codex 的界面结构可能随更新变化。如果主题仍加载但局部没有着色，请提交 issue 并附上 Codex 与 Codex++ 版本。

## 安全边界

- 主题只运行在 renderer 范围，不注册主进程代码或网络请求。
- 运行时不下载任何图片或脚本。
- 本地图片写入 Codex++ 的 per-tweak 数据目录。
- 发布包附带 SHA-256 校验文件。
- `stop()` 会移除样式、属性与 CSS 变量，支持 Codex++ 热重载和安全模式。

## 致谢

- Windows tweak loader：[Codex++](https://github.com/b-nnett/codex-plusplus)
- 结构参考：[HeiGeAi/codex-miku-theme](https://github.com/HeiGeAi/codex-miku-theme)

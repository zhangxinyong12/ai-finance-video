# AI财经资讯视频 使用说明

## 项目形态

这是一个 Electron + Vite React 桌面应用。

- React/Vite 负责界面。
- Electron 主进程负责读取本地配置、调用 API、保存生成结果、检查 FFmpeg。
- 生产环境通过 `Menu.setApplicationMenu(null)` 和 `autoHideMenuBar` 隐藏工具栏。
- Windows 打包使用 `electron-builder`，配置在 `electron-builder.yml`。

## API Key

应用会从项目根目录 `README.md` 读取：

- `MARKETAUX_API_KEY`
- `deepseek_api_key`
- 可选：阿里云百炼/DashScope key

不要把真实 key 写进公开仓库。

## 当前能力

第一版已经完成：

1. 输入财经主题，例如 `global AI chip industry supply chain`
2. 从 Marketaux 拉取国外英文财经新闻
3. 调用 DeepSeek 生成面向中国平台的合规中文口播、字幕和图片提示词
4. 保存 `content.json`、`script.md`、`image-prompts.txt`、`sources.json`
5. 检测本机 FFmpeg，为后续视频合成做准备

## 命令

```bash
pnpm install
pnpm dev
pnpm run build:win
```

打包产物输出到 `release/`。

## 打包说明

打包方式已按 `D:\Personal\抖音私域` 的 Electron 项目对齐：

- `.npmrc` 使用 Electron 镜像：`https://npmmirror.com/mirrors/electron/`
- `electron-builder.yml` 使用 `nsis` 目标
- Windows 图标使用 `build/icon.ico`
- 打包后主窗口隐藏菜单栏和工具栏
- 前台不以股票代码作为输入，不输出股票代码、荐股、买卖建议、目标价或收益暗示

如果首次打包卡在 `winCodeSign-2.6.0.7z`，这是 electron-builder 从 GitHub 下载 Windows 资源编辑工具失败。当前机器已经复用了本地缓存，`pnpm run build:win` 已验证通过。

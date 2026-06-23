# AI 财经资讯视频

本项目是一个本地 Electron 工作台，用于把海外财经新闻整理成合规中文短视频资产。应用会抓取新闻、调用 DeepSeek 生成脚本和封面 HTML、调用 DashScope 生成口播音频，并用 FFmpeg 合成竖屏 MP4。

## 功能

- 抓取海外财经新闻并去重排序。
- 生成中文财经大类资讯解读脚本，不做个股推荐。
- 生成发布标题、简介、标签、封面文案、分镜口播和画面提示词。
- 生成封面图、分镜图、口播音频、字幕和竖屏视频。
- 在界面中配置 API Key、模型、温度、语音和提示词。

## 环境要求

- Node.js 20 或更高版本。
- pnpm。
- FFmpeg 和 FFprobe，并加入系统 `PATH`。

## 安装与运行

```bash
pnpm install
pnpm dev
```

打包 Windows 安装包：

```bash
pnpm run build
```

构建产物会输出到 `release/`，本地生成的视频资产默认输出到 `outputs/`。

## API Key 配置

打开应用后进入左侧菜单的“接口与模型”，填写并保存：

- Marketaux API Key：用于抓取海外财经新闻。
- DeepSeek API Key：用于生成新闻分析脚本和封面 HTML。
- DashScope 语音 Key：用于生成固定声音口播音频。

申请入口：

- Marketaux: https://www.marketaux.com/
- DeepSeek: https://platform.deepseek.com/api_keys
- DashScope: https://help.aliyun.com/zh/model-studio/developer-reference/get-api-key

配置保存到当前用户的 Electron 数据目录，文件名为 `finance-video-config.json`。开发模式下通常位于项目内的 `.electron-user-data/finance-video-config.json`。该文件包含 API Key，不要提交到 Git。

第一次打开应用且没有保存 Key 时，Marketaux、DeepSeek、DashScope 都会显示为“缺失”。

## 本地开发配置文件

本仓库提供一个本地开发配置文件：

- `finance-video-config.local.json`：本机开发优先读取的配置文件，已被 `.gitignore` 忽略；本地开发只需要填写 3 个 Key。
- `.electron-user-data/finance-video-config.json`：应用界面保存的完整配置文件，已被 `.gitignore` 忽略。

开发时可以直接编辑项目根目录的 `finance-video-config.local.json`，内容保持下面这样即可：

```json
{
  "marketauxApiKey": "你的 Marketaux Key",
  "deepseekApiKey": "你的 DeepSeek Key",
  "alibabaDashscopeApiKey": "你的 DashScope Key"
}
```

模型、温度、语音和提示词都有代码默认值，不需要写在本地开发配置里。也可以在应用“接口与模型”页面保存配置；界面保存时会把所有可调参数写入 `.electron-user-data/finance-video-config.json`。

## 可配置参数

“接口与模型”页面支持配置：

- DeepSeek 新闻分析/脚本模型，默认 `deepseek-v4-pro`。
- DeepSeek 封面 HTML 模型，默认 `deepseek-v4-pro`。
- 脚本温度和封面温度。
- DashScope TTS 模型，默认 `qwen3-tts-flash`。
- DashScope 声音，默认 `Cherry`。
- TTS 请求超时。
- 新闻资讯分析提示词。
- 脚本 system prompt。
- 封面 system prompt。
- 封面额外提示词。

“生成任务”页面里的“本次新闻分析提示词”默认读取全局配置，但只影响当前生成任务，便于临时调整账号风格。

## 本地文件与忽略规则

`.gitignore` 已忽略：

- 依赖目录：`node_modules/`
- 构建产物：`dist/`、`dist-electron/`、`release/`
- Electron 本地数据：`.electron-user-data/`
- 生成输出：`outputs/`
- 本地环境和密钥：`.env`、`.env.*`、`*.local`、`*.secret`、`secrets.*`、`finance-video-config.json`、`finance-video-config.local.json`
- 日志和系统/editor 噪声。

## 验证

```bash
pnpm exec tsc --noEmit
pnpm run build
```

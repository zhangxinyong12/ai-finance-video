import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface AppSecrets {
  marketauxApiKey?: string;
  deepseekApiKey?: string;
  alibabaDashscopeApiKey?: string;
}

export interface AppRuntimeConfig extends AppSecrets {
  deepseekScriptModel: string;
  deepseekCoverModel: string;
  deepseekScriptTemperature: number;
  deepseekCoverTemperature: number;
  dashscopeTtsModel: string;
  dashscopeTtsVoice: string;
  ttsTimeoutMs: number;
  contentPrompt: string;
  scriptSystemPrompt: string;
  coverSystemPrompt: string;
  coverPromptExtra: string;
}

export interface NewsArticle {
  uuid?: string;
  title: string;
  description?: string;
  snippet?: string;
  url?: string;
  source?: string;
  publishedAt?: string;
  entities?: string[];
}

export interface GenerationRequest {
  topic: string;
  maxArticles: number;
  requestRounds: number;
  durationSeconds: number;
  outputDir: string;
  tone: string;
  contentPrompt?: string;
}

export interface ScenePlan {
  title: string;
  narration: string;
  imagePrompt: string;
  caption: string;
}

export interface GeneratedContent {
  videoTitle: string;
  publishTitle: string;
  publishContent: string;
  hashtags: string[];
  coverDescription: string;
  coverImagePath?: string;
  audioPath?: string;
  videoPath?: string;
  summary: string;
  disclaimer: string;
  scenes: ScenePlan[];
  sourceArticles: NewsArticle[];
  outputDir: string;
  files: string[];
}

export interface ProgressEvent {
  phase: string;
  message: string;
  percent: number;
}

interface MarketauxResponse {
  data?: Array<Record<string, any>>;
}

interface SaveResult {
  files: string[];
  coverImagePath: string;
  audioPath: string;
  videoPath: string;
}

const emitter = new EventEmitter();

const BROAD_FINANCE_QUERIES = [
  'global financial markets macro economy central banks inflation interest rates',
  'US market risk sentiment bond yields dollar liquidity',
  'global commodities oil gold copper inflation demand',
  'technology industry supply chain earnings capital expenditure',
  'China ADR global trade tariffs manufacturing demand'
];

const BANNED_OUTPUT_PATTERNS = [
  /[A-Z]{1,5}\.(?:US|O|N|L|HK|SS|SZ)\b/g,
  /\b(?:NASDAQ|NYSE|AMEX|HKEX|SSE|SZSE)\s*[:：]?\s*[A-Z0-9.]{1,8}\b/gi,
  /\([A-Z]{1,5}\)/g,
  /\b[A-Z]{1,5}\s+(?:stock|shares?)\b/gi,
  /\b(?:ticker|symbol)\s*[:：]?\s*[A-Z]{1,5}\b/gi,
  /\b\d{6}\b/g,
  /\b\d{4,5}\.HK\b/gi,
  /买入|卖出|持有|加仓|减仓|建仓|清仓|抄底|逃顶|上车|下车|布局|低吸|高抛|目标价|止盈|止损|荐股|推荐股票|可以关注|值得关注/g
];

export const DEFAULT_CONTENT_PROMPT = [
  '只做财经大类资讯解读，不做个股推荐。',
  '受众是国内炒股人群，但内容必须保持公开资讯整理、宏观观察、海外市场、流动性、商品、科技周期、风险偏好等方向。',
  '不要输出股票代码、交易所代码、买入、卖出、持有、加仓、减仓、建仓、清仓、抄底、目标价、止盈、止损、收益承诺。',
  '需要先识别今天海外财经新闻的主线，再解释它对国内投资者通常关注的风险偏好、汇率压力、商品价格、出口链、科技周期和流动性的观察意义。',
  '输出 4 到 6 个分镜。每个分镜的 title 是短栏目标题，4 到 10 个中文字符；caption 是画面卡片里的要点标题，8 到 18 个中文字符；两者不要重复。',
  '每段 narration 控制在 55 到 90 个中文字符，最多不要超过 100 个中文字符。每段用 2 到 3 个短句，保证视频画面文字清晰可读。'
].join('\n');

export const DEFAULT_SCRIPT_SYSTEM_PROMPT = [
  'You are a finance news editor for Chinese short-video platforms.',
  'The audience is retail stock-market participants in mainland China, but the output must not recommend stocks.',
  'Only explain broad finance, macro, overseas markets, commodities, liquidity, industry cycles, and risk sentiment.',
  'Do not output stock tickers, buy/sell advice, target prices, return promises, or trading instructions.',
  'Return strict JSON only.'
].join(' ');

export const DEFAULT_COVER_SYSTEM_PROMPT = 'You are a senior visual designer generating safe production HTML for a fixed-size 1080x1920 mobile video cover. Return JSON only.';

export const DEFAULT_COVER_PROMPT_EXTRA = [
  '封面要像专业财经资讯封面，重点突出时间、主线和大类市场观察。',
  '不要出现个股代码、交易建议、买卖箭头、收益承诺或夸张标题。'
].join('\n');

export const DEFAULT_APP_CONFIG: AppRuntimeConfig = {
  deepseekScriptModel: 'deepseek-v4-pro',
  deepseekCoverModel: 'deepseek-v4-pro',
  deepseekScriptTemperature: 0.45,
  deepseekCoverTemperature: 0.35,
  dashscopeTtsModel: 'qwen3-tts-flash',
  dashscopeTtsVoice: 'Cherry',
  ttsTimeoutMs: 45000,
  contentPrompt: DEFAULT_CONTENT_PROMPT,
  scriptSystemPrompt: DEFAULT_SCRIPT_SYSTEM_PROMPT,
  coverSystemPrompt: DEFAULT_COVER_SYSTEM_PROMPT,
  coverPromptExtra: DEFAULT_COVER_PROMPT_EXTRA
};

export function onProgress(listener: (event: ProgressEvent) => void) {
  emitter.on('progress', listener);
  return () => emitter.off('progress', listener);
}

function progress(phase: string, message: string, percent: number) {
  emitter.emit('progress', { phase, message, percent });
}

export async function checkFfmpeg(): Promise<{ available: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], { timeout: 5000 }, (error, stdout) => {
      if (error) {
        resolve({ available: false, error: '未检测到 ffmpeg，请安装后加入 PATH。' });
        return;
      }
      resolve({ available: true, version: stdout.split(/\r?\n/)[0] });
    });
  });
}

function execFileAsync(file: string, args: string[], timeout = 120000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchMarketauxNews(
  topic: string,
  maxArticles: number,
  requestRounds: number,
  apiKey: string
): Promise<NewsArticle[]> {
  const queries = buildSearchQueries(topic, requestRounds);
  const perRoundLimit = Math.max(3, Math.min(Math.ceil(maxArticles / queries.length) + 2, 12));
  const allArticles: NewsArticle[] = [];

  for (let index = 0; index < queries.length; index += 1) {
    progress('news', `Fetching global finance news round ${index + 1}/${queries.length}`, 15 + Math.round((index / queries.length) * 25));
    allArticles.push(...await fetchMarketauxRound(queries[index], perRoundLimit, apiKey));
  }

  return dedupeArticles(allArticles).slice(0, Math.max(1, Math.min(maxArticles, 40)));
}

function buildSearchQueries(topic: string, requestRounds: number): string[] {
  const rounds = Math.max(1, Math.min(requestRounds, BROAD_FINANCE_QUERIES.length + 1));
  const normalizedTopic = topic.trim();
  const queries = [normalizedTopic || BROAD_FINANCE_QUERIES[0]];

  for (const query of BROAD_FINANCE_QUERIES) {
    if (queries.length >= rounds) break;
    if (!queries.includes(query)) queries.push(query);
  }

  return queries;
}

async function fetchMarketauxRound(search: string, limit: number, apiKey: string): Promise<NewsArticle[]> {
  const url = new URL('https://api.marketaux.com/v1/news/all');
  url.searchParams.set('api_token', apiKey);
  url.searchParams.set('search', search);
  url.searchParams.set('language', 'en');
  url.searchParams.set('must_have_entities', 'true');
  url.searchParams.set('group_similar', 'true');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('sort', 'published_at');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Marketaux request failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as MarketauxResponse;
  return (payload.data ?? []).map((item) => ({
    uuid: String(item.uuid ?? ''),
    title: String(item.title ?? ''),
    description: item.description ? String(item.description) : undefined,
    snippet: item.snippet ? String(item.snippet) : undefined,
    url: item.url ? String(item.url) : undefined,
    source: item.source ? String(item.source) : undefined,
    publishedAt: item.published_at ? String(item.published_at) : undefined,
    entities: Array.isArray(item.entities)
      ? item.entities.map((entity: any) => entity.name).filter(Boolean)
      : undefined
  })).filter((item) => item.title);
}

function dedupeArticles(articles: NewsArticle[]): NewsArticle[] {
  const seen = new Set<string>();
  const result: NewsArticle[] = [];

  for (const article of articles) {
    const key = article.url || article.uuid || article.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(article);
  }

  return result.sort((a, b) => {
    const at = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bt = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return bt - at;
  });
}

export async function generateContent(
  request: GenerationRequest,
  config: AppRuntimeConfig
): Promise<GeneratedContent> {
  if (!config.marketauxApiKey) {
    throw new Error('没有配置 Marketaux API Key。');
  }
  if (!config.deepseekApiKey) {
    throw new Error('没有配置 DeepSeek API Key。');
  }

  progress('news', 'Fetching broad global finance news', 10);
  const articles = await fetchMarketauxNews(
    request.topic,
    request.maxArticles,
    request.requestRounds,
    config.marketauxApiKey
  );
  if (articles.length === 0) {
    throw new Error('没有获取到财经新闻，请换一个更宽泛的英文主题，或检查 Marketaux 额度。');
  }

  progress('script', 'Generating compliant Chinese finance analysis', 50);
  const generated = await generateScriptWithDeepseek(request, articles, config);

  progress('save', 'Saving publish assets and media files', 82);
  const outputDir = await createRunOutputDir(request.outputDir);
  const saved = await saveGeneratedFiles(
    outputDir,
    generated,
    articles,
    config
  );

  progress('completed', 'Content and video generation completed', 100);
  return {
    ...generated,
    coverImagePath: saved.coverImagePath,
    audioPath: saved.audioPath,
    videoPath: saved.videoPath,
    sourceArticles: articles,
    outputDir,
    files: saved.files
  };
}

async function generateScriptWithDeepseek(
  request: GenerationRequest,
  articles: NewsArticle[],
  config: AppRuntimeConfig
): Promise<Omit<GeneratedContent, 'sourceArticles' | 'outputDir' | 'files'>> {
  const prompt = buildPrompt(request, articles, config.contentPrompt);
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.deepseekApiKey}`
    },
    body: JSON.stringify({
      model: config.deepseekScriptModel,
      temperature: config.deepseekScriptTemperature,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: config.scriptSystemPrompt
        },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`DeepSeek request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as any;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('DeepSeek 没有返回脚本内容。');
  }

  return sanitizeGeneratedContent(normalizeGeneratedJson(parseJsonObject(content)));
}

function buildPrompt(request: GenerationRequest, articles: NewsArticle[], configuredContentPrompt: string): string {
  const sourceText = articles.map((article, index) => {
    return [
      `#${index + 1}`,
      `title: ${article.title}`,
      `source: ${article.source ?? ''}`,
      `published_at: ${article.publishedAt ?? ''}`,
      `summary: ${article.description ?? article.snippet ?? ''}`,
      `url: ${article.url ?? ''}`,
      `entities: ${safeArray(article.entities).join(', ')}`
    ].join('\n');
  }).join('\n\n');

  return `
Create a Chinese vertical short-video script for Douyin / WeChat Channels / Xiaohongshu.

Positioning:
- Topic scope: broad finance only, not individual stock picking.
- Audience: mainland China retail stock-market participants who care about market direction, macro signals, overseas markets, commodities, liquidity, and industry sentiment.
- Use overseas finance news as source material, then explain why it matters for market observation.

Input topic: ${request.topic}
Target length: about ${request.durationSeconds} seconds
Style: ${request.tone}
News request rounds used: ${request.requestRounds}

User-configurable content instructions:
${(request.contentPrompt ?? configuredContentPrompt).trim() || 'Use the default broad finance news analysis style and compliance rules.'}

Compliance rules:
- Do not output any stock ticker, exchange code, or ticker-like symbol.
- Do not recommend any stock or sector as a trade.
- Do not say buy, sell, hold, add position, reduce position, open position, clear position, bottom fishing, get in, target price, stop profit, stop loss, worth watching, or similar trading guidance.
- Do not forecast exact price moves or returns.
- If source news includes tickers, rewrite them as company names, sectors, or market events.
- The final script can discuss "risk appetite", "liquidity", "valuation pressure", "industry sentiment", "safe-haven demand", "external market signal", but must stay informational.

Analysis requirements:
- First identify the main global finance theme from the news set.
- Then connect it to what Chinese stock-market viewers usually care about: risk appetite, exchange-rate pressure, commodity prices, overseas tech cycle, export chain, interest-rate expectations, or liquidity.
- Include 4 to 6 scenes.
- Each scene must include narration, caption, and imagePrompt.
- For each scene, title and caption must be different:
  - title is a short section title, 4 to 10 Chinese characters.
  - caption is a key point headline shown inside the scene card, 8 to 18 Chinese characters.
  - narration is the full spoken script and must expand on both title and caption.
- Strict length limits for best video readability:
  - Each title: 4 to 10 Chinese characters.
  - Each caption: 8 to 18 Chinese characters.
  - Each narration: 55 to 90 Chinese characters. Do not exceed 100 Chinese characters.
  - Avoid long clauses. Use 2 to 3 short sentences per scene.
  - The narration should be concise enough to fit on one 1080x1920 scene image without tiny text.
- Image prompts must be Chinese and should describe finance news cards, global market boards, macro data dashboards, commodity visuals, central-bank imagery, industry-chain diagrams, or risk-sentiment visuals.
- Do not include stock tickers, candlestick trading signals, buy/sell arrows, or specific portraits.

Return strict JSON only:
{
  "videoTitle": "标题",
  "publishTitle": "抖音作品标题，最多30个中文字符",
  "publishContent": "抖音作品简介，最多1000个中文字符，不含投资建议",
  "hashtags": ["3到6个中文标签，不要带股票代码"],
  "coverDescription": "一句简单描述今天新闻主题的中文封面文案，12到24个中文字符",
  "summary": "一句话摘要",
  "disclaimer": "风险提示",
  "scenes": [
    {
      "title": "分镜标题",
      "narration": "口播文字",
      "caption": "屏幕字幕",
      "imagePrompt": "图片生成提示词"
    }
  ]
}

News sources:
${sourceText}
`.trim();
}

function parseJsonObject(content: string): any {
  const trimmed = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(trimmed);
}

function normalizeGeneratedJson(value: any): Omit<GeneratedContent, 'sourceArticles' | 'outputDir' | 'files'> {
  const scenes = Array.isArray(value.scenes) ? value.scenes : [];
  const normalizedHashtags = Array.isArray(value.hashtags)
    ? value.hashtags.map((tag: any) => String(tag ?? '')).filter(Boolean).slice(0, 8)
    : [];

  return {
    videoTitle: String(value.videoTitle ?? '全球财经资讯快讯'),
    publishTitle: String(value.publishTitle ?? value.videoTitle ?? '全球财经资讯快讯'),
    publishContent: String(value.publishContent ?? value.summary ?? ''),
    hashtags: normalizedHashtags.length > 0 ? normalizedHashtags : ['财经资讯', '全球市场', '宏观观察'],
    coverDescription: String(value.coverDescription ?? value.summary ?? '全球财经大类观察'),
    summary: String(value.summary ?? ''),
    disclaimer: String(value.disclaimer ?? '本内容仅为公开资讯整理，不构成任何投资建议。'),
    scenes: scenes
      .map((scene: any, index: number) => ({
        title: String(scene?.title ?? `分镜 ${index + 1}`),
        narration: String(scene?.narration ?? ''),
        caption: String(scene?.caption ?? ''),
        imagePrompt: String(scene?.imagePrompt ?? '')
      }))
      .filter((scene: ScenePlan) => scene.narration)
  };
}

function sanitizeGeneratedContent(
  content: Omit<GeneratedContent, 'sourceArticles' | 'outputDir' | 'files'>
): Omit<GeneratedContent, 'sourceArticles' | 'outputDir' | 'files'> {
  const scenes = safeScenes(content.scenes).map((scene) => ({
    title: sanitizeText(scene.title),
    narration: sanitizeText(scene.narration),
    caption: sanitizeText(scene.caption),
    imagePrompt: sanitizeText(scene.imagePrompt)
  }));

  return {
    videoTitle: sanitizeText(content.videoTitle),
    publishTitle: limitChars(sanitizeText(content.publishTitle), 30),
    publishContent: limitChars(sanitizeText(content.publishContent), 1000),
    hashtags: safeArray(content.hashtags).map((tag) => sanitizeHashtag(tag)).filter(Boolean).slice(0, 8),
    coverDescription: sanitizeText(content.coverDescription),
    summary: sanitizeText(content.summary),
    disclaimer: '本内容仅为公开资讯整理，不构成任何投资建议。',
    scenes: scenes.length > 0 ? scenes : [
      {
        title: '全球财经观察',
        narration: sanitizeText(content.summary || '今天的海外财经新闻主要围绕宏观预期、流动性和风险偏好展开。'),
        caption: sanitizeText(content.summary || '关注宏观信号与市场情绪变化'),
        imagePrompt: '财经资讯卡片，全球市场面板，宏观数据仪表盘，克制专业风格'
      }
    ]
  };
}

function sanitizeText(input: string): string {
  let output = String(input ?? '');
  for (const pattern of BANNED_OUTPUT_PATTERNS) {
    output = output.replace(pattern, '');
  }
  return output.replace(/\s{2,}/g, ' ').trim();
}

function sanitizeHashtag(input: string): string {
  return sanitizeText(input).replace(/^#+/, '').replace(/\s+/g, '');
}

function limitChars(input: string, maxChars: number): string {
  const chars = Array.from(String(input ?? '').trim());
  return chars.length > maxChars ? chars.slice(0, maxChars).join('') : chars.join('');
}

async function createRunOutputDir(baseDir: string): Promise<string> {
  const stamp = formatFileTimestamp(new Date());
  const outputDir = path.join(baseDir, `finance-video-${stamp}`);
  await fs.mkdir(outputDir, { recursive: true });
  return outputDir;
}

async function saveGeneratedFiles(
  outputDir: string,
  content: Omit<GeneratedContent, 'sourceArticles' | 'outputDir' | 'files'>,
  articles: NewsArticle[],
  config: AppRuntimeConfig
): Promise<SaveResult> {
  const scenes = safeScenes(content.scenes);
  const hashtags = safeArray(content.hashtags);
  const jsonPath = path.join(outputDir, 'content.json');
  const scriptPath = path.join(outputDir, 'script.md');
  const promptsPath = path.join(outputDir, 'image-prompts.txt');
  const sourcesPath = path.join(outputDir, 'sources.json');
  const narrationPath = path.join(outputDir, 'narration.txt');
  const subtitlesPath = path.join(outputDir, 'subtitles.srt');
  const audioPath = path.join(outputDir, 'narration.wav');
  const publishPath = path.join(outputDir, 'douyin-publish.json');
  const coverHtmlPath = path.join(outputDir, 'cover.html');
  const coverImagePath = path.join(outputDir, 'cover.png');
  const videoPath = path.join(outputDir, 'video.mp4');
  const concatPath = path.join(outputDir, 'video-frames.txt');
  const audioConcatPath = path.join(outputDir, 'audio-parts.txt');
  const sceneImagePaths: string[] = [];
  const sceneAudioPaths: string[] = [];

  const normalizedContent = { ...content, scenes, hashtags };
  progress('cover', 'Generating AI cover HTML layout', 84);
  const coverHtml = await generateCoverHtmlWithDeepseek(normalizedContent, articles, config);
  await fs.writeFile(coverHtmlPath, coverHtml, 'utf8');
  await renderHtmlImage(coverHtml, coverImagePath, { width: 1145, height: 1529 });

  progress('media', 'Rendering scene images', 88);
  for (let index = 0; index < scenes.length; index += 1) {
    const sceneImagePath = path.join(outputDir, `scene-${String(index + 1).padStart(2, '0')}.png`);
    await renderHtmlImage(renderSceneHtml(normalizedContent, scenes[index], index), sceneImagePath);
    sceneImagePaths.push(sceneImagePath);
  }

  progress('audio', 'Rendering narration audio', 90);
  const sceneDurations = await renderSceneAudios(outputDir, scenes, narrationPath, audioPath, audioConcatPath, config);
  for (let index = 0; index < scenes.length; index += 1) {
    sceneAudioPaths.push(path.join(outputDir, `audio-${String(index + 1).padStart(2, '0')}.wav`));
  }

  progress('video', 'Rendering vertical MP4 video', 92);
  await renderSlideshowVideo(outputDir, sceneImagePaths, concatPath, audioPath, videoPath, sceneDurations);

  const contentWithAssets = {
    ...normalizedContent,
    coverImagePath,
    videoPath,
    audioPath,
    sourceArticles: articles
  };

  await fs.writeFile(jsonPath, JSON.stringify(contentWithAssets, null, 2), 'utf8');
  await fs.writeFile(scriptPath, renderScriptMarkdown(normalizedContent), 'utf8');
  await fs.writeFile(promptsPath, scenes.map((scene, index) => `${index + 1}. ${scene.imagePrompt}`).join('\n\n'), 'utf8');
  await fs.writeFile(sourcesPath, JSON.stringify(articles, null, 2), 'utf8');
  await fs.writeFile(subtitlesPath, renderSrt(scenes, sceneDurations), 'utf8');
  await fs.writeFile(publishPath, JSON.stringify({
    title: content.publishTitle,
    content: content.publishContent,
    hashtags,
    coverImagePath,
    audioPath,
    videoPath
  }, null, 2), 'utf8');

  return {
    coverImagePath,
    audioPath,
    videoPath,
    files: [
      jsonPath,
      scriptPath,
      promptsPath,
      sourcesPath,
      narrationPath,
      ...sceneAudioPaths,
      audioConcatPath,
      audioPath,
      subtitlesPath,
      publishPath,
      coverHtmlPath,
      coverImagePath,
      ...sceneImagePaths,
      concatPath,
      videoPath
    ]
  };
}

function renderScriptMarkdown(content: Omit<GeneratedContent, 'sourceArticles' | 'outputDir' | 'files'>): string {
  const scenes = safeScenes(content.scenes).map((scene, index) => {
    return [
      `## ${index + 1}. ${scene.title}`,
      '',
      `口播：${scene.narration}`,
      '',
      `字幕：${scene.caption}`,
      '',
      `图片提示词：${scene.imagePrompt}`
    ].join('\n');
  }).join('\n\n');

  return [
    `# ${content.videoTitle}`,
    '',
    `发布标题：${content.publishTitle}`,
    '',
    `发布文案：${content.publishContent}`,
    '',
    `发布标签：${safeArray(content.hashtags).map((tag) => `#${tag}`).join(' ')}`,
    '',
    `封面文案：${content.coverDescription}`,
    '',
    content.summary,
    '',
    `> ${content.disclaimer}`,
    '',
    scenes
  ].join('\n');
}

async function generateCoverHtmlWithDeepseek(
  content: Omit<GeneratedContent, 'sourceArticles' | 'outputDir' | 'files'>,
  _articles: NewsArticle[],
  config: AppRuntimeConfig
): Promise<string> {
  const timestamp = formatChineseTimestamp(new Date());
  const prompt = `
Create one complete HTML document for a Douyin vertical video cover image.

Canvas:
- Exact output size is 1145px wide and 1529px high.
- The first rendered viewport must contain the entire design.
- No scrolling. No overflow. No content outside the canvas.
- Use only inline CSS in a <style> tag. No JavaScript. No external images, fonts, SVG files, or network assets.
- Use CSS shapes, gradients, simple data panels, and typography only.
- Body and the main root element must be exactly width:1145px; height:1529px; overflow:hidden.
- Keep all important text inside a safe area: left/right 96px, top 110px, bottom 360px.
- Do not place key information in the bottom 320px.
- Use Chinese text.
- This cover must be readable on a phone feed thumbnail. Use very large text.
- The cover is not part of the video timeline. It is only the upload cover image.
- The style should feel like a professional finance news cover for Chinese retail stock-market viewers, but do not include stock codes, tickers, buy/sell arrows, buy/sell advice, target price, return promise, or trading instruction.
- The design must not look like a webpage card inside a page. It is the actual full cover.
- Do not include source lists, paragraphs, tiny footnotes, dense tags, data tables, or small text.
- Use one main headline only, ideally 8 to 18 Chinese characters. If the given title is too long, rewrite it into a shorter broad finance headline.
- Main headline font size should be at least 120px and up to 180px.
- The date/time is critical for finance news. Show the full timestamp prominently as "YYYY年MM月DD日 HH:mm:ss".
- Timestamp font size must be at least 52px, visually clear on phone thumbnail, and placed near the top safe area.
- Optional secondary line must be no more than 12 Chinese characters and at least 54px.
- Visual layout should be simple: brand badge, prominent timestamp, huge headline in the center, one small compliance line near bottom safe area.

Content:
- Date/time: ${timestamp}
- Brand badge: 财经资讯
- One-sentence theme to show: ${content.coverDescription}
- Candidate title, shorten if needed: ${content.publishTitle}
- Optional context, do not render as paragraph: ${content.summary}

User-configurable cover instructions:
${config.coverPromptExtra.trim() || 'Use a clear professional finance news cover style.'}

Return strict JSON only:
{
  "html": "<!doctype html>..."
}
`.trim();

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.deepseekApiKey}`
    },
    body: JSON.stringify({
      model: config.deepseekCoverModel,
      temperature: config.deepseekCoverTemperature,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: config.coverSystemPrompt
        },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`DeepSeek cover HTML request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as any;
  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error('DeepSeek did not return cover HTML.');
  }

  const parsed = parseJsonObject(raw);
  const html = String(parsed.html ?? '').trim();
  if (!html || !/<html[\s>]/i.test(html)) {
    throw new Error('DeepSeek cover HTML is invalid.');
  }

  return enforceFixedCanvasHtml(html, { width: 1145, height: 1529 });
}

function renderSceneHtml(
  content: Omit<GeneratedContent, 'sourceArticles' | 'outputDir' | 'files'>,
  scene: ScenePlan,
  index: number
): string {
  const sceneTitle = displayText(scene.title);
  const sceneCaption = displayText(getSceneCaptionTitle(scene));
  const sceneNarration = displayText(scene.narration);
  const footerTitle = displayText(content.coverDescription);
  const titleSize = fitTextFontSize(sceneTitle, { maxFont: 66, minFont: 46, boxWidth: 760, maxLines: 3 });
  const captionSize = fitTextFontSize(sceneCaption, { maxFont: 46, minFont: 34, boxWidth: 760, maxLines: 3 });
  const narrationSize = fitTextFontSize(sceneNarration, { maxFont: 38, minFont: 28, boxWidth: 780, maxLines: 12 });

  return baseHtml(`
    <div class="scene">
      <div class="scene-head">
        <div class="scene-index">${String(index + 1).padStart(2, '0')}</div>
        <div>
          <div class="scene-kicker">财经大类观察</div>
          <h2 style="font-size:${titleSize}px">${escapeHtml(sceneTitle)}</h2>
        </div>
      </div>
      <div class="scene-card">
        <div class="caption" style="font-size:${captionSize}px">${escapeHtml(sceneCaption)}</div>
        <div class="narration" style="font-size:${narrationSize}px">${escapeHtml(sceneNarration)}</div>
      </div>
      <div class="scene-footer">
        <span>${escapeHtml(footerTitle)}</span>
        <span>公开资讯整理</span>
      </div>
    </div>
  `);
}

function baseHtml(body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <style>
    * { box-sizing: border-box; }
    html, body {
      overflow: hidden;
    }
    ::-webkit-scrollbar {
      width: 0;
      height: 0;
      display: none;
    }
    body {
      margin: 0;
      width: 1080px;
      height: 1920px;
      font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
      color: #111827;
      background: #f4f7fb;
    }
    .cover, .scene {
      width: 1080px;
      height: 1920px;
      overflow: hidden;
      padding: 96px 86px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      background:
        linear-gradient(135deg, rgba(22,119,255,.12), rgba(16,185,129,.10)),
        radial-gradient(circle at 78% 16%, rgba(22,119,255,.18), transparent 28%),
        #f7fafc;
    }
    .top, .bottom, .scene-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 30px;
      color: #4b5563;
      font-weight: 600;
    }
    .badge {
      padding: 14px 24px;
      border-radius: 999px;
      background: #111827;
      color: white;
      font-size: 30px;
    }
    .main {
      padding-bottom: 90px;
      overflow: hidden;
    }
    .label, .scene-kicker {
      font-size: 38px;
      color: #1677ff;
      font-weight: 700;
      margin-bottom: 34px;
    }
    h1 {
      margin: 0;
      font-size: 88px;
      line-height: 1.16;
      letter-spacing: 0;
      color: #111827;
      font-weight: 900;
      max-height: 320px;
      overflow: hidden;
    }
    .summary {
      margin-top: 46px;
      font-size: 38px;
      line-height: 1.45;
      color: #374151;
      font-weight: 600;
      max-height: 170px;
      overflow: hidden;
    }
    .tags {
      display: flex;
      gap: 18px;
      flex-wrap: wrap;
      margin-top: 56px;
    }
    .tags span {
      padding: 16px 24px;
      background: white;
      border: 2px solid #dbeafe;
      border-radius: 8px;
      color: #1d4ed8;
      font-size: 32px;
      font-weight: 700;
    }
    .bottom, .scene-footer {
      border-top: 3px solid #d1d5db;
      padding-top: 30px;
      align-items: end;
      line-height: 1.4;
    }
    .scene-head {
      display: grid;
      grid-template-columns: 132px 1fr;
      gap: 28px;
      align-items: start;
    }
    .scene-index {
      width: 112px;
      height: 112px;
      display: grid;
      place-items: center;
      border-radius: 8px;
      background: #111827;
      color: #ffffff;
      font-size: 46px;
      font-weight: 900;
    }
    h2 {
      margin: 0;
      font-size: 66px;
      line-height: 1.18;
      letter-spacing: 0;
      font-weight: 900;
      max-height: 240px;
      overflow: hidden;
    }
    .scene-card {
      margin: 42px 0;
      padding: 50px;
      border-radius: 8px;
      background: #ffffff;
      border: 3px solid #dbeafe;
      box-shadow: 0 22px 70px rgba(15, 23, 42, .10);
      overflow: hidden;
    }
    .caption {
      font-size: 46px;
      line-height: 1.28;
      font-weight: 900;
      color: #1d4ed8;
      margin-bottom: 36px;
      max-height: 180px;
      overflow: hidden;
    }
    .narration {
      font-size: 36px;
      line-height: 1.46;
      color: #1f2937;
      font-weight: 650;
      max-height: 700px;
      overflow: hidden;
    }
  </style>
</head>
<body>${body}</body>
</html>`;
}

interface RenderSize {
  width: number;
  height: number;
}

function enforceFixedCanvasHtml(html: string, size: RenderSize): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '');

  const guard = `
<meta name="viewport" content="width=${size.width}, height=${size.height}, initial-scale=1" />
<style id="codex-fixed-cover-guard">
  * { box-sizing: border-box !important; }
  html, body {
    width: ${size.width}px !important;
    height: ${size.height}px !important;
    min-width: ${size.width}px !important;
    max-width: ${size.width}px !important;
    min-height: ${size.height}px !important;
    max-height: ${size.height}px !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    overscroll-behavior: none !important;
  }
  body {
    position: relative !important;
    scrollbar-width: none !important;
  }
  body::-webkit-scrollbar,
  html::-webkit-scrollbar,
  *::-webkit-scrollbar {
    width: 0 !important;
    height: 0 !important;
    display: none !important;
  }
  body > * {
    max-width: ${size.width}px !important;
    max-height: ${size.height}px !important;
    overflow: hidden !important;
  }
</style>`;

  if (/<head[^>]*>/i.test(cleaned)) {
    return cleaned.replace(/<head[^>]*>/i, (match) => `${match}${guard}`);
  }

  return `<!doctype html><html lang="zh-CN"><head>${guard}</head><body>${cleaned}</body></html>`;
}

async function renderHtmlImage(
  html: string,
  outputPath: string,
  size: RenderSize = { width: 1080, height: 1920 }
): Promise<void> {
  const fixedHtml = enforceFixedCanvasHtml(html, size);
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    show: false,
    webPreferences: {
      offscreen: true,
      sandbox: false
    }
  });

  try {
    win.setContentSize(size.width, size.height);
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fixedHtml)}`);
    await win.webContents.executeJavaScript(`
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.documentElement.style.width = '${size.width}px';
      document.documentElement.style.height = '${size.height}px';
      document.body.style.width = '${size.width}px';
      document.body.style.height = '${size.height}px';
    `);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: size.width, height: size.height });
    await fs.writeFile(outputPath, image.toPNG());
  } finally {
    win.destroy();
  }
}

async function renderSceneAudios(
  outputDir: string,
  scenes: ScenePlan[],
  narrationPath: string,
  audioPath: string,
  audioConcatPath: string,
  config: AppRuntimeConfig
): Promise<number[]> {
  const safe = safeScenes(scenes);
  const narration = safe.map((scene, index) => renderSceneAudioText(scene, index)).join('\n\n');
  await fs.writeFile(narrationPath, narration, 'utf8');

  const durations: number[] = [];
  const audioParts: string[] = [];

  for (let index = 0; index < safe.length; index += 1) {
    const sceneAudioPath = path.join(outputDir, `audio-${String(index + 1).padStart(2, '0')}.wav`);
    progress('audio', `Rendering narration audio ${index + 1}/${safe.length}`, 90 + Math.round((index / Math.max(safe.length, 1)) * 2));
    await renderNarrationAudioText(
      renderSceneAudioText(safe[index], index),
      sceneAudioPath,
      config,
      `第 ${index + 1} 条`,
      90 + Math.round((index / Math.max(safe.length, 1)) * 2)
    );
    const duration = await getMediaDuration(sceneAudioPath);
    durations.push(Math.max(0.5, duration));
    audioParts.push(sceneAudioPath);
  }

  await concatAudioFiles(outputDir, audioParts, audioConcatPath, audioPath);
  await assertAudioFile(audioPath);
  return durations;
}

function renderSceneAudioText(scene: ScenePlan, index: number): string {
  const captionTitle = sanitizeText(getSceneCaptionTitle(scene));
  const narration = sanitizeText(scene.narration);
  return [`第${index + 1}条`, captionTitle, narration]
    .filter((item, itemIndex, items) => Boolean(item) && items.findIndex((value) => sameText(value, item)) === itemIndex)
    .join('。');
}

async function renderNarrationAudioText(
  text: string,
  audioPath: string,
  config: AppRuntimeConfig,
  label = '当前分镜',
  percent = 90
): Promise<void> {
  if (!config.alibabaDashscopeApiKey) {
    throw new Error('没有配置 DashScope 语音 Key，无法生成固定声音的口播。');
  }

  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      progress('audio', `${label} TTS attempt ${attempt}/3`, percent);
      await renderDashscopeNarrationAudio(text, audioPath, config);
      await assertAudioFile(audioPath);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
      }
    }
  }

  throw new Error(`口播音频生成失败：${label} 使用固定声音 ${config.dashscopeTtsModel} / ${config.dashscopeTtsVoice} 连续重试 3 次仍失败。${lastError}`);
}

async function concatAudioFiles(
  outputDir: string,
  audioParts: string[],
  audioConcatPath: string,
  outputPath: string
): Promise<void> {
  if (audioParts.length === 0) {
    throw new Error('没有可用于合并的口播音频。');
  }

  await fs.writeFile(
    audioConcatPath,
    audioParts.map((item) => `file '${toConcatFileName(outputDir, item)}'`).join('\n'),
    'utf8'
  );
  await execFileAsync('ffmpeg', [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', audioConcatPath,
    '-c:a', 'pcm_s16le',
    outputPath
  ], 180000);
}

async function renderDashscopeNarrationAudio(text: string, audioPath: string, config: AppRuntimeConfig): Promise<void> {
  await renderDashscopeMultimodalTts(text, audioPath, config);
}

async function renderDashscopeMultimodalTts(
  text: string,
  audioPath: string,
  config: AppRuntimeConfig
): Promise<void> {
  const response = await fetchWithTimeout('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.alibabaDashscopeApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.dashscopeTtsModel,
      input: {
        text,
        voice: config.dashscopeTtsVoice,
        language_type: 'Chinese'
      }
    })
  }, config.ttsTimeoutMs);

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`multimodal ${config.dashscopeTtsModel}: ${response.status} ${response.statusText} ${detail}`);
  }

  await saveDashscopeAudioResponse(response, audioPath, `multimodal ${config.dashscopeTtsModel}`, config.ttsTimeoutMs);
}

async function saveDashscopeAudioResponse(response: Response, audioPath: string, label: string, timeoutMs: number): Promise<void> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('audio/') || contentType.includes('application/octet-stream')) {
    await fs.writeFile(audioPath, Buffer.from(await response.arrayBuffer()));
    return;
  }

  const payload = await response.json() as any;
  const audioUrl = payload?.output?.audio?.url ?? payload?.output?.url ?? payload?.audio?.url;
  const audioData = payload?.output?.audio?.data ?? payload?.output?.audio?.base64 ?? payload?.audio?.data;

  if (typeof audioUrl === 'string' && audioUrl) {
    const audioResponse = await fetchWithTimeout(audioUrl, {}, timeoutMs);
    if (!audioResponse.ok) {
      throw new Error(`${label}: audio url failed ${audioResponse.status} ${audioResponse.statusText}`);
    }
    await fs.writeFile(audioPath, Buffer.from(await audioResponse.arrayBuffer()));
    return;
  }

  if (typeof audioData === 'string' && audioData) {
    const base64 = audioData.includes(',') ? audioData.split(',').pop()! : audioData;
    await fs.writeFile(audioPath, Buffer.from(base64, 'base64'));
    return;
  }

  throw new Error(`${label}: no audio returned ${JSON.stringify(payload).slice(0, 500)}`);
}

async function assertAudioFile(audioPath: string): Promise<void> {
  const stat = await fs.stat(audioPath);
  if (stat.size < 1024) {
    throw new Error(`audio file is too small: ${stat.size} bytes`);
  }
}

async function renderSlideshowVideo(
  outputDir: string,
  imagePaths: string[],
  concatPath: string,
  audioPath: string,
  videoPath: string,
  sceneDurations: number[]
): Promise<void> {
  const images = imagePaths.length > 0 ? imagePaths : [];
  if (images.length === 0) {
    throw new Error('没有可用于生成视频的图片。');
  }

  const concatLines: string[] = [];
  const audioDuration = await getMediaDuration(audioPath);

  for (let index = 0; index < images.length; index += 1) {
    const imagePath = images[index];
    const duration = sceneDurations[index] ?? sceneDurations[sceneDurations.length - 1] ?? 3;
    concatLines.push(`file '${toConcatFileName(outputDir, imagePath)}'`);
    concatLines.push(`duration ${duration.toFixed(3)}`);
  }
  concatLines.push(`file '${toConcatFileName(outputDir, images[images.length - 1])}'`);

  await fs.writeFile(concatPath, concatLines.join('\n'), 'utf8');
  await execFileAsync('ffmpeg', [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatPath,
    '-i', audioPath,
    '-vf', 'scale=1080:1920,format=yuv420p',
    '-r', '30',
    '-t', audioDuration.toFixed(3),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    videoPath
  ], 180000);
}

function toConcatFileName(outputDir: string, filePath: string): string {
  const relative = path.relative(outputDir, filePath).replace(/\\/g, '/');
  return relative.replace(/'/g, "'\\''");
}

async function getMediaDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ], 30000);
    const duration = Number.parseFloat(stdout.trim());
    if (Number.isFinite(duration) && duration > 0) return duration;
  } catch {
    // Fall through to a conservative estimate.
  }

  return 60;
}

function escapeHtml(input: string): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function visualText(input: string, maxChars: number): string {
  const text = String(input ?? '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return `${chars.slice(0, Math.max(1, maxChars - 1)).join('')}…`;
}

function displayText(input: string): string {
  return String(input ?? '').replace(/\s+/g, ' ').trim();
}

interface FitTextOptions {
  maxFont: number;
  minFont: number;
  boxWidth: number;
  maxLines: number;
}

function fitTextFontSize(text: string, options: FitTextOptions): number {
  const length = Math.max(1, Array.from(text).length);
  for (let font = options.maxFont; font >= options.minFont; font -= 1) {
    const charsPerLine = Math.max(1, Math.floor(options.boxWidth / (font * 0.58)));
    const lines = Math.ceil(length / charsPerLine);
    if (lines <= options.maxLines) return font;
  }
  return options.minFont;
}

function getSceneCaptionTitle(scene: ScenePlan): string {
  const title = sanitizeText(scene.title);
  const caption = sanitizeText(scene.caption);
  if (caption && !sameText(caption, title)) return caption;

  const narration = sanitizeText(scene.narration);
  const firstSentence = narration.split(/[。！？!?；;]/)[0]?.trim();
  if (firstSentence && !sameText(firstSentence, title)) {
    return visualText(firstSentence, 18);
  }

  return title ? `${title}要点` : '本条要点';
}

function sameText(left: string, right: string): boolean {
  return normalizeComparableText(left) === normalizeComparableText(right);
}

function normalizeComparableText(input: string): string {
  return String(input ?? '').replace(/[，。！？、：:\s#]/g, '').trim();
}

function renderSrt(scenes: ScenePlan[], sceneDurations: number[]): string {
  const safe = safeScenes(scenes);
  let cursor = 0;
  return safe.map((scene, index) => {
    const start = cursor;
    const end = start + (sceneDurations[index] ?? 3);
    cursor = end;
    return [
      String(index + 1),
      `${formatSrtTime(start)} --> ${formatSrtTime(end)}`,
      [scene.title, getSceneCaptionTitle(scene)].filter(Boolean).join(' - '),
      ''
    ].join('\n');
  }).join('\n');
}

function formatSrtTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},000`;
}

function formatChineseTimestamp(date: Date): string {
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatFileTimestamp(date: Date): string {
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日${pad(date.getHours())}时${pad(date.getMinutes())}分${pad(date.getSeconds())}秒`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function safeArray(values?: unknown[]): string[] {
  return Array.isArray(values) ? values.map((value) => String(value ?? '')).filter(Boolean) : [];
}

function safeScenes(values?: ScenePlan[]): ScenePlan[] {
  return Array.isArray(values) ? values.filter(Boolean) : [];
}

import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface AppSecrets {
  marketauxApiKey?: string;
  deepseekApiKey?: string;
  alibabaDashscopeApiKey?: string;
  newsApiKey?: string;
}

export interface AppRuntimeConfig extends AppSecrets {
  newsProviders: string[];
  deepseekScriptModel: string;
  deepseekCoverModel: string;
  deepseekScriptTemperature: number;
  deepseekCoverTemperature: number;
  dashscopeTtsModel: string;
  dashscopeTtsVoice: string;
  enableAiImages: boolean;
  dashscopeImageModel: string;
  dashscopeImageSize: string;
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
  provider?: string;
  publishedAt?: string;
  entities?: string[];
}

export interface GenerationRequest {
  topic: string;
  maxArticles: number;
  requestRounds: number;
  maxNewsAgeHours: number;
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
  landscapeCoverImagePath?: string;
  audioPath?: string;
  videoPath?: string;
  summary: string;
  disclaimer: string;
  scenes: ScenePlan[];
  sourceArticles: NewsArticle[];
  sourceWarnings?: string[];
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

interface NewsApiResponse {
  articles?: Array<Record<string, any>>;
}

interface FinanceNewsResult {
  articles: NewsArticle[];
  warnings: string[];
}

interface AiImagePrompts {
  coverPrompt: string;
  scenePrompts: string[];
}

interface SaveResult {
  files: string[];
  coverImagePath: string;
  landscapeCoverImagePath: string;
  audioPath: string;
  videoPath: string;
}

const emitter = new EventEmitter();

const BROAD_FINANCE_QUERIES = [
  'global markets Fed inflation Treasury yields dollar yuan China stocks risk sentiment',
  'US stocks Wall Street liquidity rates China ADR Hong Kong markets',
  'AI chips semiconductors export controls supply chain capital expenditure',
  'China trade tariffs manufacturing demand global supply chain',
  'oil prices inflation transport chemicals China economy market sentiment'
];

const NEWSAPI_FINANCE_QUERIES = [
  '(Fed OR inflation OR Treasury yields OR dollar OR yuan) AND (stocks OR markets OR China)',
  '(Wall Street OR US stocks OR Hong Kong stocks OR China ADR) AND (risk sentiment OR liquidity)',
  '(AI chips OR semiconductor OR Nvidia OR TSMC OR ASML) AND (supply chain OR export controls)',
  '(China trade OR tariffs OR manufacturing OR supply chain) AND markets',
  '(oil prices OR energy costs) AND (inflation OR China economy OR transport OR chemicals)'
];

const DASHSCOPE_IMAGE_TASK_TIMEOUT_MS = 300000;
const DASHSCOPE_IMAGE_CREATE_TIMEOUT_MS = 30000;
const DASHSCOPE_IMAGE_POLL_TIMEOUT_MS = 20000;
const DASHSCOPE_IMAGE_DOWNLOAD_TIMEOUT_MS = 60000;
const DASHSCOPE_IMAGE_POLL_INTERVAL_MS = 2000;

const AI_IMAGE_PROMPT_BANNED_PATTERNS = [
  /抖音/g,
  /小红书/g,
  /视频号/g,
  /9\s*[:：]\s*16/g,
  /二维码/g,
  /条形码/g,
  /水印/g,
  /文字/g,
  /字幕/g,
  /标题/g,
  /股票代码/g,
  /股票名称/g,
  /买入/g,
  /卖出/g,
  /收益承诺/g
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
  '只做面向中国股票投资者的海外财经资讯整理，不做个股推荐。',
  '优先解释海外新闻对 A 股风险偏好、人民币汇率、外资情绪、港股中概、科技产业链、出口链、通胀和流动性的观察意义。',
  '黄金、原油、期货只能作为宏观变量或成本变量提及，不做交易分析、点位预测、做多做空、开户引流或收益暗示。',
  '不要输出股票代码、交易所代码、买入、卖出、持有、加仓、减仓、建仓、清仓、抄底、目标价、止盈、止损、收益承诺。',
  '需要先识别今天海外财经新闻的主线，再解释它对国内投资者通常关注的风险偏好、汇率压力、海外科技周期、出口链、通胀和流动性的观察意义。',
  '输出 4 到 6 个分镜。每个分镜的 title 是短栏目标题，4 到 10 个中文字符；caption 是画面卡片里的要点标题，8 到 18 个中文字符；两者不要重复。',
  '每段 narration 控制在 55 到 90 个中文字符，最多不要超过 100 个中文字符。每段用 2 到 3 个短句，保证视频画面文字清晰可读。'
].join('\n');

export const DEFAULT_SCRIPT_SYSTEM_PROMPT = [
  'You are a finance news editor for Chinese short-video platforms.',
  'The audience is retail stock-market participants in mainland China, but the output must not recommend stocks.',
  'Use overseas news to explain China stock-market observation variables: risk appetite, yuan pressure, Hong Kong and China ADR sentiment, AI chips, export chains, inflation, and liquidity.',
  'Gold, oil, and futures may only be discussed as macro or cost variables, never as tradable instruments.',
  'Do not output stock tickers, buy/sell advice, target prices, return promises, trading instructions, long/short calls, or futures strategies.',
  'Return strict JSON only.'
].join(' ');

export const DEFAULT_COVER_SYSTEM_PROMPT = 'You are a senior visual designer generating safe production HTML for a fixed-size 1080x1920 mobile video cover. Return JSON only.';

export const DEFAULT_COVER_PROMPT_EXTRA = [
  '封面要像专业财经资讯封面，重点突出时间、主线和大类市场观察。',
  '不要出现个股代码、交易建议、买卖箭头、收益承诺或夸张标题。'
].join('\n');

export const DEFAULT_APP_CONFIG: AppRuntimeConfig = {
  newsProviders: ['marketaux', 'marketWatch', 'newsApi'],
  deepseekScriptModel: 'deepseek-v4-pro',
  deepseekCoverModel: 'deepseek-v4-pro',
  deepseekScriptTemperature: 0.45,
  deepseekCoverTemperature: 0.35,
  dashscopeTtsModel: 'qwen3-tts-flash',
  dashscopeTtsVoice: 'Cherry',
  enableAiImages: false,
  dashscopeImageModel: 'wan2.6-t2i',
  dashscopeImageSize: '960*1696',
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
  maxNewsAgeHours: number,
  apiKey: string
): Promise<NewsArticle[]> {
  const queries = buildSearchQueries(topic, requestRounds);
  const perRoundLimit = Math.max(3, Math.min(Math.ceil(maxArticles / queries.length) + 2, 12));
  const freshnessHours = Math.max(1, Math.min(Number.isFinite(maxNewsAgeHours) ? maxNewsAgeHours : 24, 168));
  const publishedAfter = new Date(Date.now() - freshnessHours * 60 * 60 * 1000);
  const allArticles: NewsArticle[] = [];

  for (let index = 0; index < queries.length; index += 1) {
    progress('news', `Fetching global finance news round ${index + 1}/${queries.length}`, 15 + Math.round((index / queries.length) * 25));
    allArticles.push(...await fetchMarketauxRound(queries[index], perRoundLimit, publishedAfter, apiKey));
  }

  return dedupeArticles(allArticles)
    .filter((article) => isArticleAfter(article, publishedAfter))
    .slice(0, Math.max(1, Math.min(maxArticles, 40)));
}

export async function fetchFinanceNews(
  request: GenerationRequest,
  config: AppRuntimeConfig
): Promise<FinanceNewsResult> {
  const freshnessHours = Math.max(1, Math.min(Number.isFinite(request.maxNewsAgeHours) ? request.maxNewsAgeHours : 24, 168));
  const publishedAfter = new Date(Date.now() - freshnessHours * 60 * 60 * 1000);
  const providers = new Set(config.newsProviders.length > 0 ? config.newsProviders : DEFAULT_APP_CONFIG.newsProviders);
  const articles: NewsArticle[] = [];
  const warnings: string[] = [];

  if (providers.has('marketaux') && config.marketauxApiKey) {
    try {
      articles.push(...await fetchMarketauxNews(
        request.topic,
        request.maxArticles,
        request.requestRounds,
        freshnessHours,
        config.marketauxApiKey
      ));
    } catch (error) {
      warnings.push(`Marketaux: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (providers.has('marketWatch')) {
    try {
      articles.push(...await fetchMarketWatchNews(
        request.maxArticles,
        publishedAfter
      ));
    } catch (error) {
      warnings.push(`MarketWatch: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (providers.has('newsApi') && config.newsApiKey) {
    try {
      articles.push(...await fetchNewsApi(
        request.topic,
        request.maxArticles,
        request.requestRounds,
        publishedAfter,
        config.newsApiKey
      ));
    } catch (error) {
      warnings.push(`NewsAPI: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const result = dedupeArticles(articles)
    .filter((article) => isArticleAfter(article, publishedAfter))
    .sort(compareArticlesForChinaStockAudience)
    .slice(0, Math.max(1, Math.min(request.maxArticles, 40)));

  if (result.length === 0 && warnings.length > 0) {
    throw new Error(`新闻源请求失败或无可用新闻：${warnings.join('；')}`);
  }

  return { articles: result, warnings };
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

async function fetchMarketauxRound(search: string, limit: number, publishedAfter: Date, apiKey: string): Promise<NewsArticle[]> {
  const url = new URL('https://api.marketaux.com/v1/news/all');
  url.searchParams.set('api_token', apiKey);
  url.searchParams.set('search', search);
  url.searchParams.set('language', 'en');
  url.searchParams.set('must_have_entities', 'true');
  url.searchParams.set('group_similar', 'true');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('sort', 'published_at');
  url.searchParams.set('published_after', formatMarketauxDate(publishedAfter));

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
    provider: 'Marketaux',
    publishedAt: item.published_at ? String(item.published_at) : undefined,
    entities: Array.isArray(item.entities)
      ? item.entities.map((entity: any) => entity.name).filter(Boolean)
      : undefined
  })).filter((item) => item.title);
}

async function fetchMarketWatchNews(
  maxArticles: number,
  publishedAfter: Date
): Promise<NewsArticle[]> {
  progress('news', 'Fetching MarketWatch RSS', 24);
  const response = await fetchWithTimeout('https://feeds.content.dowjones.io/public/rss/mw_topstories', {
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  }, 20000);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  return parseRssArticles(xml, {
    provider: 'MarketWatch RSS',
    fallbackSource: 'marketwatch.com'
  })
    .filter((article) => isArticleAfter(article, publishedAfter))
    .slice(0, Math.max(1, Math.min(maxArticles, 20)));
}

async function fetchNewsApi(
  topic: string,
  maxArticles: number,
  requestRounds: number,
  publishedAfter: Date,
  apiKey: string
): Promise<NewsArticle[]> {
  const queries = buildNewsApiQueries(topic, requestRounds);
  const perRoundLimit = Math.max(3, Math.min(Math.ceil(maxArticles / queries.length) + 3, 10));
  const allArticles: NewsArticle[] = [];

  for (let index = 0; index < queries.length; index += 1) {
    progress('news', `Fetching NewsAPI ${index + 1}/${queries.length}`, 28 + Math.round((index / queries.length) * 18));
    const url = new URL('https://newsapi.org/v2/everything');
    url.searchParams.set('q', queries[index]);
    url.searchParams.set('language', 'en');
    url.searchParams.set('sortBy', 'publishedAt');
    url.searchParams.set('pageSize', String(perRoundLimit));
    url.searchParams.set('from', publishedAfter.toISOString());

    const response = await fetchWithTimeout(url.toString(), {
      headers: {
        'X-Api-Key': apiKey
      }
    }, 20000);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const payload = await response.json() as NewsApiResponse;
    allArticles.push(...(payload.articles ?? []).map((item) => ({
      title: String(item.title ?? ''),
      description: item.description ? String(item.description) : undefined,
      snippet: item.content ? String(item.content) : undefined,
      url: item.url ? String(item.url) : undefined,
      source: item.source?.name ? String(item.source.name) : undefined,
      provider: 'NewsAPI',
      publishedAt: item.publishedAt ? String(item.publishedAt) : undefined
    })).filter((item) => item.title));
  }

  return allArticles;
}

function buildNewsApiQueries(topic: string, requestRounds: number): string[] {
  const rounds = Math.max(1, Math.min(requestRounds, NEWSAPI_FINANCE_QUERIES.length + 1));
  const topicWords = topic
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => /^[a-zA-Z-]{3,}$/.test(word))
    .slice(0, 5);
  const normalizedTopic = topicWords.length > 0 ? topicWords.join(' OR ') : NEWSAPI_FINANCE_QUERIES[0];
  const queries = [normalizedTopic];

  for (const query of NEWSAPI_FINANCE_QUERIES) {
    if (queries.length >= rounds) break;
    if (!queries.includes(query)) queries.push(query);
  }

  return queries;
}

function isArticleAfter(article: NewsArticle, publishedAfter: Date): boolean {
  if (!article.publishedAt) return false;
  const publishedAt = Date.parse(article.publishedAt);
  return Number.isFinite(publishedAt) && publishedAt >= publishedAfter.getTime();
}

function parseRssArticles(
  xml: string,
  options: { provider: string; fallbackSource: string }
): NewsArticle[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  return items.map((item) => {
    const link = decodeXmlText(extractXmlTag(item, 'link'));
    const domain = link ? getUrlDomain(link) : '';
    return {
      title: decodeXmlText(extractXmlTag(item, 'title')),
      description: decodeXmlText(stripHtml(extractXmlTag(item, 'description'))),
      url: link || undefined,
      source: domain || options.fallbackSource,
      provider: options.provider,
      publishedAt: normalizePublishedDate(extractXmlTag(item, 'pubDate'))
    };
  }).filter((article) => article.title && article.publishedAt);
}

function extractXmlTag(xml: string, tag: string): string {
  const matched = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return matched?.[1]?.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim() ?? '';
}

function stripHtml(input: string): string {
  return String(input ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeXmlText(input: string): string {
  return String(input ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function normalizePublishedDate(input: string): string | undefined {
  const value = Date.parse(input);
  return Number.isFinite(value) ? new Date(value).toISOString() : undefined;
}

function getUrlDomain(input: string): string {
  try {
    return new URL(input).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function formatMarketauxDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '');
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

function compareArticlesForChinaStockAudience(a: NewsArticle, b: NewsArticle): number {
  const scoreDiff = scoreChinaStockAudienceRelevance(b) - scoreChinaStockAudienceRelevance(a);
  if (scoreDiff !== 0) return scoreDiff;

  const at = a.publishedAt ? Date.parse(a.publishedAt) : 0;
  const bt = b.publishedAt ? Date.parse(b.publishedAt) : 0;
  return bt - at;
}

function scoreChinaStockAudienceRelevance(article: NewsArticle): number {
  const text = [
    article.title,
    article.description,
    article.snippet,
    article.source,
    article.provider,
    safeArray(article.entities).join(' ')
  ].join(' ').toLowerCase();

  let score = 0;
  const positiveWeights: Array<[RegExp, number]> = [
    [/\b(china|chinese|yuan|renminbi|hong kong|adr|tariff|trade|export control|supply chain)\b/i, 8],
    [/\b(fed|fomc|inflation|cpi|pce|treasury yield|bond yield|dollar|liquidity|rate cut|interest rate)\b/i, 7],
    [/\b(ai|chip|chips|semiconductor|nvidia|tsmc|asml|data center|capex|cloud)\b/i, 7],
    [/\b(wall street|nasdaq|s&p|global markets|risk sentiment|market sentiment|stocks|equities)\b/i, 5],
    [/\b(ev|electric vehicle|battery|lithium|solar|biotech|pharma|real estate|banks|brokerage|insurance)\b/i, 4],
    [/\b(oil prices|energy costs|crude prices|commodity prices|shipping|transport|chemicals)\b/i, 2]
  ];
  const negativeWeights: Array<[RegExp, number]> = [
    [/\b(crypto|bitcoin|ethereum|forex trading|options strategy)\b/i, 10],
    [/\b(gold futures|crude futures|oil futures|futures contract|long position|short position|trading signal)\b/i, 8],
    [/\b(price target|buy rating|sell rating|upgrade|downgrade)\b/i, 6]
  ];

  for (const [pattern, weight] of positiveWeights) {
    if (pattern.test(text)) score += weight;
  }
  for (const [pattern, weight] of negativeWeights) {
    if (pattern.test(text)) score -= weight;
  }

  const publishedAt = article.publishedAt ? Date.parse(article.publishedAt) : 0;
  if (Number.isFinite(publishedAt) && Date.now() - publishedAt <= 6 * 60 * 60 * 1000) score += 3;
  return score;
}

export async function generateContent(
  request: GenerationRequest,
  config: AppRuntimeConfig
): Promise<GeneratedContent> {
  if (!config.deepseekApiKey) {
    throw new Error('没有配置 DeepSeek API Key。');
  }

  progress('news', 'Fetching broad global finance news', 10);
  const news = await fetchFinanceNews(request, config);
  const { articles } = news;
  if (articles.length === 0) {
    throw new Error(`没有获取到最近 ${request.maxNewsAgeHours ?? 24} 小时内的财经新闻，请换一个更宽泛的英文主题，或检查新闻源配置。`);
  }

  progress('script', 'Generating compliant Chinese finance analysis', 50);
  const generated = await generateScriptWithDeepseek(request, articles, config);
  const generatedWithWarnings = {
    ...generated,
    sourceWarnings: news.warnings
  };

  progress('save', 'Saving publish assets and media files', 82);
  const outputDir = await createRunOutputDir(request.outputDir);
  const saved = await saveGeneratedFiles(
    outputDir,
    generatedWithWarnings,
    articles,
    config
  );

  progress('completed', 'Content and video generation completed', 100);
  return {
    ...generatedWithWarnings,
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
      `provider: ${article.provider ?? ''}`,
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
- Audience: mainland China retail stock-market participants who care about A-share risk appetite, yuan pressure, Hong Kong and China ADR sentiment, overseas tech cycles, export chains, inflation, and liquidity.
- Use overseas finance news as source material, then explain why it matters for China stock-market observation.

Input topic: ${request.topic}
Target length: about ${request.durationSeconds} seconds
Style: ${request.tone}
News request rounds used: ${request.requestRounds}
News freshness window: only use sources published within the last ${request.maxNewsAgeHours} hours.

User-configurable content instructions:
${(request.contentPrompt ?? configuredContentPrompt).trim() || 'Use the default broad finance news analysis style and compliance rules.'}

Compliance rules:
- Do not output any stock ticker, exchange code, or ticker-like symbol.
- Do not recommend any stock or sector as a trade.
- Do not say buy, sell, hold, add position, reduce position, open position, clear position, bottom fishing, get in, target price, stop profit, stop loss, worth watching, or similar trading guidance.
- Do not forecast exact price moves or returns.
- Do not provide gold, crude oil, futures, options, forex, or crypto trading analysis, long/short calls, entry points, or strategy.
- Gold, oil, and commodity news can only be framed as macro signals, inflation expectations, cost pressure, risk appetite, or industry-chain background.
- If source news includes tickers, rewrite them as company names, sectors, or market events.
- The final script can discuss "risk appetite", "liquidity", "valuation pressure", "industry sentiment", "safe-haven demand", "external market signal", "yuan pressure", and "export-chain expectations", but must stay informational.

Analysis requirements:
- First identify the main global finance theme from the news set.
- Then connect it to what Chinese stock-market viewers usually care about: A-share risk appetite, exchange-rate pressure, Hong Kong and China ADR sentiment, overseas tech cycle, export chain, interest-rate expectations, inflation, or liquidity.
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
  const hashtags = safeArray(content.hashtags).map((tag) => sanitizeHashtag(tag)).filter(Boolean).slice(0, 8);
  const scenes = safeScenes(content.scenes).map((scene) => ({
    title: sanitizeText(scene.title),
    narration: sanitizeText(scene.narration),
    caption: sanitizeText(scene.caption),
    imagePrompt: sanitizeText(scene.imagePrompt)
  }));

  return {
    videoTitle: sanitizeText(content.videoTitle),
    publishTitle: limitChars(sanitizeText(content.publishTitle), 30),
    publishContent: appendHashtagsToPublishContent(sanitizeText(content.publishContent), hashtags, 1000),
    hashtags,
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

function appendHashtagsToPublishContent(content: string, hashtags: string[], maxChars: number): string {
  const cleanContent = String(content ?? '').trim();
  const tags = Array.from(new Set(
    hashtags
      .map((tag) => sanitizeHashtag(tag))
      .filter(Boolean)
      .map((tag) => `#${tag}`)
  )).filter((tag) => !cleanContent.includes(tag));

  if (tags.length === 0) return limitChars(cleanContent, maxChars);

  const suffix = tags.join(' ');
  const separator = cleanContent ? '\n\n' : '';
  const suffixLength = Array.from(separator + suffix).length;
  const availableContentChars = maxChars - suffixLength;

  if (availableContentChars <= 0) return limitChars(suffix, maxChars);
  return `${limitChars(cleanContent, availableContentChars)}${separator}${suffix}`.trim();
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
  const landscapeCoverImagePath = path.join(outputDir, 'cover-horizontal.png');
  const videoPath = path.join(outputDir, 'video.mp4');
  const concatPath = path.join(outputDir, 'video-frames.txt');
  const audioConcatPath = path.join(outputDir, 'audio-parts.txt');
  const sceneImagePaths: string[] = [];
  const sceneAudioPaths: string[] = [];
  const generatedBackgroundPaths: string[] = [];

  const normalizedContent = { ...content, scenes, hashtags };
  let coverBackgroundDataUrl: string | undefined;
  let firstSceneBackgroundDataUrl: string | undefined;
  const aiImagePrompts = config.enableAiImages
    ? await generateAiImagePromptsWithDeepseek(normalizedContent, config).catch((error) => {
      progress('image', `DeepSeek image prompts failed, using local fallback: ${error instanceof Error ? error.message : String(error)}`, 83);
      return null;
    })
    : null;
  if (config.enableAiImages) {
    const coverBackgroundPath = path.join(outputDir, 'cover-bg.png');
    try {
      progress('cover', 'Generating DashScope AI cover background', 84);
      await renderDashscopeTextToImage(
        aiImagePrompts?.coverPrompt || buildCoverAiImagePrompt(normalizedContent),
        coverBackgroundPath,
        config,
        '封面背景图',
        84
      );
      generatedBackgroundPaths.push(coverBackgroundPath);
      coverBackgroundDataUrl = await imageFileToDataUrl(coverBackgroundPath);
      const coverHtml = renderAiCoverOverlayHtml(normalizedContent, coverBackgroundDataUrl);
      await fs.writeFile(coverHtmlPath, coverHtml, 'utf8');
      await renderHtmlImage(coverHtml, coverImagePath, { width: 1145, height: 1529 });
    } catch (error) {
      progress('cover', `AI cover failed, using HTML fallback: ${error instanceof Error ? error.message : String(error)}`, 84);
      const coverHtml = await generateCoverHtmlWithDeepseek(normalizedContent, articles, config);
      await fs.writeFile(coverHtmlPath, coverHtml, 'utf8');
      await renderHtmlImage(coverHtml, coverImagePath, { width: 1145, height: 1529 });
    }
  } else {
    progress('cover', 'Generating AI cover HTML layout', 84);
    const coverHtml = await generateCoverHtmlWithDeepseek(normalizedContent, articles, config);
    await fs.writeFile(coverHtmlPath, coverHtml, 'utf8');
    await renderHtmlImage(coverHtml, coverImagePath, { width: 1145, height: 1529 });
  }

  progress('media', 'Rendering scene images', 88);
  for (let index = 0; index < scenes.length; index += 1) {
    const sceneImagePath = path.join(outputDir, `scene-${String(index + 1).padStart(2, '0')}.png`);
    if (config.enableAiImages) {
      const sceneBackgroundPath = path.join(outputDir, `scene-bg-${String(index + 1).padStart(2, '0')}.png`);
      try {
        progress('media', `Generating DashScope AI scene background ${index + 1}/${scenes.length}`, 88 + Math.round((index / Math.max(scenes.length, 1)) * 2));
        await renderDashscopeTextToImage(
          aiImagePrompts?.scenePrompts[index] || buildSceneAiImagePrompt(scenes[index], index),
          sceneBackgroundPath,
          config,
          `分镜 ${index + 1} 背景图`,
          88
        );
        generatedBackgroundPaths.push(sceneBackgroundPath);
        const sceneBackgroundDataUrl = await imageFileToDataUrl(sceneBackgroundPath);
        firstSceneBackgroundDataUrl ||= sceneBackgroundDataUrl;
        await renderHtmlImage(
          renderSceneHtml(normalizedContent, scenes[index], index, sceneBackgroundDataUrl),
          sceneImagePath
        );
      } catch (error) {
        progress('media', `AI scene failed, using HTML fallback: ${error instanceof Error ? error.message : String(error)}`, 88);
        await renderHtmlImage(renderSceneHtml(normalizedContent, scenes[index], index), sceneImagePath);
      }
    } else {
      await renderHtmlImage(renderSceneHtml(normalizedContent, scenes[index], index), sceneImagePath);
    }
    sceneImagePaths.push(sceneImagePath);
  }

  if (config.enableAiImages && !coverBackgroundDataUrl && firstSceneBackgroundDataUrl) {
    progress('cover', 'Rendering covers with first scene AI background', 89);
    coverBackgroundDataUrl = firstSceneBackgroundDataUrl;
    const coverHtml = renderAiCoverOverlayHtml(normalizedContent, coverBackgroundDataUrl);
    await fs.writeFile(coverHtmlPath, coverHtml, 'utf8');
    await renderHtmlImage(coverHtml, coverImagePath, { width: 1145, height: 1529 });
  }

  progress('cover', 'Rendering landscape cover image', 89);
  await renderHtmlImage(
    renderLandscapeCoverHtml(normalizedContent, coverBackgroundDataUrl),
    landscapeCoverImagePath,
    { width: 788, height: 590 }
  );

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
    landscapeCoverImagePath,
    videoPath,
    audioPath,
    sourceArticles: articles
  };

  await fs.writeFile(jsonPath, JSON.stringify(contentWithAssets, null, 2), 'utf8');
  await fs.writeFile(scriptPath, renderScriptMarkdown(normalizedContent), 'utf8');
  await fs.writeFile(promptsPath, renderImagePromptsFile(scenes, aiImagePrompts), 'utf8');
  await fs.writeFile(sourcesPath, JSON.stringify(articles, null, 2), 'utf8');
  await fs.writeFile(subtitlesPath, renderSrt(scenes, sceneDurations), 'utf8');
  await fs.writeFile(publishPath, JSON.stringify({
    title: content.publishTitle,
    content: content.publishContent,
    hashtags,
    coverImagePath,
    landscapeCoverImagePath,
    audioPath,
    videoPath
  }, null, 2), 'utf8');

  return {
    coverImagePath,
    landscapeCoverImagePath,
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
      ...generatedBackgroundPaths,
      coverImagePath,
      landscapeCoverImagePath,
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

function renderImagePromptsFile(scenes: ScenePlan[], prompts: AiImagePrompts | null): string {
  if (prompts) {
    return [
      `封面：${prompts.coverPrompt}`,
      ...prompts.scenePrompts.map((prompt, index) => `分镜 ${index + 1}：${prompt}`)
    ].join('\n\n');
  }

  return scenes.map((scene, index) => `${index + 1}. ${scene.imagePrompt}`).join('\n\n');
}

async function generateAiImagePromptsWithDeepseek(
  content: Omit<GeneratedContent, 'sourceArticles' | 'outputDir' | 'files'>,
  config: AppRuntimeConfig
): Promise<AiImagePrompts> {
  const scenes = safeScenes(content.scenes);
  const prompt = `
你是专业的中文文生图提示词设计师，负责为财经资讯短视频生成阿里万相文生图提示词。

目标：
- 根据封面和每个分镜，生成适合财经新闻视觉的中文文生图提示词。
- 只描述画面元素、场景、光线、构图、风格，不描述平台、比例、尺寸、文件格式。
- 正向提示词里绝对不要出现这些词：抖音、小红书、视频号、9:16、二维码、条形码、水印、文字、字幕、标题、股票代码、股票名称、买入、卖出、收益承诺。
- 不要写“不要/避免/无/禁止”这类否定句；只写希望画面出现什么。
- 每条 60 到 120 个中文字符，具体、可视化、适合金融新闻背景图。
- 画面主体放在两侧、上方或远景，中心区域保持开阔、低细节、层次干净，方便后期叠加信息。
- 背景本身要有可观看价值，边缘和远景保留金融场景细节，不能只是一块纯色或模糊色块。
- 风格可以包含：全球市场数据屏幕、交易大厅、宏观经济仪表盘、商品市场、科技产业链、央行建筑剪影、资金流动抽象光线、风险情绪可视化。

封面信息：
- 标题：${content.publishTitle}
- 封面主题：${content.coverDescription}
- 摘要：${content.summary}

分镜信息：
${scenes.map((scene, index) => [
    `#${index + 1}`,
    `title: ${scene.title}`,
    `caption: ${scene.caption}`,
    `narration: ${scene.narration}`,
    `oldImagePrompt: ${scene.imagePrompt}`
  ].join('\n')).join('\n\n')}

返回严格 JSON：
{
  "coverPrompt": "封面文生图提示词",
  "scenePrompts": ["分镜1提示词", "分镜2提示词"]
}
`.trim();

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.deepseekApiKey}`
    },
    body: JSON.stringify({
      model: config.deepseekScriptModel,
      temperature: 0.25,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Return strict JSON only. Generate safe visual text-to-image prompts for financial news background images.'
        },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`DeepSeek image prompt request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as any;
  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error('DeepSeek 没有返回文生图提示词。');
  }

  const parsed = parseJsonObject(raw);
  const coverPrompt = cleanAiImagePrompt(parsed.coverPrompt, buildCoverAiImagePrompt(content));
  const scenePrompts = scenes.map((scene, index) => cleanAiImagePrompt(
    Array.isArray(parsed.scenePrompts) ? parsed.scenePrompts[index] : '',
    buildSceneAiImagePrompt(scene, index)
  ));

  return { coverPrompt, scenePrompts };
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

function renderAiCoverOverlayHtml(
  content: Omit<GeneratedContent, 'sourceArticles' | 'outputDir' | 'files'>,
  backgroundDataUrl: string
): string {
  const timestamp = formatChineseTimestamp(new Date());
  const headline = displayText(content.coverDescription || content.publishTitle || content.videoTitle);
  const subtitle = displayText(content.summary || content.publishTitle);
  const headlineSize = fitTextFontSize(headline, { maxFont: 146, minFont: 82, boxWidth: 900, maxLines: 4 });
  const subtitleSize = fitTextFontSize(subtitle, { maxFont: 54, minFont: 38, boxWidth: 880, maxLines: 3 });

  return enforceFixedCanvasHtml(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: 1145px;
      height: 1529px;
      overflow: hidden;
      font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
      color: #ffffff;
    }
    .cover-root {
      position: relative;
      width: 1145px;
      height: 1529px;
      overflow: hidden;
      padding: 104px 96px 118px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      background: #111827;
      isolation: isolate;
    }
    .cover-bg-canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
    }
    .cover-shade {
      position: absolute;
      inset: 0;
      z-index: 1;
      background:
        linear-gradient(180deg, rgba(2, 6, 23, .48) 0%, rgba(2, 6, 23, .10) 38%, rgba(2, 6, 23, .58) 100%),
        linear-gradient(90deg, rgba(2, 6, 23, .50) 0%, rgba(2, 6, 23, .06) 58%, rgba(2, 6, 23, .30) 100%);
    }
    .top, .main, .bottom {
      position: relative;
      z-index: 2;
    }
    .top {
      display: flex;
      justify-content: space-between;
      gap: 28px;
      align-items: center;
    }
    .badge {
      padding: 18px 28px;
      border-radius: 8px;
      background: rgba(255,255,255,.94);
      color: #111827;
      font-size: 38px;
      line-height: 1;
      font-weight: 900;
    }
    .time {
      font-size: 54px;
      line-height: 1.1;
      font-weight: 900;
      text-align: right;
      text-shadow: 0 4px 18px rgba(0,0,0,.45);
    }
    .main {
      padding: 90px 0 130px;
    }
    h1 {
      margin: 0;
      max-height: 620px;
      overflow: hidden;
      font-size: ${headlineSize}px;
      line-height: 1.08;
      letter-spacing: 0;
      font-weight: 900;
      text-shadow: 0 8px 34px rgba(0,0,0,.55);
    }
    .subtitle {
      margin-top: 44px;
      max-height: 230px;
      overflow: hidden;
      font-size: ${subtitleSize}px;
      line-height: 1.32;
      font-weight: 800;
      color: rgba(255,255,255,.92);
      text-shadow: 0 5px 22px rgba(0,0,0,.55);
    }
    .bottom {
      display: flex;
      justify-content: space-between;
      align-items: end;
      gap: 28px;
      border-top: 4px solid rgba(255,255,255,.72);
      padding-top: 34px;
      font-size: 34px;
      line-height: 1.32;
      font-weight: 800;
      color: rgba(255,255,255,.90);
      text-shadow: 0 3px 14px rgba(0,0,0,.55);
    }
  </style>
</head>
<body>
  <div class="cover-root">
    <canvas class="cover-bg-canvas" width="1145" height="1529" data-background-src="${escapeHtml(backgroundDataUrl)}"></canvas>
    <div class="cover-shade"></div>
    <div class="top">
      <div class="badge">财经资讯</div>
      <div class="time">${escapeHtml(timestamp)}</div>
    </div>
    <main class="main">
      <h1>${escapeHtml(headline)}</h1>
      <div class="subtitle">${escapeHtml(visualText(subtitle, 42))}</div>
    </main>
    <div class="bottom">
      <span>公开资讯整理</span>
      <span>非投资建议</span>
    </div>
  </div>
</body>
</html>`, { width: 1145, height: 1529 });
}

function renderLandscapeCoverHtml(
  content: Omit<GeneratedContent, 'sourceArticles' | 'outputDir' | 'files'>,
  backgroundDataUrl?: string
): string {
  const timestamp = formatChineseTimestamp(new Date());
  const headline = displayText(content.coverDescription || content.publishTitle || content.videoTitle);
  const subtitle = displayText(content.summary || content.publishTitle);
  const headlineSize = fitTextFontSize(headline, { maxFont: 74, minFont: 42, boxWidth: 470, maxLines: 3 });
  const subtitleSize = fitTextFontSize(subtitle, { maxFont: 28, minFont: 20, boxWidth: 470, maxLines: 2 });

  return enforceFixedCanvasHtml(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: 788px;
      height: 590px;
      overflow: hidden;
      font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
      color: #ffffff;
      background: #0f172a;
    }
    .landscape-cover {
      position: relative;
      width: 788px;
      height: 590px;
      overflow: hidden;
      padding: 44px 52px;
      isolation: isolate;
      background:
        radial-gradient(circle at 76% 28%, rgba(37, 99, 235, .34), transparent 28%),
        linear-gradient(135deg, #0f172a 0%, #111827 54%, #1f2937 100%);
    }
    .landscape-bg-canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
    }
    .landscape-shade {
      position: absolute;
      inset: 0;
      z-index: 1;
      background:
        linear-gradient(90deg, rgba(2, 6, 23, .74) 0%, rgba(2, 6, 23, .44) 52%, rgba(2, 6, 23, .24) 100%),
        linear-gradient(180deg, rgba(2, 6, 23, .35) 0%, rgba(2, 6, 23, .12) 48%, rgba(2, 6, 23, .58) 100%);
    }
    .content {
      position: relative;
      z-index: 2;
      width: 520px;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .top {
      display: flex;
      align-items: center;
      gap: 16px;
      color: rgba(255,255,255,.88);
      font-size: 24px;
      line-height: 1.1;
      font-weight: 800;
      text-shadow: 0 3px 12px rgba(0,0,0,.45);
    }
    .badge {
      padding: 10px 14px;
      border-radius: 8px;
      background: rgba(255,255,255,.94);
      color: #111827;
      font-size: 22px;
      font-weight: 900;
    }
    h1 {
      margin: 0;
      max-height: 245px;
      overflow: hidden;
      font-size: ${headlineSize}px;
      line-height: 1.08;
      letter-spacing: 0;
      font-weight: 900;
      text-shadow: 0 6px 24px rgba(0,0,0,.58);
    }
    .subtitle {
      margin-top: 18px;
      max-height: 78px;
      overflow: hidden;
      font-size: ${subtitleSize}px;
      line-height: 1.35;
      font-weight: 800;
      color: rgba(255,255,255,.88);
      text-shadow: 0 4px 18px rgba(0,0,0,.50);
    }
    .bottom {
      display: flex;
      align-items: center;
      gap: 18px;
      border-top: 2px solid rgba(255,255,255,.62);
      padding-top: 18px;
      color: rgba(255,255,255,.86);
      font-size: 20px;
      font-weight: 800;
      text-shadow: 0 3px 12px rgba(0,0,0,.46);
    }
  </style>
</head>
<body>
  <div class="landscape-cover">
    ${backgroundDataUrl ? `<canvas class="landscape-bg-canvas" width="788" height="590" data-background-src="${escapeHtml(backgroundDataUrl)}"></canvas>` : ''}
    <div class="landscape-shade"></div>
    <div class="content">
      <div class="top">
        <div class="badge">财经资讯</div>
        <div>${escapeHtml(timestamp)}</div>
      </div>
      <main>
        <h1>${escapeHtml(headline)}</h1>
        <div class="subtitle">${escapeHtml(visualText(subtitle, 42))}</div>
      </main>
      <div class="bottom">
        <span>公开资讯整理</span>
        <span>非投资建议</span>
      </div>
    </div>
  </div>
</body>
</html>`, { width: 788, height: 590 });
}

function renderSceneHtml(
  content: Omit<GeneratedContent, 'sourceArticles' | 'outputDir' | 'files'>,
  scene: ScenePlan,
  index: number,
  backgroundDataUrl?: string
): string {
  const sceneTitle = displayText(scene.title);
  const sceneCaption = displayText(getSceneCaptionTitle(scene));
  const sceneNarration = displayText(scene.narration);
  const footerTitle = displayText(content.coverDescription);
  const titleSize = fitTextFontSize(sceneTitle, { maxFont: 66, minFont: 46, boxWidth: 760, maxLines: 3 });
  const captionSize = fitTextFontSize(sceneCaption, { maxFont: 46, minFont: 34, boxWidth: 760, maxLines: 3 });
  const narrationSize = fitTextFontSize(sceneNarration, { maxFont: 38, minFont: 28, boxWidth: 780, maxLines: 12 });

  return baseHtml(`
    <div class="scene${backgroundDataUrl ? ' has-ai-background' : ''}">
      ${backgroundDataUrl ? `<canvas class="ai-background-canvas" width="1080" height="1920" data-background-src="${escapeHtml(backgroundDataUrl)}"></canvas><div class="ai-background-shade"></div>` : ''}
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
      position: relative;
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
      isolation: isolate;
    }
    .ai-background-canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
    }
    .ai-background-shade {
      position: absolute;
      inset: 0;
      z-index: 1;
      background:
        linear-gradient(180deg, rgba(2, 6, 23, .46) 0%, rgba(2, 6, 23, .08) 42%, rgba(2, 6, 23, .54) 100%),
        linear-gradient(90deg, rgba(2, 6, 23, .50) 0%, rgba(2, 6, 23, .04) 54%, rgba(2, 6, 23, .28) 100%);
    }
    .cover > :not(.ai-background-canvas):not(.ai-background-shade),
    .scene > :not(.ai-background-canvas):not(.ai-background-shade) {
      position: relative;
      z-index: 2;
    }
    .scene.has-ai-background {
      color: #ffffff;
      background: #111827;
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
    .scene.has-ai-background .scene-kicker {
      color: #bfdbfe;
      text-shadow: 0 3px 12px rgba(0,0,0,.45);
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
    .scene.has-ai-background h2 {
      color: #ffffff;
      text-shadow: 0 6px 26px rgba(0,0,0,.55);
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
    .scene.has-ai-background .scene-card {
      background: rgba(255,255,255,.78);
      border-color: rgba(255,255,255,.52);
      box-shadow: 0 28px 90px rgba(0,0,0,.34);
      backdrop-filter: blur(2px);
    }
    .scene.has-ai-background .scene-footer {
      color: rgba(255,255,255,.92);
      border-top-color: rgba(255,255,255,.60);
      text-shadow: 0 3px 14px rgba(0,0,0,.50);
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
  const renderHtmlPath = `${outputPath}.render.html`;
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
    await fs.writeFile(renderHtmlPath, fixedHtml, 'utf8');
    win.setContentSize(size.width, size.height);
    await win.loadFile(renderHtmlPath);
    await win.webContents.executeJavaScript(`
      (async () => {
        const loadImage = (src) => new Promise((resolve) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => resolve(null);
          image.src = src;
        });
        await Promise.all(Array.from(document.querySelectorAll('canvas[data-background-src]')).map(async (canvas) => {
          const source = canvas.dataset.backgroundSrc;
          if (!source) return;
          const image = await loadImage(source);
          if (!image) return;
          const context = canvas.getContext('2d');
          if (!context) return;
          const canvasWidth = canvas.width || canvas.clientWidth;
          const canvasHeight = canvas.height || canvas.clientHeight;
          const imageWidth = image.naturalWidth || image.width;
          const imageHeight = image.naturalHeight || image.height;
          const scale = Math.max(canvasWidth / imageWidth, canvasHeight / imageHeight);
          const drawWidth = imageWidth * scale;
          const drawHeight = imageHeight * scale;
          const drawX = (canvasWidth - drawWidth) / 2;
          const drawY = (canvasHeight - drawHeight) / 2;
          context.clearRect(0, 0, canvasWidth, canvasHeight);
          context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
        }));
        await Promise.all(Array.from(document.images).map((img) => {
          if (img.complete) return true;
          return new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          });
        }));
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        document.documentElement.style.width = '${size.width}px';
        document.documentElement.style.height = '${size.height}px';
        document.body.style.width = '${size.width}px';
        document.body.style.height = '${size.height}px';
      })();
    `);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: size.width, height: size.height });
    await fs.writeFile(outputPath, image.toPNG());
  } finally {
    win.destroy();
    await fs.unlink(renderHtmlPath).catch(() => undefined);
  }
}

async function imageFileToDataUrl(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return `data:${detectImageMime(buffer)};base64,${buffer.toString('base64')}`;
}

function detectImageMime(buffer: Buffer): string {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return 'image/png';
}

function buildCoverAiImagePrompt(
  content: Omit<GeneratedContent, 'sourceArticles' | 'outputDir' | 'files'>
): string {
  return cleanAiImagePrompt([
    '专业财经资讯封面背景图，金融新闻视觉，高清商业摄影质感',
    '画面主题：' + sanitizeText(content.coverDescription || content.publishTitle || content.summary),
    '全球市场数据屏幕、交易大厅、宏观经济仪表盘、科技与商品市场意象',
    '克制现代的财经媒体风格，主体偏向两侧或远景，中心区域开阔低细节，边缘保留丰富金融场景细节'
  ].join('，'), '专业财经新闻背景图，全球市场数据屏幕，现代交易大厅，高清商业摄影质感，主体偏侧，中心开阔低细节');
}

function buildSceneAiImagePrompt(scene: ScenePlan, index: number): string {
  return cleanAiImagePrompt([
    `专业财经新闻分镜背景图，序号 ${index + 1}`,
    `主题：${sanitizeText(scene.caption || scene.title)}`,
    `画面说明：${sanitizeText(scene.imagePrompt || scene.narration)}`,
    '现代财经媒体风格，宏观市场氛围，数据可视化元素，真实质感，主体放在两侧或远景，中心区域开阔低细节'
  ].join('，'), '专业财经新闻背景图，宏观市场数据屏幕，真实质感，主体偏侧，中心开阔低细节');
}

function cleanAiImagePrompt(input: unknown, fallback: string): string {
  let output = sanitizeText(String(input ?? '').trim());
  for (const pattern of AI_IMAGE_PROMPT_BANNED_PATTERNS) {
    output = output.replace(pattern, '');
  }
  output = output
    .replace(/不要|避免|禁止|不能|不可|无/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[，,、；;。]{2,}/g, '，')
    .replace(/^[，,、；;。]+|[，,、；;。]+$/g, '')
    .trim();

  return output || fallback;
}

async function renderDashscopeTextToImage(
  promptText: string,
  outputPath: string,
  config: AppRuntimeConfig,
  label: string,
  percent: number
): Promise<void> {
  if (!config.alibabaDashscopeApiKey) {
    throw new Error('没有配置 DashScope Key，无法生成 AI 图片。');
  }

  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      progress('image', `${label} image attempt ${attempt}/3`, percent);
      await renderDashscopeTextToImageOnce(promptText, outputPath, config, label, percent);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 3) {
        progress('image', `${label} image attempt ${attempt}/3 failed, retrying: ${lastError}`, percent);
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
  }

  throw new Error(`${label} 文生图连续重试 3 次仍失败。${lastError}`);
}

async function renderDashscopeTextToImageOnce(
  promptText: string,
  outputPath: string,
  config: AppRuntimeConfig,
  label: string,
  percent: number
): Promise<void> {
  const createResponse = await fetchWithTimeout('https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.alibabaDashscopeApiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable'
    },
    body: JSON.stringify({
      model: config.dashscopeImageModel,
      input: {
        messages: [
          {
            role: 'user',
            content: [
              {
                text: promptText
              }
            ]
          }
        ]
      },
      parameters: {
        size: config.dashscopeImageSize,
        n: 1,
        prompt_extend: false,
        watermark: false,
        negative_prompt: '文字，水印，二维码，股票代码，股票名称，买入，卖出，收益承诺，低清晰度，畸形图表'
      }
    })
  }, DASHSCOPE_IMAGE_CREATE_TIMEOUT_MS);

  if (!createResponse.ok) {
    const detail = await createResponse.text().catch(() => '');
    throw new Error(`${config.dashscopeImageModel}: ${createResponse.status} ${createResponse.statusText} ${detail}`);
  }

  const created = await createResponse.json() as any;
  const immediateUrl = extractDashscopeImageUrl(created);
  const imageUrl = immediateUrl || await waitForDashscopeImage(created, config, label, percent);
  if (!imageUrl) {
    throw new Error(`${label} 文生图任务未返回图片地址`);
  }

  const imageResponse = await fetchWithTimeout(imageUrl, {}, DASHSCOPE_IMAGE_DOWNLOAD_TIMEOUT_MS);
  if (!imageResponse.ok) {
    throw new Error(`${label} 图片下载失败：${imageResponse.status} ${imageResponse.statusText}`);
  }

  await fs.writeFile(outputPath, Buffer.from(await imageResponse.arrayBuffer()));
}

async function waitForDashscopeImage(
  created: any,
  config: AppRuntimeConfig,
  label: string,
  percent: number
): Promise<string | undefined> {
  const taskId = created?.output?.task_id ?? created?.output?.taskId ?? created?.task_id;
  if (!taskId) {
    throw new Error(`${label} 文生图任务没有返回 task_id`);
  }

  const maxAttempts = Math.ceil(DASHSCOPE_IMAGE_TASK_TIMEOUT_MS / DASHSCOPE_IMAGE_POLL_INTERVAL_MS);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    progress('image', `${label} AI image polling ${attempt}/${maxAttempts}`, percent);
    await new Promise((resolve) => setTimeout(resolve, DASHSCOPE_IMAGE_POLL_INTERVAL_MS));
    const response = await fetchWithTimeout(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${config.alibabaDashscopeApiKey}`
      }
    }, DASHSCOPE_IMAGE_POLL_TIMEOUT_MS);

    if (!response.ok) {
      throw new Error(`${label} 文生图任务查询失败：${response.status} ${response.statusText}`);
    }

    const payload = await response.json() as any;
    const imageUrl = extractDashscopeImageUrl(payload);
    if (imageUrl) return imageUrl;

    const status = String(payload?.output?.task_status ?? payload?.output?.taskStatus ?? '').toUpperCase();
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      throw new Error(`${label} 文生图任务失败：${payload?.output?.message ?? payload?.message ?? status}`);
    }
  }

  throw new Error(`${label} 文生图任务超过 ${Math.round(DASHSCOPE_IMAGE_TASK_TIMEOUT_MS / 1000)} 秒仍未完成`);
}

function extractDashscopeImageUrl(payload: any): string | undefined {
  const choices = Array.isArray(payload?.output?.choices) ? payload.output.choices : [];
  for (const choice of choices) {
    const content = Array.isArray(choice?.message?.content) ? choice.message.content : [];
    for (const item of content) {
      const image = item?.image ?? item?.url ?? item?.image_url;
      if (typeof image === 'string' && image) return image;
    }
  }

  const result = payload?.output?.results?.[0] ?? payload?.output?.result ?? payload?.result;
  const url = result?.url ?? result?.image_url ?? payload?.output?.url ?? payload?.output?.image_url;
  return typeof url === 'string' && url ? url : undefined;
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

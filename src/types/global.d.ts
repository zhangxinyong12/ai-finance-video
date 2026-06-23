export interface AppConfigStatus {
  hasMarketauxApiKey: boolean;
  hasNewsApiKey: boolean;
  hasDeepseekApiKey: boolean;
  hasAlibabaDashscopeApiKey: boolean;
  defaultOutputDir: string;
  settings: AppRuntimeConfig;
}

export interface AppRuntimeConfig {
  marketauxApiKey?: string;
  newsApiKey?: string;
  deepseekApiKey?: string;
  alibabaDashscopeApiKey?: string;
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

export interface GenerationRequest {
  topic: string;
  maxArticles: number;
  requestRounds: number;
  maxNewsAgeHours: number;
  durationSeconds: number;
  outputDir: string;
  tone: string;
  contentPrompt: string;
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
  sentiment?: string;
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
  sourceWarnings?: string[];
  outputDir: string;
  files: string[];
}

export interface ProgressEvent {
  phase: string;
  message: string;
  percent: number;
}

export interface ExecutionItem {
  id: string;
  title: string;
  status: 'running' | 'done' | 'failed';
  createdAt: string;
  outputDir: string;
  summary: string;
  content?: GeneratedContent;
}

export interface ElectronAPI {
  app: {
    getVersion: () => Promise<string>;
  };
  config: {
    get: () => Promise<AppConfigStatus>;
    save: (config: Partial<AppRuntimeConfig>) => Promise<AppConfigStatus>;
  };
  system: {
    checkFfmpeg: () => Promise<{ available: boolean; version?: string; error?: string }>;
  };
  dialog: {
    selectOutputDir: () => Promise<string | null>;
  };
  generation: {
    run: (request: GenerationRequest) => Promise<GeneratedContent>;
  };
  shell: {
    openPath: (targetPath: string) => Promise<string>;
    openExternal: (targetUrl: string) => Promise<void>;
  };
  asset: {
    getDataUrl: (targetPath: string) => Promise<string>;
    deleteOutputDir: (targetPath: string) => Promise<void>;
  };
  onGenerationProgress: (callback: (event: ProgressEvent) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

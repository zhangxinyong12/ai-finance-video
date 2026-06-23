import type {
  AppConfigStatus,
  AppRuntimeConfig,
  GeneratedContent,
  GenerationRequest,
  ProgressEvent
} from '../types/global';

const fallback = {
  app: {
    getVersion: () => Promise.resolve('0.1.0')
  },
  config: {
    get: () => Promise.resolve<AppConfigStatus>({
      hasMarketauxApiKey: false,
      hasNewsApiKey: false,
      hasDeepseekApiKey: false,
      hasAlibabaDashscopeApiKey: false,
      defaultOutputDir: '',
      settings: {
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
        contentPrompt: '',
        scriptSystemPrompt: '',
        coverSystemPrompt: '',
        coverPromptExtra: ''
      }
    }),
    save: () => Promise.reject(new Error('Electron environment is not ready')) as Promise<AppConfigStatus>
  },
  system: {
    checkFfmpeg: () => Promise.resolve({ available: false, error: 'Electron environment is not ready' })
  },
  dialog: {
    selectOutputDir: () => Promise.resolve(null)
  },
  generation: {
    run: () => Promise.reject(new Error('Electron environment is not ready')) as Promise<GeneratedContent>
  },
  shell: {
    openPath: () => Promise.resolve(''),
    openExternal: () => Promise.resolve()
  },
  asset: {
    getDataUrl: () => Promise.reject(new Error('Electron environment is not ready')),
    deleteOutputDir: () => Promise.reject(new Error('删除本地文件功能需要重启应用后生效'))
  },
  onGenerationProgress: () => () => {}
};

const runtimeApi = window.electronAPI ?? fallback;
const api = {
  ...fallback,
  ...runtimeApi,
  app: { ...fallback.app, ...runtimeApi.app },
  config: { ...fallback.config, ...runtimeApi.config },
  system: { ...fallback.system, ...runtimeApi.system },
  dialog: { ...fallback.dialog, ...runtimeApi.dialog },
  generation: { ...fallback.generation, ...runtimeApi.generation },
  shell: { ...fallback.shell, ...runtimeApi.shell },
  asset: { ...fallback.asset, ...runtimeApi.asset }
};

export const appAPI = api.app;
export const configAPI = api.config;
export const saveConfig = (config: Partial<AppRuntimeConfig>) => api.config.save(config);
export const systemAPI = api.system;
export const dialogAPI = api.dialog;
export const generationAPI = {
  run: (request: GenerationRequest) => api.generation.run(request)
};
export const shellAPI = api.shell;
export const assetAPI = api.asset;
export const onGenerationProgress = (callback: (event: ProgressEvent) => void) => {
  return api.onGenerationProgress(callback);
};

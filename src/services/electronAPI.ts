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
      hasDeepseekApiKey: false,
      hasAlibabaDashscopeApiKey: false,
      defaultOutputDir: '',
      settings: {
        deepseekScriptModel: 'deepseek-v4-pro',
        deepseekCoverModel: 'deepseek-v4-pro',
        deepseekScriptTemperature: 0.45,
        deepseekCoverTemperature: 0.35,
        dashscopeTtsModel: 'qwen3-tts-flash',
        dashscopeTtsVoice: 'Cherry',
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
    getDataUrl: () => Promise.reject(new Error('Electron environment is not ready'))
  },
  onGenerationProgress: () => () => {}
};

const api = window.electronAPI ?? fallback;

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

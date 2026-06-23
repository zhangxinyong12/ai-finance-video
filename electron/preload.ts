import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { AppRuntimeConfig, GenerationRequest, ProgressEvent } from './generator';

contextBridge.exposeInMainWorld('electronAPI', {
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion')
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    save: (config: Partial<AppRuntimeConfig>) => ipcRenderer.invoke('config:save', config)
  },
  system: {
    checkFfmpeg: () => ipcRenderer.invoke('system:checkFfmpeg')
  },
  dialog: {
    selectOutputDir: () => ipcRenderer.invoke('dialog:selectOutputDir')
  },
  generation: {
    run: (request: GenerationRequest) => ipcRenderer.invoke('generation:run', request)
  },
  shell: {
    openPath: (targetPath: string) => ipcRenderer.invoke('shell:openPath', targetPath),
    openExternal: (targetUrl: string) => ipcRenderer.invoke('shell:openExternal', targetUrl)
  },
  asset: {
    getDataUrl: (targetPath: string) => ipcRenderer.invoke('asset:getDataUrl', targetPath)
  },
  onGenerationProgress: (callback: (event: ProgressEvent) => void) => {
    const listener = (_event: IpcRendererEvent, progress: ProgressEvent) => callback(progress);
    ipcRenderer.on('generation:progress', listener);
    return () => ipcRenderer.removeListener('generation:progress', listener);
  }
});

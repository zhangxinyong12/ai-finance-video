import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_APP_CONFIG,
  type AppRuntimeConfig,
  checkFfmpeg,
  generateContent,
  onProgress,
  type GenerationRequest
} from './generator';

let mainWindow: BrowserWindow | null = null;
const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';
let workspaceDir = process.cwd();

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');

if (isDev) {
  app.setPath('userData', path.join(workspaceDir, '.electron-user-data'));
}

async function createMainWindow(): Promise<BrowserWindow> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    title: 'AI财经资讯视频',
    backgroundColor: '#f5f7fb',
    autoHideMenuBar: true,
    icon: path.join(workspaceDir, 'build/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  Menu.setApplicationMenu(null);

  if (isDev) {
    await mainWindow.loadURL('http://localhost:5848');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

app.whenReady().then(async () => {
  workspaceDir = locateWorkspaceDir();
  await createMainWindow();

  onProgress((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('generation:progress', event);
    }
  });

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

function locateWorkspaceDir(): string {
  const candidates = [
    process.cwd(),
    path.dirname(process.execPath),
    app.getAppPath(),
    app.getPath('userData')
  ];

  for (const candidate of candidates) {
    const found = findReadmeUpward(candidate, 5);
    if (found) return found;
  }

  return process.cwd();
}

function findReadmeUpward(startDir: string, maxDepth: number): string | null {
  let current = startDir;
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const readmePath = path.join(current, 'README.md');
    if (fs.existsSync(readmePath)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('app:getVersion', async () => app.getVersion());

ipcMain.handle('config:get', async () => {
  const settings = await loadRuntimeConfig();
  return toConfigStatus(settings);
});

ipcMain.handle('config:save', async (_, nextConfig: Partial<AppRuntimeConfig>) => {
  const current = await loadRuntimeConfig();
  const settings = normalizeRuntimeConfig({ ...current, ...nextConfig });
  await fs.promises.mkdir(path.dirname(getConfigPath()), { recursive: true });
  await fs.promises.writeFile(getConfigPath(), JSON.stringify(settings, null, 2), 'utf8');
  return toConfigStatus(settings);
});

ipcMain.handle('system:checkFfmpeg', async () => checkFfmpeg());

ipcMain.handle('dialog:selectOutputDir', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: '选择输出目录',
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('generation:run', async (_, request: GenerationRequest) => {
  const settings = await loadRuntimeConfig();
  return generateContent(request, settings);
});

ipcMain.handle('shell:openPath', async (_, targetPath: string) => {
  return shell.openPath(targetPath);
});

ipcMain.handle('shell:openExternal', async (_, targetUrl: string) => {
  await shell.openExternal(String(targetUrl ?? ''));
});

ipcMain.handle('asset:getDataUrl', async (_, targetPath: string) => {
  const resolvedPath = path.resolve(String(targetPath ?? ''));
  const buffer = await fs.promises.readFile(resolvedPath);
  const mime = getMimeType(resolvedPath);
  return `data:${mime};base64,${buffer.toString('base64')}`;
});

ipcMain.handle('asset:deleteOutputDir', async (_, targetPath: string) => {
  const resolvedPath = path.resolve(String(targetPath ?? ''));
  const baseName = path.basename(resolvedPath);
  if (!baseName.startsWith('finance-video-')) {
    throw new Error('只能删除应用生成的 finance-video-* 输出目录。');
  }
  await fs.promises.rm(resolvedPath, { recursive: true, force: true });
});

function getMimeType(targetPath: string): string {
  const ext = path.extname(targetPath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.json') return 'application/json';
  if (ext === '.txt' || ext === '.md' || ext === '.srt') return 'text/plain;charset=utf-8';
  return 'application/octet-stream';
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'finance-video-config.json');
}

function getLocalDevConfigPath(): string {
  return path.join(workspaceDir, 'finance-video-config.local.json');
}

async function loadRuntimeConfig(): Promise<AppRuntimeConfig> {
  const [localDevConfig, fileConfig] = await Promise.all([
    isDev ? readJsonConfigFile(getLocalDevConfigPath()) : Promise.resolve({}),
    readConfigFile()
  ]);

  const mergedConfig = {
    ...compactRuntimeConfig(localDevConfig),
    ...compactRuntimeConfig(fileConfig)
  };

  return normalizeRuntimeConfig({
    ...DEFAULT_APP_CONFIG,
    ...mergedConfig
  });
}

async function readConfigFile(): Promise<Partial<AppRuntimeConfig>> {
  return readJsonConfigFile(getConfigPath());
}

async function readJsonConfigFile(filePath: string): Promise<Partial<AppRuntimeConfig>> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function toConfigStatus(settings: AppRuntimeConfig) {
  return {
    hasMarketauxApiKey: Boolean(settings.marketauxApiKey),
    hasDeepseekApiKey: Boolean(settings.deepseekApiKey),
    hasAlibabaDashscopeApiKey: Boolean(settings.alibabaDashscopeApiKey),
    defaultOutputDir: path.join(workspaceDir, 'outputs'),
    settings
  };
}

function normalizeRuntimeConfig(input: Partial<AppRuntimeConfig>): AppRuntimeConfig {
  const scriptModel = cleanString(input.deepseekScriptModel, DEFAULT_APP_CONFIG.deepseekScriptModel);
  const coverModel = cleanString(input.deepseekCoverModel, DEFAULT_APP_CONFIG.deepseekCoverModel);

  return {
    ...DEFAULT_APP_CONFIG,
    marketauxApiKey: cleanOptionalString(input.marketauxApiKey),
    deepseekApiKey: cleanOptionalString(input.deepseekApiKey),
    alibabaDashscopeApiKey: cleanOptionalString(input.alibabaDashscopeApiKey),
    deepseekScriptModel: normalizeDeepseekModel(scriptModel),
    deepseekCoverModel: normalizeDeepseekModel(coverModel),
    deepseekScriptTemperature: clampNumber(input.deepseekScriptTemperature, 0, 2, DEFAULT_APP_CONFIG.deepseekScriptTemperature),
    deepseekCoverTemperature: clampNumber(input.deepseekCoverTemperature, 0, 2, DEFAULT_APP_CONFIG.deepseekCoverTemperature),
    dashscopeTtsModel: cleanString(input.dashscopeTtsModel, DEFAULT_APP_CONFIG.dashscopeTtsModel),
    dashscopeTtsVoice: cleanString(input.dashscopeTtsVoice, DEFAULT_APP_CONFIG.dashscopeTtsVoice),
    ttsTimeoutMs: Math.round(clampNumber(input.ttsTimeoutMs, 5000, 180000, DEFAULT_APP_CONFIG.ttsTimeoutMs)),
    contentPrompt: cleanString(input.contentPrompt, DEFAULT_APP_CONFIG.contentPrompt),
    scriptSystemPrompt: cleanString(input.scriptSystemPrompt, DEFAULT_APP_CONFIG.scriptSystemPrompt),
    coverSystemPrompt: cleanString(input.coverSystemPrompt, DEFAULT_APP_CONFIG.coverSystemPrompt),
    coverPromptExtra: cleanString(input.coverPromptExtra, DEFAULT_APP_CONFIG.coverPromptExtra)
  };
}

function compactRuntimeConfig(input: Partial<AppRuntimeConfig>): Partial<AppRuntimeConfig> {
  const compacted: Partial<AppRuntimeConfig> = {};
  for (const [key, value] of Object.entries(input) as Array<[keyof AppRuntimeConfig, unknown]>) {
    if (typeof value === 'string' && value.trim() === '') continue;
    if (value === undefined || value === null) continue;
    compacted[key] = value as never;
  }
  return compacted;
}

function cleanOptionalString(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
}

function cleanString(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}

function normalizeDeepseekModel(model: string): string {
  if (model === 'deepseek-chat' || model === 'deepseek-reasoner') {
    return DEFAULT_APP_CONFIG.deepseekScriptModel;
  }
  return model;
}

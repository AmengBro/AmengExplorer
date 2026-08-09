const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { exec, spawn } = require('child_process');
const { createAmsysResolver } = require('./js/amsys-resolver');

// ========== 配置路径（支持便携版） ==========
// 便携版：打包后配置文件存储在 exe 所在目录
// 开发模式：配置文件存储在项目根目录
function getAppBasePath() {
  if (app.isPackaged) {
    // 打包后，使用 exe 所在目录
    return path.dirname(process.execPath);
  }
  // 开发模式，使用项目根目录
  return app.getAppPath();
}

function getConfigPath(fileName) {
  return path.join(getAppBasePath(), fileName);
}

const amsysResolver = createAmsysResolver({
  settingsPath: () => getConfigPath(path.join('config', 'settings.json')),
  embeddedDir: () => app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : app.getAppPath()
});

// 读取应用设置（settings.json），缺失字段用默认值
function readAppSettings() {
  try {
    const settingsPath = getConfigPath(path.join('config', 'settings.json'));
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return { ...defaultSettings, ...data };
    }
  } catch (err) {
    console.error('Failed to read settings.json:', err);
  }
  return { ...defaultSettings };
}

// ========== 首次运行：把 asar 内的默认配置复制到程序目录（便携版可写） ==========
// 打包后 config/ 在 app.asar 内部，而配置读写统一走 exe 旁 config/；
// 不预置的话图标配置读不到，会导致打包版所有图标显示 undefined。
function ensureDefaultConfigFiles() {
  try {
    const configDir = getConfigPath('config');
    fs.mkdirSync(configDir, { recursive: true });

    const files = ['icons.json', 'settings.json', 'launchpad-history.json'];
    for (const file of files) {
      const target = path.join(configDir, file);
      if (fs.existsSync(target)) continue;

      // 默认配置位于 app.asar 内（开发模式项目 config/ 已在 exe 旁，直接跳过）
      const asarSource = path.join(process.resourcesPath || '', 'app.asar', 'config', file);
      if (fs.existsSync(asarSource)) {
        fs.copyFileSync(asarSource, target);
        console.log(`Seeded default config: ${target}`);
      }
    }

  } catch (err) {
    console.error('Failed to seed default config:', err);
  }
}

// 同步接口（旧/兜底）：仅支持配置与内嵌路径；外部 amsys 解析走异步接口
ipcMain.on('amsys-get-path', (event, name) => {
  const n = name || 'amsys.exe';
  event.returnValue = amsysResolver.resolveConfiguredAmsysPath(n) || amsysResolver.resolveEmbeddedAmsysPath(n);
});

ipcMain.handle('amsys-get-path-async', async (event, name) => {
  return amsysResolver.resolveAmsysPathAsync(name || 'amsys.exe');
});

// ========== 检查更新（GitHub Releases，无需数据库） ==========
function compareVersions(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

ipcMain.handle('check-updates', async () => {
  try {
    const res = await fetch('https://api.github.com/repos/AmengBro/AmengExplorer/releases/latest');
    if (!res.ok) {
      // 404 = 暂无 release（或仓库无公开发布），视为已是最新
      if (res.status === 404) {
        return { hasUpdate: false, latestVersion: null, currentVersion: app.getVersion(), url: null };
      }
      return { hasUpdate: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const latest = String(data.tag_name || '').replace(/^v/i, '');
    const current = app.getVersion();
    const hasUpdate = latest ? compareVersions(latest, current) > 0 : false;
    return {
      hasUpdate,
      latestVersion: latest || null,
      currentVersion: current,
      url: data.html_url || null
    };
  } catch (err) {
    return { hasUpdate: false, error: err.message };
  }
});

// ========== PowerShell 路径解析（优先使用程序目录内置的便携版 pwsh7，兼容 Windows PE） ==========
function resolvePowerShellPath() {
  try {
    const base = getAppBasePath();
    const candidates = [
      path.join(base, 'pwsh7', 'pwsh.exe'),
      path.join(base, 'pwsh', 'pwsh.exe'),
      path.join(base, 'pwsh.exe'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  } catch (err) {
    console.error('Failed to resolve pwsh path:', err);
  }
  // 兜底：PATH 中的 pwsh（不存在时由调用方降级为盘符扫描）
  return 'pwsh';
}

ipcMain.on('pwsh-get-path', (event) => {
  event.returnValue = resolvePowerShellPath();
});

// ========== 运行命令路径解析（修复启动台历史里的相对路径命令） ==========
function resolveCommandPath(command) {
  const trimmed = (command || '').trim();
  if (!trimmed) return command;

  const match = trimmed.match(/^("([^"]*)"|'([^']*)'|(\S+))/);
  if (!match) return command;
  const firstToken = match[2] || match[3] || match[4] || '';
  const rest = trimmed.slice(match[0].length).trim();

  // 1) amsys.exe：改写为配置/解包后的实际路径（settings.json 可覆盖）
  if (path.basename(firstToken).toLowerCase() === 'amsys.exe') {
    const amsysPath = resolveAmsysPath('amsys.exe');
    if (amsysPath) {
      const rewritten = `"${amsysPath}"` + (rest ? ' ' + rest : '');
      return rewritten;
    }
  }

  // 2) 相对路径：优先相对程序基础目录（exe 所在目录/项目根）解析
  if (/^\.{1,2}[\\/]/.test(firstToken)) {
    const abs = path.resolve(getAppBasePath(), firstToken);
    if (fs.existsSync(abs)) {
      return `"${abs}"` + (rest ? ' ' + rest : '');
    }
  }

  return command;
}

// Worker 池：最多 4 个并发 worker
const MAX_WORKERS = 4;
const workerPool = [];
const taskQueue = [];

function getWorker() {
  // 复用空闲 worker
  const idle = workerPool.find(w => w.idle);
  if (idle) return idle;

  // 创建新 worker
  if (workerPool.length < MAX_WORKERS) {
    const worker = new Worker(path.join(__dirname, 'js', 'size-worker.js'));
    worker.idle = true;
    worker.taskId = null;
    worker.sender = null;
    workerPool.push(worker);
    return worker;
  }

  // 池满，返回 null，调用者入队等待
  return null;
}

function processQueue() {
  while (taskQueue.length > 0) {
    const worker = getWorker();
    if (!worker) break;
    const task = taskQueue.shift();
    runCalcTask(worker, task);
  }
}

function runCalcTask(worker, task) {
  const { dirPath, taskId, quick, sender } = task;
  worker.idle = false;
  worker.taskId = taskId;
  worker.sender = sender;

  const onMessage = (msg) => {
    if (msg.taskId !== taskId) return;
    if (msg.type === 'progress') {
      // 转发进度到发起该任务的渲染进程
      if (sender && !sender.isDestroyed()) {
        sender.send('calc-size-progress', {
          taskId: msg.taskId,
          progress: msg.progress,
          totalFiles: msg.totalFiles,
          completedFiles: msg.completedFiles,
          completedSize: msg.completedSize,
          currentFile: msg.currentFile,
          indeterminate: msg.indeterminate
        });
      }
    } else if (msg.type === 'done') {
      worker.off('message', onMessage);
      worker.idle = true;
      worker.taskId = null;
      worker.sender = null;
      // resolve promise
      task.resolve({
        status: msg.status,
        size: msg.size,
        fileCount: msg.fileCount,
        error: msg.error
      });
      // 处理队列中的下一个任务
      processQueue();
    }
  };

  worker.on('message', onMessage);
  worker.postMessage({ type: 'calc', dirPath, taskId, quick });
}

function cancelTask(taskId) {
  // 找到执行该任务的 worker
  const worker = workerPool.find(w => w.taskId === taskId);
  if (worker) {
    worker.postMessage({ type: 'cancel' });
  }
  // 同时从队列中移除
  const idx = taskQueue.findIndex(t => t.taskId === taskId);
  if (idx >= 0) {
    const task = taskQueue.splice(idx, 1)[0];
    task.resolve({ status: 'cancelled', size: 0, fileCount: 0 });
  }
}

function createWindow() {
  // 设置 Windows 应用用户模型 ID，确保任务栏图标正确显示
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.ameng.explorer');
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 800,
    title: 'AmengExplorer',
    icon: path.join(__dirname, '..', 'explorer.png'),
    frame: false,
    transparent: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1a2e',
      symbolColor: '#ffffff',
      height: 36,
    },
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
}

// 完整计算（带进度上报，用于手动点击"查看"）
ipcMain.handle('calc-size', async (event, { dirPath, taskId }) => {
  return new Promise((resolve) => {
    const task = {
      dirPath,
      taskId,
      quick: false,
      sender: event.sender,
      resolve
    };
    const worker = getWorker();
    if (worker) {
      runCalcTask(worker, task);
    } else {
      taskQueue.push(task);
    }
  });
});

// 快速计算（独立 worker，不占用共享池，避免大文件夹阻塞小文件夹）
ipcMain.handle('calc-size-quick', async (event, { dirPath, timeoutMs }) => {
  return new Promise((resolve) => {
    let settled = false;
    let worker = null;
    let timer = null;
    const timeout = timeoutMs || 300;

    const cleanup = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (worker) {
        try { worker.terminate(); } catch {}
      }
      resolve(result);
    };

    try {
      worker = new Worker(path.join(__dirname, 'js', 'size-worker.js'));
    } catch (err) {
      resolve({ status: 'error', size: 0, fileCount: 0 });
      return;
    }

    const taskId = 'quick-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

    worker.on('message', (msg) => {
      if (msg.taskId !== taskId) return;
      if (msg.type === 'done') {
        cleanup({
          status: msg.status,
          size: msg.size,
          fileCount: msg.fileCount
        });
      }
    });

    worker.on('error', () => {
      cleanup({ status: 'error', size: 0, fileCount: 0 });
    });

    timer = setTimeout(() => {
      cleanup({ status: 'timeout', size: 0, fileCount: 0 });
    }, timeout);

    worker.postMessage({ type: 'calc', dirPath, taskId, quick: true });
  });
});

// 取消任务
ipcMain.handle('calc-size-cancel', async (event, { taskId }) => {
  cancelTask(taskId);
  return { ok: true };
});

// 暂停任务
ipcMain.handle('calc-size-pause', async (event, { taskId }) => {
  const worker = workerPool.find(w => w.taskId === taskId);
  if (worker) {
    worker.postMessage({ type: 'pause' });
  }
  return { ok: true };
});

// 恢复任务
ipcMain.handle('calc-size-resume', async (event, { taskId }) => {
  const worker = workerPool.find(w => w.taskId === taskId);
  if (worker) {
    worker.postMessage({ type: 'resume' });
  }
  return { ok: true };
});

app.whenReady().then(() => {
  // 先把默认配置落盘到 exe 旁，渲染进程同步读图标配置时才能拿到
  ensureDefaultConfigFiles();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
  
  // Build file index in background (non-blocking)
  startBackgroundIndexBuild();
});

// Global file search index (sigma-file-manager style)
let fileIndex = null;
let searchWorker = null;
let indexResolveCallback = null;
let fileIndexBuilding = false;
let mainWindow = null;

function searchIndex(query, maxResults = 50) {
  if (!fileIndex) return [];
  
  const results = [];
  const queryLower = query.toLowerCase();
  
  const queryTokens = queryLower
    .split(/[\s._-]+/)
    .filter(t => t.length > 0);
  
  const hasTokens = queryTokens.length > 1;
  
  for (const entry of fileIndex.entries) {
    if (results.length >= maxResults) break;
    
    const nameLower = entry.name.toLowerCase();
    const pathLower = entry.path.toLowerCase();
    
    let score = 0;
    
    if (nameLower === queryLower) {
      score = 1000;
    } else if (nameLower === queryLower + '.exe' || nameLower === queryLower + '.lnk') {
      score = 900;
    } else if (nameLower.startsWith(queryLower)) {
      score = 500;
    } else if (nameLower.includes(queryLower)) {
      score = 300;
    } else if (pathLower.includes(queryLower)) {
      score = 200;
    }
    
    if (hasTokens && score < 300) {
      let tokenMatchCount = 0;
      for (const token of queryTokens) {
        if (nameLower.includes(token) || pathLower.includes(token)) {
          tokenMatchCount++;
        }
      }
      if (tokenMatchCount === queryTokens.length) {
        score = 400;
      }
    }
    
    if (score > 0) {
      results.push({ ...entry, _score: score });
    }
  }
  
  results.sort((a, b) => b._score - a._score);
  
  return results.map(({ _score, ...rest }) => rest);
}

function buildFileIndex(forceRebuild = false) {
  if (fileIndex && !forceRebuild) return Promise.resolve(fileIndex);
  if (fileIndexBuilding) {
    return new Promise((resolve) => {
      const existingCb = indexResolveCallback;
      indexResolveCallback = (idx) => {
        if (existingCb) existingCb(idx);
        resolve(idx);
      };
    });
  }
  
  fileIndexBuilding = true;
  
  return new Promise((resolve) => {
    indexResolveCallback = resolve;
    
    if (searchWorker) {
      searchWorker.terminate();
      searchWorker = null;
    }
    
    searchWorker = new Worker(path.join(__dirname, 'js', 'search-index-worker.js'));
    
    searchWorker.on('message', (msg) => {
      if (msg.type === 'progress') {
        // Progress reporting could be sent to renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('launchpad-index-progress', {
            scanned: msg.scanned,
            entries: msg.entries
          });
        }
      } else if (msg.type === 'complete') {
        fileIndex = {
          entries: msg.entries,
          entryCount: msg.entryCount,
          buildTime: msg.buildTime
        };
        fileIndexBuilding = false;
        
        const cb = indexResolveCallback;
        indexResolveCallback = null;
        if (cb) cb(fileIndex);
        
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('launchpad-index-ready', {
            entryCount: msg.entryCount,
            buildTime: msg.buildTime
          });
        }
      }
    });
    
    searchWorker.on('error', (err) => {
      fileIndexBuilding = false;
      const cb = indexResolveCallback;
      indexResolveCallback = null;
      if (cb) cb({ entries: [], entryCount: 0, buildTime: 0, error: err.message });
    });
    
    searchWorker.on('exit', () => {
      fileIndexBuilding = false;
      searchWorker = null;
    });
    
    searchWorker.postMessage({ type: 'build-index', depth: readAppSettings().searchDepth || 5 });
  });
}

// Start building index in background when app is ready
function startBackgroundIndexBuild() {
  const settings = readAppSettings();
  if (settings.autoIndex === false) return;
  buildFileIndex().catch(() => {});
}

ipcMain.handle('launchpad-rebuild-index', async () => {
  fileIndex = null;
  return buildFileIndex(true);
});

ipcMain.handle('launchpad-search', async (event, { query, maxResults = 50, searchInPath = null }) => {
  try {
    // If index is ready, use it
    if (fileIndex) {
      const results = searchIndex(query, maxResults);
      return { results, total: results.length, indexedSearch: true };
    }
    
    // If still building, wait briefly for results
    if (fileIndexBuilding) {
      // Quick timeout: if index finishes within 2s, use it; otherwise use fallback
      const timeoutPromise = new Promise(resolve => setTimeout(resolve, 2000));
      const indexPromise = buildFileIndex();
      
      const result = await Promise.race([indexPromise, timeoutPromise]);
      
      if (result && result.entries) {
        const results = searchIndex(query, maxResults);
        return { results, total: results.length, indexedSearch: true };
      }
    }
    
    // No index available yet - do a quick scan of common locations
    const fallbackResults = quickFallbackSearch(query, maxResults);
    return { results: fallbackResults, total: fallbackResults.length, pathSearch: true };
  } catch (e) {
    return { results: [], total: 0, error: e.message };
  }
});

function quickFallbackSearch(query, maxResults = 50) {
  const results = [];
  const queryLower = query.toLowerCase();
  const seen = new Set();
  
  function addResult(fullPath, name, isDirectory) {
    const pathLower = fullPath.toLowerCase();
    if (seen.has(pathLower)) return;
    
    const nameLower = name.toLowerCase();
    if (!nameLower.includes(queryLower)) return;
    
    seen.add(pathLower);
    try {
      const stat = fs.statSync(fullPath);
      results.push({
        path: fullPath,
        name: name,
        isDirectory: isDirectory,
        size: stat.isDirectory() ? 0 : stat.size
      });
    } catch (e) {}
  }
  
  // Quick scan: PATH directories + drive roots (depth 2)
  const pathEnv = process.env.PATH || '';
  const dirs = pathEnv.split(';').filter(d => d && fs.existsSync(d));
  
  const drives = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  for (const d of drives) {
    const p = `${d}:\\`;
    if (fs.existsSync(p)) dirs.push(p);
  }
  
  const IGNORED = new Set(['system32', 'syswow64', 'winsxs', '$recycle.bin', 'appdata', 'windows']);
  
  for (const dir of dirs) {
    if (results.length >= maxResults) break;
    
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        addResult(fullPath, entry.name, entry.isDirectory());
        
        if (entry.isDirectory() && !IGNORED.has(entry.name.toLowerCase())) {
          if (results.length < maxResults) {
            try {
              const sub = fs.readdirSync(fullPath);
              for (const s of sub) {
                addResult(path.join(fullPath, s), s, false);
                if (results.length >= maxResults) break;
              }
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
  }
  
  return results.slice(0, maxResults);
}

ipcMain.handle('launchpad-run', async (event, { command, type }) => {
  try {
    if (type === 'url') {
      shell.openExternal(command);
      return { success: true };
    } else if (type === 'folder') {
      shell.showItemInFolder(command);
      return { success: true };
    } else if (type === 'file') {
      shell.openPath(command);
      return { success: true };
    } else {
      // command 类型：使用 cmd /c start 模式启动（Windows 标准方式）
      // 等价于 system("start cmd")，确保 GUI 程序能在独立窗口中运行
      try {
        const finalCommand = resolveCommandPath(command);
        const child = spawn('cmd', ['/c', 'start', '', finalCommand], {
          detached: true,
          shell: false,
          windowsHide: false
        });
        child.unref();
        return { success: true };
      } catch (spawnErr) {
        return { success: false, error: spawnErr.message };
      }
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('launchpad-locate', async (event, { path: filePath }) => {
  try {
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ========== Config History IPC ==========

const configDir = getConfigPath('config');
const configHistoryFile = path.join(configDir, 'launchpad-history.json');

function ensureConfigDir() {
  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
  } catch (err) {
    console.error('Failed to ensure config directory:', err);
  }
}

ipcMain.handle('config-read-history', async () => {
  try {
    if (fs.existsSync(configHistoryFile)) {
      const content = fs.readFileSync(configHistoryFile, 'utf-8');
      const data = JSON.parse(content);
      return {
        success: true,
        searches: data.searches || [],
        runs: data.runs || []
      };
    }
    return { success: true, searches: [], runs: [] };
  } catch (err) {
    console.error('Failed to read launchpad history:', err);
    return { success: false, searches: [], runs: [], error: err.message };
  }
});

ipcMain.handle('config-write-history', async (event, { searches, runs }) => {
  try {
    ensureConfigDir();
    const data = { searches: searches || [], runs: runs || [] };
    fs.writeFileSync(configHistoryFile, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    console.error('Failed to write launchpad history:', err);
    return { success: false, error: err.message };
  }
});

// ========== Icons Config IPC ==========

const iconsConfigFile = path.join(configDir, 'icons.json');

// 同步读取（用于模块加载时的同步调用）
ipcMain.on('config-sync-read-icons', (event) => {
  try {
    if (fs.existsSync(iconsConfigFile)) {
      const content = fs.readFileSync(iconsConfigFile, 'utf-8');
      event.returnValue = JSON.parse(content);
    } else {
      event.returnValue = {};
    }
  } catch (err) {
    console.error('Failed to read icons config:', err);
    event.returnValue = {};
  }
});

// 同步写入
ipcMain.on('config-sync-write-icons', (event, data) => {
  try {
    ensureConfigDir();
    fs.writeFileSync(iconsConfigFile, JSON.stringify(data, null, 2), 'utf-8');
    event.returnValue = { success: true };
  } catch (err) {
    console.error('Failed to write icons config:', err);
    event.returnValue = { success: false, error: err.message };
  }
});

// 异步读取（用于常规调用）
ipcMain.handle('config-read-icons', async () => {
  try {
    if (fs.existsSync(iconsConfigFile)) {
      const content = fs.readFileSync(iconsConfigFile, 'utf-8');
      const data = JSON.parse(content);
      return { success: true, data };
    }
    return { success: true, data: {} };
  } catch (err) {
    console.error('Failed to read icons config:', err);
    return { success: false, data: {}, error: err.message };
  }
});

// 异步写入
ipcMain.handle('config-write-icons', async (event, { data }) => {
  try {
    ensureConfigDir();
    fs.writeFileSync(iconsConfigFile, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    console.error('Failed to write icons config:', err);
    return { success: false, error: err.message };
  }
});

// ========== Settings Config IPC ==========

const settingsConfigFile = path.join(configDir, 'settings.json');

const defaultSettings = {
  startPage: 'home',
  defaultView: 'list',
  language: 'zh-CN',
  confirmDelete: true,
  showHidden: false,
  doubleClick: true,
  amsysPath: '',
  homeBanner: './banner-difcult.png',
  autoIndex: true,
  searchDepth: 5,
  saveHistory: true,
  theme: 'dark',
  accentColor: 'blue'
};

ipcMain.handle('config-read-settings', async () => {
  try {
    if (fs.existsSync(settingsConfigFile)) {
      const content = fs.readFileSync(settingsConfigFile, 'utf-8');
      const data = JSON.parse(content);
      return { success: true, settings: { ...defaultSettings, ...data } };
    }
    return { success: true, settings: { ...defaultSettings } };
  } catch (err) {
    console.error('Failed to read settings:', err);
    return { success: false, settings: { ...defaultSettings }, error: err.message };
  }
});

ipcMain.handle('config-write-settings', async (event, settings) => {
  try {
    ensureConfigDir();
    const data = { ...defaultSettings, ...settings };
    fs.writeFileSync(settingsConfigFile, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    console.error('Failed to write settings:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('config-get-path', async () => {
  try {
    return { success: true, path: configDir };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('config-open-dir', async () => {
  try {
    shell.openPath(configDir);
    return { success: true };
  } catch (err) {
    console.error('Failed to open config dir:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-recycle-bin', async () => {
  try {
    const { exec } = require('child_process');
    exec('explorer shell:RecycleBinFolder');
    return { success: true };
  } catch (err) {
    console.error('Failed to open recycle bin:', err);
    return { success: false, error: err.message };
  }
});

app.on('window-all-closed', () => {
  // 终止所有 worker
  workerPool.forEach(w => {
    try { w.terminate(); } catch {}
  });
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

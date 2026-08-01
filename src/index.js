const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { Worker } = require('worker_threads');

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

  const mainWindow = new BrowserWindow({
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

  mainWindow.webContents.openDevTools();
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
    const timeout = timeoutMs || 500;

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
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
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

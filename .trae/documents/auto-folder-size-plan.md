# 文件夹大小自动计算与进度条优化计划

## 摘要

进入文件夹时自动计算该级所有子文件夹的大小（100ms 超时），未完成的项目显示"查看"按钮。计算过程迁移到 Node.js worker_threads（通过主进程 IPC 调度），不阻塞渲染进程。任务面板进度条学习 Windows：总文件数未知时显示"正在统计文件"的不确定动画，已知后显示 `completedFiles/totalFiles` 的确定进度。

## 当前状态分析

### 已实现
- **文件名省略号**：[style.css](file:///i:/Data-数据区/应用/自制/AmengExplorer/src/css/style.css#L644-L652) 中 `.file-item-name` 和 [style.css](file:///i:/Data-数据区/应用/自制/AmengExplorer/src/css/style.css#L723-L731) 中 `.grid-item-name` 已经有 `text-overflow: ellipsis`，但需要确认父容器是否有 `min-width: 0`。
- **calculateDirectorySize**：[app.js](file:///i:/Data-数据区/应用/自制/AmengExplorer/src/js/app.js#L523-L618) 已使用纯 Node.js 递归遍历，但**在渲染进程同步执行**，会阻塞 UI。
- **任务面板**：[app.js](file:///i:/Data-数据区/应用/自制/AmengExplorer/src/js/app.js#L1998-L2056) 已有 `addTask/updateTask/completeTask` 系统，支持 `progress`、`totalFiles`、`completedFiles` 字段。
- **进度条样式**：[style.css](file:///i:/Data-数据区/应用/自制/AmengExplorer/src/css/style.css#L954-L975) 是确定进度条（`width: %`），**没有不确定动画**。

### 未实现
- 进入文件夹时**不会自动计算**子文件夹大小（[app.js](file:///i:/Data-数据区/应用/自制/AmengExplorer/src/js/app.js#L295-L360) 的 `loadDirectory` 不触发计算）
- **没有多线程**：[app.js](file:///i:/Data-数据区/应用/自制/AmengExplorer/src/js/app.js) 没有 `require('worker_threads')`
- **主进程没有 IPC**：[index.js](file:///i:/Data-数据区/应用/自制/AmengExplorer/src/index.js) 引入了 `ipcMain` 但未使用
- **进度条没有不确定模式**

## 提议的修改

### 决策 1：多线程架构 — 主进程 IPC + worker_threads

**为什么**：Electron 渲染进程的 `Worker` 是 Web Worker（无 Node.js API），要用 Node.js `worker_threads` 必须在主进程。`nodeIntegration: true` + `contextIsolation: false` 已配置，IPC 调用简单。

**架构**：
```
渲染进程 (app.js)                    主进程 (index.js)              Worker (size-worker.js)
─────────────────                    ─────────────────              ─────────────────────
calculateDirectorySize ──ipc──>  ipcMain.handle('calc-size')  ──>  postMessage({type:'count', path})
                                  ↓ 创建/复用 worker               ↓ 快速统计文件数
                                  ↓ 转发消息                       postMessage({type:'counted', total})
calculateSize callbacks <──ipc──  forward messages  <──────────  postMessage({type:'progress', ...})
                                                                      postMessage({type:'done', size, count})
```

#### 文件 1: 新建 `src/js/size-worker.js`（新文件）

Worker 线程逻辑，接收路径，分两阶段：
- **阶段 1（快速计数）**：递归遍历，只统计文件数，不 `stat` 文件（用 `readdir` 的 `withFileTypes` 判断目录/文件，文件直接 +1，目录递归）。完成后发送 `{type:'counted', total}`。
- **阶段 2（计算大小）**：再次递归，`stat` 每个文件累加大小，每 200ms 发送 `{type:'progress', completed, size}`。
- 完成后发送 `{type:'done', size, count}`。
- 支持取消：主线程 `postMessage({type:'cancel'})` 时设置标志。

#### 文件 2: 修改 `src/index.js`（主进程）

添加 worker 池（最多 4 个并发）：
```javascript
const { Worker } = require('worker_threads');
const workerPool = []; // 复用 worker

ipcMain.handle('calc-size', async (event, { path, taskId }) => {
  // 创建或复用 worker
  // 监听 worker 消息，通过 event.sender.send('calc-size-progress', {taskId, ...}) 转发
  // 返回最终结果 { size, fileCount }
});
```

#### 文件 3: 修改 `src/js/app.js`

修改 `calculateDirectorySize`（[app.js](file:///i:/Data-数据区/应用/自制/AmengExplorer/src/js/app.js#L523-L618)）改为通过 IPC 调用：
```javascript
const { ipcRenderer } = require('electron');

async calculateDirectorySize(dirPath) {
  // ... 虚拟路径检查 ...
  const task = this.addTask('size', '计算文件夹大小');
  
  // 监听进度（一次性监听器，任务结束后移除）
  const onProgress = (_, data) => {
    if (data.taskId === task.id) {
      this.updateTask(task.id, {
        progress: data.progress,
        totalFiles: data.totalFiles,
        completedFiles: data.completedFiles,
        completedSize: data.completedSize,
        currentFile: data.currentFile,
        indeterminate: data.indeterminate  // 新字段：是否不确定模式
      });
    }
  };
  ipcRenderer.on('calc-size-progress', onProgress);
  
  try {
    const result = await ipcRenderer.invoke('calc-size', {
      path: winPath, taskId: task.id
    });
    ipcRenderer.removeListener('calc-size-progress', onProgress);
    this.completeTask(task.id);
    return { status: 'ok', size: result.size, fileCount: result.fileCount };
  } catch (err) {
    ipcRenderer.removeListener('calc-size-progress', onProgress);
    // ... 错误处理 ...
  }
}
```

### 决策 2：进入文件夹时自动计算（100ms 超时）

**为什么**：用户希望进入文件夹后自动看到子文件夹大小，避免逐个点击。

**实现**：在 `renderFileList`（[app.js](file:///i:/Data-数据区/应用/自制/AmengExplorer/src/js/app.js#L362-L402)）渲染完成后，对每个子文件夹启动带超时的计算：

#### 文件 3（续）: 修改 `src/js/app.js`

新增方法 `autoCalcSubfolderSizes`：
```javascript
async autoCalcSubfolderSizes(fileData) {
  const subdirs = fileData.filter(({ file, stats }) =>
    file.isDirectory && !stats.isVirtual
  );
  
  // 对每个子文件夹并发启动计算，每个 100ms 超时
  const results = await Promise.allSettled(
    subdirs.map(({ fullPath, file }) =>
      this.calcSizeWithTimeout(fullPath, 100)
    )
  );
  
  // 更新对应的 UI 元素
  results.forEach((result, i) => {
    const { fullPath } = subdirs[i];
    const sizeBtn = document.querySelector(
      `.file-item-size-btn[data-path="${CSS.escape(fullPath)}"]`
    );
    if (result.status === 'fulfilled' && result.value.status === 'ok') {
      // 显示大小
      if (sizeBtn) {
        sizeBtn.textContent = this.formatFileSize(result.value.size);
        sizeBtn.classList.add('auto-calculated');
      }
    } else {
      // 超时或失败，保留"查看"按钮
      if (sizeBtn) sizeBtn.textContent = '查看';
    }
  });
}
```

新增 `calcSizeWithTimeout`（快速版本，不进任务面板）：
```javascript
async calcSizeWithTimeout(dirPath, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
    ipcRenderer.invoke('calc-size-quick', { path: dirPath })
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve({ status: 'error' });
      });
  });
}
```

在 `loadDirectory`（[app.js](file:///i:/Data-数据区/应用/自制/AmengExplorer/src/js/app.js#L295-L360)）末尾调用：
```javascript
// 在 renderFileList 之后
this.renderFileList(sortedFiles);
// 自动计算子文件夹大小（后台，不阻塞）
this.autoCalcSubfolderSizes(fileData).catch(err => 
  console.error('auto calc failed:', err)
);
```

#### 文件 2（续）: 修改 `src/index.js`

添加快速计算 IPC（用 worker 但无进度上报，100ms 内完成则返回）：
```javascript
ipcMain.handle('calc-size-quick', async (event, { path }) => {
  // 使用专用 worker，100ms 内完成则返回结果
  // 内部 setTimeout 超时则 reject
});
```

### 决策 3：进度条支持不确定模式

**为什么**：用户要求学习 Windows，统计文件数阶段显示"移动条"动画。

#### 文件 4: 修改 `src/css/style.css`

新增不确定进度条动画：
```css
.status-center-task-progress-bar--indeterminate {
  width: 30% !important;
  background-color: hsl(var(--primary));
  animation: indeterminate-slide 1.5s ease-in-out infinite;
}

@keyframes indeterminate-slide {
  0% { transform: translateX(-100%); }
  50% { transform: translateX(150%); }
  100% { transform: translateX(350%); }
}
```

#### 文件 3（续）: 修改 `src/js/app.js` 的 `renderTasks`

修改 [app.js](file:///i:/Data-数据区/应用/自制/AmengExplorer/src/js/app.js#L2013-L2055) 的进度条渲染：
```javascript
const progressBarClass = task.status === 'completed' 
  ? 'status-center-task-progress-bar--complete' 
  : task.status === 'cancelled'
    ? 'status-center-task-progress-bar--cancelled'
    : task.indeterminate
      ? 'status-center-task-progress-bar--indeterminate'
      : '';

// 进度条 width 仅在确定模式下使用
const progressWidth = task.indeterminate ? '' : `style="width: ${task.progress}%"`;

div.innerHTML = `
  ...
  <div class="status-center-task-progress">
    <div class="status-center-task-progress-bar ${progressBarClass}" ${progressWidth}></div>
  </div>
  <div class="status-center-task-info">
    <span>${task.currentFile || (task.indeterminate ? '正在统计文件...' : '')}</span>
    <span>${infoText}</span>
  </div>
`;
```

### 决策 4：文件名省略号检查

**为什么**：用户建议。CSS 已有 `text-overflow: ellipsis`，但需要确认所有显示文件名的位置都生效。

#### 文件 4（续）: 修改 `src/css/style.css`

确保父容器有 `min-width: 0`（flex 项目省略号生效的前提）：
```css
.file-item {
  /* 确保有 min-width: 0 */
  min-width: 0;
}
.grid-item {
  min-width: 0;
  overflow: hidden;
}
```

并检查标签页标题（[app.js](file:///i:/Data-数据区/应用/自制/AmengExplorer/src/js/app.js#L348-L354) 的 `tab-label`）和信息面板名称是否也应用省略号。

## 假设与决策

1. **worker 数量**：最多 4 个并发 worker（避免过多线程开销），超出的任务排队。
2. **100ms 超时**：仅用于自动计算（进入文件夹时），手动点击"查看"按钮不设超时，完整计算。
3. **worker 复用**：worker 池中的 worker 完成任务后不销毁，等待下一个任务（减少创建开销）。
4. **取消机制**：通过 `postMessage({type:'cancel'})` 通知 worker，worker 在循环中检查标志位退出。
5. **文件名省略号**：CSS 已基本实现，仅补充 `min-width: 0` 确保生效。

## 验证步骤

1. **进入文件夹自动计算**：进入一个包含多个子文件夹的目录，观察子文件夹大小是否在 100ms 内自动显示，未完成的项目是否显示"查看"按钮。
2. **任务面板进度条**：
   - 对一个大文件夹点击"查看"，观察任务面板是否先显示"正在统计文件..."的不确定动画，然后切换为 `X/Y 文件` 的确定进度。
3. **多线程不阻塞 UI**：计算大文件夹大小时，UI 应保持流畅（可继续点击、滚动）。
4. **取消功能**：在计算过程中点击取消按钮，任务应立即停止。
5. **文件名省略号**：在窄列宽下查看长文件名，应显示省略号。
6. **worker 池并发**：同时对多个文件夹点击"查看"，应有 4 个并发计算，其余排队。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| worker 创建失败 | 回退到渲染进程异步递归（当前实现） |
| IPC 通信延迟 | 进度更新合并（每 200ms 一次），减少 IPC 次数 |
| 100ms 太短导致多数项目超时 | 超时后仍显示"查看"按钮，用户可手动触发 |
| worker 内存泄漏 | 任务完成后保留 worker 在池中，定期清理空闲 worker |

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs').promises;
const path = require('path');

let cancelled = false;
let paused = false;
let isQuick = false;

function checkPaused() {
  if (paused && !cancelled) {
    // 用一个自旋等待来暂停（不是最优方案但简单有效）
    // 实际场景中 worker 不需要高频率暂停
    return new Promise(resolve => {
      const check = () => {
        // 暂停中被取消，或者已恢复，都立即退出
        if (!paused || cancelled) resolve();
        else setTimeout(check, 100);
      };
      check();
    });
  }
}

if (parentPort) {
  parentPort.on('message', async (msg) => {
    if (msg.type === 'cancel') {
      cancelled = true;
      // 取消时同时解除暂停，避免卡在 checkPaused 循环里
      paused = false;
      return;
    }
    if (msg.type === 'pause') {
      paused = true;
      return;
    }
    if (msg.type === 'resume') {
      paused = false;
      return;
    }

    if (msg.type === 'calc') {
      isQuick = msg.quick === true;
      const { dirPath, taskId } = msg;
      try {
        await fs.access(dirPath);
      } catch {
        parentPort.postMessage({ type: 'done', taskId, status: 'error', size: 0, fileCount: 0 });
        return;
      }

      try {
        if (isQuick) {
          // 快速模式：跳过 countFiles，直接计算大小，不汇报进度
          // 这样只需一次遍历，速度接近手动计算
          const result = await calcSize(dirPath, taskId, 0, false);
          parentPort.postMessage({
            type: 'done',
            taskId,
            status: cancelled ? 'cancelled' : 'ok',
            size: result.size,
            fileCount: result.count
          });
          return;
        }

        // 完整模式：先统计文件数
        let totalFiles = 0;
        const counted = await countFiles(dirPath);
        totalFiles = counted;

        parentPort.postMessage({
          type: 'progress',
          taskId,
          indeterminate: false,
          totalFiles,
          completedFiles: 0,
          completedSize: 0,
          currentFile: '已发现 ' + totalFiles + ' 个文件，正在计算大小...'
        });

        // 再计算大小，上报进度
        const result = await calcSize(dirPath, taskId, totalFiles, true);
        parentPort.postMessage({
          type: 'done',
          taskId,
          status: cancelled ? 'cancelled' : 'ok',
          size: result.size,
          fileCount: result.count
        });
      } catch (err) {
        parentPort.postMessage({
          type: 'done',
          taskId,
          status: 'error',
          size: 0,
          fileCount: 0,
          error: err.message
        });
      }
    }
  });
}

// 阶段 1：快速统计文件数（不做 stat，只通过 readdir 的 withFileTypes 判断）
async function countFiles(currentPath) {
  if (cancelled) return 0;
  await checkPaused();
  if (cancelled) return 0;
  let files;
  try {
    files = await fs.readdir(currentPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const file of files) {
    if (cancelled) return count;
    await checkPaused();
    if (cancelled) return count;
    if (file.isDirectory()) {
      count += await countFiles(path.join(currentPath, file.name));
    } else if (file.isFile()) {
      count++;
    }
  }
  return count;
}

// 阶段 2：计算大小
async function calcSize(currentPath, taskId, totalFiles, reportProgress) {
  if (cancelled) return { size: 0, count: 0 };
  await checkPaused();
  if (cancelled) return { size: 0, count: 0 };

  let size = 0;
  let count = 0;
  let files;
  try {
    files = await fs.readdir(currentPath, { withFileTypes: true });
  } catch {
    return { size: 0, count: 0 };
  }

  let lastUpdateTime = Date.now();
  for (const file of files) {
    if (cancelled) return { size, count };
    await checkPaused();
    if (cancelled) return { size, count };

    const fullPath = path.join(currentPath, file.name);
    try {
      if (file.isDirectory()) {
        const sub = await calcSize(fullPath, taskId, totalFiles, false);
        size += sub.size;
        count += sub.count;
      } else if (file.isFile()) {
        const stat = await fs.stat(fullPath);
        size += stat.size;
        count++;
      }

      if (reportProgress) {
        const now = Date.now();
        if (now - lastUpdateTime > 200) {
          const progress = totalFiles > 0 ? Math.min(100, (count / totalFiles) * 100) : 0;
          parentPort.postMessage({
            type: 'progress',
            taskId,
            indeterminate: false,
            progress,
            totalFiles,
            completedFiles: count,
            completedSize: size,
            currentFile: path.basename(fullPath)
          });
          lastUpdateTime = now;
        }
      }
    } catch {
      continue;
    }
  }
  return { size, count };
}

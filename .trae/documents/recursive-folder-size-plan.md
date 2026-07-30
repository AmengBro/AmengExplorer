# 递归获取文件夹大小和文件数实现计划

## 需求分析

当前 `calculateDirectorySize` 方法依赖外部工具 `getfl.exe`，无法在任务面板显示实时进度。需要改为纯 Node.js 实现，通过递归遍历文件系统计算文件夹大小和文件数，并在遍历过程中更新进度。同时需要在属性菜单中显示文件夹内文件数。

## 当前实现分析

**文件**: `src/js/app.js`

**当前问题**:
- 第 523-599 行使用 `execFile` 调用外部工具 `getfl.exe`
- 无法显示实时进度，只能在完成后更新状态
- 依赖外部可执行文件，移植性差
- 属性菜单只显示大小，不显示文件数

**任务面板**:
- 第 1925-2030 行已有完整的任务管理系统
- 支持 `addTask`、`updateTask`、`completeTask`、`cancelTask`
- 任务对象包含 `progress`、`currentFile`、`totalFiles`、`completedFiles`、`totalSize`、`completedSize` 等字段

**属性菜单**:
- 第 2040-2100 行显示文件属性
- 文件夹大小显示为"查看"按钮，点击后调用 `calculateDirectorySize`
- 需要添加文件数字段

## 实现方案

### 1. 重写 `calculateDirectorySize` 方法

将外部工具调用改为纯 Node.js 递归遍历：

- 使用 `fs.promises.readdir` 异步读取目录
- 使用 `fs.promises.stat` 获取文件/目录信息
- 递归处理子目录
- 在遍历过程中更新任务进度
- 支持取消操作（检查 `task.cancelled`）
- 同时统计文件数

### 2. 进度计算策略

- **预估阶段**: 先快速扫描统计总文件数（可选，会增加开销）
- **计算阶段**: 遍历每个文件，累加大小和计数，更新进度
- **进度更新频率**: 每处理 100 个文件或每 500ms 更新一次，避免过度渲染

### 3. 属性菜单更新

- 在属性菜单中添加"文件数"字段
- 文件夹显示"查看"按钮，点击后计算大小和文件数
- 计算完成后同时显示大小和文件数

## 修改步骤

### 步骤 1: 修改 `calculateDirectorySize` 方法

**文件**: `src/js/app.js`

**修改内容**:
- 删除 `execFile` 调用和 `getfl.exe` 相关代码
- 使用 `fs.promises` 递归遍历
- 添加进度更新逻辑
- 添加取消支持
- 返回值增加 `fileCount` 字段

### 步骤 2: 更新属性菜单显示

**文件**: `src/js/app.js`

**修改内容**:
- 在属性菜单中添加"文件数"字段
- 修改大小按钮的点击事件处理，显示文件数
- 更新 HTML 模板

### 步骤 3: 确保任务取消生效

**文件**: `src/js/app.js`

**修改内容**:
- 在递归过程中检查 `task.cancelled` 状态
- 如果任务被取消，立即停止遍历并返回

### 步骤 4: 处理异常情况

**文件**: `src/js/app.js`

**修改内容**:
- 处理权限不足错误（跳过无法访问的文件/目录）
- 处理符号链接（跳过或跟随，根据配置）
- 处理文件被占用错误

## 代码示例

```javascript
async calculateDirectorySize(dirPath) {
  const isVirtual = await this.vfs.isVirtualPath(dirPath);
  if (isVirtual) {
    return { status: 'virtual', size: 0, fileCount: 0 };
  }
  
  const winPath = await this.vfs.toWindows(dirPath);
  if (!winPath) {
    return { status: 'error', size: 0, fileCount: 0 };
  }
  
  const fs = require('fs').promises;
  const path = require('path');
  
  try {
    await fs.access(winPath);
  } catch {
    return { status: 'error', size: 0, fileCount: 0 };
  }
  
  const task = this.addTask('size', '计算文件夹大小');
  const dirName = dirPath.split('/').pop();
  
  let totalSize = 0;
  let totalFiles = 0;
  
  const traverse = async (currentPath) => {
    if (task.cancelled) return { size: 0, count: 0 };
    
    let size = 0;
    let count = 0;
    let files = [];
    
    try {
      files = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (err) {
      return { size: 0, count: 0 };
    }
    
    for (const file of files) {
      if (task.cancelled) return { size, count };
      
      const fullPath = path.join(currentPath, file.name);
      
      try {
        if (file.isDirectory()) {
          const subResult = await traverse(fullPath);
          size += subResult.size;
          count += subResult.count;
        } else {
          const stat = await fs.stat(fullPath);
          size += stat.size;
          count++;
        }
        
        this.updateTask(task.id, {
          currentFile: path.relative(winPath, fullPath),
          completedFiles: totalFiles + count,
          completedSize: totalSize + size
        });
        
      } catch (err) {
        continue;
      }
    }
    
    return { size, count };
  };
  
  try {
    const result = await traverse(winPath);
    this.completeTask(task.id);
    return { status: 'ok', size: result.size, fileCount: result.count };
  } catch (err) {
    this.updateTask(task.id, {
      status: 'error',
      currentFile: '计算失败'
    });
    return { status: 'error', size: 0, fileCount: 0 };
  }
}
```

## 属性菜单更新示例

```javascript
// 在 updateInfoPanel 方法中添加文件数字段
const sizeBtnId = `size-btn-${Date.now()}`;
const fileCountBtnId = `count-btn-${Date.now()}`;

this.infoProperties.innerHTML = `
  <div class="info-row">
    <span class="info-label">名称</span>
    <span class="info-value">${name}</span>
  </div>
  <div class="info-row">
    <span class="info-label">类型</span>
    <span class="info-value">${type}</span>
  </div>
  <div class="info-row">
    <span class="info-label">大小</span>
    <span class="info-value">${size}</span>
  </div>
  <div class="info-row">
    <span class="info-label">文件数</span>
    <span class="info-value">${fileCount}</span>
  </div>
  ...
`;
```

## 注意事项

1. **性能**: 对于大型目录（数百万文件），递归遍历可能较慢，但可以通过限制更新频率优化
2. **内存**: 使用异步递归不会导致调用栈溢出，但需注意并发限制
3. **权限**: 需要处理权限不足的情况，避免崩溃
4. **符号链接**: 默认跳过符号链接，避免无限循环
5. **一致性**: 文件数和大小使用同一遍历流程，确保数据一致性

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 大目录遍历慢 | 用户体验 | 添加进度显示，让用户知道正在处理 |
| 权限错误 | 计算不准确 | 跳过无法访问的文件，记录错误 |
| 任务取消不及时 | 资源浪费 | 在每个文件处理前检查取消状态 |
| 数据不一致 | 显示错误 | 文件数和大小使用同一遍历流程 |

## 测试方案

1. **正常路径**: 选择一个包含多层子目录的文件夹测试
2. **虚拟目录**: 测试虚拟路径是否返回正确状态
3. **取消功能**: 在计算过程中点击取消按钮
4. **权限不足**: 测试系统目录或受限目录
5. **文件数统计**: 验证文件数统计是否准确
6. **属性菜单显示**: 验证文件数字段是否正确显示

# 分栏视图功能实现计划

## 一、需求分析

用户要求添加分栏视图功能，类似 Windows 文件资源管理器的"详细信息"视图，具有以下特点：
- 多列显示（名称、类型、大小、修改时间）
- 列宽可拖拽调整
- 点击列标题可排序
- 与现有列表视图/网格视图切换

## 二、现有代码分析

### 2.1 当前视图系统
- **列表视图** (`list`): 使用 CSS Grid 布局，固定列宽
- **网格视图** (`grid`): 使用 CSS Grid 自动填充布局

### 2.2 关键文件
| 文件 | 职责 |
|------|------|
| `src/index.html` | 视图容器 HTML 结构 |
| `src/css/style.css` | 视图样式 |
| `src/js/app.js` | 视图切换逻辑、渲染逻辑 |
| `src/js/icons.js` | 图标加载（通过 `config/icons.json` 配置） |
| `config/icons.json` | 图标名称映射配置 |

### 2.3 已完成的工作（上一轮）
- ✅ 分栏视图 HTML 结构（`file-column-view`）
- ✅ 分栏视图 CSS 样式
- ✅ `switchView('column')` 方法支持
- ✅ `renderFileList` 方法更新（渲染分栏项）
- ✅ `createColumnItem` 方法实现
- ✅ 工具栏分栏视图按钮

### 2.4 待完成的工作
- ⬜ `config/icons.json` 添加 `alignHorizontalCenter` 图标配置
- ⬜ 列宽拖拽调整功能
- ⬜ 列排序功能

## 三、实现计划

### 3.1 图标配置（低优先级）

**文件**: `config/icons.json`

添加分栏视图按钮所需的图标映射：
```json
"alignHorizontalCenter": "align_horizontal_center"
```

### 3.2 列宽拖拽调整（中优先级）

**文件**: `src/js/app.js`

实现步骤：
1. 在 `initFileBrowser` 或专门的初始化方法中绑定列宽拖拽事件
2. 监听 `column-resizer` 的 `mousedown` 事件
3. 拖拽过程中更新列宽（同步更新 header 和所有 item）
4. 松开鼠标结束拖拽

### 3.3 列排序功能（高优先级）

**文件**: `src/js/app.js`

实现步骤：
1. 添加 `sortColumn` 和 `sortDirection` 状态变量
2. 监听 `column-header-item` 的 `click` 事件
3. 实现排序逻辑（支持名称、类型、大小、日期）
4. 更新排序指示（箭头图标）

### 3.4 列宽同步（高优先级）

**文件**: `src/js/app.js`

实现步骤：
1. 在 `createColumnItem` 中动态获取当前列宽
2. 拖拽调整列宽时，实时更新所有已渲染的 `column-item-cell`
3. 列宽改变时触发 `renderFileList` 重新渲染

## 四、技术方案

### 4.1 列宽调整实现

```javascript
initColumnResizers() {
  const resizers = document.querySelectorAll('.column-resizer');
  resizers.forEach(resizer => {
    resizer.addEventListener('mousedown', (e) => {
      // 记录起始位置和当前列宽
      const headerItem = resizer.parentElement;
      const startX = e.clientX;
      const startWidth = parseInt(headerItem.style.width) || 100;
      
      const onMouseMove = (e) => {
        // 计算新宽度
        const newWidth = Math.max(50, startWidth + (e.clientX - startX));
        headerItem.style.width = newWidth + 'px';
        
        // 更新所有列项的对应列宽
        const columnName = headerItem.dataset.column;
        const items = document.querySelectorAll('.column-item');
        items.forEach(item => {
          const cell = item.querySelector(`.column-item-cell.${columnName}-cell`);
          if (cell) cell.style.width = newWidth + 'px';
        });
      };
      
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });
}
```

### 4.2 列排序实现

```javascript
// 状态变量
this.sortColumn = 'name';
this.sortDirection = 'asc';

// 排序方法
sortByColumn(columnName) {
  if (this.sortColumn === columnName) {
    this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    this.sortColumn = columnName;
    this.sortDirection = 'asc';
  }
  // 重新加载目录并排序
  this.loadDirectory(this.currentPath);
}

// 在 renderFileList 中应用排序
const sortedFiles = files.sort((a, b) => {
  let result = 0;
  switch (this.sortColumn) {
    case 'name':
      result = a.name.localeCompare(b.name, 'zh-CN');
      break;
    case 'type':
      result = this.getFileType(a.name).localeCompare(this.getFileType(b.name), 'zh-CN');
      break;
    case 'size':
      result = a.size - b.size;
      break;
    case 'date':
      result = new Date(a.mtime) - new Date(b.mtime);
      break;
  }
  return this.sortDirection === 'desc' ? -result : result;
});
```

## 五、风险与注意事项

### 5.1 性能风险
- 列宽调整时遍历所有列项可能导致卡顿（大量文件时）
- **缓解方案**: 使用 requestAnimationFrame 批量更新

### 5.2 状态同步风险
- 排序状态在切换视图后需要保持
- **缓解方案**: 将排序状态存储在 tab 状态中

### 5.3 图标兼容性风险
- `alignHorizontalCenter` 图标可能不存在于 Fluent 图标库
- **缓解方案**: 提供 fallback 图标

## 六、验证计划

### 6.1 功能验证
1. ✅ 点击工具栏按钮切换到分栏视图
2. ✅ 分栏视图正确显示文件信息
3. ✅ 拖拽列分隔线调整列宽
4. ✅ 点击列标题排序
5. ✅ 切换视图后列宽和排序状态保持

### 6.2 性能验证
1. ✅ 1000+ 文件目录加载时间 < 2s
2. ✅ 列宽调整响应流畅

## 七、完成标准

- [ ] `config/icons.json` 添加 `alignHorizontalCenter` 图标配置
- [ ] `src/js/app.js` 添加列宽拖拽调整功能
- [ ] `src/js/app.js` 添加列排序功能
- [ ] 分栏视图按钮在工具栏显示
- [ ] 列宽调整功能正常工作
- [ ] 列排序功能正常工作

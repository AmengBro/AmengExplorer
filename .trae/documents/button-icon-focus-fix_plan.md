# 按钮图标焦点丢失修复方案

## 问题描述
部分操作栏按钮控件在鼠标指向中心 icon 时失去焦点，只能通过点击按钮边缘实现操作。

## 根本原因
SVG 图标元素捕获了鼠标事件（hover/click），导致父级按钮无法接收这些事件。当鼠标位于 SVG 上方时，按钮的 `:hover` 状态丢失，点击事件也无法触发。

## 解决方案
为所有可交互元素内的 SVG 图标添加 `pointer-events: none`，使鼠标事件穿透 SVG 直接传递到父级按钮元素。

## 修改文件

### `src/css/style.css`

#### 1. `.icon-wrapper svg` — 通用图标包装器内的 SVG
```css
.icon-wrapper svg {
  pointer-events: none;
}
```

#### 2. `.window-toolbar-button svg` — 工具栏按钮内的 SVG
```css
.window-toolbar-button svg {
  pointer-events: none;
}
```

#### 3. `.pane-btn svg` — 面板按钮内的 SVG
```css
.pane-btn svg {
  pointer-events: none;
}
```

#### 4. `.nav-sidebar-item svg` — 侧边栏导航项内的 SVG
```css
.nav-sidebar-item svg {
  pointer-events: none;
}
```

#### 5. `.context-menu-item svg` — 右键菜单项内的 SVG
```css
.context-menu-item svg {
  pointer-events: none;
}
```

#### 6. `.status-center-*` 系列按钮内的 SVG
为任务面板相关的按钮添加 `pointer-events: none`：
```css
.status-center-task-cancel svg,
.status-center-task-pause svg,
.status-center-task-resume svg,
.status-center-task-remove svg,
.status-center-panel-clear svg {
  pointer-events: none;
}
```

## 更优方案（推荐）
使用更通用的选择器一次性解决所有可交互元素内的 SVG 问题：

```css
/* 所有可交互元素内的 SVG 不接收鼠标事件 */
button svg,
.nav-sidebar-item svg,
.context-menu-item svg,
.file-item svg,
.grid-item svg,
.column-item svg {
  pointer-events: none;
}
```

## 验证
1. 启动应用 `npm start`
2. 测试工具栏按钮：将鼠标移到图标中心，确认 hover 状态保持
3. 点击图标中心，确认按钮正常响应
4. 测试侧边栏导航项
5. 测试右键菜单项
6. 测试任务面板按钮

## 风险评估
- **风险等级**：低
- **影响范围**：仅修改 CSS，不影响功能逻辑
- **注意事项**：`pointer-events: none` 会阻止 SVG 接收所有鼠标事件，包括 hover。但由于我们不直接对 SVG 绑定事件，这是安全的

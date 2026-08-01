# 启动台（Launchpad）功能设计文档
//plan mode 
## 概述

将顶栏左侧的搜索按钮替换为**启动台（Launchpad）**，集成 portable Everything 实现快速文件搜索，同时作为"运行"对话框使用，提供统一的快速启动和搜索入口。

---

## 功能特性

### 1. 快速文件搜索（Everything 集成）

#### 1.1 环境准备
- 内嵌 **portable Everything** 到项目中（`vendor/Everything/Everything64.exe`）
- 通过 IPC 调用 Everything SDK 查询文件
- 若 Everything 未启动，自动后台拉起

#### 1.2 搜索模式
| 触发 | 说明 |
|------|------|
| `Ctrl+P` 或点击启动台按钮 | 打开启动台弹窗 |
| 直接输入关键词 | 搜索 Everything 索引 |
| 支持搜索语法 | `folder:`, `file:`, `ext:`, `size>100mb`, `date:today` |

#### 1.3 结果展示
- 模糊搜索：输入 `doc` 显示所有 `.doc`/`.docx` 文件
- 实时过滤：输入过程中即时更新结果列表
- 结果排序：按默认 Everything 排序（相关度/修改时间）
- 结果信息：文件名、路径、大小、修改时间

#### 1.4 交互操作
| 操作 | 快捷键 | 说明 |
|------|--------|------|
| 打开文件 | Enter | 使用默认程序打开 |
| 打开所在位置 | Ctrl+Enter | 在文件管理器中定位 |
| 复制路径 | Ctrl+C（选中时） | 复制文件完整路径 |
| 上/下选择 | ↑/↓ | 切换选中项 |

---

### 2. 运行对话框

#### 2.1 命令执行
启动台内置"运行"功能，可直接执行：

| 类型 | 示例 | 说明 |
|------|------|------|
| 应用程序 | `notepad`, `calc`, `chrome` | 启动系统/第三方应用 |
| 内置命令 | `cmd`, `powershell`, `explorer` | 打开系统工具 |
| URL | `https://github.com` | 使用默认浏览器打开 |
| 路径 | `D:\Projects`, `/home/user` | 在 AmengExplorer 中打开 |

#### 2.2 触发方式
- 启动台输入框为空时，输入的内容将作为命令执行
- 快捷标记：以 `>` 开头时强制作为命令执行
  - `>notepad` → 打开记事本
  - `>calc` → 打开计算器

---

### 3. 命令面板增强

#### 3.1 命令搜索
保留原有命令面板功能，通过 Everything 集成优化搜索体验：

| 命令 | 说明 |
|------|------|
| `/clear` | 清空启动台 |
| `/close` | 关闭启动台 |
| `/run <cmd>` | 以运行模式执行命令 |
| `/search <query>` | 强制以搜索模式搜索 |

#### 3.2 最近使用
- 记录最近 20 条搜索记录
- 记录最近 10 条命令/运行记录
- 支持快速重新执行

---

## UI 设计

### 3.1 启动台弹窗

```
┌─────────────────────────────────────────────────┐
│  🔍 启动台                    [运行] [搜索]  |
├─────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐   │
│  │ 输入文件名、命令或路径...                │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  🏠 最近搜索                                    │
│  ├─ report_2024.xlsx        45 KB  2024-01-15 │
│  ├─ project.docx            12 KB  2024-01-14 │
│  └─ config.json             3 KB   2024-01-13 │
│                                                 │
│  ⚡ 快速运行                                    │
│  ├─ notepad.exe              📝 记事本         │
│  ├─ calc.exe                 🧮 计算器         │
│  └─ chrome.exe               🌐 Chrome        │
└─────────────────────────────────────────────────┘
```

### 3.2 搜索结果

```
┌─────────────────────────────────────────────────┐
│  🔍 doc                                          │
├─────────────────────────────────────────────────┤
│  📄 report_2024.docx                            │
│     D:\Reports\2024\  │  12 KB  │  2024-01-15   │
│  📄 meeting_notes.docx                          │
│     D:\Work\Docs\    │  8 KB   │  2024-01-14   │
│  📁 documents                                   │
│     D:\Backup\       │  Folder │  2024-01-10   │
│  ...                                            │
├─────────────────────────────────────────────────┤
│  [在文件管理器中定位]  [打开]  [复制路径]         │
└─────────────────────────────────────────────────┘
```

### 3.3 按钮样式
顶栏搜索按钮 → 启动台按钮：
- 图标：`data-icon="search"` → `data-icon="play"`
- 或保留 `search` 图标但改变标题：`title="启动台 (Ctrl+P)"`

---

## 技术架构

### 4.1 Everything 集成

```
┌─────────────────────────────────────────────┐
│              AmengExplorer 启动台            │
├─────────────────────────────────────────────┤
│  渲染进程 (app.js)                           │
│  ├── 搜索请求 → IPC invoke('everything-search')│
│  ├── 命令执行 → shell.openPath()              │
│  └── 结果展示/交互                            │
└──────────────────┬──────────────────────────┘
                   │ IPC
┌──────────────────▼──────────────────────────┐
│  主进程 (index.js)                            │
│  ├── everything-search:                       │
│  │   └── sp Everything64.exe -s <query>      │
│  ├── everything-close:                       │
│  │   └── sp Everything64.exe -c              │
│  └── everything-start:                       │
│      └── spawn Everything64.exe -minimized   │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│  Everything64.exe (portable)                 │
│  ├── 文件索引数据库                           │
│  └── 搜索/执行 API                            │
└──────────────────────────────────────────────┘
```

### 4.2 关键依赖
| 组件 | 版本 | 用途 |
|------|------|------|
| Everything | 1.4.x (portable) | 快速文件搜索引擎 |
| Electron shell API | - | 打开文件/路径 |
| Node.js child_process | - | 与 Everything 通信 |

### 4.3 文件结构
```
AmengExplorer/
├── vendor/
│   └── Everything/
│       ├── Everything64.exe      # 可执行文件
│       ├── Everything.ini        # 配置（自动生成）
│       └── es.exe                # 命令行工具
├── src/
│   ├── js/
│   │   ├── app.js                # 启动台 UI 逻辑
│   │   └── launchpad.js          # Everything 客户端封装
│   └── index.html                # 启动台弹窗 HTML
└── config/
    └── launchpad.json            # 启动台配置
```

---

## 配置说明

### launchpad.json

```json
{
  "everything": {
    "path": "vendor/Everything/Everything64.exe",
    "autoStart": true,
    "timeoutMs": 5000
  },
  "search": {
    "maxResults": 50,
    "includeFolders": true,
    "sortBy": "relevance",
    "liveUpdate": true
  },
  "run": {
    "safePaths": ["C:\\Windows", "C:\\Program Files"],
    "allowUrls": true,
    "allowCustomPaths": true
  },
  "history": {
    "searchLimit": 20,
    "runLimit": 10,
    "storageKey": "ameng_launchpad_history"
  }
}
```

---

## 实现路线图

### Phase 1：基础框架（MVP）
- [ ] 将搜索按钮改为启动台按钮（保留 `search` 图标）
- [ ] 实现启动台弹窗 UI（HTML/CSS）
- [ ] 基础输入框 + 结果列表

### Phase 2：Everything 集成
- [ ] 集成 portable Everything
- [ ] 实现 Everything 搜索 IPC 通信
- [ ] 结果实时展示与过滤

### Phase 3：运行功能
- [ ] 命令执行（应用/URL/路径）
- [ ] 命令模式标记（`>` 前缀）
- [ ] 最近使用记录

### Phase 4：增强体验
- [ ] 搜索语法支持（`folder:`, `ext:` 等）
- [ ] 打开/定位/复制路径快捷键
- [ ] 模糊搜索与排序优化
- [ ] 全局快捷键（即使窗口未聚焦）

### Phase 5：高级特性
- [ ] 插件扩展（自定义搜索源）
- [ ] 云同步搜索记录
- [ ] AI 建议（基于使用习惯）

---

## 注意事项

1. **Everything 首次索引**：首次启动 Everything 需要扫描磁盘，可能需要数分钟
2. **索引更新**：Everything 自动监听文件系统变化，搜索结果实时更新
3. **中文支持**：Everything 默认支持中文文件名搜索
4. **权限**：搜索系统目录（如 `C:\Windows`）可能需要管理员权限
5. **便携性**：portable Everything 无需安装，可直接随应用分发

---

## 参考链接

- [Everything 官方网站](https://www.voidtools.com/)
- [Everything 命令行选项](https://www.voidtools.com/support/everything/command_line_options/)
- [Electron shell.openPath()](https://www.electronjs.org/docs/api/shell#shellopenpathpath)

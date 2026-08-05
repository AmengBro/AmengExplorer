# AmengExplorer Agent 上下文

## 项目概述

AmengExplorer 是一个 Electron 文件管理器应用，基于 Node.js + 原生 HTML/CSS/JS 构建。在 Windows 上提供 Linux 风格的文件管理体验。

## 技术栈

- **框架**: Electron
- **主进程**: Node.js (CommonJS modules)
- **渲染进程**: 原生 HTML/CSS/JS，无前端框架
- **启动配置**: `package.json` + `config.ini`

## 关键文件

| 文件 | 作用 |
|------|------|
| `src/index.js` | 主进程入口，IPC 处理、本地文件搜索索引、窗口管理 |
| `src/js/app.js` | 渲染进程核心，UI 交互、文件操作、启动台搜索、设置面板 |
| `src/js/search-index-worker.js` | Worker 线程，后台构建文件索引 |
| `src/js/virtual-fs.js` | 虚拟文件系统层，回收站路径管理 |
| `src/js/amsys-client.js` | amsys.exe 管道通信客户端 |
| `src/js/icons.js` | 图标渲染引擎 |
| `src/css/style.css` | 全部样式 |
| `src/index.html` | 主 HTML 结构 |
| `config.ini` | amsys 系统配置（虚拟根、挂载等；应用不读写） |
| `config/icons.json` | 图标配置 |
| `config/settings.json` | 设置存储（主题、视图、搜索等） |
| `config/launchpad-history.json` | 启动台历史记录（搜索/运行历史） |

## IPC 事件

### 本地索引搜索
| 事件 | 方向 | 作用 |
|------|------|------|
| `launchpad-search` | renderer → main | 执行搜索 |
| `launchpad-rebuild-index` | renderer → main | 手动重建索引 |
| `launchpad-index-progress` | main → renderer | 索引构建进度 |
| `launchpad-index-ready` | main → renderer | 索引构建完成 |

另：`amsys-get-path`（同步）返回 amsys.exe 路径（settings.json 的 `amsysPath` 可配置）；`pwsh-get-path`（同步）返回 PowerShell 路径（优先程序目录内置 `pwsh7/pwsh.exe`，兼容 Windows PE）。

### 配置读写
| 事件 | 方向 | 作用 |
|------|------|------|
| `config-read-history` | renderer → main | 读取启动台历史记录 |
| `config-write-history` | renderer → main | 写入启动台历史记录 |
| `config-read-settings` | renderer → main | 读取应用设置 |
| `config-write-settings` | renderer → main | 写入应用设置 |
| `config-read-icons` | renderer → main | 读取图标配置 |
| `config-write-icons` | renderer → main | 写入图标配置 |
| `config-sync-read-icons` | renderer → main | 同步读取图标配置（用于模块加载） |
| `config-sync-write-icons` | renderer → main | 同步写入图标配置 |
| `config-get-path` | renderer → main | 获取配置目录路径 |
| `config-open-dir` | renderer → main | 在资源管理器中打开配置目录 |

## 内置回收站

### 路径
- **位置**: `<root>\root\Trash`（root 用户）/ `<root>\home\<其他用户>\Trash`（虚拟根下，当前用户来自 `root/etc/users.toml` 的 `[global] current_user`，主目录约定与 Linux 一致：root 为 `/root`，其他用户为 `/home/<用户>`）
- **自动创建**: 首次使用时自动创建目录

### 行为
- **Delete 键 / 右键删除**: 普通目录中移动到回收站
- **回收站内**: Delete 键执行永久删除
- **右键菜单**: 在回收站目录中显示"恢复"和"永久删除"选项
- **冲突处理**: 同名文件自动添加 ` (1)`, ` (2)` 后缀

## 设置面板

### 标签页
1. **通用**: 启动页面、默认视图、语言、删除确认、显示隐藏文件、双击打开
2. **搜索**: 自动索引、搜索深度、历史记录
3. **外观**: 主题模式、强调色选择、字体大小
4. **关于**: 应用信息、配置文件位置、检查更新、恢复默认设置

## 启动台交互

### 模式切换
- **搜索模式**: 输入文件名搜索，Enter 打开
- **运行模式**: 输入命令执行，Enter 运行
- **切换方式**: 
  1. 点击输入框右侧的"搜索/运行"标签
  2. 输入 `>` 前缀自动切换到运行模式

### 快捷键
| 快捷键 | 作用 |
|--------|------|
| Ctrl+P | 打开启动台 |
| Enter | 搜索模式: 搜索/打开结果; 运行模式: 执行命令 |
| Ctrl+Enter | 定位选中文件到资源管理器 |
| Esc | 关闭启动台 |

### 历史记录
- 最近搜索: `./config/launchpad-history.json` 中 `searches` 字段 (最多 20 条)
- 最近运行: `./config/launchpad-history.json` 中 `runs` 字段 (最多 10 条)
- 支持手动清空（标题栏垃圾桶按钮）
- 数据存储在应用目录下，支持便携版
- 历史仅在用户主动提交（Enter/点击搜索按钮/打开文件）时记录，防抖搜索不记录

## 多选支持
- **Ctrl+Click**: 多选/取消选择文件
- **Shift+Click**: 暂未实现范围选择
- **Ctrl+A**: 全选当前目录
- 选中文件有 `.selected` CSS 类视觉反馈

## 已修复的问题

1. **Everything 依赖已彻底移除**: 搜索完全基于本地文件索引 + PATH 快速扫描，不再依赖 Everything
2. **搜索卡死**: 文件索引移到 Worker 线程，不阻塞主线程
3. **输入框与按钮重叠**: 移除独立搜索按钮，改用模式指示器
4. **无搜索结果**: 实现本地文件索引 + PATH 快速扫描兜底
5. **recentSearches/recentRuns 过长**: 改为并排布局 + 最大高度 + 手动清空
6. **搜索历史冗余**: 防抖搜索不再记录历史，仅在用户主动提交时保存
7. **回收站实现**: 从系统回收站改为程序内置虚拟根回收站（root 为 `<root>\root\Trash`，其他用户为 `<root>\home\<用户>\Trash`），支持恢复和永久删除
8. **多选视觉反馈**: Ctrl+Click 多选时正确添加 `.selected` 类
9. **wmic 依赖移除**: 磁盘枚举/容量改用程序目录内置便携版 pwsh7（`Get-CimInstance`），无 pwsh 时降级为盘符扫描，兼容 Windows PE
10. **跨卷移动修复**: 删除到回收站/恢复/剪切粘贴跨盘符（EXDEV）时自动复制+删除兜底

## 开发约定

- 代码使用 CommonJS (`require`/`module.exports`)
- 不要引入 npm 包（Electron 原生环境足够）
- 颜色使用 HSL CSS 变量: `hsl(var(--primary))`, `hsl(var(--muted-foreground))` 等
- 图标使用 `data-icon` 属性 + 预加载 SVG sprite
- 文件操作通过 IPC 主进程处理，渲染进程不直接操作文件系统
- `virtual-fs.js` 顶部已导入 `const path = require('path')`，不要在函数内重复 require

## 配置路径策略（便携版支持）

### 基础路径
- **开发模式**: `app.getAppPath()` → 项目根目录
- **打包模式**: `path.dirname(process.execPath)` → exe 所在目录

### 配置文件存储
所有用户数据存储在基础路径下的 `config/` 目录：
- `config.ini`: amsys 系统配置（应用不读写）
- `config/icons.json`: 图标配置
- `config/settings.json`: 应用设置
- `config/launchpad-history.json`: 启动台历史记录

### 重要规则
- 渲染进程不直接读写配置文件，必须通过 IPC 主进程处理
- 同步 IPC (`sendSync`) 仅用于模块加载时需要同步初始化的场景（如 `icons.js`）
- 异步 IPC (`invoke`) 用于常规读写操作
- 配置文件读写通过 `getConfigPath()` 函数统一管理路径

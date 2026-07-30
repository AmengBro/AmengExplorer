# AmengExplorer

> 在 Windows 上体验 Linux 风格的文件管理 —— 通过虚拟文件系统层，让 `/home`、`/media/c`、`/dev` 等 Unix 路径在 Windows 上原生可用。

## 目录

- [功能特性](#功能特性)
- [架构概览](#架构概览)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [快捷键](#快捷键)
- [项目结构](#项目结构)
- [技术栈](#技术栈)
- [相关文档](#相关文档)

---

## 功能特性

### 文件浏览
- **三种视图模式**：列表视图、网格视图、分栏视图，按 `Ctrl+Shift+1/2/3` 切换
- **双面板模式**：并排浏览两个目录，支持同步导航
- **多标签页**：随时新建、切换、关闭标签页，每个标签独立维护浏览历史
- **地址栏**：支持 Unix 路径输入，如 `/home/user`、`/media/c/Windows`

### 文件操作
- **复制/剪切/粘贴**：支持快捷键 `Ctrl+C/X/V`，剪切后文件显示淡化效果作为视觉反馈
- **右键菜单**：文件项和空白处均支持右键操作，空白处菜单等价于对当前目录的操作
- **批量操作**：支持多选、全选（`Ctrl+A`），批量执行复制/移动/删除

### 虚拟文件系统
- **Unix 风格路径**：`/`、`/home`、`/usr`、`/tmp`、`/etc` 等标准目录
- **盘符挂载**：Windows 盘符自动挂载到 `/media/c`、`/media/d` 等路径
- **虚拟设备**：`/dev/sda`、`/dev/null`、`/dev/zero` 等虚拟设备
- **`.floder` 重定向**：类似符号链接的目录映射机制
- **安全边界**：`..` 无法逃逸出虚拟根目录

### 辅助功能
- **文件夹大小计算**：后台 Worker 计算文件夹大小，支持暂停/取消/恢复
- **快速预览**：悬停或选中文件时显示属性信息
- **命令面板**：`Ctrl+P` 快速执行命令
- **深色主题**：默认深色界面

---

## 架构概览

```
┌─────────────────────────────────────────────────────┐
│              Electron UI (index.html / app.js)      │
└──────────────────┬──────────────────────────────────┘
                   │  stdin/stdout JSON 管道
┌──────────────────▼──────────────────────────────────┐
│            VirtualFileSystem (virtual-fs.js)         │
└──────────────────┬──────────────────────────────────┘
                   │  child_process.spawn
┌──────────────────▼──────────────────────────────────┐
│              amsys.exe (C++ 子进程)                  │
│          PathManager 路径翻译引擎                    │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│            Win32 API (实际文件系统)                   │
└─────────────────────────────────────────────────────┘
```

**通信机制**：Electron 主进程通过管道向 `amsys.exe` 发送 JSON 命令并接收响应，实现渲染进程与底层文件系统的解耦。

---

## 快速开始

### 环境要求

- **Node.js** >= 18
- **npm** >= 9
- **操作系统**：Windows 10/11（64 位）

### 安装与运行

```bash
# 1. 安装依赖
npm install

# 2. 启动开发模式
npm start

# 3. 打包发布
npm run make
```

### 首次配置

首次运行前，确认 `config.ini` 中的根目录路径正确：

```ini
[system]
root = I:\Data-数据区\应用\自制\AmengExplorer\root
```

该目录将作为虚拟文件系统的 `/` 根目录。

---

## 配置说明

### config.ini — 文件系统配置

```ini
[system]
root = D:\amsys_root              ; 虚拟根目录（必需）

[mounts]
home =                             ; 留空 = <root>\home
usr  =                             ; 可指定绝对路径
tmp  = D:\temp_stuff

[floder]
enabled = true                     ; 启用 .floder 重定向

[security]
block_dotdot = true                ; 禁止 .. 路径逃逸
```

### icons.json — 图标配置

位于 `config/icons.json`，支持 [Fluent UI Icons](https://fluenticons.io/) 图标名：

```json
{
  "list": "list",
  "grid": "grid",
  "alignHorizontalCenter": "dual_screen_header",
  "refresh": "arrow_repeat_all"
}
```

修改图标名即可一键更换界面图标，无需改动代码。

### /etc/fstab — 盘符挂载

位于虚拟根目录的 `etc/fstab`：

```
C:\  /media/c
D:\  /media/d
```

格式：`<Windows 路径>  <Unix 挂载点>`。支持 `#` 开头的注释行。

---

## 快捷键

### 通用

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+P` | 打开命令面板 |
| `Ctrl+T` | 新建标签页 |
| `Ctrl+W` | 关闭当前标签页 |

### 文件操作

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+C` | 复制选中项 |
| `Ctrl+X` | 剪切选中项 |
| `Ctrl+V` | 粘贴到当前目录 |
| `Ctrl+A` | 全选当前目录 |
| `Delete` | 删除选中项 |
| `F2` | 重命名选中项 |
| `Enter` | 打开选中项 |

### 视图切换

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+1` | 列表视图 |
| `Ctrl+Shift+2` | 网格视图 |
| `Ctrl+Shift+3` | 分栏视图 |

### 导航

| 快捷键 | 功能 |
|--------|------|
| `Alt+←` | 后退 |
| `Alt+→` | 前进 |
| `Alt+↑` | 返回上级目录 |
| `F5` | 刷新当前目录 |

### 其他

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+N` | 新建文件 |
| `Ctrl+Shift+N` | 新建文件夹 |
| `Ctrl+I` | 切换属性面板 |
| `Alt+Enter` | 查看选中项属性 |

---

## 项目结构

```
AmengExplorer/
├── config/
│   └── icons.json            # 图标映射配置
├── root/
│   └── etc/
│       └── fstab             # 盘符挂载配置
├── src/
│   ├── css/
│   │   └── style.css         # 全局样式
│   ├── js/
│   │   ├── app.js            # 主应用逻辑
│   │   ├── virtual-fs.js     # 虚拟文件系统封装
│   │   ├── amsys-client.js   # amsys.exe 管道通信客户端
│   │   ├── icons.js          # 图标渲染引擎
│   │   └── size-worker.js    # 文件夹大小计算 Worker
│   ├── index.html            # 主页面
│   └── index.js              # Electron 主进程入口
├── config.ini                # 根目录与挂载配置
├── amsys.exe                 # 虚拟文件系统引擎（C++）
├── forge.config.js           # Electron Forge 配置
├── package.json
└── README.md
```

---

## 技术栈

| 类别 | 技术 | 说明 |
|------|------|------|
| **框架** | Electron 43 | 跨平台桌面应用框架 |
| **UI** | HTML/CSS/JavaScript | 原生前端，无框架依赖 |
| **图标** | @fluentui/svg-icons | Fluent Design SVG 图标库 |
| **后端** | amsys.exe (C++) | 虚拟文件系统引擎 |
| **通信** | stdin/stdout JSON 管道 | 进程间数据交换 |
| **计算** | Node.js Worker Threads | 后台文件夹大小计算 |
| **构建** | Electron Forge | 打包与分发 |

---

## 相关文档

- [虚拟文件系统架构详解](filesystem-architecture.md) — amsys 路径翻译、挂载体系、API 接口完整文档
- [接口需求文档](want.md) — AmengExplorer 与 amsys 的接口设计规范
- [管道通信协议](use-pipe.md) — amsys 进程通信格式说明
- [自动文件夹大小方案](.trae/documents/auto-folder-size-plan.md) — 文件夹大小计算实现方案
- [分栏视图方案](.trae/documents/column-view-plan.md) — 三栏分视图设计文档

---

## License

MIT © A萌菌

# amsys 虚拟文件系统 — 架构与集成手册

> 版本 1.0 · 适用于 amsys 类 Unix Shell for Windows

---

## 目录

1. [架构概述](#1-架构概述)
2. [路径翻译引擎](#2-路径翻译引擎)
3. [三级挂载体系](#3-三级挂载体系)
4. [目录结构](#4-目录结构)
5. [虚拟目录机制](#5-虚拟目录机制)
6. [安全边界](#6-安全边界)
7. [配置文件说明](#7-配置文件说明)
8. [外部集成方案](#8-外部集成方案)
9. [C ABI 接口设计](#9-c-abi-接口设计)
10. [附录：路径翻译规则表](#10-附录路径翻译规则表)

---

## 1. 架构概述

### 1.1 设计目标

在 Windows 上提供一个**类 Unix 的虚拟文件系统**，使得：

- 所有路径以 Unix 风格（`/home/user`）书写
- 根目录 `/` 映射到任意 Windows 目录（通过 `config.ini` 配置）
- 标准 Unix 目录（`/home`, `/usr`, `/tmp` 等）可独立配置映射
- `.floder` 文件实现类似符号链接的重定向
- `/etc/fstab` 持久化挂载配置
- Windows 盘符通过 `/media/c`, `/media/d` 访问
- `..` 无法逃逸出虚拟根目录

### 1.2 分层架构

```
┌─────────────────────────────────────────┐
│             Shell (用户层)               │
│  cd / ls / cat / mount / sudo / wine    │
├─────────────────────────────────────────┤
│           PathManager (路径引擎)          │
│  resolve() → to_windows() → to_unix()   │
│  is_virtual_dir() / list_virtual_children│
├─────────────────────────────────────────┤
│       Mount Table (mounts_ 映射表)        │
│  {"/home" → "D:\root\home", ...}        │
├─────────────────────────────────────────┤
│     Config 加载层                         │
│  config.ini → build_mounts()             │
│  /etc/fstab → load_fstab()              │
│  .floder → read_floder()                │
├─────────────────────────────────────────┤
│         Win32 API (实际文件操作)           │
│  CreateFileW / FindFirstFileW / WMI     │
└─────────────────────────────────────────┘
```

### 1.3 核心数据结构

```cpp
// 路径挂载表：unix_path → windows_path
std::unordered_map<std::string, std::string> mounts_;

// 预定义虚拟目录（始终可 cd/ls，即使无挂载子节点）
std::unordered_set<std::string> well_known_virtual_dirs_;
// → {"/dev", "/media"}

// 无盘符的 /dev 分区条目（仅 ls -a 显示）
std::unordered_set<std::string> hidden_devices_;
```

---

## 2. 路径翻译引擎

### 2.1 翻译流程

```
用户输入: cd /home/user/projects
               │
               ▼
        resolve("/home/user/projects")
               │
       ① 规范化: //home/./user/../user/projects
               → /home/user/projects
       ② 检查 .. 逃逸: block_dotdot
       ③ 返回规范 Unix 路径
               │
               ▼
        to_windows("/home/user/projects")
               │
       ① 是 /？→ 返回 root_
       ② 是虚拟目录？→ 返回空
       ③ 是 /media/*？→ 查 mount 表 → 返回
       ④ 是 /mnt/*？→ 查 mount 表 → 返回
       ⑤ 分解顶级目录: "home" + "user/projects"
       ⑥ 查 mount 表: /home → D:\root\home
       ⑦ 拼接: D:\root\home\user\projects
               │
               ▼
        Windows API: SetCurrentDirectoryW(...)
```

### 2.2 反向翻译

```
to_unix("D:\\root\\home\\user\\projects")
               │
       ① 查 mount 表（最长匹配）
       ② /home → D:\root\home（匹配！）
       ③ 剩余: user\projects
       ④ 返回: /home/user/projects
```

### 2.3 路径解析优先级链

| 优先级 | 检查项 | 说明 |
|--------|--------|------|
| 1 | `well_known_virtual_dirs_` | `/dev`, `/media` 始终可 cd |
| 2 | `mounts_` 精确匹配 | `mounts_["/home"]` 存在则用 |
| 3 | `mounts_` 前缀匹配 | `/home/user` → 找最长匹配前缀 |
| 4 | `is_virtual_dir()` 扫描 | 有子挂载点的路径 |
| 5 | 默认拼接 | `<root>\<unix_path>` |

---

## 3. 三级挂载体系

### 3.1 第一级：config.ini 标准目录

启动时从 `config.ini` 的 `[mounts]` 段读取，自动创建目录：

```ini
[mounts]
home =                ; 未配置 = <root>\home
usr  = C:\Users       ; 显式指定
tmp  = D:\temp_stuff
```

**处理流程**：

```
for dir in [home, usr, tmp, var, etc, opt, bin, lib]:
    val = config.get("mounts", dir, "")
    if val is empty:
        val = root_ + "\\" + dir    # 默认路径
    
    # 检查 .floder 重定向
    floder_path = read_floder(val)
    if floder_path is not empty:
        val = floder_path
    
    # 确保目录存在
    CreateDirectoryW(wpath)
    
    # 注册到挂载表
    mounts_["/" + dir] = val
```

### 3.2 第二级：.floder 文件重定向

`.floder` 文件是 amsys 的**符号链接等价物**。

**查找规则**：在目录的**平级位置**查找 `<dirname>.floder`

| 挂载点 | .floder 位置 |
|--------|-------------|
| `/opt` → `<root>\opt` | **`<root>\opt.floder`** |
| `/home` → `<root>\home` | **`<root>\home.floder`** |
| `/media/test` | `<root>\media\test.floder` |

**文件格式**：

```
D:\program files
```

或带环境变量：

```
%USERPROFILE%\Documents
```

**创建方式**：

```bash
# 命令行
newfl /opt.floder "D:\program files"

# 挂载命令（自动创建 .floder）
mount /dev/sda2 /media/test

# 手动创建
echo "D:\program files" > <root>\opt.floder
```

**生效时机**：重启后自动生效（`build_mounts` 时调用 `read_floder`）。

### 3.3 第三级：/etc/fstab 持久挂载

**文件位置**：`<root>\etc\fstab`（无后缀名）

**默认内容**（启动时自动生成）：

```
C:\  /media/c
D:\  /media/d
```

**格式**：

```
# 注释
<Windows 路径>  <Unix 挂载点>
```

**处理流程**：

```
load_fstab():
    if not exists /etc/fstab:
        枚举 Windows 盘符
        写入默认 fstab（/media/c, /media/d...）
    
    读取 fstab 每一行
    for each line:
        device = 第一部分
        mountpoint = 第二部分
        # 检查 .floder 重定向
        floder_path = read_floder(device)
        if floder_path:
            device = floder_path
        mounts_[mountpoint] = device
```

---

## 4. 目录结构

### 4.1 标准目录

| Unix 路径 | 默认 Windows 路径 | 配置方式 |
|-----------|------------------|---------|
| `/` | `config.ini` 的 `root` | `[system]root` |
| `/home` | `<root>\home` | `[mounts]home` |
| `/usr` | `<root>\usr` | `[mounts]usr` |
| `/tmp` | `<root>\tmp` | `[mounts]tmp` |
| `/var` | `<root>\var` | `[mounts]var` |
| `/etc` | `<root>\etc` | `[mounts]etc` |
| `/opt` | `<root>\opt` | `[mounts]opt` |
| `/bin` | `<root>\bin` | `[mounts]bin` |
| `/lib` | `<root>\lib` | `[mounts]lib` |

### 4.2 自动挂载

| Unix 路径 | 实际路径 | 来源 |
|-----------|---------|------|
| `/media/c` | `C:\` | `/etc/fstab` |
| `/media/d` | `D:\` | `/etc/fstab` |
| `/mnt` | `<root>\mnt` | 启动时创建（真实目录） |

### 4.3 虚拟设备目录 `/dev`

| 设备 | 类型 | 说明 |
|------|------|------|
| `/dev/sda` | 物理磁盘 | 整块磁盘，`\\.\PhysicalDrive0` |
| `/dev/sda1` | 分区 | 无盘符分区（仅 `ls -a` 可见） |
| `/dev/sda2` | 分区 | 有盘符时指向卷路径（如 `\\.\C:`） |
| `/dev/null` | 特殊设备 | 读取返回空，写入丢弃 |
| `/dev/zero` | 特殊设备 | 读取返回零字节流 |

### 4.4 文件类型颜色

| 颜色 | ANSI 码 | 类型 | 示例扩展名 |
|------|---------|------|-----------|
| 蓝色粗体 | `\033[1;34m` | 真实目录 | — |
| 青色粗体 | `\033[1;36m` | **虚拟目录** | `dev`, `media` |
| 绿色粗体 | `\033[1;32m` | 可执行文件 | `.exe .com .bat .cmd .msi` |
| 红色粗体 | `\033[1;31m` | 压缩包 | `.zip .rar .7z .tar .gz .iso` |
| 紫色粗体 | `\033[1;35m` | 图片 | `.png .jpg .gif .bmp .ico .svg` |
| 黄色粗体 | `\033[1;33m` | 音频 | `.mp3 .wav .flac .ogg` |
| 橙色 | `\033[38;5;208m` | 视频 | `.mp4 .avi .mkv .mov` |
| 亮白 | `\033[0;37m` | 文本 | `.txt .md .log .cfg .ini` |

---

## 5. 虚拟目录机制

### 5.1 定义

虚拟目录是指**没有对应 Windows 实际路径**，但在 Unix 视角下可 `cd` 和 `ls` 的目录。

### 5.2 虚拟目录来源

| 来源 | 示例 | 注册方式 |
|------|------|---------|
| 预定义集合 | `/dev`, `/media` | `well_known_virtual_dirs_` |
| 挂载前缀 | `/media/c` 使 `/media` 成为虚拟目录 | `mounts_[“/media/c”]` |

### 5.3 检测逻辑

```
is_virtual_dir(path) = 
    path in well_known_virtual_dirs_
    OR 存在子挂载点 starts_with(mount_path, path + "/")
```

### 5.4 显示逻辑

- 虚拟目录在 `ls` 中显示为**青色**（`[1;36m`），与真实目录（蓝色）区分
- 虚拟目录的子条目来自 `list_virtual_children()`

---

## 6. 安全边界

### 6.1 `..` 逃逸拦截

```cpp
bool PathManager::would_escape_root(const std::string& path);
```

- 计算路径深度：每层目录 `+1`，每层 `..` `-1`
- 深度 <= 0 时报错
- 配置开关：`[security]block_dotdot = true`

### 6.2 路径归一化回环检测

```
cd /media/i/rootdir/mnt/i/rootdir/...
    ↓
to_unix() 反向归一化 → "/"
    ↓
cwd_ = "/" (不是 "/media/i/rootdir/...")
```

### 6.3 命令隔离

- 非内建命令不直接执行，提示 `please run by wine`
- Windows 程序通过 `wine` 命令显式启动

---

## 7. 配置文件说明

### 7.1 config.ini

```ini
[system]
root = D:\amsys_root        ; 虚拟根目录（必需）

[mounts]
home =                      ; 留空 = <root>\home
usr  =                      ; 可指定绝对路径
tmp  = D:\temp_stuff

[floder]
enabled = true              ; 启用 .floder 重定向

[security]
block_dotdot = true         ; 禁止 .. 逃逸
```

- 编码：**UTF-8**（支持中文路径）
- 注释：`;` 或 `#`
- 环境变量：`%VAR%` 可在值中展开

### 7.2 /etc/fstab

```fstab
# amsys fstab
C:\  /media/c
D:\  /media/d
```

- 编码：UTF-8
- 自动生成（启动时检测不存在则创建）
- 可手工编辑，重启后生效

### 7.3 .floder 文件

- 编码：UTF-8
- 位置：与目标目录平级
- 内容：第一行为目标 Windows 路径，支持 `%VAR%` 展开

---

## 8. 外部集成方案

以下是 Electron 项目集成 amsys 虚拟文件系统的几种可行方案。

### 方案 A：子进程管道通信

```
Electron App                 amsys.exe
    │                            │
    │── stdin ──→ JSON 命令 ─────→│
    │←── stdout ←─ JSON 响应 ────│
    │                            │
```

**原理**：Electron 启动 `amsys.exe` 作为子进程，通过 stdin/stdout 发送 JSON 格式的命令。

```typescript
// Electron 侧示例
const { spawn } = require('child_process');
const amsys = spawn('amsys.exe', ['--pipe']);

function call(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve) => {
        const request = JSON.stringify({ cmd, args }) + '\n';
        amsys.stdin.write(request);
        amsys.stdout.once('data', (data) => {
            resolve(JSON.parse(data.toString()));
        });
    });
}

// 使用
const winPath = await call('to_windows', ['/home/user']);
const files = await call('ls', ['/media/c']);
```

| 优点 | 缺点 |
|------|------|
| 无需编译额外 DLL | 需要附带 amsys.exe |
| 完全隔离，安全 | 进程间通信有开销 |
| 支持所有 amsys 功能 | 依赖子进程生命周期管理 |

### 方案 B：C++ DLL + Node.js FFI

把 PathManager 的核心逻辑编译为 DLL，Electron 通过 `ffi-napi` 调用。

```cpp
// amsys_api.h — C ABI 导出
extern "C" {
    __declspec(dllexport) int   amsys_init(const char* config);
    __declspec(dllexport) char* amsys_to_windows(const char* unix_path);
    __declspec(dllexport) char* amsys_to_unix(const char* windows_path);
    __declspec(dllexport) void  amsys_free_string(char* str);
}
```

```typescript
// Electron 侧
import ffi from 'ffi-napi';

const lib = ffi.Library('amsys_api.dll', {
    amsys_init: ['int', ['string']],
    amsys_to_windows: ['string', ['string']],
    amsys_to_unix: ['string', ['string']],
});

lib.amsys_init('D:\\config.ini');
const winPath = lib.amsys_to_windows('/home/user');
```

| 优点 | 缺点 |
|------|------|
| 高性能，无进程开销 | 需要编译 DLL |
| 直接集成到 Node 进程 | 需要 `ffi-napi` 编译环境 |
| 支持所有 Windows 版本 | 32/64 位需分别编译 |

### 方案 C：纯 TypeScript 重写

把路径翻译核心规则用 TypeScript 实现为 npm 包。

```typescript
// amsys-path.ts
interface MountEntry {
    unixPath: string;
    windowsPath: string;
}

class PathManager {
    private mounts: MountEntry[] = [];
    private root: string = '';

    constructor(config: { root: string }) {
        this.root = config.root;
    }

    toWindows(unixPath: string): string {
        // 实现路径翻译逻辑...
    }

    toUnix(windowsPath: string): string {
        // 实现反向翻译...
    }
}
```

| 优点 | 缺点 |
|------|------|
| 零外部依赖 | 需要重写逻辑 |
| 可直接 `npm install` | 不支持 WMI/IOCTL（磁盘枚举） |
| 跨平台（可 Linux 开发） | 不支持 Windows 盘符自动发现 |

### 方案 D：HTTP API 服务

amsys 启动一个轻量 HTTP 服务，Electron 通过 `fetch` 调用。

```bash
amsys.exe --http=8080
```

```typescript
// Electron 侧
async function toWindows(path: string): Promise<string> {
    const res = await fetch('http://localhost:8080/to_windows', {
        method: 'POST',
        body: JSON.stringify({ path }),
    });
    return (await res.json()).result;
}
```

| 优点 | 缺点 |
|------|------|
| 语言无关 | 需要引入 HTTP 服务依赖 |
| 可远程访问 | 安全性需额外考虑 |
| 易于调试 | 端口冲突风险 |

---

## 9. C ABI 接口设计

若选择方案 B（DLL + FFI），以下是建议的导出接口：

### 9.1 头文件 `amsys_api.h`

```c
#ifndef AMSYS_API_H
#define AMSYS_API_H

#ifdef AMSYS_API_EXPORTS
#define AMSYS_API __declspec(dllexport)
#else
#define AMSYS_API __declspec(dllimport)
#endif

/* ── 生命周期 ────────────────── */

/* 初始化 PathManager，加载配置
 * config_path: config.ini 的完整路径，或 NULL 使用默认查找
 * 返回 0 成功，非 0 失败 */
AMSYS_API int amsys_init(const char* config_path);

/* 销毁 PathManager，释放资源 */
AMSYS_API void amsys_destroy(void);

/* ── 路径转换 ────────────────── */

/* Unix 路径 → Windows 路径
 * 返回的字符串需调用 amsys_free_string 释放 */
AMSYS_API char* amsys_to_windows(const char* unix_path);

/* Windows 路径 → Unix 路径 */
AMSYS_API char* amsys_to_unix(const char* windows_path);

/* 路径规范化（解析 . 和 ..） */
AMSYS_API char* amsys_resolve(const char* unix_path);

/* ── 工作目录 ────────────────── */

/* 设置当前工作目录 */
AMSYS_API int amsys_set_cwd(const char* unix_path);

/* 获取当前工作目录 */
AMSYS_API char* amsys_get_cwd(void);

/* ── 目录内容 ────────────────── */

/* 列出目录内容（虚拟目录和真实目录）
 * 返回 JSON 格式字符串，需释放 */
AMSYS_API char* amsys_list_dir(const char* unix_path);

/* ── 挂载管理 ────────────────── */

/* 添加挂载点 */
AMSYS_API int amsys_mount(const char* unix_path, const char* win_path);

/* 移除挂载点 */
AMSYS_API int amsys_umount(const char* unix_path);

/* ── 内存管理 ────────────────── */

/* 释放由 amsys_* 返回的字符串 */
AMSYS_API void amsys_free_string(char* str);

/* ── 错误信息 ────────────────── */

/* 获取最后错误的描述文本 */
AMSYS_API const char* amsys_last_error(void);

#endif /* AMSYS_API_H */
```

### 9.2 接口返回值约定

| 返回类型 | 成功 | 失败 |
|---------|------|------|
| `int` | `0` | `-1`（调用 `amsys_last_error()` 获取详情） |
| `char*` | 非 NULL 字符串 | `NULL` |
| `const char*` | 错误描述文本 | — |

### 9.3 编译为 DLL

```bash
g++ -std=c++20 -shared -o amsys_api.dll \
    src/amsys_api.cpp \
    src/config.cpp \
    src/floder_reader.cpp \
    src/path_manager.cpp \
    -lole32 -lwbemuuid -loleaut32 \
    -static -Wno-write-strings
```

### 9.4 Electron 侧调用示例

```typescript
// 安装依赖
// npm install ffi-napi ref-napi

import ffi from 'ffi-napi';
import ref from 'ref-napi';

const amsys = ffi.Library('amsys_api.dll', {
    amsys_init: ['int', ['string']],
    amsys_to_windows: ['string', ['string']],
    amsys_to_unix: ['string', ['string']],
    amsys_resolve: ['string', ['string']],
    amsys_get_cwd: ['string', []],
    amsys_set_cwd: ['int', ['string']],
    amsys_list_dir: ['string', ['string']],
    amsys_mount: ['int', ['string', 'string']],
    amsys_umount: ['int', ['string']],
    amsys_free_string: ['void', ['string']],
    amsys_last_error: ['string', []],
});

// 初始化
const ret = amsys.amsys_init(null);
if (ret !== 0) {
    console.error('amsys init failed');
    process.exit(1);
}

// 路径翻译
const winPath = amsys.amsys_to_windows('/home/user/projects');
console.log(winPath); // D:\root\home\user\projects
amsys.amsys_free_string(winPath);

const unixPath = amsys.amsys_to_unix('D:\\root\\home\\test');
console.log(unixPath); // /home/test
amsys.amsys_free_string(unixPath);

// 目录列表
const listing = amsys.amsys_list_dir('/media/c');
console.log(JSON.parse(listing));
// [{ name: "Windows", is_dir: true }, { name: "Users", is_dir: true }, ...]
amsys.amsys_free_string(listing);

// 挂载管理
amsys.amsys_mount('/mnt/data', 'D:\\my_data');

// 销毁
amsys.amsys_destroy();
```

---

## 10. 附录：路径翻译规则表

### 输入 → 输出对照

| Unix 路径 | Windows 路径 | 说明 |
|-----------|-------------|------|
| `/` | `<root>\` | 根目录 |
| `/home` | `<root>\home` | 标准挂载点 |
| `/home/user/file.txt` | `<root>\home\user\file.txt` | 子路径拼接 |
| `/media/c` | `C:\` | fstab 挂载 |
| `/media/c/Windows` | `C:\Windows` | 挂载后子路径 |
| `/dev/null` | — | 特殊设备 |
| `/dev/sda2` | `\\.\C:`（有盘符）或 `\\.\PhysicalDrive0` | 卷路径 |
| `/mnt/test` | `<root>\mnt\test` | 真实目录 |
| `../etc` | 阻止（block_dotdot） | 逃逸拦截 |
| `/media/i/rootdir/...` | `/`（归一化） | 回环检测 |

### 反向翻译

| Windows 路径 | Unix 路径 | 说明 |
|-------------|-----------|------|
| `<root>\` | `/` | 精确匹配根 |
| `<root>\home\test` | `/home/test` | 最长 mount 前缀匹配 |
| `C:\` | `/media/c` | fstab 挂载反向 |
| `C:\Windows` | `/media/c/Windows` | 子路径 |
| `\\.\PhysicalDrive0` | `/dev/sda` | 设备路径 |
| `D:\root\mnt\x` | `/mnt/x` | 真实目录 |

# amsys — Unix-like shell for Windows

amsys 是一个运行在 Windows 上的类 Unix shell，提供虚拟根文件系统、路径映射、别名工具管理、管道与重定向、提权执行等功能，并支持通过命名管道与其他程序（如 Electron 文件管理器）进行进程间通信。

---

## Quick Start

```bash
amsys.exe
amsys.exe --user alice
amsys.exe --pipe
amsys.exe --sudo --exec="ls -l /home"
amsys.exe --user bob --pipe --pipe=\\.\pipe\amsys_sudo_1234
```

---

## 目录结构

```
amsys/
├── amsys.exe          # 主程序
├── config.ini         # 根目录、工具、命令等配置
├── icon.rc            # Windows 资源文件（图标）
├── icon.ico           # 程序图标
├── src/               # 源代码
│   ├── main.cpp       # 入口、pipe 模式、sudo exec 模式
│   ├── shell.h/cpp    # Shell 主循环、内建命令、工具执行
│   ├── path_manager.h/cpp # 虚拟文件系统路径翻译引擎
│   ├── config.h/cpp   # INI 配置文件读取
│   ├── floder_reader.h/cpp # .floder 文件解析（符号链接触发器）
│   └── utils.h        # 工具函数（字符串、编码转换、全局匹配）
└── README.md
```

---

## 虚拟文件系统

### 路径映射

`config.ini` 中的 `[system]` 节定义根目录：

```ini
[system]
root = D:\amsys_root
```

标准目录自动在根下创建，也可通过配置重定向：

```ini
home = I:\users
usr  = D:\tools
```

优先级（从高到低）：
1. **`.floder` 文件** — 若目录下存在 `home.floder`，其第一行路径为实际目标
2. **`config.ini` 显式配置** — 若写了 `home = C:\real\path`
3. **默认值** — `<root>\home`

### 虚拟目录

以下目录为虚拟目录（无对应 Windows 文件系统路径），自动生成子条目：

| 路径 | 说明 |
|------|------|
| `/dev` | 设备树：`/dev/sda` `/dev/sda1` … `/dev/null` `/dev/zero` |
| `/media` | Windows 盘符挂载（`/media/c` `/media/d` …） |
| `/mnt` | 通用挂载目录（供 `mount` 命令挂载） |

`ls` 中虚拟目录以 **青色** 显示。

### 盘符自动挂载

启动时自动扫描所有 Windows 物理磁盘及其分区，生成 `/dev/sda`、`/dev/sda1` 等设备条目，并将有盘符的分区通过 fstab 挂载到 `/media/` 下：

```
/media/c  →  C:\
/media/d  →  D:\
```

`/etc/fstab` 自动创建，记录这些挂载。

### .floder 文件（符号链接触发器）

`.floder` 是 amsys 的软链接机制。文件第一行为重定向目标路径：

```
C:\Program Files
```

- 新建：`newfl /opt.floder "C:\Program Files"`
- 建链接：`newfl -j /mnt/link D:\target`（Windows 目录符号链接）
- 访问：`cd /opt` 自动读取 `/opt.floder` 并跳转

---

## 命令参考

### 文件操作

| 命令 | 说明 |
|------|------|
| `ls [-l] [-a] [-s] <path>` | 列出目录；`-l` 长格式，`-a` 显示隐藏，`-s` 每行一个 |
| `cat <file> [file...]` | 查看文件内容 |
| `cp [-r] <src> <dst>` | 复制文件或目录 |
| `mv <src> <dst>` | 移动/重命名 |
| `rm [-r] <path>` | 删除文件或目录 |
| `mkdir <dir>` | 创建目录 |

### 路径导航

| 命令 | 说明 |
|------|------|
| `cd <path>` | 切换目录；`~` 展开为 `$HOME` |
| `pwd` | 显示当前 Unix 路径 |

### 环境变量

| 命令 | 说明 |
|------|------|
| `export [VAR=value]` | 设置环境变量；无参数显示所有 |
| `unset <VAR>` | 删除变量（内置变量受保护） |
| `env` | 显示所有环境变量 |
| `echo $VAR` | 展开变量；`$$` → 单 `$` |

内置变量：

| 变量 | 说明 |
|------|------|
| `$HOME` | 用户 home 目录（`/root` 或 `/home/{user}`） |
| `$USER` | 当前用户名 |
| `$SHELL` | `amsys` |
| `$PWD` | 当前工作目录 |
| `$PATH` | `/bin:/opt`（独立于 Windows PATH） |
| `$AMSYS_LOCATE` | amsys.exe 的 Unix 路径 |
| `$AMSYS_ROOT` | 根目录的 Unix 回环路径 |
| `$AMSYS_VERSION` | `1.0.0` |

### 挂载

| 命令 | 说明 |
|------|------|
| `mount` | 显示所有挂载点 |
| `mount <dev> <path>` | 挂载设备到路径（创建 .floder 文件） |
| `umount <path>` | 卸载（删除 .floder 文件） |
| `newfl <path> <target>` | 创建 .floder 文件 |
| `newfl -j <link> <target>` | 创建 Windows 目录符号链接 |

### 提权

| 命令 | 说明 |
|------|------|
| `sudo` / `sudo -h` | 显示帮助 |
| `sudo -i` | 原窗口提权交互式 shell（命名管道 IPC） |
| `sudo -n` | 新管理员窗口 |
| `sudo -n <command>` | 在新管理员窗口执行命令 |
| `sudo <command>` | 提权执行命令（临时文件捕获输出） |

### 工具与命令

在 `config.ini` 中注册：

```ini
[tools]
vi  = .\root\bin\vim.exe
vim = .\root\bin\vim.exe
calc = calc.exe

[commands]
apm = .\apm.exe
```

- **tool**：启动前提示"可能不支持 Unix 路径"；非 TTY 环境拒绝运行
- **command**：无提示，可在管道终端运行（如 `apm` 包管理器）

注册后可直接调用：

```bash
amsys:/$ vi /home/test.txt
amsys:/$ apm install something
```

`tools` 命令列出所有已注册别名的工具，标注类型。

### 输出重定向

| 符号 | 说明 |
|------|------|
| `>` | 标准输出重定向（覆盖） |
| `>>` | 标准输出重定向（追加） |
| `<` | 标准输入重定向 |
| `2>` | 标准错误重定向（覆盖） |
| `2>>` | 标准错误重定向（追加） |
| `|` | 管道：前命令 stdout → 后命令 stdin |

示例：

```bash
echo hello > /tmp/out.txt
cat /tmp/out.txt
ls /nonexist 2> /tmp/err.txt
cat /tmp/err.txt
echo hello | grep he
```

### 通配符展开

支持 `*` 和 `?` 全局匹配：

```bash
ls /*
echo /home/*.txt
cat /etc/*.conf
```

### 多用户

```bash
amsys.exe                      # 默认 root
amsys.exe --user alice         # 以 alice 身份启动
amsys.exe --pipe --user bob    # pipe 模式指定用户
```

- `root` → home 在 `/root`
- 其他 → home 在 `/home/{username}`
- home 目录自动创建
- `$HOME`、`$USER`、`cd ~` 随之适配

### 其他

| 命令 | 说明 |
|------|------|
| `help` / `help -c` | 显示帮助（英文/中文） |
| `mount` | 显示挂载表 |
| `wine <exe> [args]` | 运行 Windows 程序 |
| `tools` | 列出已注册工具别名 |
| `exit` / `quit` | 退出 |

---

## 管道模式（IPC）

通过 `-pipe` 或 `-pipe=\\.\pipe\name` 启动 IPC 模式。用于与其他程序（如 Electron 文件管理器）通信。支持以下命令：

| 命令 | 示例 |
|------|------|
| `resolve <path>` | `resolve /home` → Unix 路径规范化 |
| `to_windows <path>` | `to_windows /media/c/Users` → `C:\Users` |
| `to_unix <path>` | `to_unix C:\Users` → `/media/c/Users` |
| `list_dir <path>` | `list_dir /home` → 文件列表 JSON |
| `stat <path>` | `stat /etc/fstab` → 文件信息 JSON |
| `export VAR | `export PATH` →  `${}`  显示变量值 |

详见 [I:\Data-数据区\应用\自制\AmengExplorer\use-pipe.md]()

---

## 配置文件 (`config.ini`)

```ini
[system]
root = D:\amsys_root                 ; 根目录
block_dotdot = true                  ; 禁止 cd ..

; 标准目录可单独重定向
home =                               ; 默认 <root>\home
usr  =                               ; 默认 <root>\usr
tmp  =                               ; 默认 <root>\tmp
; ... bin, etc, opt, lib, var, root

[tools]
; 工具别名：相对路径相对于 amsys.exe
vi  = .\root\bin\vim.exe
vim = .\root\bin\vim.exe
calc = calc.exe

[commands]
; 命令：无提示、管道可用
apm = .\apm.exe
```

---

## 快捷键

| 按键 | 行为 |
|------|------|
| `Ctrl+C` | 终止当前操作（工具进程被 TerminateProcess） |
| `Ctrl+D` | `exit` |

---

## 编译

```bash
# 需要 MinGW-w64 / TDM-GCC
windres icon.rc -O coff -o icon.res
g++ -std=c++20 -Wall src/*.cpp icon.res -o amsys.exe -static -lole32 -lwbemuuid -loleaut32
```

---

## 构建依赖

- C++20 编译器（MinGW-w64 / TDM-GCC）
- Windows SDK（`windows.h`、`wbemuuid.lib`、`ole32.lib`、`oleaut32.lib`）
- 图标资源 `icon.ico`（通过 `icon.rc` 引用）

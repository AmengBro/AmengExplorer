# apm — Amsys Package Manager

apm 是 amsys 虚拟文件系统的包管理器。  
它将应用程序以 `.aup` 格式打包并安装到 `/opt` 或 `/bin`，同时注册 `.app` 桌面入口到 `/usr/share/applications`。

## 命令

| 命令 | 参数 | 说明 |
|------|------|------|
| `apm install <package.aup>` | 包文件路径 | 安装一个 .aup 包 |
| `apm uninstall <name>` | 包名 | 卸载一个已安装的包（包名为 `[package] name`） |
| `apm list` | — | 列出所有已安装的包 |
| `apm --help` | — | 显示帮助信息 |

### install 的路径参数

`install` 接受三种路径形式，apm 会自动转译为 Windows 绝对路径：

| 形式 | 示例 | 处理方式 |
|------|------|---------|
| Unix 绝对路径 | `apm install /media/d/apps/wps.aup` | 通过 `amsys resolve` 转换 |
| 相对路径 / 裸名 | `apm install ./wps.aup` 或 `apm install wps.aup` | 基于当前工作目录（= amsys shell 的 cwd）转为绝对路径 |
| Windows 绝对路径 | `apm install D:\apps\wps.aup` | 直接使用 |

## .aup 包格式

`.aup` 是一个使用 7-Zip (LZMA2) 压缩的存档文件（本质是重命名的 `.7z`）。

### 包内结构

```
myapp-1.0.0.aup
├── aminfo.ini          [必需] 包元数据与安装指令
├── myapp.app           [必需] 桌面入口描述 (JSON)
├── myapp.exe           [原软件] 保持原样
├── myapp.dll           [原软件]
├── config/             [原软件]
└── ...                 其他任意文件
```

> 包内就是原软件原貌 + `aminfo.ini` + `.app` 文件，不做任何目录重排。  
> apm 安装时会扫描包根目录下**所有** `*.app` 文件，无需与包名一致。

### aminfo.ini 格式

```ini
[package]
name = com.example.myapp   ; 包名：决定 .app 记录、/etc/{name}、apmlist
version = 1.0.0            ; 版本号

[install]
location = /opt            ; 安装基目录（仅允许 /opt 或 /bin）
name = myapp               ; 安装目录名：装到 {location}/{name}
```

> **`[package] name` 与 `[install] name` 是两个独立字段。**  
> 安装目录名由 `[install] name` 决定，可以与包名不同（例如包 `com.wps.app` 安装到 `/opt/WPS`）。  
> 卸载、`list`、安装记录均以 `[package] name` 为准，互不影响。

### .app 文件格式 (JSON)

```json
{
  "name": "显示名称",
  "description": "描述文本",
  "exePath": "/opt/myapp/myapp.exe",
  "icon": "/opt/myapp/myapp.ico"
}
```

> `exePath` 和 `icon` 使用 **Unix 路径**（安装后的最终位置），  
> apm 安装时会自动通过 amsys 转换为 Windows 绝对路径后写入 `/usr/share/applications/`。

## 安装流程

1. 定位并启动 `amsys.exe --pipe`（自动选择能加载 `config.ini` 的那个）
2. 通过 amsys 获取 `/tmp` 和 `/bin/7z/7z.exe` 的 Windows 路径
3. 将包路径转译为 Windows 绝对路径（Unix / 相对 / Windows 三种形式）
4. 使用 7z 解压 `.aup` 到 `/tmp/apmtemp`
5. 读取 `aminfo.ini` 获取安装参数
6. **先安装 `.app`**：扫描包内所有 `*.app`，处理路径转换后写入 `/usr/share/applications`
7. 复制剩余文件到 `/{location}/{name}`（自动剔除 `aminfo.ini` 和 `*.app`）
8. 保存安装记录到 `/etc/{package.name}/aminfo.ini`
9. 登记包名到 `/etc/apmlist`
10. 清理 `/tmp/apmtemp`

## 卸载流程

1. 读取 `/etc/{name}/aminfo.ini` 获取安装信息
2. 递归删除 `/{location}/{install.name}`
3. 删除 `/usr/share/applications/` 下匹配的 `*.app`
4. 删除 `/etc/{name}` 安装记录
5. 从 `/etc/apmlist` 移除包名

## amsys 定位策略

apm 按以下顺序寻找 `amsys.exe`，**优先选择能找到 `config.ini` 的那个**（确保使用正确的 root）：

1. apm.exe 同目录
2. `..\` 上级目录
3. `..\..\`（项目根目录）
4. 系统 PATH

选择依据：该 amsys.exe 的 exe 目录、父目录或当前 cwd 中存在 `config.ini`。

## 构建

```bash
# 需要 MinGW-w64 (g++ 10+)
g++ -std=c++20 -Wall -Wno-write-strings -o root/bin/apm.exe apm/src/*.cpp -static -lole32
```

## 路径血统

所有路径在代码中以 **Unix 风格**书写，通过 `amsys.exe --pipe` 转换为 Windows 绝对路径后再使用，确保 amsys 虚拟文件系统的血统纯正。

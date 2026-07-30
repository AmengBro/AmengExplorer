# AmengExplorer 接口需求文档

## 背景

AmengExplorer 需要集成 amsys 的虚拟文件系统能力，实现：
- Unix 风格路径访问（如 `/home`, `/media/c`）
- 虚拟目录支持（如 `/dev`, `/mnt`）
- `.floder` 文件指针挂载机制
- Windows 盘符虚拟挂载

## 核心设计原则

1. **amsys 负责路径翻译和虚拟目录逻辑**
2. **AmengExplorer 只负责 UI 和实际文件操作**
3. **统一接口，一次调用返回完整结果**，避免多次请求
4. **返回 JSON 格式**，便于扩展和解析

## 接口设计

### 1. resolve — 路径解析

**功能**：解析 Unix 路径，返回路径类型和必要信息

**输入**：
```
resolve <unix_path>
```

**输出**：JSON 格式
```json
{
  "success": true,
  "type": "real",        // "real" | "virtual" | "not_found"
  "winPath": "D:\\root\\home\\user",  // real 类型时返回 Windows 绝对路径
  "children": null       // virtual 类型时返回子条目
}
```

**虚拟目录示例**：
```json
{
  "success": true,
  "type": "virtual",
  "winPath": null,
  "children": [
    {"name": "c", "type": "dir", "is_virtual": false},
    {"name": "d", "type": "dir", "is_virtual": false},
    {"name": "sda", "type": "dir", "is_virtual": true}
  ]
}
```

**不存在的路径**：
```json
{
  "success": false,
  "error": "no such file or directory",
  "type": "not_found"
}
```

### 2. list_dir — 列出目录内容

**功能**：统一处理真实目录和虚拟目录，返回文件列表

**输入**：
```
list_dir <unix_path>
```

**输出**：JSON 格式
```json
{
  "success": true,
  "entries": [
    {"name": "Documents", "type": "dir", "size": 0, "mtime": "2024-01-01T12:00:00Z"},
    {"name": "file.txt", "type": "file", "size": 1024, "mtime": "2024-01-02T10:30:00Z"},
    {"name": "link.floder", "type": "file", "size": 256, "mtime": "2024-01-03T08:00:00Z"}
  ]
}
```

**虚拟目录示例**（如 `/dev`）：
```json
{
  "success": true,
  "entries": [
    {"name": "sda", "type": "dir", "is_virtual": true},
    {"name": "sdb", "type": "dir", "is_virtual": true},
    {"name": "cdrom", "type": "dir", "is_virtual": true}
  ]
}
```

### 3. to_windows — Unix 路径转 Windows 路径

**功能**：将 Unix 路径转换为 Windows 绝对路径（仅处理真实路径）

**输入**：
```
to_windows <unix_path>
```

**输出**：JSON 格式
```json
{
  "success": true,
  "winPath": "D:\\root\\home\\user\\file.txt"
}
```

**不存在或虚拟路径**：
```json
{
  "success": false,
  "error": "not a real path"
}
```

## 通信协议

建议采用 **子进程管道通信**：

1. AmengExplorer 启动 amsys 作为子进程
2. 通过 `stdin` 发送命令（每行一条）
3. 通过 `stdout` 接收 JSON 响应（每行一条）
4. 命令格式：`<command> <args...>`
5. 响应格式：单行 JSON

### 协议示例

**AmengExplorer → amsys**：
```
resolve /home
```

**amsys → AmengExplorer**：
```json
{"success":true,"type":"real","winPath":"D:\\root\\home","children":null}
```

**AmengExplorer → amsys**：
```
list_dir /media
```

**amsys → AmengExplorer**：
```json
{"success":true,"entries":[{"name":"c","type":"dir","is_virtual":false},{"name":"d","type":"dir","is_virtual":false}]}
```

## 特殊处理要求

### .floder 文件支持
- `resolve` 和 `list_dir` 应透明处理 `.floder` 重定向
- 当路径指向 `.floder` 文件时，应解析其内容并重定向到目标路径
- 对调用方透明，无需特殊处理

### 安全边界
- 支持 `block_dotdot` 配置，防止路径遍历攻击
- 所有路径操作应经过安全检查

### 错误处理
- 返回 JSON 格式错误，包含错误码和错误信息
- 错误码建议：
  - `ENOENT`：文件或目录不存在
  - `ENOTDIR`：不是目录
  - `EACCES`：权限不足
  - `EINVAL`：无效参数

## 使用场景示例

### 场景1：用户点击 root 驱动器
```
AmengExplorer: resolve /
amsys: {"success":true,"type":"real","winPath":"D:\\root","children":null}
AmengExplorer: list_dir /
amsys: {"success":true,"entries":[{"name":"home","type":"dir"},{"name":"usr","type":"dir"},{"name":"etc","type":"dir"}]}
```

### 场景2：用户进入 /media（虚拟目录）
```
AmengExplorer: resolve /media
amsys: {"success":true,"type":"virtual","winPath":null,"children":[{"name":"c","type":"dir"},{"name":"d","type":"dir"}]}
AmengExplorer: list_dir /media
amsys: {"success":true,"entries":[{"name":"c","type":"dir","is_virtual":false},{"name":"d","type":"dir","is_virtual":false}]}
```

### 场景3：用户进入 /media/c（挂载的 Windows C 盘）
```
AmengExplorer: resolve /media/c
amsys: {"success":true,"type":"real","winPath":"C:\\","children":null}
AmengExplorer: list_dir /media/c
amsys: {"success":true,"entries":[{"name":"Users","type":"dir"},{"name":"Program Files","type":"dir"},{"name":"Windows","type":"dir"}]}
```

## 实现建议

1. 在 amsys 中添加命令行接口模式，监听 stdin
2. 每条命令处理完成后立即输出 JSON 响应
3. 使用换行符作为命令/响应分隔符
4. 支持持续运行模式，保持子进程活跃

## 注意事项

1. 所有路径中的空格和特殊字符需要正确处理
2. JSON 输出需要转义换行符和引号
3. 错误响应也应返回合法 JSON
4. 考虑性能优化，避免重复解析配置文件
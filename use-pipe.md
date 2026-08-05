# amsys --pipe 模式 — Electron 调用文档

> 适用版本：amsys 1.0+  
> 协议：JSON Lines over stdin/stdout

---

## 快速开始

```typescript
const { spawn } = require('child_process');

const amsys = spawn('amsys.exe', ['--pipe'], {
    stdio: ['pipe', 'pipe', 'pipe']
});

function request(cmd) {
    return new Promise((resolve, reject) => {
        const onData = (data) => {
            amsys.stdout.removeListener('data', onData);
            resolve(JSON.parse(data.toString()));
        };
        amsys.stdout.on('data', onData);
        amsys.stdin.write(cmd + '\n');
    });
}

// 使用
const result = await request('resolve /media/c');
console.log(result.winPath); // C:\
```

---

## 命令行参数

`amsys.exe` 支持以下启动参数（必须在 spawn 时传入，进程运行期间不可更改）：

| 参数 | 说明 |
|------|------|
| `--pipe` | 管道模式：JSON Lines over stdin/stdout（本文档主流程） |
| `--user <用户名>` | 指定当前用户，默认 `root`。设置会话的 `USER`/`HOME` 环境变量，用于交互式 shell 的用户上下文（提示符、`~` 相关行为等）；pipe 模式的 `resolve` / `list_dir` / `to_windows` 路径映射不受影响，路径始终按 `config.ini` 的 root 解析 |
| `--sudo` | 以 sudo 权限运行 |
| `--cwd=<目录>` | 指定工作目录 |
| `--exec=<命令>` | 启动后直接执行命令 |
| `--tmpfile=<路径>` | 临时文件模式 |

**`--user` 使用示例**：

```typescript
const { spawn } = require('child_process');
const path = require('path');

// 以 AmengBro 身份启动；root 是默认值，可不传
const amsys = spawn('amsys.exe', ['--pipe', '--user', 'AmengBro'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    // config.ini 里的相对 root（如 ./root）是相对进程工作目录解析的，
    // 建议显式把 cwd 固定为 amsys.exe 所在目录，避免受启动方目录影响
    cwd: path.dirname('amsys.exe'),
});
```

**切换用户**：`--user` 只能在启动时指定，切换用户需要结束当前进程并用新参数重新 spawn（参考 `amsys-client.js` 的 `setUser()`）。

**配置查找**：`config.ini` 在 amsys.exe 所在目录及其上级目录查找；其中 `[system] root` 若为相对路径（如 `./root`），则相对**进程工作目录**解析——因此打包/部署时必须保证 `cwd` 指向 amsys.exe 所在目录，否则虚拟根会挂载失败。

---

## 协议格式

### 请求

每行一条命令，`<命令> <参数>` 格式，以换行符 `\n` 分隔。

```
resolve /home/user
list_dir /dev
to_windows /media/c
```

### 响应

每行一条 JSON 对象，与请求顺序一一对应。

```json
{"success":true,"type":"real","winPath":"D:\\root\\home\\user","children":null}
```

---

## 命令参考

### 1. resolve — 路径解析

**功能**：判断路径类型，返回必要信息。

**请求**：
```
resolve <unix_path>
```

**响应格式**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | bool | 是否成功 |
| `type` | string | `"real"` / `"virtual"` / `"not_found"` |
| `winPath` | string / null | 真实路径的 Windows 绝对路径 |
| `children` | array / null | 虚拟目录的子条目列表 |
| `error` | string | 失败时的错误描述 |

**示例**：

```bash
# 真实路径
resolve /home
# → {"success":true,"type":"real","winPath":"D:\\root\\home","children":null}

# 虚拟目录
resolve /dev
# → {"success":true,"type":"virtual","winPath":null,"children":[
#      {"name":"sda","type":"dir","is_virtual":false},
#      {"name":"null","type":"dir","is_virtual":false},
#      {"name":"zero","type":"dir","is_virtual":false}
#    ]}

resolve /media
# → {"success":true,"type":"virtual","winPath":null,"children":[
#      {"name":"c","type":"dir","is_virtual":false},
#      {"name":"d","type":"dir","is_virtual":false}
#    ]}

# 不存在的路径
resolve /nonexistent
# → {"success":false,"error":"no such file or directory","code":"ENOENT"}
```

### 2. list_dir — 列出目录内容

**功能**：返回目录中的文件和子目录列表。

**请求**：
```
list_dir <unix_path>
```

**响应字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | bool | 是否成功 |
| `entries` | array | 文件/目录列表 |
| `entries[].name` | string | 文件名 |
| `entries[].type` | string | `"dir"` / `"file"` |
| `entries[].size` | number | 文件大小（字节），目录为 0 |
| `entries[].mtime` | string | 最后修改时间（ISO 8601） |
| `entries[].is_virtual` | bool | 是否为虚拟条目（仅虚拟目录） |

**示例**：

```bash
# 真实目录
list_dir /
# → {"success":true,"entries":[
#      {"name":"bin","type":"dir","size":0,"mtime":"2026-07-06T11:17:26Z"},
#      {"name":"etc","type":"dir","size":0,"mtime":"2026-07-06T12:06:37Z"},
#      {"name":"home","type":"dir","size":0,"mtime":"2026-07-08T00:26:30Z"},
#      {"name":"opt","type":"dir","size":0,"mtime":"2026-07-06T11:23:56Z"}
#    ]}

# 虚拟目录
list_dir /dev
# → {"success":true,"entries":[
#      {"name":"sda","type":"dir","is_virtual":false},
#      {"name":"null","type":"dir","is_virtual":false},
#      {"name":"zero","type":"dir","is_virtual":false}
#    ]}
```

### 3. to_windows — Unix 路径转 Windows 路径

**功能**：将 Unix 路径转换为 Windows 绝对路径（仅真实路径）。

**请求**：
```
to_windows <unix_path>
```

**响应字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | bool | 是否成功 |
| `winPath` | string | Windows 绝对路径 |

**示例**：

```bash
to_windows /media/c
# → {"success":true,"winPath":"C:\\"}

to_windows /home/user/file.txt
# → {"success":true,"winPath":"D:\\root\\home\\user\\file.txt"}

to_windows /dev/sda
# → {"success":false,"error":"not a real path","code":"ENOENT"}
```

---

## 错误处理

所有错误响应格式一致：

```json
{
  "success": false,
  "error": "描述信息",
  "code": "错误码"
}
```

| 错误码 | 说明 |
|--------|------|
| `EINVAL` | 参数错误（缺少路径、未知命令） |
| `ENOENT` | 路径不存在 |
| `EACCES` | 权限不足 |

---

## 注意事项

1. **保持子进程活跃**：amsys 启动后持续监听 stdin，不会主动退出。Electron 退出时应调用 `amsys.kill()` 或发送 `exit` 命令（当前不支持，需杀进程）
2. **路径编码**：所有路径使用 UTF-8 编码，JSON 中的反斜杠 `\` 会转义为 `\\`
3. **性能**：每次请求都会重新解析路径，无需缓存
4. **并发**：当前为串行处理，前一个请求完成后才会处理下一个。如需要并发，建议在 Electron 侧维护多个子进程或请求队列
5. **启动延迟**：首次启动需加载配置和初始化 WMI，约 100-500ms。之后每次请求 < 5ms
6. **`is_virtual` 字段**：标记该条目是否为虚拟目录（如 `/dev` 本身），用于 UI 区分显示颜色

---

## 完整 TypeScript 封装示例

```typescript
import { spawn, ChildProcess } from 'child_process';

interface ResolveResult {
    success: boolean;
    type?: 'real' | 'virtual' | 'not_found';
    winPath?: string | null;
    children?: Array<{ name: string; type: string; is_virtual: boolean }> | null;
    error?: string;
}

interface ListDirResult {
    success: boolean;
    entries?: Array<{
        name: string;
        type: 'dir' | 'file';
        size: number;
        mtime: string;
        is_virtual?: boolean;
    }>;
    error?: string;
}

interface ToWindowsResult {
    success: boolean;
    winPath?: string;
    error?: string;
}

class AmsysClient {
    private proc: ChildProcess;
    private queue: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = [];
    private buffer = '';

    constructor(path: string = 'amsys.exe', user?: string) {
        const args = ['--pipe'];
        if (user) args.push('--user', user);
        this.proc = spawn(path, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: path.dirname(path),
        });
        this.proc.stdout!.on('data', (data: Buffer) => {
            this.buffer += data.toString();
            const lines = this.buffer.split('\n');
            this.buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.trim()) continue;
                const q = this.queue.shift();
                if (q) q.resolve(JSON.parse(line));
            }
        });
        this.proc.on('error', (err) => {
            for (const q of this.queue) q.reject(err);
            this.queue = [];
        });
    }

    private request<T>(cmd: string): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue.push({ resolve, reject });
            this.proc.stdin!.write(cmd + '\n');
        });
    }

    resolve(path: string): Promise<ResolveResult> {
        return this.request<ResolveResult>(`resolve ${path}`);
    }

    listDir(path: string): Promise<ListDirResult> {
        return this.request<ListDirResult>(`list_dir ${path}`);
    }

    toWindows(path: string): Promise<ToWindowsResult> {
        return this.request<ToWindowsResult>(`to_windows ${path}`);
    }

    close() {
        this.proc.kill();
    }
}

// 使用
const client = new AmsysClient();

async function browse(path: string) {
    const res = await client.resolve(path);
    if (res.type === 'virtual') {
        console.log('虚拟目录，子条目:', res.children);
    } else if (res.type === 'real') {
        const listing = await client.listDir(path);
        console.log('文件列表:', listing.entries);
    }
}

await browse('/media');
await browse('/home');
client.close();
```

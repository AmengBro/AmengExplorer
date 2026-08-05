const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const REQUEST_TIMEOUT_MS = 5000; // 5秒超时

function resolveExecutable(name) {
    // 1) 优先使用主进程解析的路径（支持 settings.json 的 amsysPath 动态配置）
    try {
        const electron = require('electron');
        if (electron && electron.ipcRenderer) {
            const configured = electron.ipcRenderer.sendSync('amsys-get-path', name);
            if (configured && fs.existsSync(configured)) return configured;
        }
    } catch (e) {
    }
    // 2) 打包模式：app.asar.unpacked
    if (__dirname.includes('app.asar')) {
        const unpackedDir = path.join(__dirname.split('app.asar')[0], 'app.asar.unpacked');
        const exePath = path.join(unpackedDir, name);
        if (fs.existsSync(exePath)) return exePath;
    }
    // 3) 开发模式：项目根
    return path.join(__dirname, '..', '..', name);
}

class AmsysClient {
    constructor(amsysPath = null) {
        if (!amsysPath) {
            amsysPath = resolveExecutable('amsys.exe');
        }
        this.amsysPath = amsysPath;
        this.execDir = path.dirname(amsysPath);
        // 用户上下文由 VirtualFileSystem 在解析出虚拟根并加载 users.toml 后设置
        this.currentUser = 'root';
        this.proc = null;
        this.queue = [];
        this.buffer = Buffer.alloc(0);
        this.init();
    }

    init() {
        const args = ['--pipe'];
        if (this.currentUser && this.currentUser !== 'root') {
            args.push('--user', this.currentUser);
        }
        
        console.log(`AmsysClient: spawning with user="${this.currentUser}"`);
        
        // config.ini 中的相对 root（如 ./root）是相对进程工作目录解析的，
        // 因此固定 cwd 为 amsys.exe 所在目录，保证打包/开发环境行为一致
        this.proc = spawn(this.amsysPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: this.execDir
        });

        this.proc.stdout.on('data', (data) => {
            this.buffer = Buffer.concat([this.buffer, data]);
            const utf8Str = this.buffer.toString('utf8');
            const lines = utf8Str.split('\n');
            const incomplete = lines.pop() || '';
            this.buffer = Buffer.from(incomplete, 'utf8');
            
            for (const line of lines) {
                if (!line.trim()) continue;
                const q = this.queue.shift();
                if (q) {
                    try {
                        q.resolve(JSON.parse(line));
                    } catch (e) {
                        console.error('AmsysClient: JSON parse error:', e);
                        q.reject(new Error('Invalid JSON response: ' + line));
                    }
                }
            }
        });

        this.proc.stderr.on('data', (data) => {
            console.error('AmsysClient stderr:', data.toString('utf8'));
        });

        this.proc.on('error', (err) => {
            console.error('AmsysClient error:', err);
            for (const q of this.queue) q.reject(err);
            this.queue = [];
        });

        this.proc.on('close', (code) => {
            console.log('AmsysClient closed with code:', code);
            // 拒绝所有挂起的请求
            for (const q of this.queue) {
                q.reject(new Error('AmsysClient process closed'));
            }
            this.queue = [];
            
            if (code !== 0 && code !== null) {
                console.log('AmsysClient: restarting...');
                setTimeout(() => {
                    this.init();
                }, 1000);
            }
        });
    }

    setUser(username) {
        if (this.currentUser === username) return;
        
        console.log(`AmsysClient: switching user from "${this.currentUser}" to "${username}"`);
        this.currentUser = username;
        
        // Kill current process and restart with new user
        if (this.proc && !this.proc.killed) {
            this.proc.kill();
        }
        setTimeout(() => {
            this.init();
        }, 200);
    }

    request(cmd, timeoutMs = REQUEST_TIMEOUT_MS) {
        return new Promise((resolve, reject) => {
            if (!this.proc || this.proc.killed) {
                this.init();
            }
            
            const request = { resolve, reject };
            this.queue.push(request);
            
            // 设置超时
            const timer = setTimeout(() => {
                const idx = this.queue.indexOf(request);
                if (idx !== -1) {
                    this.queue.splice(idx, 1);
                    reject(new Error('AmsysClient request timeout'));
                }
            }, timeoutMs);
            
            // 清除超时并解决
            const originalResolve = resolve;
            const originalReject = reject;
            request.resolve = (value) => {
                clearTimeout(timer);
                originalResolve(value);
            };
            request.reject = (err) => {
                clearTimeout(timer);
                originalReject(err);
            };
            
            this.proc.stdin.write(cmd + '\n');
        });
    }

    async resolve(path) {
        return this.request(`resolve ${path}`);
    }

    async listDir(path) {
        return this.request(`list_dir ${path}`);
    }

    async toWindows(path) {
        return this.request(`to_windows ${path}`);
    }

    close() {
        if (this.proc && !this.proc.killed) {
            this.proc.kill();
        }
    }
}

module.exports = AmsysClient;

const { spawn } = require('child_process');
const path = require('path');

class AmsysClient {
    constructor(amsysPath) {
        if (!amsysPath) {
            amsysPath = path.join(__dirname, '..', '..', 'amsys.exe');
        }
        this.amsysPath = amsysPath;
        this.proc = null;
        this.queue = [];
        this.buffer = Buffer.alloc(0);
        this.init();
    }

    init() {
        this.proc = spawn(this.amsysPath, ['--pipe'], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        this.proc.stdout.on('data', (data) => {
            this.buffer = Buffer.concat([this.buffer, data]);
            const utf8Str = this.buffer.toString('utf8');
            const lines = utf8Str.split('\n');
            const incomplete = lines.pop() || '';
            this.buffer = Buffer.from(incomplete, 'utf8');
            
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const q = this.queue.shift();
                    if (q) q.resolve(JSON.parse(line));
                } catch (e) {
                    console.error('AmsysClient: JSON parse error:', e);
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
        });
    }

    request(cmd) {
        return new Promise((resolve, reject) => {
            if (!this.proc || this.proc.killed) {
                this.init();
            }
            this.queue.push({ resolve, reject });
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
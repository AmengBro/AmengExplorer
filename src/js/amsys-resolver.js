const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// amsys 路径解析，优先级：
// settings.json 的 amsysPath > 内嵌 amsys 的 config.ini 中 amsys= 指向的外部 amsys > 内嵌 amsys
// ctx: { settingsPath(): string, embeddedDir(): string }
function createAmsysResolver(ctx) {
  function resolveConfiguredAmsysPath(name) {
    try {
      const settingsPath = ctx.settingsPath();
      if (fs.existsSync(settingsPath)) {
        const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (data.amsysPath) {
          const configured = data.amsysPath;
          if (fs.existsSync(configured)) {
            if (fs.statSync(configured).isDirectory()) {
              const inDir = path.join(configured, name);
              if (fs.existsSync(inDir)) return inDir;
            } else if (name === 'amsys.exe') {
              return configured;
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to resolve configured amsys path:', err);
    }
    return null;
  }

  function resolveEmbeddedAmsysPath(name) {
    const p = path.join(ctx.embeddedDir(), name);
    return fs.existsSync(p) ? p : null;
  }

  // 通过内嵌 amsys 读取其 config.ini 中 amsys= 指向的外部 amsys（如 amsys=/bin/com.amsys.app）
  async function resolveExternalAmsysFromConfig(name) {
    try {
      const iniPath = path.join(ctx.embeddedDir(), 'config.ini');
      if (!fs.existsSync(iniPath)) return null;
      const content = fs.readFileSync(iniPath, 'utf-8');
      const match = content.match(/^\s*amsys\s*=\s*(.+)$/m);
      if (!match) return null;
      const value = match[1].trim();
      if (!value) return null;

      // 绝对 Windows 路径
      if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')) {
        return fs.existsSync(value) ? value : null;
      }

      // 类 Unix 路径（如 /bin/com.amsys.app）：先拉起内嵌 amsys 解析成 Windows 路径
      const embedded = resolveEmbeddedAmsysPath('amsys.exe');
      if (!embedded) return null;
      const winPath = await resolveViaAmsysPipe(embedded, value);
      if (winPath) {
        // amsys 的相对 root 会返回相对路径（如 .\root\bin\...），按内嵌 amsys 目录归一化
        const abs = path.isAbsolute(winPath)
          ? winPath
          : path.resolve(path.dirname(embedded), winPath);
        if (fs.existsSync(abs)) return abs;
      }

      // 兜底：值本身就是存在的可执行文件
      if (fs.existsSync(value) && !fs.statSync(value).isDirectory()) return value;
    } catch (err) {
      console.error('resolveExternalAmsysFromConfig error:', err);
    }
    return null;
  }

  // 临时拉起内嵌 amsys，用 resolve 命令把类 Unix 路径翻译成 Windows 路径
  function resolveViaAmsysPipe(exePath, unixPath) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (val) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };
      try {
        const proc = spawn(exePath, ['--pipe'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: path.dirname(exePath)
        });
        const timer = setTimeout(() => {
          try { proc.kill(); } catch (e) {}
          done(null);
        }, 5000);
        let buf = Buffer.alloc(0);
        proc.stdout.on('data', (d) => {
          buf = Buffer.concat([buf, d]);
          const s = buf.toString('utf8');
          const lines = s.split('\n');
          buf = Buffer.from(lines.pop() || '', 'utf8');
          for (const line of lines) {
            if (!line.trim()) continue;
            clearTimeout(timer);
            try { proc.kill(); } catch (e) {}
            try {
              const r = JSON.parse(line);
              done(r && r.success && r.winPath ? r.winPath : null);
              return;
            } catch (e) {
              done(null);
              return;
            }
          }
        });
        proc.on('error', () => { clearTimeout(timer); done(null); });
        proc.stdin.write(`resolve ${unixPath}\n`);
      } catch (e) {
        done(null);
      }
    });
  }

  async function resolveAmsysPathAsync(name) {
    const configured = resolveConfiguredAmsysPath(name);
    if (configured) return configured;
    const external = await resolveExternalAmsysFromConfig(name);
    if (external) return external;
    return resolveEmbeddedAmsysPath(name);
  }

  return {
    resolveAmsysPathAsync,
    resolveConfiguredAmsysPath,
    resolveEmbeddedAmsysPath,
    resolveExternalAmsysFromConfig
  };
}

module.exports = { createAmsysResolver };

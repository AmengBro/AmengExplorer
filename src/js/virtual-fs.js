const AmsysClient = require('./amsys-client');

class VirtualFileSystem {
  constructor() {
    this.fs = require('fs');
    this.path = require('path');
    
    this.amsysClient = new AmsysClient();
    this.root_ = '';
    this.mounts_ = {};
    
    this.initConfig();
    this.init();
  }

  initConfig() {
    try {
      const configPath = this.path.join(__dirname, '..', '..', 'config.ini');
      if (this.fs.existsSync(configPath)) {
        const content = this.fs.readFileSync(configPath, 'utf-8');
        const match = content.match(/^\s*root\s*=\s*(.+)$/m);
        if (match) {
          this.root_ = match[1].trim();
          console.log('VirtualFileSystem: root from config:', this.root_);
        }
      }
    } catch (err) {
      console.error('VirtualFileSystem initConfig error:', err);
    }
  }

  async init() {
    try {
      if (!this.root_) {
        const result = await this.amsysClient.resolve('/');
        if (result.success && result.winPath) {
          this.root_ = result.winPath;
        } else {
          this.root_ = require('os').homedir() + '\\AmengExplorerRoot';
        }
      }
    } catch (err) {
      console.error('VirtualFileSystem init error:', err);
      if (!this.root_) {
        this.root_ = require('os').homedir() + '\\AmengExplorerRoot';
      }
    }
  }

  normalizeUnix(unixPath) {
    if (!unixPath) return '/';
    
    let p = unixPath.replace(/\\/g, '/');
    
    if (p[0] !== '/') {
      p = '/' + p;
    }
    
    const parts = p.split('/').filter(p => p);
    const result = [];
    
    for (const part of parts) {
      if (part === '.') continue;
      if (part === '..') {
        if (result.length > 0) {
          result.pop();
        }
      } else {
        result.push(part);
      }
    }
    
    if (result.length === 0) return '/';
    
    return '/' + result.join('/');
  }

  resolve(unixPath) {
    return this.normalizeUnix(unixPath);
  }

  async isVirtualDir(unixPath) {
    try {
      const result = await this.amsysClient.resolve(unixPath);
      return result.success && result.type === 'virtual';
    } catch (err) {
      return false;
    }
  }

  async listVirtualChildren(unixPath) {
    try {
      const result = await this.amsysClient.resolve(unixPath);
      if (result.success && result.type === 'virtual' && result.children) {
        return result.children.map(c => c.name);
      }
    } catch (err) {
    }
    return [];
  }

  async toWindows(unixPath) {
    try {
      const result = await this.amsysClient.toWindows(unixPath);
      if (result.success && result.winPath) {
        return result.winPath;
      }
    } catch (err) {
    }
    
    return '';
  }

  async toUnix(windowsPath) {
    let win = windowsPath.replace(/\//g, '\\');
    while (win.endsWith('\\')) {
      win = win.slice(0, -1);
    }
    
    if (!win) return '/';
    
    if (this.root_ && win.toLowerCase().startsWith(this.root_.toLowerCase())) {
      const suffix = win.substr(this.root_.length);
      const cleanSuffix = suffix.startsWith('\\') ? suffix.substr(1) : suffix;
      if (!cleanSuffix) return '/';
      return '/' + cleanSuffix.replace(/\\/g, '/');
    }
    
    const driveMatch = win.match(/^([A-Za-z]):\\(.*)$/);
    if (driveMatch) {
      const driveLetter = driveMatch[1].toLowerCase();
      const subPath = driveMatch[2] || '';
      if (subPath) {
        return '/media/' + driveLetter + '/' + subPath.replace(/\\/g, '/');
      }
      return '/media/' + driveLetter;
    }
    
    return '/';
  }

  async exists(unixPath) {
    try {
      const result = await this.amsysClient.resolve(unixPath);
      return result.success && result.type !== 'not_found';
    } catch (err) {
      return false;
    }
  }

  async stat(unixPath) {
    try {
      const result = await this.amsysClient.resolve(unixPath);
      if (result.success) {
        if (result.type === 'virtual') {
          return {
            isDirectory: () => true,
            isFile: () => false,
            size: 0,
            mtime: new Date()
          };
        }
        
        if (result.type === 'real') {
          let winPath = null;
          
          if (result.winPath) {
            winPath = result.winPath;
            try {
              if (this.fs.existsSync(winPath)) {
                return this.fs.statSync(winPath);
              }
            } catch (e) {
            }
          }
          
          winPath = this.unixToWindowsPath(unixPath);
          if (winPath) {
            try {
              return this.fs.statSync(winPath);
            } catch (fsErr) {
              console.warn('VirtualFileSystem stat: fs.statSync failed for:', winPath, 'error:', fsErr.message);
              // stat 失败（如系统锁定文件 pagefile.sys）时，
              // 根据路径名判断：有扩展名的大概率是文件，否则当作目录
              const lastSep = Math.max(winPath.lastIndexOf('\\'), winPath.lastIndexOf('/'));
              const baseName = lastSep >= 0 ? winPath.substring(lastSep + 1) : winPath;
              const hasExt = baseName.includes('.') && !baseName.startsWith('.');
              return {
                isDirectory: () => !hasExt,
                isFile: () => hasExt,
                size: 0,
                mtime: new Date()
              };
            }
          }
        }
      }
    } catch (err) {
      console.error('VirtualFileSystem stat error:', err);
    }
    
    throw new Error('File not found');
  }

  async readdir(unixPath) {
    try {
      const listResult = await this.amsysClient.listDir(unixPath);
      let entries = [];
      const nameIndex = new Map(); // lowercase name -> index in entries

      const addEntry = (entry) => {
        const key = entry.name.toLowerCase();
        const existingIdx = nameIndex.get(key);
        if (existingIdx !== undefined) {
          // 已存在，更新（resolve 数据更准确）
          entries[existingIdx] = {
            name: entry.name,
            type: entry.type,
            size: entry.size || entries[existingIdx].size || 0,
            mtime: entry.mtime || entries[existingIdx].mtime || '',
            is_virtual: entry.is_virtual === true || entries[existingIdx].is_virtual === true
          };
        } else {
          nameIndex.set(key, entries.length);
          entries.push({ ...entry });
        }
      };

      if (listResult.success && listResult.entries) {
        listResult.entries.forEach(e => addEntry({
          name: e.name,
          type: e.type === 'dir' ? 'dir' : 'file',
          size: e.size || 0,
          mtime: e.mtime || '',
          is_virtual: e.is_virtual === true
        }));
      }

      if (unixPath === '/') {
        if (!nameIndex.has('dev')) {
          addEntry({ name: 'dev', type: 'dir', size: 0, mtime: '', is_virtual: true });
        }
        if (!nameIndex.has('media')) {
          addEntry({ name: 'media', type: 'dir', size: 0, mtime: '', is_virtual: true });
        }
      }

      const resolveResult = await this.amsysClient.resolve(unixPath);
      if (resolveResult.success && resolveResult.children) {
        resolveResult.children.forEach(child => {
          addEntry({
            name: child.name,
            type: child.type === 'dir' ? 'dir' : 'file',
            size: child.size || 0,
            mtime: child.mtime || '',
            is_virtual: child.is_virtual === true
          });
        });
      }

      return entries;
    } catch (err) {
      console.error('VirtualFileSystem readdir error:', err);
    }

    return [];
  }

  async getFileSize(unixPath) {
    try {
      const resolveResult = await this.amsysClient.resolve(unixPath);
      
      if (resolveResult.success && resolveResult.type === 'real') {
        let winPath = null;
        
        if (resolveResult.winPath) {
          winPath = resolveResult.winPath;
          try {
            if (this.fs.existsSync(winPath)) {
              return this.fs.statSync(winPath).size;
            }
          } catch (e) {
          }
        }
        
        winPath = this.unixToWindowsPath(unixPath);
        if (winPath && this.fs.existsSync(winPath)) {
          return this.fs.statSync(winPath).size;
        }
      }
    } catch (err) {
      console.warn('VirtualFileSystem getFileSize error:', err);
    }
    
    return null;
  }

  unixToWindowsPath(unixPath) {
    if (!this.root_) return null;
    const clean = this.normalizeUnix(unixPath);
    if (clean === '/') return this.root_;
    const suffix = clean.replace(/^\//, '');
    return this.path.join(this.root_, suffix);
  }

  async isVirtualPath(unixPath) {
    try {
      const resolveResult = await this.amsysClient.resolve(unixPath);
      return resolveResult.success && resolveResult.type === 'virtual';
    } catch (err) {
      return false;
    }
  }

  async mkdir(unixPath) {
    try {
      const winPath = await this.toWindows(unixPath);
      if (winPath) {
        this.fs.mkdirSync(winPath, { recursive: true });
        return true;
      }
    } catch (err) {
      console.error('VirtualFileSystem mkdir error:', err);
    }
    
    return false;
  }

  async rmdir(unixPath) {
    try {
      const winPath = await this.toWindows(unixPath);
      if (winPath) {
        this.fs.rmdirSync(winPath, { recursive: true });
        return true;
      }
    } catch (err) {
      console.error('VirtualFileSystem rmdir error:', err);
    }
    
    return false;
  }

  async unlink(unixPath) {
    try {
      const winPath = await this.toWindows(unixPath);
      if (winPath) {
        this.fs.unlinkSync(winPath);
        return true;
      }
    } catch (err) {
      console.error('VirtualFileSystem unlink error:', err);
    }
    
    return false;
  }

  async copyFile(src, dest) {
    try {
      const srcWin = await this.toWindows(src);
      const destWin = await this.toWindows(dest);
      if (srcWin && destWin) {
        this.fs.copyFileSync(srcWin, destWin);
        return true;
      }
    } catch (err) {
      console.error('VirtualFileSystem copyFile error:', err);
    }
    
    return false;
  }

  async rename(oldPath, newPath) {
    try {
      const oldWin = await this.toWindows(oldPath);
      const newWin = await this.toWindows(newPath);
      if (oldWin && newWin) {
        this.fs.renameSync(oldWin, newWin);
        return true;
      }
    } catch (err) {
      console.error('VirtualFileSystem rename error:', err);
    }
    
    return false;
  }

  async readFile(unixPath, encoding = 'utf8') {
    try {
      const winPath = await this.toWindows(unixPath);
      if (winPath) {
        return this.fs.readFileSync(winPath, encoding);
      }
    } catch (err) {
      console.error('VirtualFileSystem readFile error:', err);
    }
    
    return null;
  }

  async writeFile(unixPath, data, encoding = 'utf8') {
    try {
      const winPath = await this.toWindows(unixPath);
      if (winPath) {
        this.fs.writeFileSync(winPath, data, encoding);
        return true;
      }
    } catch (err) {
      console.error('VirtualFileSystem writeFile error:', err);
    }
    
    return false;
  }

  async getMounts() {
    return this.mounts_;
  }

  async getRoot() {
    return this.root_;
  }

  close() {
    this.amsysClient.close();
  }
}

module.exports = VirtualFileSystem;
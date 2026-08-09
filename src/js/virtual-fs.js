const AmsysClient = require('./amsys-client');
const UserConfig = require('./user-config');
const path = require('path');

class VirtualFileSystem {
  constructor() {
    this.fs = require('fs');
    this.path = require('path');
    this.os = require('os');

    // 用户配置在 amsys 解析出虚拟根后加载（全部路径解析追随 amsys）
    this.userConfig = null;
    this.currentUser = 'root';
    // amsys 客户端在 init 中按解析出的路径（含外部 amsys）创建
    this.amsysClient = null;
    this.root_ = '';
    this.mounts_ = {};

    this.ready = this.init();
  }

  initUserPaths() {
    const winHomeBase = this.getWindowsHomeBasePath();

    this.userPaths = {
      home: this.userConfig.getHomePath(),
      desktop: this.userConfig.getDesktopPath(),
      documents: this.userConfig.getDocumentsPath(),
      downloads: this.userConfig.getDownloadsPath(),
      pictures: this.userConfig.getPicturesPath(),
      videos: this.userConfig.getVideosPath(),
      music: this.userConfig.getMusicPath(),
      recycleBin: this.userConfig.getRecycleBinPath(),
      // Windows 映射统一指向虚拟根，与 amsys 的列表解析保持一致
      windows: {
        home: winHomeBase,
        desktop: this.path.join(winHomeBase, 'Desktop'),
        documents: this.path.join(winHomeBase, 'Documents'),
        downloads: this.path.join(winHomeBase, 'Downloads'),
        pictures: this.path.join(winHomeBase, 'Pictures'),
        videos: this.path.join(winHomeBase, 'Videos'),
        music: this.path.join(winHomeBase, 'Music'),
        recycleBin: this.path.join(winHomeBase, 'Trash')
      }
    };

    // Automatically create user directories if they don't exist
    this.ensureUserDirectories();
  }

  ensureUserDirectories() {
    // 虚拟根尚未解析时先不创建目录，避免在错误位置留下空壳
    if (!this.root_) return;

    const windowsPaths = this.userPaths.windows;
    const dirsToCreate = [
      windowsPaths.home,
      windowsPaths.desktop,
      windowsPaths.documents,
      windowsPaths.downloads,
      windowsPaths.pictures,
      windowsPaths.videos,
      windowsPaths.music,
    ];

    for (const dir of dirsToCreate) {
      if (dir && !this.fs.existsSync(dir)) {
        try {
          this.fs.mkdirSync(dir, { recursive: true });
          console.log('VirtualFileSystem: created user directory:', dir);
        } catch (err) {
          console.warn('VirtualFileSystem: failed to create directory', dir, ':', err.message);
        }
      }
    }
  }

  switchUser(username) {
    if (this.currentUser === username) return;

    console.log(`VirtualFileSystem: switching user from "${this.currentUser}" to "${username}"`);
    this.currentUser = username;
    this.userConfig.setCurrentUser(username);
    this.amsysClient.setUser(username);
    this.initUserPaths();
  }

  getCurrentUser() {
    return this.currentUser;
  }

  getUserPaths() {
    return this.userPaths;
  }

  getWindowsHomeBasePath() {
    const rootBase = this.root_ || this.path.join(this.os.homedir(), 'AmengExplorerRoot');
    // 与 user-config 的 home 约定一致：root -> <root>\root，其他用户 -> <root>\home\<user>
    return this.currentUser === 'root'
      ? this.path.join(rootBase, 'root')
      : this.path.join(rootBase, 'home', this.currentUser);
  }

  getTrashWindowsPath() {
    return this.path.join(this.getWindowsHomeBasePath(), 'Trash');
  }

  getTrashPath() {
    const trashWin = this.getTrashWindowsPath();
    if (!this.fs.existsSync(trashWin)) {
      try {
        this.fs.mkdirSync(trashWin, { recursive: true });
      } catch (err) {
        console.warn('Failed to create trash directory:', err.message);
      }
    }
    const homeUnix = this.userPaths.home;
    const trashUnix = homeUnix === '/' ? `/${this.currentUser}/Trash` : homeUnix + '/Trash';
    return { win: trashWin, unix: trashUnix };
  }

  async init() {
    try {
      if (!this.amsysClient) {
        this.amsysClient = new AmsysClient(await AmsysClient.resolvePath('amsys.exe'));
      }
      if (!this.root_) {
        const result = await this.amsysClient.resolve('/');
        if (result.success && result.winPath) {
          // amsys 的 root 可能是相对路径（如 .\root\），相对其自身工作目录解析，
          // 归一化为绝对路径，避免受渲染进程 cwd 影响
          this.root_ = this.path.isAbsolute(result.winPath)
            ? result.winPath
            : this.path.resolve(this.amsysClient.execDir, result.winPath);
        } else {
          this.root_ = require('os').homedir() + '\\AmengExplorerRoot';
        }
      }

      // 用户配置完全以 amsys 解析出的虚拟根为准
      this.userConfig = new UserConfig(this.root_);
      this.currentUser = this.userConfig.getCurrentUser();
      if (this.currentUser !== 'root') {
        this.amsysClient.setUser(this.currentUser);
      }

      this.initUserPaths();
    } catch (err) {
      console.error('VirtualFileSystem init error:', err);
      if (!this.amsysClient) {
        try {
          this.amsysClient = new AmsysClient(null);
        } catch (e2) {
          console.error('VirtualFileSystem: failed to create amsys client:', e2);
        }
      }
      if (!this.root_) {
        this.root_ = require('os').homedir() + '\\AmengExplorerRoot';
      }
      this.userConfig = this.userConfig || new UserConfig(this.root_);
      this.currentUser = this.userConfig.getCurrentUser();
      this.initUserPaths();
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
    // First try user-specific path resolution
    const userWindowsPath = this.getUserWindowsPath(unixPath);
    if (userWindowsPath) {
      return userWindowsPath;
    }

    try {
      const result = await this.amsysClient.toWindows(unixPath);
      if (result.success && result.winPath) {
        return result.winPath;
      }
    } catch (err) {
    }

    return '';
  }

  getUserWindowsPath(unixPath) {
    if (!unixPath) return null;

    const paths = this.userPaths;
    const normalized = this.normalizeUnix(unixPath);

    // Check if path matches a user-specific path
    // More specific paths should be checked first
    const userPathMappings = [
      { unix: paths.recycleBin, windows: paths.windows.recycleBin },
      { unix: paths.desktop, windows: paths.windows.desktop },
      { unix: paths.documents, windows: paths.windows.documents },
      { unix: paths.downloads, windows: paths.windows.downloads },
      { unix: paths.pictures, windows: paths.windows.pictures },
      { unix: paths.videos, windows: paths.windows.videos },
      { unix: paths.music, windows: paths.windows.music },
      { unix: paths.home, windows: paths.windows.home },
    ];

    for (const mapping of userPathMappings) {
      if (normalized === mapping.unix || normalized.startsWith(mapping.unix + '/')) {
        const suffix = normalized.slice(mapping.unix.length);
        if (!suffix || suffix === '') {
          return mapping.windows;
        } else {
          return this.path.join(mapping.windows, suffix.replace(/\//g, '\\'));
        }
      }
    }

    return null;
  }

  async toUnix(windowsPath) {
    let win = windowsPath.replace(/\//g, '\\');
    while (win.endsWith('\\')) {
      win = win.slice(0, -1);
    }

    if (!win) return '/';

    // Check for user-specific paths first
    const userUnixPath = this.getUserUnixPath(win);
    if (userUnixPath) {
      return userUnixPath;
    }

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

  getUserUnixPath(windowsPath) {
    const paths = this.userPaths;
    const winLower = windowsPath.toLowerCase();

    const userPathMappings = [
      { windows: paths.windows.recycleBin, unix: paths.recycleBin },
      { windows: paths.windows.home, unix: paths.home },
      { windows: paths.windows.desktop, unix: paths.desktop },
      { windows: paths.windows.documents, unix: paths.documents },
      { windows: paths.windows.downloads, unix: paths.downloads },
      { windows: paths.windows.pictures, unix: paths.pictures },
      { windows: paths.windows.videos, unix: paths.videos },
      { windows: paths.windows.music, unix: paths.music },
    ];

    for (const mapping of userPathMappings) {
      if (!mapping.windows) continue;
      if (winLower === mapping.windows.toLowerCase() || winLower.startsWith(mapping.windows.toLowerCase() + '\\')) {
        const suffix = windowsPath.slice(mapping.windows.length);
        if (!suffix || suffix === '') {
          return mapping.unix;
        } else {
          return mapping.unix + suffix.replace(/\\/g, '/');
        }
      }
    }

    return null;
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
          if (result.path && result.path.isDir) {
            return {
              isDirectory: () => true,
              isFile: () => false,
              size: 0,
              mtime: new Date()
            };
          }

          const knownPaths = ['/', '/home', '/root', '/usr', '/tmp', '/media', '/mnt'];
          const normalized = this.normalizeUnix(unixPath);
          const isKnownVirtual = knownPaths.some(p => normalized === p || normalized.startsWith(p + '/'));

          if (!isKnownVirtual) {
            throw new Error('Virtual path not found: ' + unixPath);
          }

          let winPath = this.unixToWindowsPath(unixPath);
          if (winPath && this.fs.existsSync(winPath)) {
            return this.fs.statSync(winPath);
          }

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
            if (this.fs.existsSync(winPath)) {
              return this.fs.statSync(winPath);
            }
          }

          winPath = this.unixToWindowsPath(unixPath);
          if (winPath && this.fs.existsSync(winPath)) {
            return this.fs.statSync(winPath);
          }

          throw new Error('Path does not exist: ' + (winPath || unixPath));
        }
      }
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('not found') || msg.includes('does not exist') || msg.includes('Path does not exist')) {
        throw err;
      }
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
    // Try user-specific path first
    const userPath = this.getUserWindowsPath(unixPath);
    if (userPath) {
      return userPath;
    }

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

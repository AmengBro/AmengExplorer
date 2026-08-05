const fs = require('fs');
const path = require('path');

class UserConfig {
  // 虚拟根必须由调用方传入（来自 amsys 的 resolve /），程序不做自己的路径解析
  constructor(rootPath) {
    this.rootPath = rootPath || '';
    this.configPath = null;
    this.config = {
      current_user: 'root',
      users: {
        root: { permission: 'root' },
        AmengBro: { permission: 'sudo' }
      }
    };
    this.load();
  }

  load() {
    try {
      if (!this.rootPath) {
        console.warn('UserConfig: 未指定虚拟根路径，使用默认用户配置');
        return;
      }
      this.configPath = path.join(this.rootPath, 'etc', 'users.toml');

      if (fs.existsSync(this.configPath)) {
        this.parseTOML(fs.readFileSync(this.configPath, 'utf-8'));
        console.log('UserConfig: loaded from', this.configPath);
        console.log('UserConfig: current user =', this.config.current_user);
      } else {
        console.log('UserConfig: no config file found, using defaults');
        this.save();
      }
    } catch (err) {
      console.error('UserConfig load error:', err);
    }
  }

  setRootPath(rootPath) {
    if (!rootPath || rootPath === this.rootPath) return;
    this.rootPath = rootPath;
    this.configPath = null;
    this.load();
  }

  getRootPath() {
    return this.rootPath;
  }

  parseTOML(content) {
    const lines = content.split('\n');
    const users = {};
    let currentSection = null;
    // [global] current_user 的最终值，不被 [user.X] 段覆盖
    let currentUser = 'root';
    // 当前正在解析的 [user.X] 段用户名
    let sectionUser = 'root';

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Section header
      const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1];
        if (currentSection.startsWith('user.')) {
          sectionUser = currentSection.slice(5);
          if (!users[sectionUser]) {
            users[sectionUser] = { permission: 'user' };
          }
        }
        continue;
      }

      // Key-value pair
      const kvMatch = trimmed.match(/^([\w-]+)\s*=\s*(.+)$/);
      if (kvMatch && currentSection) {
        const key = kvMatch[1];
        let value = kvMatch[2].trim();
        
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        if (currentSection === 'global') {
          if (key === 'current_user') {
            currentUser = value;
          }
        } else if (currentSection.startsWith('user.')) {
          const username = currentSection.slice(5);
          if (!users[username]) {
            users[username] = { permission: 'user' };
          }
          if (key === 'permission') {
            users[username].permission = value;
          }
        }
      }
    }

    this.config = {
      current_user: currentUser,
      users: users
    };
  }

  generateTOML() {
    let content = '# Ameng User Configuration\n';
    content = '# Auto-generated - do not edit manually unless you know what you\'re doing\n\n';
    
    content += '[global]\n';
    content += `current_user = "${this.config.current_user}"\n\n`;

    for (const [username, data] of Object.entries(this.config.users)) {
      content += `[user.${username}]\n`;
      content += `permission = "${data.permission}"\n\n`;
    }

    return content;
  }

  save() {
    try {
      if (!this.rootPath) {
        console.warn('UserConfig: 未指定虚拟根路径，无法保存用户配置');
        return false;
      }
      if (!this.configPath) {
        this.configPath = path.join(this.rootPath, 'etc', 'users.toml');
      }

      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, this.generateTOML(), 'utf-8');
      console.log('UserConfig: saved to', this.configPath);
      return true;
    } catch (err) {
      console.error('UserConfig save error:', err);
    }
    return false;
  }

  getCurrentUser() {
    return this.config.current_user;
  }

  getCurrentUserPermission() {
    const userData = this.config.users[this.config.current_user];
    return userData ? userData.permission : 'user';
  }

  setCurrentUser(username) {
    if (!this.config.users[username]) {
      this.config.users[username] = { permission: 'user' };
    }
    this.config.current_user = username;
    this.save();
  }

  addUser(username, permission = 'user') {
    if (!this.config.users[username]) {
      this.config.users[username] = { permission };
      this.save();
      return true;
    }
    return false;
  }

  removeUser(username) {
    if (username === 'root') {
      console.warn('UserConfig: cannot remove root user');
      return false;
    }
    if (this.config.users[username]) {
      delete this.config.users[username];
      if (this.config.current_user === username) {
        this.config.current_user = 'root';
      }
      this.save();
      return true;
    }
    return false;
  }

  getUserPermission(username) {
    const userData = this.config.users[username];
    return userData ? userData.permission : 'user';
  }

  setUserPermission(username, permission) {
    if (this.config.users[username]) {
      this.config.users[username].permission = permission;
      this.save();
    }
  }

  listUsers() {
    return Object.keys(this.config.users);
  }

  // Virtual filesystem paths based on user
  // 类 Unix 主目录：root 特判为 /root，其余用户为 /home/<user>
  getHomeBasePath(username = null) {
    const user = username || this.config.current_user;
    return user === 'root' ? '/root' : `/home/${user}`;
  }

  getHomePath(username = null) {
    return this.getHomeBasePath(username);
  }

  getDesktopPath(username = null) {
    return `${this.getHomeBasePath(username)}/Desktop`;
  }

  getDocumentsPath(username = null) {
    return `${this.getHomeBasePath(username)}/Documents`;
  }

  getDownloadsPath(username = null) {
    return `${this.getHomeBasePath(username)}/Downloads`;
  }

  getPicturesPath(username = null) {
    return `${this.getHomeBasePath(username)}/Pictures`;
  }

  getVideosPath(username = null) {
    return `${this.getHomeBasePath(username)}/Videos`;
  }

  getMusicPath(username = null) {
    return `${this.getHomeBasePath(username)}/Music`;
  }

  getRecycleBinPath(username = null) {
    return `${this.getHomeBasePath(username)}/Trash`;
  }

}

module.exports = UserConfig;

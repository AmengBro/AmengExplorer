class FileManager {
  constructor() {
    this.vfs = new (require('./js/virtual-fs'))();
    this.os = require('os');
    this.icons = require('./js/icons');

    this.selectedItems = [];
    this.copyBuffer = [];
    this.copyMode = 'copy';

    this.currentView = 'list';
    this.leftPaneView = 'list';
    this.rightPaneView = 'list';
    this.infoPanelVisible = false;
    this.processPanelVisible = false;

    this.sortColumn = 'name';
    this.sortDirection = 'asc';

    this.tasks = [];
    this.taskIdCounter = 1;
    this.sizeCache = new Map();

    this.leftPaneFilter = this.createEmptyFilter();
    this.rightPaneFilter = this.createEmptyFilter();

    this.tabIdCounter = 1;
    this.currentTabId = 'tab-1';
    this.tabs = {};
    this.tabs['tab-1'] = {
      path: 'computer://mainmenu',
      history: ['computer://mainmenu'],
      historyIndex: 0
    };

    this.init();
  }

  init() {
    try { this.initTabs(); } catch(e) { console.error('initTabs failed:', e); }
    try { this.initFileBrowser(); } catch(e) { console.error('initFileBrowser failed:', e); }
    try { this.initContextMenu(); } catch(e) { console.error('initContextMenu failed:', e); }
    try { this.initCommandPalette(); } catch(e) { console.error('initCommandPalette failed:', e); }
    try { this.initInfoPanel(); } catch(e) { console.error('initInfoPanel failed:', e); }
    try { this.initKeyboardShortcuts(); } catch(e) { console.error('initKeyboardShortcuts failed:', e); }
    try { this.initViewButtons(); } catch(e) { console.error('initViewButtons failed:', e); }
    try { this.initSidebar(); } catch(e) { console.error('initSidebar failed:', e); }
    try { this.initFilterPanel(); } catch(e) { console.error('initFilterPanel failed:', e); }
    try { this.initLaunchpad(); } catch(e) { console.error('initLaunchpad failed:', e); }
    try { this.initSettings(); } catch(e) { console.error('initSettings failed:', e); }
    try { this.initVolumeLabels(); } catch(e) { console.error('initVolumeLabels failed:', e); }

    this.hideLoadingScreen();

    const showStartPage = () => {
      // 等待虚拟文件系统初始化 + 设置加载完成，再按“启动时打开”设置导航
      Promise.all([
        Promise.resolve(this.vfs.ready),
        Promise.resolve(this.settingsState && this.settingsState.settingsLoaded)
      ]).then(() => {
        const startPage = this.settings?.startPage || 'home';
        const userPaths = this.vfs.getUserPaths();
        let target = null;

        if (startPage === 'desktop') {
          target = userPaths.desktop;
        } else if (startPage === 'documents') {
          target = userPaths.documents;
        } else if (startPage === 'last') {
          target = this.settings?.lastDirectory || userPaths.home;
        }

        if (target) {
          this.loadDirectory(target);
        } else {
          this.showHome();
        }
      }).catch((err) => {
        console.error('vfs/settings init failed:', err);
        this.showHome();
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showStartPage);
    } else {
      showStartPage();
    }
  }

  hideLoadingScreen() {
    setTimeout(() => {
      const loadingScreen = document.getElementById('loading-screen');
      if (loadingScreen) {
        loadingScreen.classList.add('is-hidden');
        setTimeout(() => {
          loadingScreen.remove();
        }, 300);
      }
    }, 500);
  }

  initTabs() {
    document.getElementById('add-tab-btn').addEventListener('click', () => {
      this.createNewTab();
    });

    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        if (!e.target.closest('.tab-close')) {
          const tabId = tab.dataset.tabId;
          this.switchTab(tabId);
        }
      });

      const closeBtn = tab.querySelector('.tab-close');
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tabId = tab.dataset.tabId;
        this.closeTab(tabId);
      });
    });
  }

  createNewTab(initialPath = null) {
    this.tabIdCounter++;
    const newTabId = `tab-${this.tabIdCounter}`;

    const targetPath = initialPath || this.getCurrentTabPath() || '/';

    this.tabs[newTabId] = {
      path: targetPath,
      history: [targetPath],
      historyIndex: 0
    };

    const label = targetPath === '/' ? '主菜单' : targetPath.split('/').pop();

    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.dataset.tabId = newTabId;
    tab.innerHTML = `
      <div class="tab-icon">
        ${this.icons.desktop}
      </div>
      <span class="tab-label">${label}</span>
      <button class="tab-close" title="关闭标签页">
        ${this.icons.close}
      </button>
    `;

    const addBtn = document.getElementById('add-tab-btn');
    const tabBar = document.querySelector('.tab-bar');
    tabBar.insertBefore(tab, addBtn);

    tab.addEventListener('click', (e) => {
      if (!e.target.closest('.tab-close')) {
        this.switchTab(newTabId);
      }
    });

    const closeBtn = tab.querySelector('.tab-close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(newTabId);
    });

    this.switchTab(newTabId);
  }

  getCurrentTabPath() {
    return this.tabs[this.currentTabId]?.path || '/';
  }

  getCurrentTabHistory() {
    return this.tabs[this.currentTabId]?.history || ['/'];
  }

  getCurrentTabHistoryIndex() {
    return this.tabs[this.currentTabId]?.historyIndex || 0;
  }

  switchTab(tabId) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const tab = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (tab) {
      tab.classList.add('active');
      this.currentTabId = tabId;

      const tabState = this.tabs[tabId];
      if (tabState) {
        if (tabState.path === 'computer://mainmenu') {
          this.showHome();
        } else {
          this.loadDirectory(tabState.path, true);
        }
      }
    }
  }

  closeTab(tabId) {
    const tabs = document.querySelectorAll('.tab');
    if (tabs.length <= 1) return;

    const tab = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (tab) {
      tab.remove();

      delete this.tabs[tabId];

      if (tabId === this.currentTabId) {
        const remainingTabs = document.querySelectorAll('.tab');
        if (remainingTabs.length > 0) {
          this.switchTab(remainingTabs[0].dataset.tabId);
        }
      }
    }
  }

  initFileBrowser() {
    document.getElementById('browser-back-btn').addEventListener('click', () => {
      this.goBack();
    });

    document.getElementById('browser-forward-btn').addEventListener('click', () => {
      this.goForward();
    });

    document.getElementById('browser-up-btn').addEventListener('click', () => {
      this.goUp();
    });

    document.getElementById('browser-home-btn').addEventListener('click', () => {
      this.goHome();
    });

    document.getElementById('browser-refresh-btn').addEventListener('click', () => {
      this.refresh();
    });

    document.getElementById('address-bar-edit-btn').addEventListener('click', () => {
      this.editAddressBar();
    });

    document.getElementById('address-bar-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.navigateTo(this.addressBarInput.value);
        this.addressBarInput.readOnly = true;
      } else if (e.key === 'Escape') {
        this.addressBarInput.value = this.currentPath;
        this.addressBarInput.readOnly = true;
      }
    });

    document.getElementById('browser-new-file-btn').addEventListener('click', () => {
      this.createNewFile();
    });

    document.getElementById('browser-new-folder-btn').addEventListener('click', () => {
      this.createNewFolder();
    });

    document.getElementById('status-select-all-btn').addEventListener('click', () => {
      this.selectAll();
    });

    document.getElementById('status-deselect-btn').addEventListener('click', () => {
      this.deselectAll();
    });

    // 分层面板的全选/取消选择按钮
    document.querySelectorAll('.pane-select-all').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectAll(btn.dataset.pane);
      });
    });

    document.querySelectorAll('.pane-deselect').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deselectAll(btn.dataset.pane);
      });
    });

    // 绑定左右面板的事件
    const bindEvents = (listId, gridId) => {
      const list = document.getElementById(listId);
      if (list) {
        list.addEventListener('click', (e) => {
          const item = e.target.closest('.file-item');
          if (item) this.handleFileClick(item, e);
        });
        list.addEventListener('dblclick', (e) => {
          const item = e.target.closest('.file-item');
          if (item) this.handleFileDoubleClick(item);
        });
        list.addEventListener('contextmenu', (e) => {
          const item = e.target.closest('.file-item');
          if (item) {
            e.preventDefault();
            this.showContextMenu(e.clientX, e.clientY, item);
          }
        });
      }

      const grid = document.getElementById(gridId);
      if (grid) {
        grid.addEventListener('click', (e) => {
          const item = e.target.closest('.grid-item');
          if (item) this.handleFileClick(item, e);
        });
        grid.addEventListener('dblclick', (e) => {
          const item = e.target.closest('.grid-item');
          if (item) this.handleFileDoubleClick(item);
        });
        grid.addEventListener('contextmenu', (e) => {
          const item = e.target.closest('.grid-item');
          if (item) {
            e.preventDefault();
            this.showContextMenu(e.clientX, e.clientY, item);
          }
        });
      }
    };

    bindEvents('file-list-left', 'grid-container-left');
    bindEvents('file-list-right', 'grid-container-right');

    this.navBackBtn = document.getElementById('browser-back-btn');
    this.navForwardBtn = document.getElementById('browser-forward-btn');
    this.navUpBtn = document.getElementById('browser-up-btn');
    this.navHomeBtn = document.getElementById('browser-home-btn');
    this.navRefreshBtn = document.getElementById('browser-refresh-btn');
    this.navNewFileBtn = document.getElementById('browser-new-file-btn');
    this.navNewFolderBtn = document.getElementById('browser-new-folder-btn');

    this.navBackBtn.addEventListener('click', () => this.goBack());
    this.navForwardBtn.addEventListener('click', () => this.goForward());
    this.navUpBtn.addEventListener('click', () => this.goUp());
    this.navHomeBtn.addEventListener('click', () => this.goHome());
    this.navRefreshBtn.addEventListener('click', () => this.refresh());
    this.navNewFileBtn.addEventListener('click', () => this.createNewFile());
    this.navNewFolderBtn.addEventListener('click', () => this.createNewFolder());

    this.addressBarInput = document.getElementById('address-bar-input');
    this.fileList = document.getElementById('file-list-left') || document.getElementById('file-list');
    this.gridContainer = document.getElementById('grid-container-left') || document.getElementById('grid-container');
    this.statusText = document.querySelector('.status-text');

    // 绑定双面板控件事件
    this.initDualPaneControls();
  }

  initDualPaneControls() {
    // 当前活动面板（用户最近操作的面板）
    this.activePane = 'left';

    // 同步按钮
    const syncBtn = document.getElementById('sync-panes-btn');
    if (syncBtn) {
      syncBtn.addEventListener('click', () => {
        this.syncPanes();
      });
    }

    // 右侧面板历史（用于记录右侧面板的路径）
    this.rightPaneHistory = ['/'];
    this.rightPaneHistoryIndex = 0;

    // 左侧面板导航按钮
    const leftBackBtn = document.getElementById('pane-left-back');
    const leftForwardBtn = document.getElementById('pane-left-forward');
    const leftUpBtn = document.getElementById('pane-left-up');
    const leftHomeBtn = document.getElementById('pane-left-home');
    const leftRefreshBtn = document.getElementById('pane-left-refresh');
    const leftAddressInput = document.getElementById('pane-left-address');

    // 右侧面板导航按钮
    const rightBackBtn = document.getElementById('pane-right-back');
    const rightForwardBtn = document.getElementById('pane-right-forward');
    const rightUpBtn = document.getElementById('pane-right-up');
    const rightHomeBtn = document.getElementById('pane-right-home');
    const rightRefreshBtn = document.getElementById('pane-right-refresh');
    const rightAddressInput = document.getElementById('pane-right-address');
    const rightPane = document.getElementById('file-pane-right');
    const leftPane = document.getElementById('file-pane-left');

    // 标记右侧面板为活动面板
    const setRightActive = () => {
      this.activePane = 'right';
    };

    // 标记左侧面板为活动面板
    const setLeftActive = () => {
      this.activePane = 'left';
    };

    // 为右侧面板添加点击监听，标记为活动面板
    if (rightPane) {
      rightPane.addEventListener('mousedown', setRightActive);
    }

    // 为左侧面板添加点击监听，标记为活动面板
    if (leftPane) {
      leftPane.addEventListener('mousedown', setLeftActive);
    }

    // 左侧面板导航按钮事件绑定
    if (leftBackBtn) {
      leftBackBtn.addEventListener('click', () => {
        setLeftActive();
        // 使用主面板的历史
        const history = this.tabs[this.currentTabId]?.history || [];
        const historyIndex = this.tabs[this.currentTabId]?.historyIndex || 0;
        if (historyIndex > 0) {
          const newPath = history[historyIndex - 1];
          this.tabs[this.currentTabId].historyIndex = historyIndex - 1;
          this.loadDirectory(newPath);
        }
      });
    }

    if (leftForwardBtn) {
      leftForwardBtn.addEventListener('click', () => {
        setLeftActive();
        const history = this.tabs[this.currentTabId]?.history || [];
        const historyIndex = this.tabs[this.currentTabId]?.historyIndex || 0;
        if (historyIndex < history.length - 1) {
          const newPath = history[historyIndex + 1];
          this.tabs[this.currentTabId].historyIndex = historyIndex + 1;
          this.loadDirectory(newPath);
        }
      });
    }

    if (leftUpBtn) {
      leftUpBtn.addEventListener('click', () => {
        setLeftActive();
        const parentPath = this.getParentPath(this.currentPath);
        this.loadDirectory(parentPath);
      });
    }

    if (leftHomeBtn) {
      leftHomeBtn.addEventListener('click', () => {
        setLeftActive();
        this.goHome();
      });
    }

    if (leftRefreshBtn) {
      leftRefreshBtn.addEventListener('click', () => {
        setLeftActive();
        this.loadDirectory(this.currentPath);
      });
    }

    // 左侧地址栏事件绑定
    if (leftAddressInput) {
      leftAddressInput.addEventListener('focus', setLeftActive);
      leftAddressInput.addEventListener('keydown', (e) => {
        setLeftActive();
        if (e.key === 'Enter') {
          const newPath = leftAddressInput.value;
          this.loadDirectory(newPath);
          leftAddressInput.readOnly = true;
        } else if (e.key === 'Escape') {
          leftAddressInput.value = this.currentPath;
          leftAddressInput.readOnly = true;
        }
      });

      leftAddressInput.addEventListener('dblclick', () => {
        setLeftActive();
        leftAddressInput.readOnly = false;
        leftAddressInput.focus();
        leftAddressInput.select();
      });
    }

    if (rightBackBtn) {
      rightBackBtn.addEventListener('click', () => {
        setRightActive();
        if (this.rightPaneHistoryIndex > 0) {
          this.rightPaneHistoryIndex--;
          const path = this.rightPaneHistory[this.rightPaneHistoryIndex];
          this.loadRightPanel(path, false);
          if (rightAddressInput) rightAddressInput.value = path;
        }
      });
    }

    if (rightForwardBtn) {
      rightForwardBtn.addEventListener('click', () => {
        setRightActive();
        if (this.rightPaneHistoryIndex < this.rightPaneHistory.length - 1) {
          this.rightPaneHistoryIndex++;
          const path = this.rightPaneHistory[this.rightPaneHistoryIndex];
          this.loadRightPanel(path, false);
          if (rightAddressInput) rightAddressInput.value = path;
        }
      });
    }

    if (rightUpBtn) {
      rightUpBtn.addEventListener('click', () => {
        setRightActive();
        const currentPath = rightAddressInput?.value || '/';
        const parentPath = this.getParentPath(currentPath);
        this.loadRightPanel(parentPath);
        if (rightAddressInput) rightAddressInput.value = parentPath;
      });
    }

    if (rightHomeBtn) {
      rightHomeBtn.addEventListener('click', () => {
        setRightActive();
        this.loadRightPanel('/');
        if (rightAddressInput) rightAddressInput.value = '/';
      });
    }

    if (rightRefreshBtn) {
      rightRefreshBtn.addEventListener('click', () => {
        setRightActive();
        const currentPath = rightAddressInput?.value || '/';
        this.loadRightPanel(currentPath, false);
      });
    }

    // 右侧地址栏导航
    if (rightAddressInput) {
      rightAddressInput.addEventListener('focus', setRightActive);
      rightAddressInput.addEventListener('keydown', (e) => {
        setRightActive();
        if (e.key === 'Enter') {
          const newPath = rightAddressInput.value;
          this.loadRightPanel(newPath);
          rightAddressInput.readOnly = true;
        } else if (e.key === 'Escape') {
          rightAddressInput.value = this.rightPaneHistory[this.rightPaneHistoryIndex] || '/';
          rightAddressInput.readOnly = true;
        }
      });

      rightAddressInput.addEventListener('dblclick', () => {
        setRightActive();
        rightAddressInput.readOnly = false;
        rightAddressInput.focus();
        rightAddressInput.select();
      });
    }
  }

  async loadDirectory(dirPath, fromTabSwitch = false) {
    if (dirPath === 'computer://mainmenu') {
      this.showHome();
      return;
    }

    // 防并发：如果正在加载，取消之前的操作
    if (this._loadToken !== undefined) {
      this._loadCancelled = true;
    }
    const currentToken = Date.now();
    this._loadToken = currentToken;
    this._loadCancelled = false;

    const checkCancelled = () => {
      if (this._loadCancelled || this._loadToken !== currentToken) {
        throw new Error('cancelled');
      }
    };

    try {
      const stats = await this.vfs.stat(dirPath);
      checkCancelled();
      if (!stats || !stats.isDirectory()) {
        dirPath = this.getParentPath(dirPath);
      }
    } catch (err) {
      if (err.message === 'cancelled') return;
      console.error('loadDirectory: stat failed for:', dirPath, 'error:', err.message);
      this.showDialog('错误', `路径不存在或无法访问: ${dirPath}`, 'error');
      if (this.addressBarInput) {
        this.addressBarInput.value = this.currentPath || '/';
      }
      return;
    }

    this.showFileBrowser();

    this.currentPath = dirPath;
    if (this.addressBarInput) {
      this.addressBarInput.value = dirPath;
    }

    const leftAddressInput = document.getElementById('pane-left-address');
    if (leftAddressInput) {
      leftAddressInput.value = dirPath;
    }

    const leftListView = document.getElementById('file-list-view-left');
    const leftGridView = document.getElementById('file-grid-view-left');
    if (this.leftPaneView === 'list') {
      if (leftListView) leftListView.classList.remove('is-hidden');
      if (leftGridView) leftGridView.classList.add('is-hidden');
    } else if (this.leftPaneView === 'grid') {
      if (leftListView) leftListView.classList.add('is-hidden');
      if (leftGridView) leftGridView.classList.remove('is-hidden');
    }

    const tabState = this.tabs[this.currentTabId];
    if (tabState) {
      tabState.path = dirPath;
      if (!fromTabSwitch) {
        this.updateHistory(dirPath);
      }
    }

    try {
      const entries = await this.vfs.readdir(dirPath);
      checkCancelled();

      // 记录上次打开的目录（用于“启动时打开上次目录”）
      if (!dirPath.startsWith('computer://') && !dirPath.startsWith('/dev')) {
        this.settings = this.settings || {};
        this.settings.lastDirectory = dirPath;
        this.schedulePersistSettings();
      }

      const showHidden = this.settings?.showHidden === true;
      const files = entries.map(entry => ({
        name: entry.name,
        isDirectory: dirPath !== '/dev' && !dirPath.startsWith('/dev/') && entry.type === 'dir',
        size: entry.size || 0,
        mtime: entry.mtime || ''
      })).filter(f => f.name && (showHidden || !f.name.startsWith('.')));

      const sortedFiles = files.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name, 'zh-CN');
      });

      const totalCount = sortedFiles.length;
      this._leftPaneTotalCount = totalCount;
      const filteredFiles = this.applyFilter(sortedFiles, this.leftPaneFilter);

      const fileData = await this.renderFileList(filteredFiles, 'left', currentToken);
      checkCancelled();

      const visibleCount = filteredFiles.length;
      if (typeof this.updateStatusBar === 'function') {
        this.updateStatusBar(this.isFilterActive(this.leftPaneFilter) ? visibleCount : totalCount);
      }

      // 更新左侧面板状态条
      const leftStatusText = document.querySelector('#file-pane-left .pane-status-text');
      if (leftStatusText) {
        if (this.isFilterActive(this.leftPaneFilter)) {
          leftStatusText.textContent = `${visibleCount} / ${totalCount} 个项目 (已筛选)`;
        } else {
          leftStatusText.textContent = `${totalCount} 个项目`;
        }
      }

      const tab = document.querySelector(`[data-tab-id="${this.currentTabId}"]`);
      if (tab) {
        const label = tab.querySelector('.tab-label');
        if (label) {
          label.textContent = dirPath;
        }
      }

      // 自动计算子文件夹大小（500ms 超时，后台 worker 线程，不阻塞 UI）
      // 传当前 token 以便 autoCalc 完成后验证是否仍然有效
      const loadToken = currentToken;
      this.autoCalcSubfolderSizes(fileData, loadToken).catch(err =>
        console.error('auto calc subfolder sizes failed:', err)
      );

    } catch (err) {
      if (err.message === 'cancelled') return;
      console.error('Failed to read directory:', err);
      this.showDialog('错误', `无法读取目录: ${err.message}`, 'error');
    }
  }

  async renderFileList(files, pane = 'left', loadToken = null) {
    // 使用 token 检查是否已被取消（比 _loadCancelled 更可靠）
    if (loadToken !== null && this._loadToken !== loadToken) return [];
    if (this._loadCancelled) return [];

    const fileListLeft = document.getElementById('file-list-left');
    const fileListRight = document.getElementById('file-list-right');
    const gridContainerLeft = document.getElementById('grid-container-left');
    const gridContainerRight = document.getElementById('grid-container-right');

    if (pane === 'left') {
      if (fileListLeft) fileListLeft.innerHTML = '';
      if (gridContainerLeft) gridContainerLeft.innerHTML = '';
    } else if (pane === 'right') {
      if (fileListRight) fileListRight.innerHTML = '';
      if (gridContainerRight) gridContainerRight.innerHTML = '';
    }

    const isVirtualDir = await this.vfs.isVirtualPath(this.currentPath);

    // 再次检查 token 和取消状态
    if (loadToken !== null && this._loadToken !== loadToken) return [];
    if (this._loadCancelled) return [];

    const filePromises = files.map(async file => {
      const fullPath = this.joinPath(this.currentPath, file.name);
      const isVirtual = file.is_virtual === true || await this.vfs.isVirtualPath(fullPath);
      let size = file.size;
      let isDir = file.isDirectory;
      let isSymlink = false;

      if (!isVirtual) {
        try {
          const winPath = this.vfs.unixToWindowsPath(fullPath);
          if (winPath) {
            const fsMod = require('fs');
            try {
              // 先用 lstat 检查是否为符号链接
              const lstat = fsMod.lstatSync(winPath);
              if (lstat.isSymbolicLink()) {
                isSymlink = true;
                // 符号链接指向的目标是否为目录
                const stat = fsMod.statSync(winPath);
                isDir = stat.isDirectory();
                size = stat.size;
              } else {
                // 不是符号链接，按原逻辑处理
                if (!isDir) {
                  if (lstat.isDirectory()) {
                    isDir = true;
                  }
                }
                if (!isDir) {
                  size = lstat.size;
                }
              }
            } catch (e) {
              // lstat 失败时用原逻辑
              if (!isDir) {
                try {
                  const realStats = await this.vfs.stat(fullPath);
                  if (realStats && realStats.isDirectory && realStats.isDirectory()) {
                    isDir = true;
                  }
                } catch (e2) {
                }
              }
            }
          }
        } catch (e) {
        }
      }

      const stats = {
        isDirectory: () => isDir,
        isFile: () => !isDir,
        size: size,
        mtime: new Date(file.mtime || Date.now()),
        isVirtual: isVirtual,
        isSymbolicLink: isSymlink
      };

      return { file: { ...file, isDirectory: isDir, isSymlink: isSymlink }, fullPath, stats };
    });

    const fileData = await Promise.all(filePromises);

    // 在追加文件前检查 token 和取消状态
    if (loadToken !== null && this._loadToken !== loadToken) return [];
    if (this._loadCancelled) return [];

    // 在追加文件前再次清空容器，防止并发写入
    if (pane === 'left') {
      if (fileListLeft) fileListLeft.innerHTML = '';
      if (gridContainerLeft) gridContainerLeft.innerHTML = '';
    } else if (pane === 'right') {
      if (fileListRight) fileListRight.innerHTML = '';
      if (gridContainerRight) gridContainerRight.innerHTML = '';
    }

    fileData.forEach(({ file, fullPath, stats }) => {
      if (pane === 'left') {
        if (fileListLeft) {
          const item = this.createFileItem(file, fullPath, stats);
          fileListLeft.appendChild(item);
        }
        if (gridContainerLeft) {
          const gridItem = this.createGridItem(file, fullPath, stats);
          gridContainerLeft.appendChild(gridItem);
        }
      } else if (pane === 'right') {
        if (fileListRight) {
          const item = this.createFileItem(file, fullPath, stats);
          fileListRight.appendChild(item);
        }
        if (gridContainerRight) {
          const gridItem = this.createGridItem(file, fullPath, stats);
          gridContainerRight.appendChild(gridItem);
        }
      }
    });

    this.updateNavigationButtons();
    return fileData;
  }

  joinPath(base, name) {
    if (base === '/') return '/' + name;
    return base + '/' + name;
  }

  getParentPath(path) {
    if (path === '/') return '/';
    const parts = path.split('/').filter(p => p);
    parts.pop();
    return parts.length === 0 ? '/' : '/' + parts.join('/');
  }

  createFileItem(file, fullPath, stats) {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.dataset.path = fullPath;
    div.dataset.name = file.name;
    div.dataset.mtime = file.mtime || '';

    const isSymlink = stats.isSymbolicLink === true;
    let iconType;
    if (isSymlink && !file.isDirectory) {
      iconType = 'file-symlink';
    } else {
      iconType = file.isDirectory ? 'folder' : (fullPath.startsWith('/dev/') ? 'device' : 'file');
    }
    let iconSvg = this.getFileIcon(file, fullPath);

    const isDir = file.isDirectory;
    const fileSize = stats.size;
    const isVirtual = stats.isVirtual;

    let sizeDisplay;
    if (isVirtual) {
      sizeDisplay = '无';
    } else if (isDir) {
      // 检查缓存中是否已有计算结果（非符号链接的目录才计算大小）
      const cached = this.sizeCache.get(fullPath);
      if (cached) {
        if (cached.status === 'virtual') {
          sizeDisplay = '无';
        } else if (cached.status === 'ok') {
          sizeDisplay = '<span class="cached-size">' + cached.text + '</span>';
        }
      } else {
        // 初始显示"查看"，autoCalcSubfolderSizes 会异步更新为大小
        sizeDisplay = '<button class="file-item-size-btn" data-path="' + fullPath + '">查看</button>';
      }
    } else {
      sizeDisplay = fileSize > 0 ? this.formatFileSize(fileSize) : '无';
    }

    const date = stats.mtime.toLocaleString('zh-CN');
    const type = this.getFileType(file.name, isDir, isSymlink);

    div.innerHTML = `
      <div class="file-item-icon ${iconType}">${iconSvg}</div>
      <div class="file-item-name">${file.name}</div>
      <div class="file-item-type">${type}</div>
      <div class="file-item-size">${sizeDisplay}</div>
      <div class="file-item-date">${date}</div>
    `;

    if (isDir) {
      const sizeBtn = div.querySelector('.file-item-size-btn');
      if (sizeBtn) {
        sizeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const btn = e.target;
          if (btn.dataset.loading) return;

          btn.dataset.loading = 'true';
          btn.textContent = '计算中...';

          const result = await this.calculateDirectorySize(fullPath);

          // 更新所有面板中相同路径的按钮
          const allBtns = document.querySelectorAll(`.file-item-size-btn[data-path="${fullPath}"]`);

          if (result.status === 'virtual') {
            allBtns.forEach(b => {
              b.textContent = '无';
              delete b.dataset.loading;
            });
            this.sizeCache.set(fullPath, { status: 'virtual', text: '无' });
          } else if (result.status === 'error') {
            allBtns.forEach(b => {
              b.textContent = '错误';
              delete b.dataset.loading;
            });
            this.sizeCache.delete(fullPath);
          } else if (result.status === 'cancelled') {
            allBtns.forEach(b => {
              b.textContent = '查看';
              delete b.dataset.loading;
            });
            this.sizeCache.delete(fullPath);
          } else {
            const sizeText = this.formatFileSize(result.size);
            allBtns.forEach(b => {
              b.textContent = sizeText;
              b.classList.add('auto-calculated');
              delete b.dataset.loading;
            });
            this.sizeCache.set(fullPath, { status: 'ok', size: result.size, fileCount: result.fileCount, text: sizeText });
          }
        });
      }

      // 缓存的大小文本也可点击重新计算
      const cachedSize = div.querySelector('.cached-size');
      if (cachedSize) {
        cachedSize.style.cursor = 'pointer';
        cachedSize.title = '点击重新计算';
        cachedSize.addEventListener('click', async (e) => {
          e.stopPropagation();
          this.sizeCache.delete(fullPath);

          // 更新所有面板中的按钮
          const allBtns = document.querySelectorAll(`.file-item-size-btn[data-path="${fullPath}"]`);
          allBtns.forEach(b => {
            b.textContent = '计算中...';
          });

          try {
            const result = await this.calculateDirectorySize(fullPath);
            if (result.status === 'virtual') {
              allBtns.forEach(b => {
                b.textContent = '无';
                b.classList.remove('auto-calculated');
              });
              this.sizeCache.set(fullPath, { status: 'virtual', text: '无' });
            } else if (result.status === 'ok') {
              const sizeText = this.formatFileSize(result.size);
              allBtns.forEach(b => {
                b.textContent = sizeText;
                b.classList.add('auto-calculated');
              });
              this.sizeCache.set(fullPath, { status: 'ok', size: result.size, fileCount: result.fileCount, text: sizeText });
            }
          } catch {
            allBtns.forEach(b => {
              b.textContent = '查看';
            });
          }
        });
      }
    }

    return div;
  }

  createGridItem(file, fullPath, stats) {
    const div = document.createElement('div');
    div.className = 'grid-item';
    div.dataset.path = fullPath;
    div.dataset.name = file.name;
    div.dataset.mtime = file.mtime || '';

    const isSymlink = stats.isSymbolicLink === true;
    let iconType;
    if (isSymlink && !file.isDirectory) {
      iconType = 'file-symlink';
    } else {
      iconType = file.isDirectory ? 'folder' : (fullPath.startsWith('/dev/') ? 'device' : 'file');
    }
    let iconSvg = this.getFileIcon(file, fullPath);

    const isDir = file.isDirectory;
    const fileSize = stats.size;

    let sizeDisplay = '';
    if (!isDir) {
      sizeDisplay = this.formatFileSize(fileSize);
    }

    div.innerHTML = `
      <div class="grid-item-icon ${iconType}">${iconSvg}</div>
      <div class="grid-item-name">${file.name}</div>
      ${sizeDisplay ? `<div class="grid-item-size">${sizeDisplay}</div>` : ''}
    `;

    return div;
  }

  createColumnItem(file, fullPath, stats) {
    const div = document.createElement('div');
    div.className = 'column-item';
    div.dataset.path = fullPath;
    div.dataset.name = file.name;
    div.dataset.mtime = file.mtime || '';

    const isSymlink = stats.isSymbolicLink === true;
    let iconType;
    if (isSymlink && !file.isDirectory) {
      iconType = 'file-symlink';
    } else {
      iconType = file.isDirectory ? 'folder' : (fullPath.startsWith('/dev/') ? 'device' : 'file');
    }
    let iconSvg = this.getFileIcon(file, fullPath);

    const isDir = file.isDirectory;
    const fileSize = stats.size;
    const isVirtual = stats.isVirtual;

    let sizeDisplay;
    if (isVirtual) {
      sizeDisplay = '无';
    } else if (isDir) {
      const cached = this.sizeCache.get(fullPath);
      if (cached) {
        if (cached.status === 'virtual') {
          sizeDisplay = '无';
        } else if (cached.status === 'ok') {
          sizeDisplay = '<span class="cached-size">' + cached.text + '</span>';
        }
      } else {
        sizeDisplay = '<button class="column-item-size-btn" data-path="' + fullPath + '">...</button>';
      }
    } else {
      sizeDisplay = fileSize > 0 ? this.formatFileSize(fileSize) : '无';
    }

    const date = stats.mtime.toLocaleString('zh-CN');
    const type = this.getFileType(file.name, isDir, isSymlink);

    div.innerHTML = `
      <div class="column-item-cell name-cell">
        <div class="file-item-icon ${iconType}">${iconSvg}</div>
        <div class="file-item-name">${file.name}</div>
      </div>
      <div class="column-item-cell type-cell">${type}</div>
      <div class="column-item-cell size-cell">${sizeDisplay}</div>
      <div class="column-item-cell date-cell">${date}</div>
    `;

    if (isDir) {
      const sizeBtn = div.querySelector('.column-item-size-btn');
      if (sizeBtn) {
        sizeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const btn = e.target;
          if (btn.dataset.loading) return;

          btn.dataset.loading = 'true';
          btn.textContent = '计算中...';

          const result = await this.calculateDirectorySize(fullPath);
          if (result.status === 'virtual') {
            btn.textContent = '无';
            this.sizeCache.set(fullPath, { status: 'virtual', text: '无' });
          } else if (result.status === 'error') {
            btn.textContent = '错误';
            this.sizeCache.delete(fullPath);
          } else if (result.status === 'cancelled') {
            btn.textContent = '查看';
            this.sizeCache.delete(fullPath);
          } else {
            const sizeText = this.formatFileSize(result.size);
            btn.textContent = sizeText;
            this.sizeCache.set(fullPath, { status: 'ok', size: result.size, fileCount: result.fileCount, text: sizeText });
            this.loadDirectory(this.currentPath, true);
          }
          delete btn.dataset.loading;
        });
      }
    }

    return div;
  }

  getFileIcon(file, fullPath) {
    // 符号链接：目录用 Folder Link，文件用 Document Link
    if (file.isSymlink && file.isDirectory) {
      return this.icons.folderLink || this.icons.folder;
    }
    if (file.isSymlink) {
      return (this.icons.types && this.icons.types.lnk) || this.icons.file || '';
    }
    if (file.isDirectory) {
      return this.icons.folder;
    }
    if (fullPath && typeof fullPath === 'string' && fullPath.startsWith('/dev/')) {
      return this.icons.device;
    }

    // 正确提取扩展名：
    // - 有扩展名的文件（如 pagefile.sys、test.tar.gz）取最后一个点后的部分
    // - 无扩展名的文件（如 Makefile、Dockerfile）ext 为空字符串
    // - 以点开头的隐藏文件（如 .gitignore、.bashrc）视为无扩展名
    let ext = '';
    const name = file.name;
    if (name && typeof name === 'string') {
      const lastDot = name.lastIndexOf('.');
      if (lastDot > 0 && lastDot < name.length - 1) {
        ext = name.substring(lastDot + 1).toLowerCase();
      }
    }

    // 其余类型统一查 config/icons.json 的 _types 映射（扩展名 → Fluent 图标）
    const types = this.icons.types || {};
    return types[ext] || types.default || this.icons.file || '';
  }

  async calculateDirectorySize(dirPath) {
    const isVirtual = await this.vfs.isVirtualPath(dirPath);
    if (isVirtual) {
      return { status: 'virtual', size: 0, fileCount: 0 };
    }

    const winPath = await this.vfs.toWindows(dirPath);
    if (!winPath) {
      return { status: 'error', size: 0, fileCount: 0 };
    }

    const { ipcRenderer } = require('electron');

    const task = this.addTask('size', '计算文件夹大小', { targetPath: dirPath });
    const dirName = dirPath.split('/').pop();
    this.updateTask(task.id, {
      currentFile: '正在统计大小...',
      indeterminate: true
    });

    // 监听进度（按 taskId 过滤）
    const onProgress = (_, data) => {
      if (data.taskId !== task.id) return;
      this.updateTask(task.id, {
        progress: data.progress || 0,
        totalFiles: data.totalFiles || 0,
        completedFiles: data.completedFiles || 0,
        completedSize: data.completedSize || 0,
        currentFile: data.currentFile || '',
        indeterminate: !!data.indeterminate
      });
    };
    ipcRenderer.on('calc-size-progress', onProgress);

    try {
      const result = await ipcRenderer.invoke('calc-size', {
        dirPath: winPath,
        taskId: task.id
      });
      ipcRenderer.removeListener('calc-size-progress', onProgress);

      if (result.status === 'ok') {
        this.updateTask(task.id, {
          completedFiles: result.fileCount,
          completedSize: result.size,
          progress: 100,
          indeterminate: false
        });
        this.completeTask(task.id);
        return { status: 'ok', size: result.size, fileCount: result.fileCount };
      } else if (result.status === 'cancelled') {
        this.cancelTask(task.id);
        return { status: 'cancelled', size: 0, fileCount: 0 };
      } else {
        this.updateTask(task.id, {
          status: 'error',
          currentFile: '计算失败',
          indeterminate: false
        });
        return { status: 'error', size: 0, fileCount: 0 };
      }
    } catch (err) {
      ipcRenderer.removeListener('calc-size-progress', onProgress);
      this.updateTask(task.id, {
        status: 'error',
        currentFile: '计算失败: ' + (err.message || ''),
        indeterminate: false
      });
      return { status: 'error', size: 0, fileCount: 0 };
    }
  }

  // 快速计算子文件夹大小（带超时，不进任务面板，用于进入文件夹时自动计算）
  async calcSizeWithTimeout(dirPath, timeoutMs = 300) {
    const isVirtual = await this.vfs.isVirtualPath(dirPath);
    if (isVirtual) {
      return { status: 'virtual', size: 0, fileCount: 0 };
    }
    const winPath = await this.vfs.toWindows(dirPath);
    if (!winPath) {
      return { status: 'error', size: 0, fileCount: 0 };
    }

    const { ipcRenderer } = require('electron');
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ status: 'timeout' });
      }, timeoutMs);

      ipcRenderer.invoke('calc-size-quick', { dirPath: winPath, timeoutMs })
        .then(result => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        })
        .catch(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ status: 'error' });
        });
    });
  }

  // 并发控制：限制同时执行的异步任务数
  async runWithConcurrency(items, concurrency, asyncFn) {
    const results = [];
    let currentIndex = 0;

    async function runner() {
      while (currentIndex < items.length) {
        const index = currentIndex++;
        try {
          results[index] = await asyncFn(items[index], index);
        } catch (err) {
          results[index] = { status: 'error' };
        }
      }
    }

    const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => runner());
    await Promise.all(runners);

    return results;
  }

  // 进入文件夹后自动计算所有子文件夹大小（显示在任务列表中）
  async autoCalcSubfolderSizes(fileData, loadToken) {
    const subdirs = fileData.filter(({ file, stats }) =>
      file.isDirectory && !stats.isVirtual
    );

    if (subdirs.length === 0) return;

    // 取消之前正在进行的自动统计任务
    if (this._autoCalcTaskId) {
      const oldTask = this.tasks.find(t => t.id === this._autoCalcTaskId);
      if (oldTask && oldTask.status === 'running') {
        this.cancelTask(this._autoCalcTaskId);
      }
    }

    // 统一超时 300ms
    const timeoutMs = 300;

    // 并发数限制为 5
    const concurrency = Math.min(5, subdirs.length);

    // 创建任务显示在任务列表中
    const taskName = `自动统计 (${this.currentPath})`;
    const task = this.addTask('size', taskName, { targetPath: this.currentPath, autoRemove: true });
    task.totalFiles = subdirs.length;
    task.completedFiles = 0;
    this._autoCalcTaskId = task.id;
    this.renderTasks();

    // 记录发起时的路径，完成后验证是否仍然匹配（防止竞态）
    const calcPath = this.currentPath;

    // 使用并发限制执行计算，并跟踪进度
    const results = new Array(subdirs.length).fill(null);
    let completedCount = 0;
    let nextIndex = 0;
    const taskId = task.id;
    const updateTask = (updates) => this.updateTask(taskId, updates);
    const calcSize = (path) => this.calcSizeWithTimeout(path, timeoutMs);

    async function runner() {
      while (true) {
        // 检查是否被取消
        const currentTask = this.tasks.find(t => t.id === taskId);
        if (!currentTask || currentTask.cancelled) {
          break;
        }

        // 检查是否暂停
        if (currentTask.paused) {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        // 使用共享的 nextIndex 获取下一个索引
        const myIndex = nextIndex++;
        if (myIndex >= subdirs.length) break;

        const { fullPath } = subdirs[myIndex];

        // 更新当前正在处理的文件名
        const fileName = fullPath.split('/').pop() || fullPath;
        updateTask({ currentFile: fileName });

        try {
          results[myIndex] = await calcSize(fullPath);
        } catch (err) {
          results[myIndex] = { status: 'error' };
        }

        // 只有在结果成功写入后才增加计数
        if (results[myIndex]) {
          completedCount++;
          const progress = Math.min(100, Math.round((completedCount / subdirs.length) * 100));
          updateTask({
            completedFiles: completedCount,
            progress: progress
          });
        }
      }
    }

    const boundRunner = runner.bind(this);
    const runners = Array.from({ length: concurrency }, () => boundRunner());
    await Promise.all(runners);

    // 检查最终状态
    const finalTask = this.tasks.find(t => t.id === taskId);
    if (!finalTask || finalTask.cancelled) {
      return;
    }

    // 如果路径已改变，标记任务为取消
    if (loadToken !== undefined && this._loadToken !== loadToken) {
      this.cancelTask(taskId);
      return;
    }

    if (this.currentPath !== calcPath) {
      this.cancelTask(taskId);
      return;
    }

    // 检查是否被暂停（暂停时不标记完成，保持暂停状态）
    if (finalTask.status === 'paused') {
      return;
    }

    // 标记任务为完成
    this.completeTask(taskId);

    // 清除自动统计任务ID
    if (this._autoCalcTaskId === taskId) {
      this._autoCalcTaskId = null;
    }

    // 收集所有面板中的按钮（左侧和右侧）
    const fileLists = [
      document.getElementById('file-list-left'),
      document.getElementById('file-list-right')
    ].filter(el => el);

    const gridContainers = [
      document.getElementById('grid-container-left'),
      document.getElementById('grid-container-right')
    ].filter(el => el);

    const allSizeBtns = [];
    fileLists.forEach(list => {
      allSizeBtns.push(...list.querySelectorAll('.file-item-size-btn'));
    });
    gridContainers.forEach(grid => {
      allSizeBtns.push(...grid.querySelectorAll('.file-item-size-btn'));
    });

    results.forEach((result, i) => {
      if (!result) return;
      const { fullPath } = subdirs[i];
      const matchingBtns = allSizeBtns.filter(btn => btn.dataset.path === fullPath);

      if (matchingBtns.length === 0) return;

      matchingBtns.forEach(sizeBtn => {
        // 如果用户已经手动点击了按钮（正在计算中），不要覆盖
        if (sizeBtn.dataset.loading) return;

        if (result.status === 'ok') {
          const sizeText = this.formatFileSize(result.size);
          sizeBtn.textContent = sizeText;
          sizeBtn.classList.add('auto-calculated');
        } else if (result.status === 'virtual') {
          sizeBtn.textContent = '无';
        } else {
          // 超时或失败，改为"查看"让用户可以手动触发
          sizeBtn.textContent = '查看';
        }
      });

      // 缓存结果
      if (result.status === 'ok') {
        const sizeText = this.formatFileSize(result.size);
        this.sizeCache.set(fullPath, { status: 'ok', size: result.size, fileCount: result.fileCount, text: sizeText });
      } else if (result.status === 'virtual') {
        this.sizeCache.set(fullPath, { status: 'virtual', text: '无' });
      }
    });
  }

  // 右侧面板自动计算文件夹大小（显示在任务列表中）
  async autoCalcRightPanelSizes(fileData, loadToken) {
    const subdirs = fileData.filter(({ file, stats }) =>
      file.isDirectory && !stats.isVirtual
    );

    if (subdirs.length === 0) return;

    // 取消之前正在进行的右侧自动统计任务
    if (this._autoCalcRightTaskId) {
      const oldTask = this.tasks.find(t => t.id === this._autoCalcRightTaskId);
      if (oldTask && oldTask.status === 'running') {
        this.cancelTask(this._autoCalcRightTaskId);
      }
    }

    // 统一超时 300ms
    const timeoutMs = 300;

    // 并发数限制为 5
    const concurrency = Math.min(5, subdirs.length);

    // 创建任务显示在任务列表中
    const rightAddressInput = document.getElementById('pane-right-address');
    const rightPath = rightAddressInput?.value || '/';
    const taskName = `自动统计 (右: ${rightPath})`;
    const task = this.addTask('size', taskName, { targetPath: rightPath, autoRemove: true });
    task.totalFiles = subdirs.length;
    task.completedFiles = 0;
    this._autoCalcRightTaskId = task.id;
    this.renderTasks();

    // 记录发起时的路径，完成后验证是否仍然匹配
    const calcPath = rightPath;

    // 使用并发限制执行计算，并跟踪进度
    const results = new Array(subdirs.length).fill(null);
    let completedCount = 0;
    let nextIndex = 0;
    const taskId = task.id;
    const updateTask = (updates) => this.updateTask(taskId, updates);
    const calcSize = (path) => this.calcSizeWithTimeout(path, timeoutMs);

    async function runner() {
      while (true) {
        // 检查是否被取消
        const currentTask = this.tasks.find(t => t.id === taskId);
        if (!currentTask || currentTask.cancelled) {
          break;
        }

        // 检查是否暂停
        if (currentTask.paused) {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        // 使用共享的 nextIndex 获取下一个索引
        const myIndex = nextIndex++;
        if (myIndex >= subdirs.length) break;

        const { fullPath } = subdirs[myIndex];

        const fileName = fullPath.split('/').pop() || fullPath;
        updateTask({ currentFile: fileName });

        try {
          results[myIndex] = await calcSize(fullPath);
        } catch (err) {
          results[myIndex] = { status: 'error' };
        }

        // 只有在结果成功写入后才增加计数
        if (results[myIndex]) {
          completedCount++;
          const progress = Math.min(100, Math.round((completedCount / subdirs.length) * 100));
          updateTask({
            completedFiles: completedCount,
            progress: progress
          });
        }
      }
    }

    const boundRunner = runner.bind(this);
    const runners = Array.from({ length: concurrency }, () => boundRunner());
    await Promise.all(runners);

    // 检查最终状态
    const finalTask = this.tasks.find(t => t.id === taskId);
    if (!finalTask || finalTask.cancelled) {
      return;
    }

    const rightAddrEl = document.getElementById('pane-right-address');
    if (rightAddrEl && rightAddrEl.value !== calcPath) {
      this.cancelTask(taskId);
      return;
    }

    // 检查是否被暂停（暂停时不标记完成，保持暂停状态）
    if (finalTask.status === 'paused') {
      return;
    }

    // 标记任务为完成
    this.completeTask(taskId);

    // 清除自动统计任务ID
    if (this._autoCalcRightTaskId === taskId) {
      this._autoCalcRightTaskId = null;
    }

    // 只收集右侧面板的按钮
    const rightList = document.getElementById('file-list-right');
    const rightGrid = document.getElementById('grid-container-right');

    const rightSizeBtns = [];
    if (rightList) {
      rightSizeBtns.push(...rightList.querySelectorAll('.file-item-size-btn'));
    }
    if (rightGrid) {
      rightSizeBtns.push(...rightGrid.querySelectorAll('.file-item-size-btn'));
    }

    results.forEach((result, i) => {
      if (!result) return;
      const { fullPath } = subdirs[i];
      const matchingBtns = rightSizeBtns.filter(btn => btn.dataset.path === fullPath);

      if (matchingBtns.length === 0) return;

      matchingBtns.forEach(sizeBtn => {
        // 如果用户已经手动点击了按钮（正在计算中），不要覆盖
        if (sizeBtn.dataset.loading) return;

        if (result.status === 'ok') {
          const sizeText = this.formatFileSize(result.size);
          sizeBtn.textContent = sizeText;
          sizeBtn.classList.add('auto-calculated');
        } else if (result.status === 'virtual') {
          sizeBtn.textContent = '无';
        } else {
          // 超时或失败，改为"查看"让用户可以手动触发
          sizeBtn.textContent = '查看';
        }
      });

      // 缓存结果（左右面板共享缓存）
      if (result.status === 'ok') {
        const sizeText = this.formatFileSize(result.size);
        this.sizeCache.set(fullPath, { status: 'ok', size: result.size, fileCount: result.fileCount, text: sizeText });
      } else if (result.status === 'virtual') {
        this.sizeCache.set(fullPath, { status: 'virtual', text: '无' });
      }
    });
  }

  formatFileSize(bytes) {
    if (bytes === null || bytes === undefined || isNaN(bytes)) return '无';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  createEmptyFilter() {
    return {
      type: 'all',
      namePattern: '',
      dateRange: 'all',
      customTypes: []
    };
  }

  getTypeCategories() {
    return [
      { key: 'all', label: '所有类型' },
      { key: 'folder', label: '文件夹' },
      { key: 'image', label: '图片', exts: ['png','jpg','jpeg','gif','bmp','webp','tiff','tif','heic','raw','ico','svg','svgz'] },
      { key: 'video', label: '视频', exts: ['mp4','mkv','avi','mov','wmv','flv','webm','m4v','3gp'] },
      { key: 'audio', label: '音频', exts: ['mp3','wav','flac','aac','ogg','wma','m4a','opus','ape'] },
      { key: 'document', label: '文档', exts: ['pdf','doc','docx','docm','dotx','dotm','xls','xlsx','xlsm','xltx','xltm','xlsb','ppt','pptx','pptm','potx','potm','txt','log','text','rtf','md','markdown','mdx','csv','tsv'] },
      { key: 'code', label: '代码', exts: ['js','mjs','cjs','ts','tsx','mts','cts','css','scss','sass','less','styl','html','htm','xhtml','vue','svelte','py','pyw','pyx','ipynb','json','xml','xsl','xslt','wsdl','cpp','cxx','cc','hpp','hxx','hh','c','h','java','jsp','jspx','cs','csproj','go','mod','rs','php','phtml','sql','sqlite','db','mdb','accdb','sh','bash','zsh','fish','ksh','rb','rake','swift','kt','scala','dart','yml','yaml','toml','ini','cfg','conf','config'] },
      { key: 'archive', label: '压缩包', exts: ['zip','rar','7z','tar','gz','bz2','xz','zst','tgz','tbz2'] },
      { key: 'executable', label: '可执行', exts: ['exe','msi','com','bat','cmd','ps1','psm1'] },
      { key: 'font', label: '字体', exts: ['ttf','otf','woff','woff2','eot'] },
      { key: 'other', label: '其他' }
    ];
  }

  getTypeCategory(file) {
    if (file.isDirectory) return 'folder';
    const name = file.name || '';
    const lastDot = name.lastIndexOf('.');
    const ext = lastDot > 0 && lastDot < name.length - 1 ? name.substring(lastDot + 1).toLowerCase() : '';
    const categories = this.getTypeCategories();
    for (const cat of categories) {
      if (cat.exts && cat.exts.includes(ext)) return cat.key;
    }
    return 'other';
  }

  applyFilter(files, filter) {
    if (!filter) return files;
    let result = files;

    if (filter.type && filter.type !== 'all') {
      result = result.filter(f => {
        const cat = this.getTypeCategory(f);
        if (filter.type === 'folder') return cat === 'folder';
        if (filter.type === 'other') return cat === 'other';
        return cat === filter.type;
      });
    }

    if (filter.namePattern) {
      const pattern = filter.namePattern.toLowerCase();
      result = result.filter(f => f.name.toLowerCase().includes(pattern));
    }

    if (filter.dateRange && filter.dateRange !== 'all') {
      const now = Date.now();
      const dayMs = 86400000;
      result = result.filter(f => {
        if (!f.mtime) return true;
        const mtime = new Date(f.mtime).getTime();
        switch (filter.dateRange) {
          case 'today': return mtime >= now - dayMs;
          case '7days': return mtime >= now - 7 * dayMs;
          case '30days': return mtime >= now - 30 * dayMs;
          case 'thismonth': {
            const d = new Date();
            const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
            return mtime >= start;
          }
          case 'thisyear': {
            const d = new Date();
            return mtime >= new Date(d.getFullYear(), 0, 1).getTime();
          }
          default: return true;
        }
      });
    }

    return result;
  }

  isFilterActive(filter) {
    if (!filter) return false;
    if (filter.type && filter.type !== 'all') return true;
    if (filter.namePattern && filter.namePattern.trim()) return true;
    if (filter.dateRange && filter.dateRange !== 'all') return true;
    return false;
  }

  initFilterPanel() {
    const filterBtn = document.getElementById('browser-filter-btn');
    const filterPanel = document.getElementById('filter-panel');
    if (!filterBtn || !filterPanel) return;

    const rightPane = document.getElementById('file-pane-right');
    const paneSelect = document.getElementById('filter-pane-select');
    const typeSelect = document.getElementById('filter-type-select');
    const nameInput = document.getElementById('filter-name-input');
    const dateSelect = document.getElementById('filter-date-select');
    const clearBtn = document.getElementById('filter-clear-btn');
    const closeBtn = document.getElementById('filter-panel-close');

    // 更新面板中当前激活的筛选状态
    const updatePanelState = () => {
      const isSplitView = rightPane && !rightPane.classList.contains('is-hidden');
      const pane = isSplitView ? this.activePane : 'left';
      const filter = pane === 'left' ? this.leftPaneFilter : this.rightPaneFilter;

      if (paneSelect) {
        paneSelect.disabled = !isSplitView;
        paneSelect.value = pane;
      }
      if (typeSelect) typeSelect.value = filter.type || 'all';
      if (nameInput) nameInput.value = filter.namePattern || '';
      if (dateSelect) dateSelect.value = filter.dateRange || 'all';

      filterBtn.classList.toggle('active', this.isFilterActive(this.leftPaneFilter) || this.isFilterActive(this.rightPaneFilter));
    };

    // 根据面板当前筛选状态重新加载
    const applyFilter = () => {
      const isSplitView = rightPane && !rightPane.classList.contains('is-hidden');
      const pane = isSplitView ? this.activePane : 'left';
      if (pane === 'left') {
        this.loadDirectory(this.currentPath, false);
      } else {
        this.loadRightPanel(this.currentPath, false);
      }
    };

    // 切换面板显示
    filterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      filterPanel.classList.toggle('is-hidden');
      if (!filterPanel.classList.contains('is-hidden')) {
        updatePanelState();
      }
    });

    // 关闭按钮
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        filterPanel.classList.add('is-hidden');
      });
    }

    // 点击面板外部关闭
    document.addEventListener('click', (e) => {
      if (!filterPanel.classList.contains('is-hidden')) {
        if (!filterPanel.contains(e.target) && !filterBtn.contains(e.target)) {
          filterPanel.classList.add('is-hidden');
        }
      }
    });

    // ESC 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !filterPanel.classList.contains('is-hidden')) {
        filterPanel.classList.add('is-hidden');
      }
    });

    // 面板切换
    if (paneSelect) {
      paneSelect.addEventListener('change', (e) => {
        this.activePane = e.target.value;
        updatePanelState();
      });
    }

    // 类型筛选
    if (typeSelect) {
      typeSelect.addEventListener('change', (e) => {
        const isSplitView = rightPane && !rightPane.classList.contains('is-hidden');
        const pane = isSplitView ? this.activePane : 'left';
        const filter = pane === 'left' ? this.leftPaneFilter : this.rightPaneFilter;
        filter.type = e.target.value;
        applyFilter();
      });
    }

    // 名称筛选（防抖）
    if (nameInput) {
      let debounceTimer;
      nameInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const isSplitView = rightPane && !rightPane.classList.contains('is-hidden');
          const pane = isSplitView ? this.activePane : 'left';
          const filter = pane === 'left' ? this.leftPaneFilter : this.rightPaneFilter;
          filter.namePattern = e.target.value;
          applyFilter();
        }, 250);
      });
    }

    // 日期筛选
    if (dateSelect) {
      dateSelect.addEventListener('change', (e) => {
        const isSplitView = rightPane && !rightPane.classList.contains('is-hidden');
        const pane = isSplitView ? this.activePane : 'left';
        const filter = pane === 'left' ? this.leftPaneFilter : this.rightPaneFilter;
        filter.dateRange = e.target.value;
        applyFilter();
      });
    }

    // 清除筛选
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        const isSplitView = rightPane && !rightPane.classList.contains('is-hidden');
        const pane = isSplitView ? this.activePane : 'left';
        const filter = pane === 'left' ? this.leftPaneFilter : this.rightPaneFilter;
        Object.assign(filter, this.createEmptyFilter());
        updatePanelState();
        applyFilter();
      });
    }
  }

  getFileType(name, isDir = false, isSymlink = false) {
    if (isSymlink) {
      return isDir ? '符号链接 (目录)' : '符号链接';
    }
    if (isDir) return '文件夹';
    const dotIndex = name.lastIndexOf('.');
    const ext = dotIndex !== -1 ? name.substr(dotIndex).toLowerCase() : '';
    const types = {
      '.txt': '文本文件',
      '.md': 'Markdown文件',
      '.js': 'JavaScript文件',
      '.ts': 'TypeScript文件',
      '.html': 'HTML文件',
      '.css': 'CSS文件',
      '.json': 'JSON文件',
      '.png': 'PNG图片',
      '.jpg': 'JPEG图片',
      '.jpeg': 'JPEG图片',
      '.gif': 'GIF图片',
      '.svg': 'SVG图片',
      '.pdf': 'PDF文档',
      '.doc': 'Word文档',
      '.docx': 'Word文档',
      '.xls': 'Excel表格',
      '.xlsx': 'Excel表格',
      '.ppt': 'PowerPoint演示',
      '.pptx': 'PowerPoint演示',
      '.zip': '压缩文件',
      '.rar': 'RAR压缩文件',
      '.7z': '7z压缩文件',
      '.exe': '可执行文件',
      '.dll': '动态链接库',
      '.bat': '批处理文件',
      '.cmd': '命令文件',
      '.lnk': '快捷方式',
      '.url': 'URL快捷方式',
    };
    return types[ext] || '文件';
  }

  handleFileClick(item, e) {
    if (e.ctrlKey || e.metaKey) {
      if (item.classList.contains('selected')) {
        item.classList.remove('selected');
        this.selectedItems = this.selectedItems.filter(p => p !== item.dataset.path);
      } else {
        item.classList.add('selected');
        this.selectedItems.push(item.dataset.path);
      }
    } else {
      this.deselectAll();
      item.classList.add('selected');
      this.selectedItems = [item.dataset.path];
    }

    this.updateInfoPanel(item.dataset.path);

    // “单击打开”模式（关闭双击打开时，单击选中后直接打开）
    if (!e.ctrlKey && !e.metaKey && this.settings?.doubleClick === false) {
      this.handleFileDoubleClick(item);
    }
  }

  async handleFileDoubleClick(item) {
    const fullPath = item.dataset.path;
    try {
      if (fullPath.startsWith('/dev/')) {
        this.openFile(fullPath);
        return;
      }

      const stats = await this.vfs.stat(fullPath);

      if (stats && stats.isDirectory()) {
        // 检查点击的是哪个面板的文件项
        const parentList = item.closest('.file-list');
        const parentGrid = item.closest('.grid-container');
        const isRightPanel = (parentList && parentList.id === 'file-list-right') ||
                            (parentGrid && parentGrid.id === 'grid-container-right');

        if (isRightPanel) {
          // 右侧面板双击文件夹，更新右侧
          this.loadRightPanel(fullPath);
        } else {
          // 左侧面板双击文件夹，更新左侧
          this.loadDirectory(fullPath);
        }
      } else {
        this.openFile(fullPath);
      }
    } catch (err) {
      console.error('handleFileDoubleClick error:', err);
      this.showDialog('错误', `无法访问文件: ${err.message}`, 'error');
    }
  }

  async openFile(filePath) {
    if (filePath.startsWith('/dev/')) {
      this.showDialog('提示', '该设备文件的打开方式暂未实现', 'info');
      return;
    }

    const winPath = await this.vfs.toWindows(filePath);
    const { shell } = require('electron');
    shell.openPath(winPath || filePath).catch(err => {
      console.error('Failed to open file:', err);
      this.showDialog('错误', `无法打开文件: ${err.message}`, 'error');
    });
  }

  goBack() {
    const tabState = this.tabs[this.currentTabId];
    if (!tabState) return;

    if (tabState.historyIndex > 0) {
      tabState.historyIndex--;
      this.loadDirectory(tabState.history[tabState.historyIndex]);
    }
  }

  goForward() {
    const tabState = this.tabs[this.currentTabId];
    if (!tabState) return;

    if (tabState.historyIndex < tabState.history.length - 1) {
      tabState.historyIndex++;
      this.loadDirectory(tabState.history[tabState.historyIndex]);
    }
  }

  goUp() {
    const parentDir = this.getParentPath(this.currentPath);
    if (parentDir !== this.currentPath) {
      this.loadDirectory(parentDir);
    }
  }

  goHome() {
    this.showHome();
  }

  showHome() {
    console.log('showHome() called');

    // 如果在分栏视图中，先关闭分栏
    const rightPane = document.getElementById('file-pane-right');
    const divider = document.getElementById('pane-divider');
    const isSplitView = rightPane && !rightPane.classList.contains('is-hidden');

    if (isSplitView) {
      // 保存右侧面板路径信息用于后续恢复
      this.savedRightPanePath = this.currentRightPanePath || this.currentPath;
      // 关闭分栏视图
      rightPane.classList.add('is-hidden');
      if (divider) divider.classList.add('is-hidden');
      const columnBtn = document.getElementById('view-column-btn');
      columnBtn?.classList.remove('active');

      // 恢复顶栏显示
      const navControls = document.getElementById('toolbar-nav-controls');
      const addressBar = document.getElementById('file-browser-address-bar');
      const topListViewBtn = document.getElementById('view-list-btn');
      const topGridViewBtn = document.getElementById('view-grid-btn');
      const syncControls = document.getElementById('toolbar-sync-controls');
      if (navControls) navControls.classList.remove('is-hidden');
      if (addressBar) addressBar.classList.remove('is-hidden');
      if (topListViewBtn) topListViewBtn.classList.remove('is-hidden');
      if (topGridViewBtn) topGridViewBtn.classList.remove('is-hidden');
      if (syncControls) syncControls.classList.add('is-hidden');

      // 隐藏子控件 header
      const leftPaneHeader = document.querySelector('#file-pane-left .pane-header');
      const rightPaneHeader = document.querySelector('#file-pane-right .pane-header');
      if (leftPaneHeader) leftPaneHeader.classList.add('is-hidden');
      if (rightPaneHeader) rightPaneHeader.classList.add('is-hidden');
    }

    this.currentPath = 'computer://mainmenu';

    const tabState = this.tabs[this.currentTabId];
    if (tabState) {
      tabState.path = 'computer://mainmenu';
      tabState.history = ['computer://mainmenu'];
      tabState.historyIndex = 0;
    }

    const homePage = document.getElementById('home-page');
    const fileBrowserContent = document.getElementById('file-browser-content');
    const tabBar = document.querySelector('.tab-bar');
    const fileBrowserToolbar = document.querySelector('.file-browser-toolbar');
    const fileBrowserStatusBar = document.getElementById('file-browser-status-bar');
    const navigatorToolbar = document.querySelector('.navigator-toolbar-actions');
    const globalStatusBar = document.getElementById('file-browser-status-bar');
    const leftPaneStatusBar = document.querySelector('#file-pane-left .pane-status-bar');
    const rightPaneStatusBar = document.querySelector('#file-pane-right .pane-status-bar');

    console.log('showHome: homePage element:', homePage);

    if (homePage) homePage.classList.remove('is-hidden');
    if (fileBrowserContent) fileBrowserContent.classList.add('is-hidden');
    if (tabBar) tabBar.classList.remove('is-hidden');
    if (fileBrowserToolbar) fileBrowserToolbar.classList.remove('is-hidden');
    if (fileBrowserStatusBar) fileBrowserStatusBar.classList.add('is-hidden');
    if (navigatorToolbar) navigatorToolbar.classList.add('is-hidden');

    // 单面板视图：显示全局底栏，隐藏面板底栏
    if (globalStatusBar) globalStatusBar.classList.remove('is-hidden');
    if (leftPaneStatusBar) leftPaneStatusBar.classList.add('is-hidden');
    if (rightPaneStatusBar) rightPaneStatusBar.classList.add('is-hidden');

    const tab = document.querySelector(`[data-tab-id="${this.currentTabId}"]`);
    if (tab) {
      const label = tab.querySelector('.tab-label');
      if (label) {
        label.textContent = '主菜单';
      }
    }

    if (this.addressBarInput) {
      this.addressBarInput.value = 'computer://mainmenu';
    }

    console.log('showHome: calling renderUserDirectories()');
    this.renderUserDirectories();

    console.log('showHome: calling renderDrives()');
    this.renderDrives();
  }

  showFileBrowser() {
    const homePage = document.getElementById('home-page');
    const fileBrowserContent = document.getElementById('file-browser-content');
    const addressBar = document.querySelector('.file-browser-address-bar');
    const tabBar = document.querySelector('.tab-bar');
    const fileBrowserToolbar = document.querySelector('.file-browser-toolbar');
    const globalStatusBar = document.getElementById('file-browser-status-bar');
    const navigatorToolbar = document.querySelector('.navigator-toolbar-actions');
    const rightPane = document.getElementById('file-pane-right');
    const isSplitView = rightPane && !rightPane.classList.contains('is-hidden');
    const leftPaneStatusBar = document.querySelector('#file-pane-left .pane-status-bar');
    const rightPaneStatusBar = document.querySelector('#file-pane-right .pane-status-bar');

    if (homePage) homePage.classList.add('is-hidden');
    if (fileBrowserContent) fileBrowserContent.classList.remove('is-hidden');
    if (addressBar && !isSplitView) addressBar.classList.remove('is-hidden');
    if (tabBar) tabBar.classList.remove('is-hidden');
    if (fileBrowserToolbar) fileBrowserToolbar.classList.remove('is-hidden');
    if (navigatorToolbar) navigatorToolbar.classList.remove('is-hidden');

    // 根据分栏状态初始化底栏
    if (isSplitView) {
      // 分栏视图：隐藏全局底栏，显示各面板底栏
      if (globalStatusBar) globalStatusBar.classList.add('is-hidden');
      if (leftPaneStatusBar) leftPaneStatusBar.classList.remove('is-hidden');
      if (rightPaneStatusBar) rightPaneStatusBar.classList.remove('is-hidden');
    } else {
      // 单面板视图：显示全局底栏，隐藏面板底栏
      if (globalStatusBar) globalStatusBar.classList.remove('is-hidden');
      if (leftPaneStatusBar) leftPaneStatusBar.classList.add('is-hidden');
      if (rightPaneStatusBar) rightPaneStatusBar.classList.add('is-hidden');
    }
  }

  renderUserDirectories() {
    const grid = document.getElementById('user-directories-grid');
    if (!grid) return;

    const userPaths = this.vfs.getUserPaths();

    const directories = [
      { name: '首页', path: userPaths.home, icon: 'home' },
      { name: '桌面', path: userPaths.desktop, icon: 'desktop' },
      { name: '下载', path: userPaths.downloads, icon: 'download' },
      { name: '文件', path: userPaths.documents, icon: 'folder' },
      { name: '图片', path: userPaths.pictures, icon: 'image' },
      { name: '视频', path: userPaths.videos, icon: 'video' },
      { name: '音乐', path: userPaths.music, icon: 'music' },
      { name: '回收站', path: userPaths.recycleBin, icon: 'trash' },
    ];

    grid.innerHTML = directories.map(dir => `
      <div class="user-directory-card" data-path="${dir.path}">
        <div class="user-directory-card__icon">
          ${this.getDirectoryIcon(dir.icon)}
        </div>
        <div class="user-directory-card__info">
          <div class="user-directory-card__name">${dir.name}</div>
          <div class="user-directory-card__path">${dir.path}</div>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('.user-directory-card').forEach(card => {
      card.addEventListener('click', () => {
        const path = card.dataset.path;
        this.loadDirectory(path);
      });
    });
  }

  getUserPermissionText() {
    if (!this.vfs.userConfig) return '';
    const perm = this.vfs.userConfig.getCurrentUserPermission();
    const permMap = {
      'root': 'root',
      'sudo': '管理员',
      'user': '普通用户'
    };
    return permMap[perm] || 'user';
  }

  switchUser(username) {
    if (!username || username === this.vfs.getCurrentUser()) return;

    console.log('App: switching to user', username);
    this.vfs.switchUser(username);
    this.renderUserDirectories();
  }

  showUserSwitcher() {
    if (!this.vfs.userConfig) {
      alert('系统初始化中，请稍候再试');
      return;
    }
    const users = this.vfs.userConfig.listUsers();
    const currentUser = this.vfs.getCurrentUser();

    // Create a simple user switcher prompt
    const choice = prompt('切换用户:\n' + users.map(u =>
      u === currentUser ? `${u} (当前)` : u
    ).join('\n') + '\n\n输入要切换的用户名:');

    if (choice && users.includes(choice)) {
      this.switchUser(choice);
    } else if (choice) {
      alert('用户 "' + choice + '" 不存在');
    }
  }

  getDirectoryIcon(iconName) {
    const icons = {
      home: this.icons.home,
      desktop: this.icons.desktop,
      download: this.icons.download,
      folder: this.icons.folder,
      image: this.icons.image,
      video: this.icons.video,
      music: this.icons.music,
      trash: this.icons.trash,
    };
    return icons[iconName] || icons.folder;
  }

  renderDrives() {
    const grid = document.getElementById('drives-grid');
    if (!grid) return;

    let drives = [{
      name: 'root',
      path: '/',
      type: 'virtual',
    }];

    const driveCards = drives.map(drive => {
      const usage = drive.type === 'virtual' ? null : this.getDriveUsage(drive.path);
      let iconSvg = '';

      if (drive.name === 'root') {
        iconSvg = this.icons.desktop;
      } else if (drive.type === 'wsl') {
        iconSvg = this.icons.folder;
      } else {
        iconSvg = this.icons.disk;
      }

      return `
        <div class="drive-card" data-path="${drive.path}">
          <div class="drive-card__header">
            <div class="drive-card__icon">
              ${iconSvg}
            </div>
            <div class="drive-card__info">
              <div class="drive-card__name">${drive.name}</div>
              <div class="drive-card__path">${drive.path}</div>
            </div>
          </div>
          ${usage ? `
            <div class="drive-card__progress">
              <div class="drive-card__progress-bar">
                <div class="drive-card__progress-fill" style="width: ${usage.percent}%"></div>
              </div>
              <div class="drive-card__progress-text">${usage.used} GB / ${usage.total} GB</div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    grid.innerHTML = driveCards;

    grid.querySelectorAll('.drive-card').forEach(card => {
      card.addEventListener('click', () => {
        const path = card.dataset.path;
        this.loadDirectory(path);
      });
    });

    this.loadDrivesAsync();
  }

  async loadDrivesAsync() {
    // 防止并发调用导致重复
    if (this._loadingDrives) return;
    this._loadingDrives = true;

    try {
      const mediaResult = await this.vfs.amsysClient.listDir('/media');
      if (mediaResult.success && mediaResult.entries) {
        const grid = document.getElementById('drives-grid');
        if (!grid) {
          this._loadingDrives = false;
          return;
        }

        // 清除之前添加的盘符（保留 root 卡片）
        grid.querySelectorAll('.drive-card:not([data-path="/"])').forEach(el => el.remove());

        const sortedEntries = mediaResult.entries.filter(e => e.type === 'dir').sort((a, b) => {
          return a.name.localeCompare(b.name);
        });

        sortedEntries.forEach(entry => {
          const driveCard = document.createElement('div');
          driveCard.className = 'drive-card';
          driveCard.dataset.path = '/media/' + entry.name;
          const letter = entry.name.toUpperCase();
          const label = (this._driveLabels || {})[letter];
          const driveName = label ? `${label} (${letter}:)` : `${letter} 盘`;
          driveCard.innerHTML = `
            <div class="drive-card__header">
              <div class="drive-card__icon">
                ${this.icons.disk}
              </div>
              <div class="drive-card__info">
                <div class="drive-card__name">${driveName}</div>
                <div class="drive-card__path">/media/${entry.name}</div>
              </div>
            </div>
          `;
          driveCard.addEventListener('click', () => {
            this.loadDirectory(driveCard.dataset.path);
          });
          grid.appendChild(driveCard);
        });
      }
    } catch (err) {
      console.error('loadDrivesAsync error:', err);
    } finally {
      this._loadingDrives = false;
    }
  }

  getSystemDrives() {
    const drives = [];

    console.log('getSystemDrives: vfs mounts:', this.vfs.getMounts());
    console.log('getSystemDrives: vfs root:', this.vfs.getRoot());

    const rootMount = {
      name: 'root',
      path: '/',
      type: 'virtual',
    };
    drives.push(rootMount);

    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      try {
        // 优先使用程序目录内置的便携版 pwsh7（兼容 Windows PE）；wmic 已弃用
        const pwsh = this.getPowerShellPath();
        const script = 'Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 } | Select-Object DeviceID, VolumeName | ConvertTo-Json -Compress';
        const encoded = Buffer.from(script, 'utf16le').toString('base64');
        const output = execSync(`"${pwsh}" -NoProfile -NonInteractive -EncodedCommand ${encoded}`, { encoding: 'utf-8', timeout: 10000 });
        const parsed = JSON.parse(output.trim());
        const disks = Array.isArray(parsed) ? parsed : (parsed && parsed.DeviceID ? [parsed] : []);

        disks.forEach(disk => {
          const caption = disk.DeviceID;
          if (caption && caption.length === 2 && caption.endsWith(':')) {
            const unixPath = this.vfs.toUnix(`${caption}\\`);
            const label = disk.VolumeName ? disk.VolumeName : '本地磁盘';
            drives.push({
              name: `${label} (${caption})`,
              path: unixPath,
              type: 'local',
            });
          }
        });
      } catch (err) {
        // 兜底：直接扫描盘符（无 pwsh / PE 环境）
        for (let i = 67; i <= 90; i++) {
          const letter = String.fromCharCode(i);
          const path = `${letter}:`;
          try {
            this.fs.statSync(path);
            const unixPath = this.vfs.toUnix(`${letter}:\\`);
            console.log(`getSystemDrives (fallback): ${letter}:\\ -> ${unixPath}`);
            drives.push({
              name: `${letter}盘`,
              path: unixPath,
              type: 'local',
            });
          } catch (e) {
          }
        }
      }

      try {
        const wslOutput = execSync('wsl --list --quiet', { encoding: 'utf-8', timeout: 3000 });
        const wslLines = wslOutput.split('\n').filter(line => line.trim());
        wslLines.forEach(line => {
          drives.push({
            name: line.trim(),
            path: this.vfs.toUnix(`\\\\wsl.localhost\\${line.trim()}`),
            type: 'wsl',
          });
        });
      } catch (e) {
      }
    } else {
      const rootPaths = ['/', '/home', '/mnt'];
      rootPaths.forEach(path => {
        try {
          this.fs.statSync(path);
          drives.push({
            name: path === '/' ? '根目录' : path,
            path: path,
            type: 'local',
          });
        } catch (e) {
        }
      });
    }

    return drives;
  }

  getDriveUsage(path) {
    try {
      const { execSync } = require('child_process');
      if (process.platform === 'win32') {
        const pwsh = this.getPowerShellPath();
        const script = `$d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${path.charAt(0)}:'"; if ($d) { [PSCustomObject]@{ Free = [int64]$d.FreeSpace; Size = [int64]$d.Size } | ConvertTo-Json -Compress }`;
        const encoded = Buffer.from(script, 'utf16le').toString('base64');
        const output = execSync(`"${pwsh}" -NoProfile -NonInteractive -EncodedCommand ${encoded}`, { encoding: 'utf-8', timeout: 10000 });
        const data = JSON.parse(output.trim());
        if (data && data.Size > 0) {
          const freeSpace = data.Free;
          const totalSize = data.Size;
          const used = totalSize - freeSpace;
          return {
            used: (used / (1024 * 1024 * 1024)).toFixed(1),
            total: (totalSize / (1024 * 1024 * 1024)).toFixed(1),
            percent: Math.round((used / totalSize) * 100),
          };
        }
      } else {
        const output = execSync(`df -k "${path}"`, { encoding: 'utf-8' });
        const lines = output.split('\n').filter(line => line.trim());
        if (lines.length >= 2) {
          const parts = lines[1].split(/\s+/);
          if (parts.length >= 5) {
            const used = parseInt(parts[2]) * 1024;
            const total = parseInt(parts[1]) * 1024;
            return {
              used: (used / (1024 * 1024 * 1024)).toFixed(1),
              total: (total / (1024 * 1024 * 1024)).toFixed(1),
              percent: Math.round((used / total) * 100),
            };
          }
        }
      }
    } catch (err) {
    }
    return null;
  }

  // 获取 PowerShell 路径：优先主进程解析（程序目录内置 pwsh7，兼容 Windows PE）
  getPowerShellPath() {
    try {
      const electron = require('electron');
      if (electron && electron.ipcRenderer) {
        const p = electron.ipcRenderer.sendSync('pwsh-get-path');
        if (p) return p;
      }
    } catch (e) {
    }
    return 'pwsh';
  }

  refresh() {
    this.loadDirectory(this.currentPath);
  }

  async navigateTo(path) {
    try {
      const stats = await this.vfs.stat(path);
      const isDir = stats && stats.isDirectory ? stats.isDirectory() : false;
      if (isDir) {
        this.loadDirectory(path);
      } else if (stats && stats.isFile && stats.isFile()) {
        this.openFileInSystem(path);
        if (this.addressBarInput) {
          this.addressBarInput.value = this.currentPath;
        }
      } else {
        this.showDialog('错误', `路径不是有效的目录: ${path}`, 'error');
        if (this.addressBarInput) {
          this.addressBarInput.value = this.currentPath;
        }
      }
    } catch (err) {
      console.warn('navigateTo failed:', path, err.message);
      this.showDialog('错误', `路径不存在: ${path}`, 'error');
      if (this.addressBarInput) {
        this.addressBarInput.value = this.currentPath;
      }
    }
  }

  editAddressBar() {
    this.addressBarInput.readOnly = false;
    this.addressBarInput.select();
    this.addressBarInput.focus();
  }

  updateHistory(path) {
    const tabState = this.tabs[this.currentTabId];
    if (!tabState) return;

    const { history, historyIndex } = tabState;

    if (history[historyIndex] !== path) {
      tabState.history = history.slice(0, historyIndex + 1);
      tabState.history.push(path);
      tabState.historyIndex = tabState.history.length - 1;
    }
  }

  updateNavigationButtons() {
    const backBtn = document.getElementById('browser-back-btn');
    const forwardBtn = document.getElementById('browser-forward-btn');
    const upBtn = document.getElementById('browser-up-btn');

    if (!backBtn || !forwardBtn || !upBtn) return;

    const tabState = this.tabs[this.currentTabId];
    const historyIndex = tabState?.historyIndex || 0;
    const historyLength = tabState?.history?.length || 1;

    backBtn.disabled = historyIndex <= 0;
    forwardBtn.disabled = historyIndex >= historyLength - 1;

    const parentDir = this.getParentPath(this.currentPath);
    upBtn.disabled = parentDir === this.currentPath;

    if (this.navBackBtn) this.navBackBtn.disabled = backBtn.disabled;
    if (this.navForwardBtn) this.navForwardBtn.disabled = forwardBtn.disabled;
    if (this.navUpBtn) this.navUpBtn.disabled = upBtn.disabled;
  }

  updateStatusBar(count) {
    if (this.statusText) {
      this.statusText.textContent = `${count} 个项目`;
    } else {
      const statusTextEl = document.querySelector('.status-text');
      if (statusTextEl) {
        statusTextEl.textContent = `${count} 个项目`;
      }
    }
  }

  selectAll(pane = null) {
    this.deselectAll(pane);
    let selector = '.file-item, .grid-item';
    if (pane === 'left') {
      selector = '#file-pane-left .file-item, #file-pane-left .grid-item';
    } else if (pane === 'right') {
      selector = '#file-pane-right .file-item, #file-pane-right .grid-item';
    }
    document.querySelectorAll(selector).forEach(item => {
      item.classList.add('selected');
      if (item.dataset.path && !this.selectedItems.includes(item.dataset.path)) {
        this.selectedItems.push(item.dataset.path);
      }
    });
  }

  deselectAll(pane = null) {
    let selector = '.file-item, .grid-item';
    if (pane === 'left') {
      selector = '#file-pane-left .file-item, #file-pane-left .grid-item';
    } else if (pane === 'right') {
      selector = '#file-pane-right .file-item, #file-pane-right .grid-item';
    }
    document.querySelectorAll(selector).forEach(item => {
      item.classList.remove('selected');
    });
    // Remove deselected pane items from selectedItems
    document.querySelectorAll('.file-item, .grid-item').forEach(item => {
      if (!item.classList.contains('selected') && item.dataset.path) {
        const idx = this.selectedItems.indexOf(item.dataset.path);
        if (idx > -1) this.selectedItems.splice(idx, 1);
      }
    });
    if (!pane) {
      this.selectedItems = [];
    }
  }

  createNewFile() {
    this.showDialog('新建文件', '<input type="text" class="dialog-input" id="new-file-name" placeholder="请输入文件名" value="新建文件.txt">', 'input', async (name) => {
      if (!name) return;

      const fullPath = this.joinPath(this.currentPath, name);

      if (await this.vfs.exists(fullPath)) {
        this.showDialog('错误', '文件已存在', 'error');
        return;
      }

      const winPath = await this.vfs.toWindows(fullPath);
      if (winPath) {
        const fs = require('fs');
        fs.writeFileSync(winPath, '');
        this.refresh();

        const item = document.querySelector(`[data-path="${fullPath}"]`);
        if (item) {
          item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else {
        this.showDialog('错误', '无法创建文件', 'error');
      }
    });
  }

  createNewFolder() {
    this.showDialog('新建文件夹', '<input type="text" class="dialog-input" id="new-folder-name" placeholder="请输入文件夹名称" value="新建文件夹">', 'input', (name) => {
      if (!name) return;

      const fullPath = this.joinPath(this.currentPath, name);

      if (this.vfs.exists(fullPath)) {
        this.showDialog('错误', '文件夹已存在', 'error');
        return;
      }

      if (this.vfs.mkdir(fullPath)) {
        this.refresh();

        const item = document.querySelector(`[data-path="${fullPath}"]`);
        if (item) {
          item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else {
        this.showDialog('错误', '无法创建文件夹', 'error');
      }
    });
  }

  initContextMenu() {
    this.contextMenu = document.getElementById('context-menu');
    this.contextMenuContent = this.contextMenu.querySelector('.context-menu-content');

    document.addEventListener('click', () => {
      this.hideContextMenu();
      this.hideBlankContextMenu();
    });

    document.getElementById('ctx-open').addEventListener('click', () => {
      if (this.selectedItems.length > 0) {
        this.handleFileDoubleClick(document.querySelector(`[data-path="${this.selectedItems[0]}"]`));
      }
      this.hideContextMenu();
    });

    document.getElementById('ctx-open-in-new-tab').addEventListener('click', () => {
      if (this.selectedItems.length > 0) {
        const path = this.selectedItems[0];
        try {
          const stats = this.fs.statSync(path);
          if (stats.isDirectory()) {
            this.createNewTab(path);
          }
        } catch (err) {
          console.error(err);
        }
      }
      this.hideContextMenu();
    });

    const submenu = document.querySelector('.context-menu-submenu');
    const submenuContent = document.getElementById('ctx-more-options-content');
    const moreOptionsBtn = document.getElementById('ctx-more-options');

    submenu.addEventListener('mouseenter', async () => {
      const submenuBtn = submenu.querySelector('.context-menu-item');
      if (submenuBtn) {
        const rect = submenuBtn.getBoundingClientRect();
        const submenuWidth = 300;

        if (rect.right + submenuWidth > window.innerWidth) {
          submenuContent.style.left = 'auto';
          submenuContent.style.right = 'calc(100% - 4px)';
        } else {
          submenuContent.style.left = 'calc(100% - 4px)';
          submenuContent.style.right = 'auto';
        }
      }

      if (this.selectedItems.length > 0 && !this.shellMenuLoaded) {
        submenuContent.innerHTML = '<button class="context-menu-item"><span class="icon-wrapper"></span><span>加载中...</span></button>';

        const path = this.selectedItems[0];
        try {
          const winPath = await this.vfs.toWindows(path);
          if (winPath) {
            await this.populateShellMenu(winPath);
          }
        } catch (err) {
          console.error(err);
          submenuContent.innerHTML = '<button class="context-menu-item"><span class="icon-wrapper"></span><span>加载失败</span></button>';
        }
      }
    });

    moreOptionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      submenu.classList.toggle('submenu-pinned');
    });

    document.getElementById('ctx-copy').addEventListener('click', () => {
      this.copyMode = 'copy';
      this.copyBuffer = [...this.selectedItems];
      this.hideContextMenu();
    });

    document.getElementById('ctx-cut').addEventListener('click', () => {
      this.copyMode = 'cut';
      this.copyBuffer = [...this.selectedItems];
      this.markCutItems();
      this.hideContextMenu();
    });

    document.getElementById('ctx-paste').addEventListener('click', () => {
      this.pasteItems();
      this.hideContextMenu();
    });

    document.getElementById('ctx-rename').addEventListener('click', () => {
      if (this.selectedItems.length === 1) {
        this.renameItem(this.selectedItems[0]);
      }
      this.hideContextMenu();
    });

    document.getElementById('ctx-delete').addEventListener('click', () => {
      if (this.selectedItems.length > 0) {
        const trashPath = this.vfs.getTrashPath();
        const isInTrash = this.currentPath === trashPath.unix;

        if (isInTrash) {
          this.confirmAction(`确定要永久删除 ${this.selectedItems.length} 个项目吗？此操作不可恢复！`, () => {
            this.permanentlyDeleteItems();
          });
        } else {
          this.confirmAction(`确定要将 ${this.selectedItems.length} 个项目移到回收站吗？`, () => {
            this.deleteItems();
          });
        }
      }
      this.hideContextMenu();
    });

    document.getElementById('ctx-restore').addEventListener('click', async () => {
      if (this.selectedItems.length > 0) {
        const trashPath = this.vfs.getTrashPath();
        const destPath = this.getParentPath(trashPath.unix);

        for (const itemPath of this.selectedItems) {
          const itemName = itemPath.split('/').pop();
          const destItemPath = this.joinPath(destPath, itemName);
          await this.restoreFromTrash(itemPath, destItemPath);
        }
      }
      this.hideContextMenu();
    });

    document.getElementById('ctx-permanent-delete').addEventListener('click', () => {
      if (this.selectedItems.length > 0) {
        this.confirmAction(`确定要永久删除 ${this.selectedItems.length} 个项目吗？此操作不可恢复！`, () => {
          this.permanentlyDeleteItems();
        });
      }
      this.hideContextMenu();
    });

    document.getElementById('ctx-properties').addEventListener('click', () => {
      if (this.selectedItems.length === 1) {
        const path = this.selectedItems[0];
        this.updateInfoPanel(path);
        this.showInfoPanel();
      }
      this.hideContextMenu();
    });

    // 空白处右键菜单事件绑定
    const blankNewFileBtn = document.getElementById('ctx-blank-new-file');
    if (blankNewFileBtn) {
      blankNewFileBtn.addEventListener('click', () => {
        this.createNewFile();
        this.hideBlankContextMenu();
      });
    }

    const blankNewFolderBtn = document.getElementById('ctx-blank-new-folder');
    if (blankNewFolderBtn) {
      blankNewFolderBtn.addEventListener('click', () => {
        this.createNewFolder();
        this.hideBlankContextMenu();
      });
    }

    const blankPasteBtn = document.getElementById('ctx-blank-paste');
    if (blankPasteBtn) {
      blankPasteBtn.addEventListener('click', () => {
        this.pasteItems();
        this.hideBlankContextMenu();
      });
    }

    const blankRefreshBtn = document.getElementById('ctx-blank-refresh');
    if (blankRefreshBtn) {
      blankRefreshBtn.addEventListener('click', () => {
        this.refresh();
        this.hideBlankContextMenu();
      });
    }

    const blankPropertiesBtn = document.getElementById('ctx-blank-properties');
    if (blankPropertiesBtn) {
      blankPropertiesBtn.addEventListener('click', () => {
        this.updateInfoPanel(this.currentPath);
        this.showInfoPanel();
        this.hideBlankContextMenu();
      });
    }

    // 绑定文件列表/网格视图的空白处右键事件
    this.bindBlankAreaContextMenu();
  }

  bindBlankAreaContextMenu() {
    const selectors = ['#file-list-left', '#file-list-right', '#grid-container-left', '#grid-container-right'];
    selectors.forEach(selector => {
      const el = document.querySelector(selector);
      if (el) {
        el.addEventListener('contextmenu', (e) => {
          // 只有点击在空白处（非文件项）时才显示空白菜单
          const item = e.target.closest('.file-item, .grid-item');
          if (!item) {
            e.preventDefault();
            this.showBlankContextMenu(e.clientX, e.clientY);
          }
        });
      }
    });
  }

  showBlankContextMenu(x, y) {
    const blankMenu = document.getElementById('context-menu-blank');
    if (!blankMenu) return;

    const pasteBtn = document.getElementById('ctx-blank-paste');
    if (pasteBtn) {
      pasteBtn.disabled = this.copyBuffer.length === 0;
    }

    // 清除所有选中项
    this.deselectAll();

    blankMenu.classList.add('active');

    const menuContent = blankMenu.querySelector('.context-menu-content');
    const menuWidth = menuContent.offsetWidth;
    const menuHeight = menuContent.offsetHeight;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    let finalX = x;
    let finalY = y;

    if (finalX + menuWidth > windowWidth) {
      finalX = windowWidth - menuWidth - 4;
    }
    if (finalY + menuHeight > windowHeight) {
      finalY = windowHeight - menuHeight - 4;
    }

    // 设置菜单内容定位
    menuContent.style.left = `${finalX}px`;
    menuContent.style.top = `${finalY}px`;
  }

  hideBlankContextMenu() {
    const blankMenu = document.getElementById('context-menu-blank');
    if (blankMenu) {
      blankMenu.classList.remove('active');
      const menuContent = blankMenu.querySelector('.context-menu-content');
      if (menuContent) {
        menuContent.style.left = '';
        menuContent.style.top = '';
      }
    }
  }

  async showContextMenu(x, y, item) {
    this.shellMenuLoaded = false;
    const pasteBtn = document.getElementById('ctx-paste');
    if (pasteBtn) {
      pasteBtn.disabled = this.copyBuffer.length === 0;
    }

    const trashPath = this.vfs.getTrashPath();
    const isInTrash = this.currentPath === trashPath.unix;

    // Show different options for trash vs normal directories
    const deleteBtn = document.getElementById('ctx-delete');
    const restoreBtn = document.getElementById('ctx-restore');
    const permanentDeleteBtn = document.getElementById('ctx-permanent-delete');

    if (isInTrash) {
      // In trash: show restore and permanent delete, hide normal delete
      if (deleteBtn) deleteBtn.classList.add('is-hidden');
      if (restoreBtn) restoreBtn.classList.remove('is-hidden');
      if (permanentDeleteBtn) permanentDeleteBtn.classList.remove('is-hidden');
    } else {
      // Normal: show delete (move to trash), hide restore and permanent
      if (deleteBtn) deleteBtn.classList.remove('is-hidden');
      if (restoreBtn) restoreBtn.classList.add('is-hidden');
      if (permanentDeleteBtn) permanentDeleteBtn.classList.add('is-hidden');
    }

    const openInNewTabBtn = document.getElementById('ctx-open-in-new-tab');
    if (item && openInNewTabBtn) {
      const path = item.dataset.path;
      try {
        const stats = await this.vfs.stat(path);
        const isDir = stats && stats.isDirectory ? stats.isDirectory() : false;
        openInNewTabBtn.style.display = isDir ? 'flex' : 'none';
      } catch {
        openInNewTabBtn.style.display = 'none';
      }
    } else {
      openInNewTabBtn.style.display = 'none';
    }

    const moreOptionsBtn = document.getElementById('ctx-more-options');
    if (item) {
      const path = item.dataset.path;
      try {
        const isVirtual = await this.vfs.isVirtualPath(path);
        moreOptionsBtn.style.display = isVirtual ? 'none' : 'flex';
      } catch {
        moreOptionsBtn.style.display = 'none';
      }
    } else {
      moreOptionsBtn.style.display = 'none';
    }

    this.contextMenu.classList.add('active');

    if (item) {
      item.classList.add('selected');
      this.selectedItems = [item.dataset.path];
    } else {
      this.deselectAll();
    }

    const menuWidth = this.contextMenuContent.offsetWidth;
    const menuHeight = this.contextMenuContent.offsetHeight;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    let finalX = x;
    let finalY = y;

    if (finalX + menuWidth > windowWidth) {
      finalX = windowWidth - menuWidth - 4;
    }
    if (finalY + menuHeight > windowHeight) {
      finalY = windowHeight - menuHeight - 4;
    }

    finalX = Math.max(4, finalX);
    finalY = Math.max(4, finalY);

    this.contextMenuContent.style.left = finalX + 'px';
    this.contextMenuContent.style.top = finalY + 'px';
  }

  async populateShellMenu(winPath) {
    const submenuContent = document.getElementById('ctx-more-options-content');

    submenuContent.innerHTML = '<button class="context-menu-item"><span class="icon-wrapper"></span><span>加载中...</span></button>';

    try {
      const { exec } = require('child_process');
      const fs = require('fs');
      const path = require('path');
      const util = require('util');
      const execPromise = util.promisify(exec);

      const tempDir = require('os').tmpdir();
      const tempFile = path.join(tempDir, `shell_menu_${Date.now()}.ps1`);

      const escapedPath = winPath.replace(/'/g, "''").replace(/\\/g, "\\\\");

      const psScript = `
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        [Console]::InputEncoding = [System.Text.Encoding]::UTF8

        $filePath = '${escapedPath}'
        Write-Host "DEBUG: filePath = $filePath"

        if (-not (Test-Path $filePath)) {
            Write-Host "ERROR: Path does not exist"
            exit 1
        }

        $shell = New-Object -ComObject Shell.Application
        $parentDir = Split-Path -Path $filePath -Parent
        $fileName = Split-Path -Path $filePath -Leaf

        Write-Host "DEBUG: parentDir = $parentDir"
        Write-Host "DEBUG: fileName = $fileName"

        if (-not $parentDir) {
            $parentDir = 'C:\\'
        }

        $folder = $shell.Namespace($parentDir)
        if (-not $folder) {
            Write-Host "ERROR: Cannot get folder"
            exit 1
        }

        $item = $folder.ParseName($fileName)

        if (-not $item) {
            Write-Host "ERROR: Cannot get item"
            exit 1
        }

        $verbs = $item.Verbs()
        Write-Host "DEBUG: Found $($verbs.Count) verbs"

        if ($verbs) {
            $verbs | ForEach-Object {
                $_.Name -replace '&', ''
            }
        }
      `;

      fs.writeFileSync(tempFile, psScript, 'utf8');

      const pwsh = this.getPowerShellPath();
      const { stdout, stderr } = await execPromise(`"${pwsh}" -NoProfile -ExecutionPolicy Bypass -File "${tempFile}"`, {
        timeout: 10000
      });

      fs.unlinkSync(tempFile);

      console.log('populateShellMenu stdout:', stdout);
      if (stderr) {
        console.log('populateShellMenu stderr:', stderr);
      }

      const lines = stdout.split('\n').filter(v => v.trim());
      const verbs = lines.filter(v => !v.startsWith('DEBUG:') && !v.startsWith('ERROR:'));

      submenuContent.innerHTML = '';

      if (verbs.length === 0) {
        const noVerbBtn = document.createElement('button');
        noVerbBtn.className = 'context-menu-item';
        noVerbBtn.innerHTML = '<span class="icon-wrapper"></span><span>没有其他选项</span>';
        submenuContent.appendChild(noVerbBtn);
        return;
      }

      this.shellMenuLoaded = true;

      verbs.forEach((verb, index) => {
        const btn = document.createElement('button');
        btn.className = 'context-menu-item';
        btn.innerHTML = '<span class="icon-wrapper"></span><span>' + verb.trim() + '</span>';
        btn.addEventListener('click', () => {
          this.executeShellVerb(winPath, verb.trim());
          this.hideContextMenu();
        });
        submenuContent.appendChild(btn);
      });

    } catch (err) {
      console.error('populateShellMenu error:', err.message, err.stderr, err.stdout);
      submenuContent.innerHTML = '';
      const errorBtn = document.createElement('button');
      errorBtn.className = 'context-menu-item';
      errorBtn.innerHTML = `<span>错误: ${err.message.substring(0, 30)}...</span>`;
      submenuContent.appendChild(errorBtn);
    }
  }

  async executeShellVerb(winPath, verb) {
    try {
      const { exec } = require('child_process');
      const fs = require('fs');
      const path = require('path');

      const tempDir = require('os').tmpdir();
      const tempFile = path.join(tempDir, `shell_execute_${Date.now()}.ps1`);

      const psScript = `
        $filePath = '${winPath.replace(/'/g, "''")}'
        $verbName = '${verb.replace(/'/g, "''")}'

        $shell = New-Object -ComObject Shell.Application
        $parentDir = Split-Path -Path $filePath -Parent
        $fileName = Split-Path -Path $filePath -Leaf

        if (-not $parentDir) {
            $parentDir = 'C:\\'
        }

        $folder = $shell.Namespace($parentDir)
        $item = $folder.ParseName($fileName)

        if ($item) {
            $verbs = $item.Verbs()
            foreach ($v in $verbs) {
                $cleanName = $v.Name -replace '&', ''
                if ($cleanName -eq $verbName) {
                    $v.DoIt()
                    break
                }
            }
        }
      `;

      fs.writeFileSync(tempFile, psScript, 'utf8');

      const pwsh = this.getPowerShellPath();
      exec(`"${pwsh}" -NoProfile -ExecutionPolicy Bypass -File "${tempFile}"`, (err) => {
        fs.unlinkSync(tempFile);
        if (err) {
          console.error('executeShellVerb error:', err.message);
        }
      });

    } catch (err) {
      console.error('executeShellVerb error:', err.message);
    }
  }

  hideContextMenu() {
    this.contextMenu.classList.remove('active');
  }

  markCutItems() {
    this.copyBuffer.forEach(path => {
      const items = document.querySelectorAll(`[data-path="${path}"]`);
      items.forEach(item => {
        item.classList.add('cut-item');
      });
    });
  }

  unmarkCutItems() {
    document.querySelectorAll('.cut-item').forEach(item => {
      item.classList.remove('cut-item');
    });
  }

  async pasteItems() {
    if (this.copyBuffer.length === 0) return;

    const fs = require('fs');
    const taskType = this.copyMode === 'copy' ? 'copy' : 'move';
    const taskName = this.copyMode === 'copy' ? '复制文件' : '移动文件';

    const task = this.addTask(taskType, taskName);
    task.totalFiles = this.copyBuffer.length;

    for (let i = 0; i < this.copyBuffer.length; i++) {
      if (task.cancelled) break;

      const sourcePath = this.copyBuffer[i];
      const fileName = sourcePath.split('/').pop();
      let destPath = this.joinPath(this.currentPath, fileName);

      this.updateTask(task.id, {
        currentFile: fileName,
        completedFiles: i
      }, true);

      let counter = 1;
      while (await this.vfs.exists(destPath)) {
        const dotIndex = fileName.lastIndexOf('.');
        const ext = dotIndex !== -1 ? fileName.substr(dotIndex) : '';
        const baseName = dotIndex !== -1 ? fileName.substr(0, dotIndex) : fileName;
        destPath = this.joinPath(this.currentPath, `${baseName} (${counter})${ext}`);
        counter++;
      }

      try {
        if (this.copyMode === 'copy') {
          await this.copyRecursive(sourcePath, destPath, task);
        } else {
          const srcWinPath = await this.vfs.toWindows(sourcePath);
          const destWinPath = await this.vfs.toWindows(destPath);
          if (srcWinPath && destWinPath) {
            this.movePathWithFallback(fs, srcWinPath, destWinPath);
          }
        }
      } catch (err) {
        console.error('Failed to paste:', err);
        this.showDialog('错误', `无法粘贴文件: ${err.message}`, 'error');
      }

      this.updateTask(task.id, {
        completedFiles: i + 1,
        progress: ((i + 1) / this.copyBuffer.length) * 100
      }, true);
    }

    if (!task.cancelled) {
      this.completeTask(task.id);
    }

    // 剪切模式完成后清除淡化效果
    if (this.copyMode === 'cut') {
      this.unmarkCutItems();
    }

    this.copyBuffer = [];
    this.copyMode = 'copy';
    this.refresh();
  }

  // 移动文件/目录：同卷 rename；跨卷（EXDEV）时复制后删除
  movePathWithFallback(fs, src, dest) {
    try {
      fs.renameSync(src, dest);
      return true;
    } catch (err) {
      if (err.code === 'EXDEV') {
        fs.cpSync(src, dest, { recursive: true, force: true });
        fs.rmSync(src, { recursive: true, force: true });
        return true;
      }
      throw err;
    }
  }

  async copyRecursive(source, dest, task = null) {
    if (task && task.cancelled) return;

    const stats = await this.vfs.stat(source);
    const fs = require('fs');
    const isDir = stats && stats.isDirectory ? stats.isDirectory() : false;

    if (isDir) {
      const destWinPath = await this.vfs.toWindows(dest);
      if (destWinPath) {
        fs.mkdirSync(destWinPath, { recursive: true });
      }
      const fileNames = await this.vfs.readdir(source);
      for (const file of fileNames) {
        if (task && task.cancelled) break;

        const srcPath = this.joinPath(source, file);
        const destPath = this.joinPath(dest, file);

        if (task) {
          this.updateTask(task.id, {
            currentFile: file
          });
        }

        await this.copyRecursive(srcPath, destPath, task);
      }
    } else {
      const srcWinPath = await this.vfs.toWindows(source);
      const destWinPath = await this.vfs.toWindows(dest);
      if (srcWinPath && destWinPath) {
        fs.copyFileSync(srcWinPath, destWinPath);

        if (task) {
          const fileSize = fs.statSync(srcWinPath).size;
          this.updateTask(task.id, {
            completedSize: task.completedSize + fileSize,
            totalSize: task.totalSize + fileSize
          });
        }
      }
    }
  }

  async renameItem(path) {
    const isVirtual = await this.vfs.isVirtualPath(path);
    if (isVirtual) {
      this.showDialog('错误', '无法重命名虚拟目录', 'error');
      return;
    }

    const oldName = path.split('/').pop();
    const dirPath = this.getParentPath(path);

    this.showDialog('重命名', `<input type="text" id="rename-input" class="dialog-input" value="${oldName}">`, 'input', async (newName) => {
      if (!newName || newName === oldName) return;

      const newPath = this.joinPath(dirPath, newName);

      if (await this.vfs.exists(newPath)) {
        this.showDialog('错误', '名称已存在', 'error');
        return;
      }

      try {
        await this.vfs.rename(path, newPath);
        this.refresh();
      } catch (err) {
        this.showDialog('错误', `重命名失败: ${err.message}`, 'error');
      }
    });
  }

  async deleteItems() {
    const fs = require('fs');
    const trashPath = this.vfs.getTrashPath();

    for (const path of this.selectedItems) {
      try {
        const stats = await this.vfs.stat(path);
        const isDir = stats && stats.isDirectory ? stats.isDirectory() : false;
        const winPath = await this.vfs.toWindows(path);

        if (!winPath) continue;

        // Generate unique name in trash to avoid conflicts
        let destWin = this.joinPath(trashPath.win, path.split('/').pop());
        let destUnix = this.joinPath(trashPath.unix, path.split('/').pop());
        let counter = 1;

        while (fs.existsSync(destWin)) {
          const name = path.split('/').pop();
          const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
          const baseName = ext ? name.slice(0, -ext.length) : name;
          destWin = this.joinPath(trashPath.win, `${baseName} (${counter})${ext}`);
          destUnix = this.joinPath(trashPath.unix, `${baseName} (${counter})${ext}`);
          counter++;
        }

        // Move to trash（跨卷时自动复制+删除）
        this.movePathWithFallback(fs, winPath, destWin);
        console.log(`Moved to trash: ${winPath} -> ${destWin}`);

      } catch (err) {
        console.error('Failed to move to trash:', err);
        this.showDialog('错误', `移动到回收站失败: ${err.message}`, 'error');
      }
    }

    this.selectedItems = [];
    this.refresh();
  }

  async restoreFromTrash(trashItemPath, destPath) {
    const fs = require('fs');

    try {
      const srcWin = await this.vfs.toWindows(trashItemPath);
      const destWin = await this.vfs.toWindows(destPath);

      if (!srcWin || !destWin) throw new Error('无法解析路径');

      this.movePathWithFallback(fs, srcWin, destWin);
      console.log(`Restored: ${srcWin} -> ${destWin}`);
      this.refresh();
      return true;
    } catch (err) {
      console.error('Failed to restore from trash:', err);
      this.showDialog('错误', `恢复失败: ${err.message}`, 'error');
      return false;
    }
  }

  async permanentlyDeleteItems() {
    const fs = require('fs');

    for (const path of this.selectedItems) {
      try {
        const winPath = await this.vfs.toWindows(path);
        if (!winPath) continue;

        const stats = fs.statSync(winPath);
        if (stats.isDirectory()) {
          fs.rmSync(winPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(winPath);
        }
      } catch (err) {
        console.error('Failed to permanently delete:', err);
      }
    }

    this.selectedItems = [];
    this.refresh();
  }

  initCommandPalette() {
    this.commandPalette = document.getElementById('command-palette');
    this.commandPaletteInput = document.getElementById('command-palette-input');
    this.commandPaletteList = document.getElementById('command-palette-list');

    document.getElementById('command-palette-input').addEventListener('input', (e) => {
      this.filterCommands(e.target.value);
    });

    document.querySelectorAll('.command-item').forEach(item => {
      item.addEventListener('click', () => {
        const command = item.dataset.command;
        this.executeCommand(command);
        this.hideCommandPalette();
      });
    });

    this.commandPalette.addEventListener('click', (e) => {
      if (e.target === this.commandPalette) {
        this.hideCommandPalette();
      }
    });

    this.commandPaletteInput.addEventListener('keydown', (e) => {
      const items = document.querySelectorAll('.command-item:not(.hidden)');
      const selectedItem = document.querySelector('.command-item.selected');

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (selectedItem) {
          selectedItem.classList.remove('selected');
          const next = selectedItem.nextElementSibling;
          if (next && !next.classList.contains('hidden')) {
            next.classList.add('selected');
          } else {
            items[0]?.classList.add('selected');
          }
        } else {
          items[0]?.classList.add('selected');
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (selectedItem) {
          selectedItem.classList.remove('selected');
          const prev = selectedItem.previousElementSibling;
          if (prev && !prev.classList.contains('hidden')) {
            prev.classList.add('selected');
          } else {
            items[items.length - 1]?.classList.add('selected');
          }
        } else {
          items[items.length - 1]?.classList.add('selected');
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = selectedItem || items[0];
        if (cmd) {
          this.executeCommand(cmd.dataset.command);
          this.hideCommandPalette();
        }
      } else if (e.key === 'Escape') {
        this.hideCommandPalette();
      }
    });
  }

  showCommandPalette() {
    this.commandPalette.classList.add('active');
    this.commandPaletteInput.value = '';
    this.commandPaletteInput.focus();
    this.filterCommands('');
  }

  hideCommandPalette() {
    this.commandPalette.classList.remove('active');
    document.querySelectorAll('.command-item').forEach(item => item.classList.remove('selected'));
  }

  filterCommands(query) {
    const q = query.toLowerCase();
    document.querySelectorAll('.command-item').forEach(item => {
      const text = item.querySelector('span:nth-child(2)').textContent.toLowerCase();
      if (text.includes(q)) {
        item.classList.remove('is-hidden');
      } else {
        item.classList.add('is-hidden');
      }
    });

    document.querySelectorAll('.command-section').forEach(section => {
      const items = section.querySelectorAll('.command-item:not(.hidden)');
      if (items.length === 0) {
        section.classList.add('is-hidden');
      } else {
        section.classList.remove('is-hidden');
      }
    });
  }

  executeCommand(command) {
    switch (command) {
      case 'new-file':
        this.createNewFile();
        break;
      case 'new-folder':
        this.createNewFolder();
        break;
      case 'delete':
        if (this.selectedItems.length > 0) {
          this.deleteItems();
        }
        break;
      case 'go-back':
        this.goBack();
        break;
      case 'go-forward':
        this.goForward();
        break;
      case 'go-up':
        this.goUp();
        break;
      case 'refresh':
        this.refresh();
        break;
      case 'toggle-list-view':
        this.switchView('list');
        break;
      case 'toggle-grid-view':
        this.switchView('grid');
        break;
      case 'toggle-info-panel':
        this.toggleInfoPanel();
        break;
      case 'copy':
        this.copyMode = 'copy';
        this.copyBuffer = [...this.selectedItems];
        break;
      case 'cut':
        this.copyMode = 'cut';
        this.copyBuffer = [...this.selectedItems];
        this.markCutItems();
        break;
      case 'paste':
        this.pasteItems();
        break;
      case 'select-all':
        this.selectAll();
        break;
    }
  }

  initInfoPanel() {
    this.infoPanel = document.getElementById('info-panel');

    document.getElementById('info-panel-close').addEventListener('click', () => {
      this.hideInfoPanel();
    });

    document.getElementById('info-panel-btn').addEventListener('click', () => {
      this.toggleInfoPanel();
    });

    document.getElementById('process-panel-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleProcessPanel();
    });

    document.addEventListener('click', (e) => {
      const popover = document.getElementById('status-center-popover');
      const btn = document.getElementById('process-panel-btn');
      if (popover && btn && !popover.contains(e.target) && !btn.contains(e.target)) {
        this.hideProcessPanel();
      }
    });

    this.infoPreview = document.getElementById('info-preview');
    this.infoProperties = document.getElementById('info-properties');
    this.processPanel = document.getElementById('status-center-popover');
    this.processPanelContent = document.getElementById('status-center-content');
  }

  showInfoPanel() {
    this.infoPanel.classList.remove('is-hidden');
    this.infoPanelVisible = true;
  }

  hideInfoPanel() {
    this.infoPanel.classList.add('is-hidden');
    this.infoPanelVisible = false;
  }

  toggleInfoPanel() {
    if (this.infoPanelVisible) {
      this.hideInfoPanel();
    } else {
      this.showInfoPanel();
    }
  }

  showProcessPanel() {
    this.processPanel.classList.remove('is-hidden');
    this.processPanelVisible = true;
    this.renderTasks();
  }

  hideProcessPanel() {
    this.processPanel.classList.add('is-hidden');
    this.processPanelVisible = false;
  }

  toggleProcessPanel() {
    if (this.processPanelVisible) {
      this.hideProcessPanel();
    } else {
      this.showProcessPanel();
    }
  }

  updateTaskPanelButton() {
    const btn = document.getElementById('process-panel-btn');
    const badge = document.getElementById('task-badge');
    if (!btn || !badge) return;

    const runningCount = this.tasks.filter(t => t.status === 'running').length;
    const pausedCount = this.tasks.filter(t => t.status === 'paused').length;
    const activeCount = runningCount + pausedCount;

    if (activeCount > 0) {
      badge.hidden = false;
      badge.textContent = activeCount > 99 ? '99+' : activeCount;
      // 根据状态设置颜色
      if (pausedCount > 0 && runningCount === 0) {
        badge.classList.remove('badge-running', 'badge-warning');
        badge.classList.add('badge-paused');
      } else if (runningCount > 0) {
        badge.classList.remove('badge-paused', 'badge-warning');
        badge.classList.add('badge-running');
      }
    } else {
      badge.hidden = true;
    }
  }

  addTask(type, name, opts = {}) {
    const taskId = `task-${this.taskIdCounter++}`;
    const task = {
      id: taskId,
      type: type,
      name: name,
      progress: 0,
      status: 'running',
      currentFile: '',
      targetPath: opts.targetPath || '',
      totalFiles: 0,
      completedFiles: 0,
      totalSize: 0,
      completedSize: 0,
      cancelled: false,
      autoRemove: !!opts.autoRemove
    };
    this.tasks.push(task);
    this.renderTasks();
    return task;
  }

  updateTask(taskId, updates, forceRender = false) {
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
      Object.assign(task, updates);
      if (forceRender) {
        this._renderTasksScheduled = false;
        this._doRenderTasks();
      } else {
        this.renderTasks();
      }
    }
  }

  completeTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = 'completed';
      task.progress = 100;
      if (task.autoRemove) {
        setTimeout(() => {
          this.removeTask(taskId);
          this.updateTaskPanelButton();
        }, 1500);
      }
      this.renderTasks();
      this.updateTaskPanelButton();
    }
  }

  cancelTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
      task.cancelled = true;
      task.status = 'cancelled';
      if (task.autoRemove) {
        setTimeout(() => {
          this.removeTask(taskId);
          this.updateTaskPanelButton();
        }, 1500);
      }
      this.renderTasks();
      this.updateTaskPanelButton();
    }
  }

  pauseTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (task && task.status === 'running') {
      task.status = 'paused';
      task.paused = true;
      this.renderTasks();
      try {
        const { ipcRenderer } = require('electron');
        ipcRenderer.invoke('calc-size-pause', { taskId });
      } catch {}
    }
  }

  resumeTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (task && task.status === 'paused') {
      task.status = 'running';
      task.paused = false;
      this.renderTasks();
      try {
        const { ipcRenderer } = require('electron');
        ipcRenderer.invoke('calc-size-resume', { taskId });
      } catch {}
    }
  }

  removeTask(taskId) {
    this.tasks = this.tasks.filter(t => t.id !== taskId);
    this.renderTasks();
  }

  clearFinishedTasks() {
    this.tasks = this.tasks.filter(t => t.status === 'running' || t.status === 'paused');
    this.renderTasks();
  }

  injectIcons(container = document) {
    container.querySelectorAll('[data-icon]').forEach(el => {
      const iconName = el.dataset.icon;
      const iconSvg = this.icons[iconName];
      if (iconSvg) {
        const wrapper = document.createElement('span');
        wrapper.className = 'icon-wrapper';
        wrapper.innerHTML = iconSvg;
        if (el.querySelector('.icon-wrapper')) {
          el.querySelector('.icon-wrapper').replaceWith(wrapper);
        } else {
          // 替换所有子节点为图标（如果是按钮的话）
          if (el.tagName === 'BUTTON') {
            el.innerHTML = '';
            el.appendChild(wrapper);
          } else {
            el.innerHTML = '';
            el.appendChild(wrapper);
          }
        }
      }
    });
  }

  renderTasks() {
    // 防抖：合并多次快速更新，避免频繁 DOM 重建
    if (this._renderTasksScheduled) return;
    this._renderTasksScheduled = true;
    requestAnimationFrame(() => {
      this._renderTasksScheduled = false;
      this._doRenderTasks();
    });
  }

  _doRenderTasks() {
    const content = this.processPanelContent;
    if (!content) return;

    // 更新任务面板按钮徽章
    this.updateTaskPanelButton();

    if (this.tasks.length === 0) {
      content.innerHTML = `
        <div class="status-center-empty">
          <span data-icon="activity"></span>
          <span>暂无正在进行的任务</span>
        </div>
      `;
      return;
    }

    content.innerHTML = '';

    const finishedCount = this.tasks.filter(t => t.status === 'completed' || t.status === 'cancelled').length;

    // 面板头部
    if (this.tasks.length > 0) {
      const header = document.createElement('div');
      header.className = 'status-center-panel-header';
      header.innerHTML = `
        <span class="status-center-panel-title">任务 (${this.tasks.length})</span>
        <div class="status-center-panel-actions">
          ${finishedCount > 0 ? `<button class="status-center-panel-clear" data-icon="delete" title="清除已完成和取消的任务"></button>` : ''}
        </div>
      `;
      content.appendChild(header);

      this.injectIcons(header);

      const clearBtn = header.querySelector('.status-center-panel-clear');
      if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.clearFinishedTasks();
        });
      }
    }

    this.tasks.forEach(task => {
      const icon = task.type === 'copy' ? this.icons.copy :
                   task.type === 'move' ? this.icons.cut :
                   task.type === 'size' ? this.icons.chart : this.icons.activity;

      const statusText = task.status === 'running' ? '进行中' :
                         task.status === 'completed' ? '已完成' : '已取消';

      const isIndeterminate = task.indeterminate && task.status === 'running';

      let progressBarClass = 'status-center-task-progress-bar';
      if (task.status === 'completed') {
        progressBarClass += ' status-center-task-progress-bar--complete';
      } else if (task.status === 'cancelled') {
        progressBarClass += ' status-center-task-progress-bar--cancelled';
      } else if (isIndeterminate) {
        progressBarClass += ' status-center-task-progress-bar--indeterminate';
      }

      const progressStyle = isIndeterminate ? '' : `style="width: ${task.progress}%"`;

      const currentFileText = isIndeterminate
        ? (task.currentFile || '正在统计大小...')
        : (task.currentFile || '');

      const infoText = isIndeterminate
        ? (task.targetPath || '')
        : (task.totalFiles > 0
          ? `${task.completedFiles}/${task.totalFiles} 文件`
          : task.totalSize > 0
            ? `${this.formatFileSize(task.completedSize)} / ${this.formatFileSize(task.totalSize)}` : '');

      const infoTextNeedsEllipsis = isIndeterminate && !!task.targetPath;

      const isPaused = task.status === 'paused';
      const isFinished = task.status === 'completed' || task.status === 'cancelled';

      const div = document.createElement('div');
      div.className = 'status-center-task';
      div.innerHTML = `
        <div class="status-center-task-header">
          <div class="status-center-task-icon">${icon}</div>
          <div class="status-center-task-name">${task.name}</div>
          <span class="status-center-task-status">${isPaused ? '已暂停' : statusText}</span>
          ${task.status === 'running' ? `<button class="status-center-task-pause" data-task-id="${task.id}" data-icon="pause" title="暂停"></button>` : ''}
          ${isPaused ? `<button class="status-center-task-resume" data-task-id="${task.id}" data-icon="resume" title="继续"></button>` : ''}
          ${(task.status === 'running' || isPaused) ? `<button class="status-center-task-cancel" data-task-id="${task.id}" data-icon="close" title="取消"></button>` : ''}
          ${isFinished ? `<button class="status-center-task-remove" data-task-id="${task.id}" data-icon="delete" title="清除该任务"></button>` : ''}
        </div>
        <div class="status-center-task-progress">
          <div class="${progressBarClass}" ${progressStyle}></div>
        </div>
        <div class="status-center-task-info">
          <span>${currentFileText}</span>
          <span class="${infoTextNeedsEllipsis ? 'status-center-task-info-ellipsis' : ''}">${infoText}</span>
        </div>
      `;

      this.injectIcons(div);

      const pauseBtn = div.querySelector('.status-center-task-pause');
      if (pauseBtn) {
        pauseBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.pauseTask(task.id);
        });
      }

      const resumeBtn = div.querySelector('.status-center-task-resume');
      if (resumeBtn) {
        resumeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.resumeTask(task.id);
        });
      }

      const cancelBtn = div.querySelector('.status-center-task-cancel');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.cancelTask(task.id);
          try {
            const { ipcRenderer } = require('electron');
            ipcRenderer.invoke('calc-size-cancel', { taskId: task.id });
          } catch {}
        });
      }

      const removeBtn = div.querySelector('.status-center-task-remove');
      if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removeTask(task.id);
        });
      }

      content.appendChild(div);
    });
  }

  async updateInfoPanel(path) {
    if (!path) return;

    try {
      const stats = await this.vfs.stat(path);
      if (!stats) return;

      const name = path.split('/').pop();
      const dir = this.getParentPath(path);
      const isDir = stats.isDirectory ? stats.isDirectory() : false;

      // 检查缓存
      const cachedSize = this.sizeCache.get(path);
      let size, fileCount;
      if (isDir && cachedSize) {
        if (cachedSize.status === 'virtual') {
          size = '无';
          fileCount = '无';
        } else if (cachedSize.status === 'ok') {
          size = '<span class="info-size-btn" data-path="' + path + '" style="cursor:pointer" title="点击重新计算">' + cachedSize.text + '</span>';
          fileCount = '<span class="info-filecount-value">' + (cachedSize.fileCount ? cachedSize.fileCount.toLocaleString() + ' 个文件' : '--') + '</span>';
        } else {
          size = '<button class="info-size-btn" data-path="' + path + '">查看</button>';
          fileCount = '<span class="info-filecount-value">--</span>';
        }
      } else if (isDir) {
        size = '<button class="info-size-btn" data-path="' + path + '">查看</button>';
        fileCount = '<span class="info-filecount-value">--</span>';
      } else {
        size = this.formatFileSize(stats.size);
        fileCount = '--';
      }
      const type = isDir ? '文件夹' : this.getFileType(name);
      const modified = stats.mtime ? stats.mtime.toLocaleString('zh-CN') : '-';
      const created = stats.birthtime ? stats.birthtime.toLocaleString('zh-CN') : '-';

      this.infoProperties.innerHTML = `
        <div class="info-row">
          <span class="info-label">名称</span>
          <span class="info-value">${name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">类型</span>
          <span class="info-value">${type}</span>
        </div>
        <div class="info-row">
          <span class="info-label">大小</span>
          <span class="info-value">${size}</span>
        </div>
        <div class="info-row">
          <span class="info-label">文件数</span>
          <span class="info-value">${fileCount}</span>
        </div>
        <div class="info-row">
          <span class="info-label">位置</span>
          <span class="info-value">${dir}</span>
        </div>
        <div class="info-row">
          <span class="info-label">修改日期</span>
          <span class="info-value">${modified}</span>
        </div>
        <div class="info-row">
          <span class="info-label">创建日期</span>
          <span class="info-value">${created}</span>
        </div>
      `;

      if (isDir) {
        const sizeBtn = this.infoProperties.querySelector('.info-size-btn');
        const fileCountValue = this.infoProperties.querySelector('.info-filecount-value');

        const updateInfo = async () => {
          if (sizeBtn.dataset.loading) return;

          sizeBtn.dataset.loading = 'true';
          sizeBtn.textContent = '计算中...';
          if (fileCountValue) {
            fileCountValue.textContent = '计算中...';
          }

          const result = await this.calculateDirectorySize(path);
          if (result.status === 'virtual') {
            sizeBtn.textContent = '无';
            if (fileCountValue) fileCountValue.textContent = '无';
            this.sizeCache.set(path, { status: 'virtual', text: '无' });
          } else if (result.status === 'error') {
            sizeBtn.textContent = '错误';
            if (fileCountValue) fileCountValue.textContent = '--';
            this.sizeCache.delete(path);
          } else if (result.status === 'cancelled') {
            // 取消后恢复为"查看"按钮，文件数显示"--"
            sizeBtn.textContent = '查看';
            if (fileCountValue) fileCountValue.textContent = '--';
            this.sizeCache.delete(path);
          } else {
            const sizeText = this.formatFileSize(result.size);
            sizeBtn.textContent = sizeText;
            if (fileCountValue) fileCountValue.textContent = result.fileCount.toLocaleString() + ' 个文件';
            this.sizeCache.set(path, { status: 'ok', size: result.size, fileCount: result.fileCount, text: sizeText });
          }
          delete sizeBtn.dataset.loading;
        };

        sizeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await updateInfo();
        });
      }

      let iconSvg = '';
      if (stats.isDirectory()) {
        iconSvg = this.icons.folder;
      } else if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.gif')) {
        iconSvg = (this.icons.types && this.icons.types.png) || this.icons.image || this.icons.file;
      } else {
        iconSvg = this.icons.file;
      }

      this.infoPreview.innerHTML = `
        <div class="preview-placeholder">
          ${iconSvg}
        </div>
      `;

    } catch (err) {
      console.error('Failed to get file info:', err);
    }
  }

  initViewButtons() {
    const listBtn = document.getElementById('view-list-btn');
    const gridBtn = document.getElementById('view-grid-btn');
    const columnBtn = document.getElementById('view-column-btn');

    listBtn.addEventListener('click', () => {
      this.switchView('list');
    });

    gridBtn.addEventListener('click', () => {
      this.switchView('grid');
    });

    columnBtn?.addEventListener('click', () => {
      this.toggleSplitView();
    });

    // 绑定左侧面板视图按钮事件
    const leftPaneListBtn = document.querySelector('#file-pane-left .pane-view-controls .pane-btn[data-icon="list"]');
    const leftPaneGridBtn = document.querySelector('#file-pane-left .pane-view-controls .pane-btn[data-icon="grid"]');
    if (leftPaneListBtn) {
      leftPaneListBtn.addEventListener('click', () => this.switchView('list', 'left'));
    }
    if (leftPaneGridBtn) {
      leftPaneGridBtn.addEventListener('click', () => this.switchView('grid', 'left'));
    }

    // 绑定右侧面板视图按钮事件
    const rightPaneListBtn = document.querySelector('#file-pane-right .pane-view-controls .pane-btn[data-icon="list"]');
    const rightPaneGridBtn = document.querySelector('#file-pane-right .pane-view-controls .pane-btn[data-icon="grid"]');
    if (rightPaneListBtn) {
      rightPaneListBtn.addEventListener('click', () => this.switchView('list', 'right'));
    }
    if (rightPaneGridBtn) {
      rightPaneGridBtn.addEventListener('click', () => this.switchView('grid', 'right'));
    }

    // 初始状态：单面板模式隐藏左侧面板子控件（pane-header）
    const leftPaneHeader = document.querySelector('#file-pane-left .pane-header');
    if (leftPaneHeader) {
      leftPaneHeader.classList.add('is-hidden');
    }
  }

  toggleSplitView() {
    const rightPane = document.getElementById('file-pane-right');
    const divider = document.getElementById('pane-divider');
    const columnBtn = document.getElementById('view-column-btn');
    const navControls = document.getElementById('toolbar-nav-controls');
    const syncControls = document.getElementById('toolbar-sync-controls');
    const addressBar = document.getElementById('file-browser-address-bar');
    const leftPaneHeader = document.querySelector('#file-pane-left .pane-header');
    const rightPaneHeader = document.querySelector('#file-pane-right .pane-header');
    const leftPaneViewControls = document.querySelector('#file-pane-left .pane-view-controls');
    const rightPaneViewControls = document.querySelector('#file-pane-right .pane-view-controls');
    const topListViewBtn = document.getElementById('view-list-btn');
    const topGridViewBtn = document.getElementById('view-grid-btn');
    const globalStatusBar = document.getElementById('file-browser-status-bar');
    const leftPaneStatusBar = document.querySelector('#file-pane-left .pane-status-bar');
    const rightPaneStatusBar = document.querySelector('#file-pane-right .pane-status-bar');

    if (rightPane && divider) {
      if (rightPane.classList.contains('is-hidden')) {
        // 开启双面板
        rightPane.classList.remove('is-hidden');
        divider.classList.remove('is-hidden');
        columnBtn?.classList.add('active');

        // 隐藏顶栏：导航控件、地址栏、列表/网格视图按钮
        if (navControls) navControls.classList.add('is-hidden');
        if (addressBar) addressBar.classList.add('is-hidden');
        if (topListViewBtn) topListViewBtn.classList.add('is-hidden');
        if (topGridViewBtn) topGridViewBtn.classList.add('is-hidden');
        if (syncControls) syncControls.classList.remove('is-hidden');

        // 显示子控件：pane-header（包含地址栏和视图按钮）
        if (leftPaneHeader) leftPaneHeader.classList.remove('is-hidden');
        if (rightPaneHeader) rightPaneHeader.classList.remove('is-hidden');
        if (leftPaneViewControls) leftPaneViewControls.classList.remove('is-hidden');
        if (rightPaneViewControls) rightPaneViewControls.classList.remove('is-hidden');

        // 分栏视图：隐藏全局底栏，显示各面板底栏
        if (globalStatusBar) globalStatusBar.classList.add('is-hidden');
        if (leftPaneStatusBar) leftPaneStatusBar.classList.remove('is-hidden');
        if (rightPaneStatusBar) rightPaneStatusBar.classList.remove('is-hidden');

        // 初始化右侧历史
        this.rightPaneHistory = [this.currentPath || '/'];
        this.rightPaneHistoryIndex = 0;

        // 更新右侧面板路径
        if (this.currentPath) {
          this.loadRightPanel(this.currentPath, false);
        }

        // 更新子控件视图按钮状态
        this.updatePaneViewControls();
      } else {
        // 关闭双面板
        rightPane.classList.add('is-hidden');
        divider.classList.add('is-hidden');
        columnBtn?.classList.remove('active');

        // 恢复顶栏：导航控件、地址栏、列表/网格视图按钮
        if (navControls) navControls.classList.remove('is-hidden');
        if (addressBar) addressBar.classList.remove('is-hidden');
        if (topListViewBtn) topListViewBtn.classList.remove('is-hidden');
        if (topGridViewBtn) topGridViewBtn.classList.remove('is-hidden');
        if (syncControls) syncControls.classList.add('is-hidden');

        // 隐藏子控件：所有 pane-header（单面板模式下不需要）
        if (leftPaneHeader) leftPaneHeader.classList.add('is-hidden');
        if (rightPaneHeader) rightPaneHeader.classList.add('is-hidden');

        // 单面板视图：显示全局底栏，隐藏面板底栏
        if (globalStatusBar) globalStatusBar.classList.remove('is-hidden');
        if (leftPaneStatusBar) leftPaneStatusBar.classList.add('is-hidden');
        if (rightPaneStatusBar) rightPaneStatusBar.classList.add('is-hidden');
      }
    }

    // 更新筛选面板状态（如果已打开）
    const filterPanel = document.getElementById('filter-panel');
    if (filterPanel && !filterPanel.classList.contains('is-hidden')) {
      const filterBtn = document.getElementById('browser-filter-btn');
      const isSplitView = rightPane && !rightPane.classList.contains('is-hidden');
      const paneSelect = document.getElementById('filter-pane-select');
      if (paneSelect) {
        paneSelect.disabled = !isSplitView;
        if (!isSplitView) paneSelect.value = 'left';
      }
      if (filterBtn) {
        filterBtn.classList.toggle('active', this.isFilterActive(this.leftPaneFilter) || this.isFilterActive(this.rightPaneFilter));
      }
    }
  }

  updatePaneViewControls() {
    const leftListBtn = document.querySelector('#file-pane-left .pane-view-controls .pane-btn[data-icon="list"]');
    const leftGridBtn = document.querySelector('#file-pane-left .pane-view-controls .pane-btn[data-icon="grid"]');
    const rightListBtn = document.querySelector('#file-pane-right .pane-view-controls .pane-btn[data-icon="list"]');
    const rightGridBtn = document.querySelector('#file-pane-right .pane-view-controls .pane-btn[data-icon="grid"]');

    const updateBtn = (btn, active) => {
      if (btn) {
        if (active) btn.classList.add('active');
        else btn.classList.remove('active');
      }
    };

    updateBtn(leftListBtn, this.leftPaneView === 'list');
    updateBtn(leftGridBtn, this.leftPaneView === 'grid');
    updateBtn(rightListBtn, this.rightPaneView === 'list');
    updateBtn(rightGridBtn, this.rightPaneView === 'grid');
  }

  loadRightPanel(path, updateHistory = true) {
    const rightList = document.getElementById('file-list-right');
    const rightGrid = document.getElementById('grid-container-right');
    const rightListView = document.getElementById('file-list-view-right');
    const rightGridView = document.getElementById('file-grid-view-right');
    const rightStatusText = document.querySelector('#file-pane-right .pane-status-text');
    const rightAddressInput = document.getElementById('pane-right-address');

    // 记录右侧面板当前路径
    this.currentRightPanePath = path;

    // 防并发：如果正在加载右侧面板，取消之前的操作
    if (this._rightLoadToken !== undefined) {
      this._rightLoadCancelled = true;
    }
    const currentRightToken = Date.now();
    this._rightLoadToken = currentRightToken;
    this._rightLoadCancelled = false;

    const checkRightCancelled = () => {
      if (this._rightLoadCancelled || this._rightLoadToken !== currentRightToken) {
        throw new Error('cancelled');
      }
    };

    if (rightAddressInput) {
      rightAddressInput.value = path;
    }

    if (updateHistory && this.rightPaneHistory) {
      this.rightPaneHistory = this.rightPaneHistory.slice(0, this.rightPaneHistoryIndex + 1);
      if (this.rightPaneHistory[this.rightPaneHistoryIndex] !== path) {
        this.rightPaneHistory.push(path);
        this.rightPaneHistoryIndex = this.rightPaneHistory.length - 1;
      }
    }

    // 清空两个容器，确保没有残留数据
    if (rightList) rightList.innerHTML = '';
    if (rightGrid) rightGrid.innerHTML = '';

    // 根据视图类型显示对应容器
    if (this.rightPaneView === 'list') {
      if (rightListView) rightListView.classList.remove('is-hidden');
      if (rightGridView) rightGridView.classList.add('is-hidden');
    } else if (this.rightPaneView === 'grid') {
      if (rightListView) rightListView.classList.add('is-hidden');
      if (rightGridView) rightGridView.classList.remove('is-hidden');
    }

    this.vfs.readdir(path).then(async entries => {
      checkRightCancelled();

      const fsMod = require('fs');

      const files = await Promise.all(entries.map(async entry => {
        const fullPath = this.joinPath(path, entry.name);
        const isVirtual = path === '/dev' || path.startsWith('/dev/') || entry.is_virtual === true;
        let isDir = path !== '/dev' && !path.startsWith('/dev/') && entry.type === 'dir';
        let isSymlink = false;
        let size = entry.size || 0;

        if (!isVirtual) {
          try {
            const winPath = this.vfs.unixToWindowsPath(fullPath);
            if (winPath) {
              try {
                const lstat = fsMod.lstatSync(winPath);
                if (lstat.isSymbolicLink()) {
                  isSymlink = true;
                  const stat = fsMod.statSync(winPath);
                  isDir = stat.isDirectory();
                  size = stat.size;
                } else {
                  if (!isDir && lstat.isDirectory()) {
                    isDir = true;
                  }
                  if (!isDir) {
                    size = lstat.size;
                  }
                }
              } catch (e) {
                // lstat 失败时用原逻辑
              }
            }
          } catch (e) {
          }
        }

        return {
          name: entry.name,
          isDirectory: isDir,
          isSymlink: isSymlink,
          size: size,
          mtime: entry.mtime || ''
        };
      }));

      const filtered = files.filter(f => f.name);

      const sortedFiles = filtered.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name, 'zh-CN');
      });

      const totalCount = sortedFiles.length;
      this._rightPaneTotalCount = totalCount;
      const filteredFiles = this.applyFilter(sortedFiles, this.rightPaneFilter);

      const fileData = filteredFiles.map(file => {
        const fullPath = this.joinPath(path, file.name);
        const stats = {
          isDirectory: () => file.isDirectory,
          isFile: () => !file.isDirectory,
          size: file.size,
          mtime: new Date(file.mtime || Date.now()),
          isVirtual: path === '/dev' || path.startsWith('/dev/'),
          isSymbolicLink: file.isSymlink === true
        };
        return { file, fullPath, stats };
      });

      // 在追加文件前再次检查并清空容器
      checkRightCancelled();
      if (rightList) rightList.innerHTML = '';
      if (rightGrid) rightGrid.innerHTML = '';

      fileData.forEach(({ file, fullPath, stats }) => {
        if (this.rightPaneView === 'list' && rightList) {
          const item = this.createFileItem(file, fullPath, stats);
          rightList.appendChild(item);
        }
        if (this.rightPaneView === 'grid' && rightGrid) {
          const gridItem = this.createGridItem(file, fullPath, stats);
          rightGrid.appendChild(gridItem);
        }
      });

      if (rightStatusText) {
        if (this.isFilterActive(this.rightPaneFilter)) {
          rightStatusText.textContent = `${filteredFiles.length} / ${totalCount} 个项目 (已筛选)`;
        } else {
          rightStatusText.textContent = `${totalCount} 个项目`;
        }
      }

      const calcToken = Date.now();
      this.autoCalcRightPanelSizes(fileData, calcToken);
    }).catch(err => {
      if (err.message === 'cancelled') return;
      console.error('Failed to load right panel:', err);
    });
  }

  syncPanes() {
    const rightAddressInput = document.getElementById('pane-right-address');
    const rightPath = rightAddressInput?.value || '/';

    // 根据活动面板决定同步方向
    if (this.activePane === 'right') {
      // 用户最近操作的是右侧面板，将左侧同步为右侧
      if (rightPath) {
        this.loadDirectory(rightPath);
      }
    } else {
      // 用户最近操作的是左侧面板，将右侧同步为左侧
      if (this.currentPath) {
        this.loadRightPanel(this.currentPath);
      }
    }
  }

  switchView(view, pane) {
    let needReload = false;

    if (pane === 'left') {
      if (this.leftPaneView !== view) needReload = true;
      this.leftPaneView = view;
    } else if (pane === 'right') {
      if (this.rightPaneView !== view) needReload = true;
      this.rightPaneView = view;
    } else {
      if (this.currentView !== view) needReload = true;
      this.currentView = view;
      this.leftPaneView = view;
      this.rightPaneView = view;
    }

    const listBtn = document.getElementById('view-list-btn');
    const gridBtn = document.getElementById('view-grid-btn');
    const columnBtn = document.getElementById('view-column-btn');

    const leftListView = document.getElementById('file-list-view-left');
    const leftGridView = document.getElementById('file-grid-view-left');
    const rightListView = document.getElementById('file-list-view-right');
    const rightGridView = document.getElementById('file-grid-view-right');

    const applyPaneView = (listView, gridView, paneView) => {
      if (paneView === 'list') {
        if (listView) listView.classList.remove('is-hidden');
        if (gridView) gridView.classList.add('is-hidden');
      } else if (paneView === 'grid') {
        if (listView) listView.classList.add('is-hidden');
        if (gridView) gridView.classList.remove('is-hidden');
      }
    };

    if (!pane || pane === 'left') {
      applyPaneView(leftListView, leftGridView, this.leftPaneView);
    }
    if (!pane || pane === 'right') {
      applyPaneView(rightListView, rightGridView, this.rightPaneView);
    }

    if (!pane) {
      if (view === 'list') {
        listBtn?.classList.add('active');
        gridBtn?.classList.remove('active');
      } else if (view === 'grid') {
        listBtn?.classList.remove('active');
        gridBtn?.classList.add('active');
      }
    }

    this.updatePaneViewControls();

    // 如果视图发生了变化，重新加载数据
    if (needReload) {
      if (pane === 'right') {
        const rightAddressInput = document.getElementById('pane-right-address');
        const rightPath = rightAddressInput?.value || '/';
        this.loadRightPanel(rightPath, false);
      } else if (pane === 'left') {
        // 左侧面板视图变化时，重新加载当前目录
        if (this.currentPath) {
          this.loadDirectory(this.currentPath);
        }
      } else if (!pane) {
        // 全局视图切换时，同步刷新两侧
        this.loadDirectory(this.currentPath);
        const rightAddressInput = document.getElementById('pane-right-address');
        if (rightAddressInput) {
          const rightPath = rightAddressInput.value;
          this.loadRightPanel(rightPath, false);
        }
      }
    }
  }

  initSidebar() {
    document.querySelectorAll('[data-icon]').forEach(btn => {
      const iconName = btn.dataset.icon;
      const iconSvg = this.icons[iconName];
      if (iconSvg) {
        if (btn.querySelector('.icon-wrapper')) {
          btn.querySelector('.icon-wrapper').innerHTML = iconSvg;
        } else {
          const iconWrapper = document.createElement('span');
          iconWrapper.className = 'icon-wrapper';
          iconWrapper.innerHTML = iconSvg;
          btn.insertBefore(iconWrapper, btn.firstChild);
        }
      }
    });

    document.querySelectorAll('.nav-sidebar-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('.nav-sidebar-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const location = btn.dataset.location;
        const userPaths = this.vfs.getUserPaths();
        switch (location) {
          case 'home':
            this.goHome();
            break;
          case 'desktop':
            this.loadDirectory(userPaths.desktop);
            break;
          case 'downloads':
            this.loadDirectory(userPaths.downloads);
            break;
          case 'documents':
            this.loadDirectory(userPaths.documents);
            break;
          case 'pictures':
            this.loadDirectory(userPaths.pictures);
            break;
          case 'music':
            this.loadDirectory(userPaths.music);
            break;
          case 'videos':
            this.loadDirectory(userPaths.videos);
            break;
          case 'trash':
            this.loadDirectory(userPaths.recycleBin);
            break;
        }
      });
    });

    document.querySelectorAll('.nav-sidebar-drive').forEach(btn => {
      btn.addEventListener('click', async () => {
        const path = btn.dataset.path;
        const location = btn.dataset.location;

        if (path) {
          const unixPath = await this.vfs.toUnix(path);
          this.loadDirectory(unixPath);
        } else if (location === 'network') {
          this.showDialog('网络', '网络功能需要系统支持', 'info');
        }
      });
    });
  }

  initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;

      if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        this.showCommandPalette();
      }

      if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        this.createNewTab();
      }

      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        this.closeTab(this.currentTabId);
      }

      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        this.createNewFile();
      }

      if (e.ctrlKey && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        this.createNewFolder();
      }

      if (e.ctrlKey && e.key === 'a') {
        e.preventDefault();
        this.selectAll();
      }

      if (e.key === 'Delete') {
        e.preventDefault();
        if (this.selectedItems.length > 0) {
          const trashPath = this.vfs.getTrashPath();
          const isInTrash = this.currentPath === trashPath.unix;

          if (isInTrash) {
            this.confirmAction(`确定要永久删除 ${this.selectedItems.length} 个项目吗？此操作不可恢复！`, () => {
              this.permanentlyDeleteItems();
            });
          } else {
            this.confirmAction(`确定要将 ${this.selectedItems.length} 个项目移到回收站吗？`, () => {
              this.deleteItems();
            });
          }
        }
      }

      if (e.key === 'F2') {
        e.preventDefault();
        if (this.selectedItems.length === 1) {
          this.renameItem(this.selectedItems[0]);
        }
      }

      if (e.key === 'F5') {
        e.preventDefault();
        this.refresh();
      }

      if (e.ctrlKey && e.key === 'c') {
        e.preventDefault();
        if (this.selectedItems.length > 0) {
          this.copyMode = 'copy';
          this.copyBuffer = [...this.selectedItems];
        }
      }

      if (e.ctrlKey && e.key === 'x') {
        e.preventDefault();
        if (this.selectedItems.length > 0) {
          this.copyMode = 'cut';
          this.copyBuffer = [...this.selectedItems];
          this.markCutItems();
        }
      }

      if (e.ctrlKey && e.key === 'v') {
        e.preventDefault();
        this.pasteItems();
      }

      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        this.goBack();
      }

      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        this.goForward();
      }

      if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        this.goUp();
      }

      if (e.ctrlKey && e.shiftKey && e.key === '1') {
        e.preventDefault();
        this.switchView('list');
      }

      if (e.ctrlKey && e.shiftKey && e.key === '2') {
        e.preventDefault();
        this.switchView('grid');
      }

      if (e.ctrlKey && e.shiftKey && e.key === '3') {
        e.preventDefault();
        this.switchView('column');
      }

      if (e.ctrlKey && e.key === 'i') {
        e.preventDefault();
        this.toggleInfoPanel();
      }

      if (e.key === 'Enter') {
        if (this.selectedItems.length === 1) {
          const item = document.querySelector(`[data-path="${this.selectedItems[0]}"]`);
          if (item) {
            this.handleFileDoubleClick(item);
          }
        }
      }
    });
  }

  showDialog(title, content, type = 'info', callback = null) {
    const overlay = document.getElementById('dialog-overlay');
    const dialog = document.getElementById('dialog');
    const dialogTitle = document.getElementById('dialog-title');
    const dialogBody = document.getElementById('dialog-body');
    const dialogConfirm = document.getElementById('dialog-confirm');
    const dialogCancel = document.getElementById('dialog-cancel');

    dialogTitle.textContent = title;
    dialogBody.innerHTML = content;

    if (type === 'error') {
      dialogConfirm.textContent = '确定';
      dialogCancel.style.display = 'none';
    } else if (type === 'confirm') {
      dialogConfirm.textContent = '确定';
      dialogCancel.textContent = '取消';
      dialogCancel.style.display = 'block';
    } else if (type === 'input') {
      dialogConfirm.textContent = '确定';
      dialogCancel.textContent = '取消';
      dialogCancel.style.display = 'block';
    } else {
      dialogConfirm.textContent = '确定';
      dialogCancel.style.display = 'none';
    }

    overlay.classList.add('active');
    dialog.classList.add('active');

    const close = () => {
      overlay.classList.remove('active');
      dialog.classList.remove('active');
      dialogConfirm.removeEventListener('click', onConfirm);
      dialogCancel.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKeyDown);
    };

    const onConfirm = () => {
      if (type === 'input') {
        const input = dialogBody.querySelector('input');
        if (callback) callback(input.value);
      } else {
        if (callback) callback();
      }
      close();
    };

    const onCancel = () => {
      close();
    };

    const onKeyDown = (e) => {
      if (e.key === 'Enter') {
        onConfirm();
      } else if (e.key === 'Escape') {
        onCancel();
      }
    };

    dialogConfirm.addEventListener('click', onConfirm);
    dialogCancel.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKeyDown);

    if (type === 'input') {
      const input = dialogBody.querySelector('input');
      setTimeout(() => {
        input?.focus();
        input?.select();
      }, 100);
    }
  }

  // ========== Launchpad 启动台 ==========

  initLaunchpad() {
    const { ipcRenderer } = require('electron');
    this.ipcRenderer = ipcRenderer;

    // 启动台状态
    this.launchpadState = {
      isOpen: false,
      isSearching: false,
      results: [],
      selectedIndex: -1,
      mode: 'idle',
      recentSearches: [],
      recentRuns: [],
      debounceTimer: null,
      isPathSearch: false
    };

    // 从 config 文件加载历史（异步）
    this.loadLaunchpadHistory();

    // 获取 DOM 元素
    this.launchpadOverlay = document.getElementById('launchpad-overlay');
    this.launchpadInput = document.getElementById('launchpad-input');
    this.launchpadCloseBtn = document.getElementById('launchpad-close-btn');
    this.launchpadSearchBtn = document.getElementById('launchpad-search-btn');
    this.launchpadContent = document.getElementById('launchpad-content');
    this.launchpadEmpty = document.getElementById('launchpad-empty');
    this.launchpadResults = document.getElementById('launchpad-results');
    this.launchpadResultsList = document.getElementById('launchpad-results-list');
    this.launchpadFooter = document.getElementById('launchpad-footer');
    this.launchpadHint = document.getElementById('launchpad-hint');
    this.launchpadCount = document.getElementById('launchpad-count');
    this.launchpadModeIndicator = document.getElementById('launchpad-mode-indicator');
    this.launchpadRecentSearches = document.getElementById('launchpad-recent-searches');
    this.launchpadRecentRuns = document.getElementById('launchpad-recent-runs');

    if (!this.launchpadOverlay) return;

    // 绑定事件
    this.bindLaunchpadEvents();

  }

  async loadLaunchpadHistory() {
    try {
      const { ipcRenderer } = require('electron');
      const result = await ipcRenderer.invoke('config-read-history');
      if (result.success) {
        this.launchpadState.recentSearches = result.searches || [];
        this.launchpadState.recentRuns = result.runs || [];
        // 加载完成后刷新 UI
        this.renderLaunchpadEmpty();
      }
    } catch (e) {
      console.error('Failed to load launchpad history:', e);
    }
  }

  saveLaunchpadHistory() {
    try {
      const { ipcRenderer } = require('electron');
      ipcRenderer.invoke('config-write-history', {
        searches: this.launchpadState.recentSearches.slice(0, 20),
        runs: this.launchpadState.recentRuns.slice(0, 10)
      }).catch(e => console.error('Failed to save launchpad history:', e));
    } catch (e) {
      console.error('Failed to save launchpad history:', e);
    }
  }

  addToRecentSearches(query) {
    if (!query.trim()) return;
    if (this.settings?.saveHistory === false) return;
    const idx = this.launchpadState.recentSearches.indexOf(query);
    if (idx > -1) this.launchpadState.recentSearches.splice(idx, 1);
    this.launchpadState.recentSearches.unshift(query);
    this.launchpadState.recentSearches = this.launchpadState.recentSearches.slice(0, 20);
    this.saveLaunchpadHistory();
  }

  addToRecentRuns(command) {
    if (!command.trim()) return;
    if (this.settings?.saveHistory === false) return;
    const idx = this.launchpadState.recentRuns.indexOf(command);
    if (idx > -1) this.launchpadState.recentRuns.splice(idx, 1);
    this.launchpadState.recentRuns.unshift(command);
    this.launchpadState.recentRuns = this.launchpadState.recentRuns.slice(0, 10);
    this.saveLaunchpadHistory();
  }

  clearRecentSearches() {
    this.launchpadState.recentSearches = [];
    this.saveLaunchpadHistory();
    this.renderLaunchpadEmpty();
  }

  clearRecentRuns() {
    this.launchpadState.recentRuns = [];
    this.saveLaunchpadHistory();
    this.renderLaunchpadEmpty();
  }

  bindLaunchpadEvents() {
    // 打开启动台
    document.getElementById('command-palette-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.openLaunchpad();
    });

    // 关闭按钮
    this.launchpadCloseBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeLaunchpad();
    });

    // 模式指示器：点击切换搜索/运行模式
    this.launchpadModeIndicator?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleLaunchpadMode();
    });

    // 清空按钮
    document.querySelectorAll('.launchpad-clear-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const type = btn.dataset.clear;
        if (type === 'searches') {
          this.clearRecentSearches();
        } else if (type === 'runs') {
          this.clearRecentRuns();
        }
      });
    });

    // 点击背景关闭
    this.launchpadOverlay?.addEventListener('click', (e) => {
      if (e.target === this.launchpadOverlay) {
        this.closeLaunchpad();
      }
    });

    // 输入事件
    this.launchpadInput?.addEventListener('input', (e) => {
      this.handleLaunchpadInput(e.target.value);
    });

    // 键盘导航
    this.launchpadInput?.addEventListener('keydown', (e) => {
      this.handleLaunchpadKeyDown(e);
    });

    // Esc 关闭（全局）
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.launchpadState.isOpen) {
        this.closeLaunchpad();
      }
      // Ctrl+P 打开
      if ((e.ctrlKey || e.metaKey) && e.key === 'p' && !e.shiftKey) {
        e.preventDefault();
        this.openLaunchpad();
      }
    });
  }

  handleSearchButtonClick() {
    const value = (this.launchpadInput?.value || '').trim();
    if (!value) return;

    if (this.launchpadState.mode === 'run' || value.startsWith('>')) {
      this.runCommand(value.startsWith('>') ? value : value);
      this.closeLaunchpad();
    } else {
      if (this.launchpadState.debounceTimer) {
        clearTimeout(this.launchpadState.debounceTimer);
        this.launchpadState.debounceTimer = null;
      }
      this.addToRecentSearches(value);
      this.performSearch(value);
    }
  }

  toggleLaunchpadMode() {
    const currentMode = this.launchpadState.mode;
    const input = this.launchpadInput;
    const value = (input?.value || '').trim();

    if (currentMode === 'search' || (!value && currentMode !== 'run')) {
      // 切换到运行模式
      this.launchpadState.mode = 'run';
      this.updateLaunchpadModeUI();
      if (input && !value) {
        input.value = '>';
        input.focus();
      }
    } else {
      // 切换到搜索模式
      this.launchpadState.mode = 'search';
      this.updateLaunchpadModeUI();
      if (input && value.startsWith('>')) {
        input.value = value.substring(1);
        this.handleLaunchpadInput(input.value);
        input.focus();
      }
    }
  }

  updateLaunchpadModeUI() {
    const indicator = this.launchpadModeIndicator;
    if (!indicator) return;

    const mode = this.launchpadState.mode;

    if (mode === 'run') {
      indicator.textContent = '运行';
      indicator.className = 'launchpad-mode-indicator is-visible mode-run';
    } else if (mode === 'search') {
      indicator.textContent = '搜索';
      indicator.className = 'launchpad-mode-indicator is-visible mode-search';
    } else {
      indicator.textContent = '搜索';
      indicator.className = 'launchpad-mode-indicator is-visible mode-search';
    }

    this.updateHintForMode();
  }

  updateHintForMode() {
    const mode = this.launchpadState.mode;
    if (this.launchpadHint) {
      if (mode === 'run') {
        this.launchpadHint.textContent = '输入命令后按 Enter 运行 · 点击标签切回搜索';
      } else if (mode === 'search') {
        this.launchpadHint.textContent = '输入文件名后按 Enter 搜索 · 输入 > 运行命令 · 点击标签切回运行';
      } else {
        this.launchpadHint.textContent = '输入文件名搜索 · 输入 > 前缀运行命令 · 点击标签切换模式';
      }
    }
  }

  openLaunchpad() {
    this.launchpadState.isOpen = true;
    this.launchpadOverlay?.classList.remove('is-hidden');
    this.launchpadState.mode = 'search';
    this.updateLaunchpadModeUI();
    this.launchpadInput?.focus();
    this.launchpadInput?.select();
    this.showLaunchpadEmpty();
  }

  closeLaunchpad() {
    this.launchpadState.isOpen = false;
    this.launchpadState.results = [];
    this.launchpadState.selectedIndex = -1;
    this.launchpadOverlay?.classList.add('is-hidden');
    if (this.launchpadInput) {
      this.launchpadInput.value = '';
    }
  }

  renderLaunchpadEmpty() {
    if (!this.launchpadEmpty || !this.launchpadRecentSearches || !this.launchpadRecentRuns) return;

    // 渲染最近搜索
    if (this.launchpadState.recentSearches.length > 0) {
      this.launchpadRecentSearches.innerHTML = this.launchpadState.recentSearches
        .map(query => `
          <div class="launchpad-recent-item" data-action="search" data-value="${this.escapeAttr(query)}">
            <div class="launchpad-recent-item-icon">
              <span data-icon="clock"></span>
            </div>
            <div class="launchpad-recent-item-name">${this.escapeHtml(query)}</div>
          </div>
        `).join('');
    } else {
      this.launchpadRecentSearches.innerHTML = '<div class="launchpad-no-history">暂无搜索记录</div>';
    }

    // 渲染最近运行
    if (this.launchpadState.recentRuns.length > 0) {
      this.launchpadRecentRuns.innerHTML = this.launchpadState.recentRuns
        .map(cmd => `
          <div class="launchpad-recent-item" data-action="run" data-value="${this.escapeAttr(cmd)}">
            <div class="launchpad-recent-item-icon">
              <span data-icon="bolt"></span>
            </div>
            <div class="launchpad-recent-item-name">${this.escapeHtml(cmd)}</div>
          </div>
        `).join('');
    } else {
      this.launchpadRecentRuns.innerHTML = '<div class="launchpad-no-history">暂无运行记录</div>';
    }

    // 添加点击事件
    this.launchpadRecentSearches.querySelectorAll('.launchpad-recent-item').forEach(item => {
      item.addEventListener('click', () => {
        const query = item.dataset.value;
        if (query) {
          this.launchpadInput.value = query;
          this.handleLaunchpadInput(query);
        }
      });
    });

    this.launchpadRecentRuns.querySelectorAll('.launchpad-recent-item').forEach(item => {
      item.addEventListener('click', () => {
        const cmd = item.dataset.value;
        if (cmd) {
          this.launchpadInput.value = cmd;
          this.runCommand(cmd);
          this.closeLaunchpad();
        }
      });
    });
  }

  handleLaunchpadInput(value) {
    if (this.launchpadState.debounceTimer) {
      clearTimeout(this.launchpadState.debounceTimer);
    }

    value = (value || '').toString();

    // 检测模式
    this.updateLaunchpadMode(value);

    if (!value.trim()) {
      this.showLaunchpadEmpty();
      return;
    }

    // 如果以 > 开头，直接运行模式
    if (value.startsWith('>')) {
      // 更新底部提示为运行模式
      if (this.launchpadCount) this.launchpadCount.textContent = '';
      if (this.launchpadHint) {
        this.launchpadHint.textContent = '按 Enter 运行 · Esc 关闭';
      }
      return;
    }

    // 防抖搜索
    this.launchpadState.debounceTimer = setTimeout(() => {
      this.performSearch(value);
    }, 200);
  }

  updateLaunchpadMode(value) {
    if (!this.launchpadModeIndicator) return;

    if (!value || !value.trim()) {
      this.launchpadState.mode = 'idle';
      this.launchpadModeIndicator.textContent = '搜索';
      this.launchpadModeIndicator.className = 'launchpad-mode-indicator is-visible mode-search';
      this.updateHintForMode();
      return;
    }

    if (value.startsWith('>')) {
      this.launchpadState.mode = 'run';
    } else if (value.startsWith('http://') || value.startsWith('https://')) {
      this.launchpadState.mode = 'run';
    } else {
      this.launchpadState.mode = 'search';
    }

    this.updateLaunchpadModeUI();
  }

  showLaunchpadEmpty() {
    this.launchpadEmpty?.classList.remove('is-hidden');
    this.launchpadResults?.classList.add('is-hidden');
    if (this.launchpadCount) this.launchpadCount.textContent = '';

    // 根据模式显示不同提示
    this.updateHintForMode();
    this.renderLaunchpadEmpty();
  }

  showLaunchpadResults() {
    this.launchpadEmpty?.classList.add('is-hidden');
    this.launchpadResults?.classList.remove('is-hidden');
  }

  async performSearch(query) {
    if (!this.ipcRenderer) return;

    this.launchpadState.isSearching = true;
    this.showLaunchpadResults();

    try {
      const result = await this.ipcRenderer.invoke('launchpad-search', {
        query: query,
        maxResults: 50
      });

      if (result.error) {
        this.launchpadResultsList.innerHTML = `
          <div style="padding: 20px; text-align: center; color: var(--muted-foreground);">
            <span data-icon="error" style="display:inline-block; margin-bottom:8px;"></span>
            <div style="font-size: 13px;">${this.escapeHtml(result.error)}</div>
          </div>
        `;
        if (this.launchpadCount) this.launchpadCount.textContent = '';
        if (this.launchpadHint) this.launchpadHint.textContent = '搜索出错 · 按 Enter 重试 · Esc 关闭';
        return;
      }

      this.launchpadState.results = result.results || [];
      this.launchpadState.selectedIndex = this.launchpadState.results.length > 0 ? 0 : -1;
      this.launchpadState.isPathSearch = result.pathSearch || false;
      this.renderResults(query);

    } catch (err) {
      console.error('Search failed:', err);
      this.launchpadResultsList.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--destructive);">
          <div style="font-size: 13px;">搜索失败: ${this.escapeHtml(err.message)}</div>
        </div>
      `;
      if (this.launchpadCount) this.launchpadCount.textContent = '';
      if (this.launchpadHint) this.launchpadHint.textContent = '搜索异常 · 按 Enter 重试 · Esc 关闭';
    } finally {
      this.launchpadState.isSearching = false;
    }
  }

  renderResults(query) {
    if (!this.launchpadResultsList) return;

    const results = this.launchpadState.results;
    const isPathSearch = this.launchpadState.isPathSearch;

    this.showLaunchpadResults();

    if (results.length === 0) {
      this.launchpadResultsList.innerHTML = `
        <div style="padding: 30px 20px; text-align: center; color: var(--muted-foreground);">
          <span data-icon="search" style="display:inline-block; margin-bottom:12px; opacity:0.5;"></span>
          <div style="font-size: 13px; margin-bottom:4px;">未找到匹配的文件</div>
          <div style="font-size: 11px; opacity:0.7;">尝试其他关键词或使用更短的搜索词</div>
        </div>
      `;
      if (this.launchpadCount) this.launchpadCount.textContent = '';
      if (this.launchpadHint) this.launchpadHint.textContent = '无结果 · 按 Enter 强制重试 · 按 Esc 关闭';
      return;
    }

    this.launchpadResultsList.innerHTML = results.map((item, idx) => {
      const nameIcon = this.getFileIcon({
        name: item.name,
        isDirectory: item.isDirectory
      });

      const sourceLabel = isPathSearch ? '<span class="launchpad-result-source">PATH</span>' : '';

      return `
        <div class="launchpad-result-item ${idx === this.launchpadState.selectedIndex ? 'is-selected' : ''}"
             data-index="${idx}"
             data-path="${this.escapeAttr(item.path)}"
             data-name="${this.escapeAttr(item.name)}"
             data-is-directory="${item.isDirectory}"
             data-is-path-search="${isPathSearch}">
          <div class="launchpad-result-icon">
            ${nameIcon}
          </div>
          <div class="launchpad-result-info">
            <div class="launchpad-result-name">${this.highlightMatch(item.name, query)}${sourceLabel}</div>
            <div class="launchpad-result-meta">
              <span class="launchpad-result-size">${item.isDirectory ? '📁 文件夹' : this.formatSize(item.size)}</span>
              <span class="launchpad-result-path">${this.escapeHtml(item.path)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // 更新底部提示
    if (this.launchpadCount) this.launchpadCount.textContent = `${results.length} 个结果`;

    if (isPathSearch) {
      if (this.launchpadHint) this.launchpadHint.textContent = '↑↓ 选择 · Enter 运行 · Esc 关闭';
    } else {
      if (this.launchpadHint) {
        this.launchpadHint.textContent = '↑↓ 选择 · Enter 打开 · Ctrl+Enter 定位';
      }
    }

    // 添加点击事件
    this.launchpadResultsList.querySelectorAll('.launchpad-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index);
        this.launchpadState.selectedIndex = index;
        this.updateSelectedResult();
        this.openSelectedResult();
      });
      item.addEventListener('mouseenter', () => {
        const index = parseInt(item.dataset.index);
        this.launchpadState.selectedIndex = index;
        this.updateSelectedResult();
      });
    });
  }

  updateSelectedResult() {
    this.launchpadResultsList?.querySelectorAll('.launchpad-result-item').forEach((item, idx) => {
      if (idx === this.launchpadState.selectedIndex) {
        item.classList.add('is-selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('is-selected');
      }
    });
  }

  highlightMatch(text, query) {
    if (!query) return this.escapeHtml(text);

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const idx = lowerText.indexOf(lowerQuery);

    if (idx === -1) {
      return this.escapeHtml(text);
    }

    return `${this.escapeHtml(text.substring(0, idx))}<mark>${this.escapeHtml(text.substring(idx, idx + query.length))}</mark>${this.escapeHtml(text.substring(idx + query.length))}`;
  }

  handleLaunchpadKeyDown(e) {
    if (!this.launchpadState.isOpen) return;

    const value = (this.launchpadInput?.value || '').trim();
    const mode = this.launchpadState.mode;
    const results = this.launchpadState.results;

    // Enter 键 - 根据模式处理
    if (e.key === 'Enter') {
      e.preventDefault();

      if (mode === 'run' || mode === 'idle') {
        // 运行模式或空输入：直接执行
        if (!value) return;
        this.runCommand(value.startsWith('>') ? value : value);
        this.closeLaunchpad();
        return;
      }

      if (mode === 'search') {
        if (!value) return;

        if (results.length > 0) {
          // 有结果：打开选中项
          if (e.ctrlKey) {
            this.locateSelectedResult();
          } else {
            this.openSelectedResult();
          }
        } else {
          // 无结果：立即触发搜索
          if (this.launchpadState.debounceTimer) {
            clearTimeout(this.launchpadState.debounceTimer);
            this.launchpadState.debounceTimer = null;
          }
          this.addToRecentSearches(value);
          this.performSearch(value);
        }
        return;
      }

      // 其他情况（空值、未知模式）：强制搜索
      if (value) {
        if (this.launchpadState.debounceTimer) {
          clearTimeout(this.launchpadState.debounceTimer);
          this.launchpadState.debounceTimer = null;
        }
        this.addToRecentSearches(value);
        this.performSearch(value);
      }
      return;
    }

    // 导航键
    if (results.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.launchpadState.selectedIndex = (this.launchpadState.selectedIndex + 1) % results.length;
        this.updateSelectedResult();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.launchpadState.selectedIndex = (this.launchpadState.selectedIndex - 1 + results.length) % results.length;
        this.updateSelectedResult();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const selected = results[this.launchpadState.selectedIndex];
        if (selected) {
          this.launchpadInput.value = selected.name;
          this.handleLaunchpadInput(selected.name);
        }
      }
    }
  }

  openSelectedResult() {
    const results = this.launchpadState.results;
    const selected = results[this.launchpadState.selectedIndex];
    if (!selected) return;

    const isPathSearch = this.launchpadState.isPathSearch;

    this.addToRecentSearches(selected.name);

    if (isPathSearch) {
      if (selected.isDirectory) {
        this.ipcRenderer?.invoke('launchpad-run', {
          command: selected.path,
          type: 'folder'
        });
      } else {
        this.ipcRenderer?.invoke('launchpad-run', {
          command: selected.path,
          type: 'file'
        });
      }
      this.closeLaunchpad();
      return;
    }

    if (selected.isDirectory) {
      this.navigateTo(selected.path);
      this.closeLaunchpad();
    } else {
      this.openFileInSystem(selected.path);
      this.closeLaunchpad();
    }
  }

  async locateSelectedResult() {
    const results = this.launchpadState.results;
    const selected = results[this.launchpadState.selectedIndex];
    if (!selected || !this.ipcRenderer) return;

    try {
      await this.ipcRenderer.invoke('launchpad-locate', { path: selected.path });
    } catch (err) {
      console.error('Failed to locate file:', err);
    }
  }

  runCommand(command) {
    if (!this.ipcRenderer || !command.trim()) return;

    const originalCommand = command;
    this.addToRecentRuns(originalCommand);

    let type = 'command';
    let target = command.trim();

    // 去掉前缀
    if (target.startsWith('>')) {
      target = target.substring(1).trim();
    }

    // 判断类型
    if (target.startsWith('http://') || target.startsWith('https://')) {
      type = 'url';
    } else if (target.endsWith('.exe') || target.endsWith('.cmd') ||
               target.endsWith('.bat') || target.endsWith('.lnk')) {
      type = 'file';
    } else if (target.match(/^[A-Z]:\\/) || target.match(/^\\\\/)) {
      type = 'file';
    }

    this.ipcRenderer.invoke('launchpad-run', {
      command: target,
      type: type
    }).then(result => {
      if (!result.success) {
        console.error('Command failed:', result.error);
        this.showToast?.(`执行失败: ${result.error}`, 'error');
      }
    }).catch(err => {
      console.error('Failed to run command:', err);
    });
  }

  openFileInSystem(path) {
    if (!this.ipcRenderer) return;
    this.ipcRenderer.invoke('launchpad-run', {
      command: path,
      type: 'file'
    }).catch(err => console.error('Failed to open file:', err));
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  escapeAttr(str) {
    return this.escapeHtml(str).replace(/"/g, '&quot;');
  }

  formatSize(size) {
    const num = parseFloat(size);
    if (isNaN(num)) return size;
    if (num === 0) return '0 B';
    if (num < 1024) return num + ' B';
    if (num < 1024 * 1024) return (num / 1024).toFixed(1) + ' KB';
    if (num < 1024 * 1024 * 1024) return (num / (1024 * 1024)).toFixed(1) + ' MB';
    return (num / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  // ===== Settings Panel =====

  initSettings() {
    // 设置状态
    this.settingsState = {
      isOpen: false,
      currentTab: 'general',
      configPath: '',
      settingsLoaded: null
    };

    // 获取 DOM 元素
    this.settingsOverlay = document.getElementById('settings-overlay');
    this.settingsCloseBtn = document.getElementById('settings-close-btn');
    this.settingsTabs = document.querySelectorAll('.settings-tab');
    this.settingsTabPanels = document.querySelectorAll('.settings-tab-panel');

    // 通用设置
    this.settingStartPage = document.getElementById('setting-start-page');
    this.settingDefaultView = document.getElementById('setting-default-view');
    this.settingLanguage = document.getElementById('setting-language');
    this.settingConfirmDelete = document.getElementById('setting-confirm-delete');
    this.settingShowHidden = document.getElementById('setting-show-hidden');
    this.settingDoubleClick = document.getElementById('setting-double-click');

    // 搜索设置
    this.settingAutoIndex = document.getElementById('setting-auto-index');
    this.settingSearchDepth = document.getElementById('setting-search-depth');
    this.settingSaveHistory = document.getElementById('setting-save-history');
    this.settingClearHistoryBtn = document.getElementById('setting-clear-history');

    // 外观设置
    this.settingTheme = document.getElementById('setting-theme');
    this.settingAccentColors = document.querySelectorAll('.setting-color-swatch');
    this.settingHomeBanner = document.getElementById('setting-home-banner');
    this.settingHomeBannerPick = document.getElementById('setting-home-banner-pick');
    this.settingHomeBannerFile = document.getElementById('setting-home-banner-file');
    this.settingClearHistoryCancel = document.getElementById('setting-clear-history-cancel');
    this.settingResetSettingsCancel = document.getElementById('setting-reset-settings-cancel');
    this.settingUpdateStatus = document.getElementById('setting-update-status');
    this.settingUpdateDownload = document.getElementById('setting-update-download');

    // 关于设置
    this.settingConfigPath = document.getElementById('setting-config-path');
    this.settingOpenConfig = document.getElementById('setting-open-config');
    this.settingCheckUpdate = document.getElementById('setting-check-update');
    this.settingResetSettings = document.getElementById('setting-reset-settings');

    if (!this.settingsOverlay) return;

    // 绑定事件
    this.bindSettingsEvents();

    // 加载设置
    this.settingsState.settingsLoaded = this.loadSettings();
  }

  bindSettingsEvents() {
    // 设置按钮点击
    const settingsBtn = document.getElementById('settings-btn');
    settingsBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      this.openSettings();
    });

    // 关闭按钮
    this.settingsCloseBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeSettings();
    });

    // 点击背景关闭
    this.settingsOverlay?.addEventListener('click', (e) => {
      if (e.target === this.settingsOverlay) {
        this.closeSettings();
      }
    });

    // 标签切换
    this.settingsTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        this.switchSettingsTab(tabName);
      });
    });

    // 搜索深度变更
    this.settingSearchDepth?.addEventListener('change', () => {
      this.saveSettings();
      this.rebuildSearchIndex();
    });

    // 清空历史记录：两步确认（变红+确认清空，右侧出现取消）
    this.setupConfirmButton(this.settingClearHistoryBtn, this.settingClearHistoryCancel, '确认清空', () => {
      try {
        this.ipcRenderer.invoke('config-write-history', { searches: [], runs: [] });
        if (this.launchpadState) {
          this.launchpadState.recentSearches = [];
          this.launchpadState.recentRuns = [];
          this.renderLaunchpadEmpty();
        }
      } catch (e) {
        console.error('Failed to clear history:', e);
      }
    });

    // 强调色选择
    this.settingAccentColors.forEach(swatch => {
      swatch.addEventListener('click', () => {
        const color = swatch.dataset.color;
        this.settingAccentColors.forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        this.applyAccentColor(color);
        this.saveSettings();
      });
    });

    // 主页横幅图片 URL
    this.settingHomeBanner?.addEventListener('change', () => {
      this.applyHomeBanner(this.settingHomeBanner.value);
      this.saveSettings();
    });
    this.settingHomeBannerPick?.addEventListener('click', () => {
      this.settingHomeBannerFile?.click();
    });
    this.settingHomeBannerFile?.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      // Electron 32+ 已移除 File.path，改用 webUtils.getPathForFile
      const filePath = file ? require('electron').webUtils.getPathForFile(file) : '';
      if (filePath) {
        this.settingHomeBanner.value = filePath;
        this.applyHomeBanner(filePath);
        this.saveSettings();
      }
      // 重置 input，允许再次选择同一文件时触发 change
      e.target.value = '';
    });

    // 开关类设置
    [this.settingConfirmDelete, this.settingDoubleClick, this.settingSaveHistory].forEach(checkbox => {
      checkbox?.addEventListener('change', () => {
        this.saveSettings();
      });
    });
    this.settingShowHidden?.addEventListener('change', () => {
      this.saveSettings();
      // 立即按新设置重新渲染当前目录
      if (this.currentPath && !this.currentPath.startsWith('computer://')) {
        this.refresh();
      } else {
        this.showHome();
      }
    });
    this.settingAutoIndex?.addEventListener('change', () => {
      this.saveSettings();
      if (this.settingAutoIndex.checked) {
        this.rebuildSearchIndex();
      }
    });

    // 下拉选择
    this.settingTheme?.addEventListener('change', () => {
      this.saveSettings();
      this.applyTheme(this.settingTheme.value);
    });
    this.settingDefaultView?.addEventListener('change', () => {
      this.saveSettings();
      this.switchView(this.settingDefaultView.value);
    });
    [this.settingStartPage, this.settingLanguage].forEach(select => {
      select?.addEventListener('change', () => {
        this.saveSettings();
      });
    });

    // 打开配置目录
    this.settingOpenConfig?.addEventListener('click', () => {
      if (this.ipcRenderer) {
        this.ipcRenderer.invoke('config-open-dir').catch(err => {
          console.error('Failed to open config dir:', err);
        });
      }
    });

    // 检查更新：结果内联显示在按钮右侧，不弹窗
    this.settingCheckUpdate?.addEventListener('click', async () => {
      const status = this.settingUpdateStatus;
      if (!status) return;
      status.textContent = '检查中…';
      status.classList.remove('is-update');
      this.settingUpdateDownload?.classList.add('is-hidden');
      try {
        const result = await this.checkForUpdates();
        if (result && result.hasUpdate) {
          status.textContent = '检查到新版本';
          status.classList.add('is-update');
          this._updateUrl = result.url || '';
          this.settingUpdateDownload?.classList.remove('is-hidden');
        } else {
          status.textContent = (result && result.error) ? '检查失败' : '已是最新版本';
        }
      } catch (e) {
        console.error('Failed to check updates:', e);
        status.textContent = '检查失败';
      }
    });

    // 前往下载：直接跳转到 GitHub release 页面
    this.settingUpdateDownload?.addEventListener('click', () => {
      if (this._updateUrl && this.ipcRenderer) {
        this.ipcRenderer.invoke('launchpad-run', { command: this._updateUrl, type: 'url' }).catch(err => {
          console.error('Failed to open release page:', err);
        });
      }
    });

    // 恢复默认设置：两步确认（变红+确认恢复，右侧出现取消）
    this.setupConfirmButton(this.settingResetSettings, this.settingResetSettingsCancel, '确认恢复', () => {
      this.resetToDefaults();
    });

    // Esc 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.settingsState.isOpen) {
        this.closeSettings();
      }
    });
  }

  openSettings() {
    this.settingsState.isOpen = true;
    this.settingsOverlay?.classList.remove('is-hidden');
    // 注入设置面板中的图标
    this.injectIcons(this.settingsOverlay);
    // 加载配置路径信息
    this.updateConfigPathInfo();
  }

  closeSettings() {
    this.settingsState.isOpen = false;
    this.settingsOverlay?.classList.add('is-hidden');
    // 保存当前设置
    this.saveSettings();
  }

  switchSettingsTab(tabName) {
    this.settingsState.currentTab = tabName;

    // 更新标签激活状态
    this.settingsTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // 更新面板显示
    this.settingsTabPanels.forEach(panel => {
      panel.classList.toggle('active', panel.dataset.panel === tabName);
    });
  }

  async loadSettings() {
    try {
      const { ipcRenderer } = require('electron');
      this.ipcRenderer = ipcRenderer;

      const result = await ipcRenderer.invoke('config-read-settings');
      if (result.success && result.settings) {
        this.applySettings(result.settings);
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  }

  applySettings(settings) {
    if (!settings) return;
    this.settings = { ...settings };
    this._settingsLoaded = true;

    // 通用设置
    if (settings.startPage && this.settingStartPage) {
      this.settingStartPage.value = settings.startPage;
    }
    if (settings.defaultView && this.settingDefaultView) {
      this.settingDefaultView.value = settings.defaultView;
      if (settings.defaultView !== this.currentView) {
        this.switchView(settings.defaultView);
      }
    }
    if (settings.language && this.settingLanguage) {
      this.settingLanguage.value = settings.language;
    }
    if (settings.confirmDelete !== undefined && this.settingConfirmDelete) {
      this.settingConfirmDelete.checked = settings.confirmDelete;
    }
    if (settings.showHidden !== undefined && this.settingShowHidden) {
      this.settingShowHidden.checked = settings.showHidden;
    }
    if (settings.doubleClick !== undefined && this.settingDoubleClick) {
      this.settingDoubleClick.checked = settings.doubleClick;
    }

    // 搜索设置
    if (settings.autoIndex !== undefined && this.settingAutoIndex) {
      this.settingAutoIndex.checked = settings.autoIndex;
    }
    if (settings.searchDepth && this.settingSearchDepth) {
      this.settingSearchDepth.value = settings.searchDepth;
    }
    if (settings.saveHistory !== undefined && this.settingSaveHistory) {
      this.settingSaveHistory.checked = settings.saveHistory;
    }

    // 外观设置
    if (settings.theme && this.settingTheme) {
      this.settingTheme.value = settings.theme;
      this.applyTheme(settings.theme);
    }
    if (settings.accentColor && this.settingAccentColors) {
      this.settingAccentColors.forEach(swatch => {
        swatch.classList.toggle('active', swatch.dataset.color === settings.accentColor);
      });
      this.applyAccentColor(settings.accentColor);
    }
    if (settings.homeBanner !== undefined) {
      if (this.settingHomeBanner) {
        this.settingHomeBanner.value = settings.homeBanner;
      }
      this.applyHomeBanner(settings.homeBanner);
    }
  }

  // 强调色：作用于“查看”、设置菜单等原本固定为蓝色的界面元素（--primary）
  applyAccentColor(color) {
    const map = {
      blue: '220 80% 50%',
      purple: '270 80% 50%',
      green: '140 70% 45%',
      orange: '30 90% 50%',
      red: '0 80% 55%'
    };
    const hsl = map[color] || map.blue;
    document.documentElement.style.setProperty('--primary', hsl);
    document.documentElement.style.setProperty('--accent', hsl);
  }

  // 两步确认按钮：首次点击变红显示确认文案并出现“取消”，再次点击执行操作
  setupConfirmButton(btn, cancelBtn, confirmText, action) {
    if (!btn) return;
    let timer = null;

    const reset = () => {
      btn.classList.remove('is-confirming');
      if (btn.dataset.originalText) {
        btn.textContent = btn.dataset.originalText;
      }
      cancelBtn?.classList.add('is-hidden');
      if (timer) clearTimeout(timer);
      timer = null;
    };

    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-confirming')) {
        reset();
        action();
        return;
      }
      btn.dataset.originalText = btn.textContent;
      btn.classList.add('is-confirming');
      btn.textContent = confirmText;
      cancelBtn?.classList.remove('is-hidden');
      // 5 秒未确认自动还原
      timer = setTimeout(reset, 5000);
    });

    cancelBtn?.addEventListener('click', reset);
  }

  // 检查更新：由主进程调用 GitHub Releases API
  async checkForUpdates() {
    if (!this.ipcRenderer) return { hasUpdate: false };
    try {
      return await this.ipcRenderer.invoke('check-updates');
    } catch (e) {
      return { hasUpdate: false, error: e.message };
    }
  }

  // 主页横幅：顶栏正下方、快速访问上方的 banner 图片
  async applyHomeBanner(value) {
    const img = document.getElementById('home-banner-media');
    if (!img) return;
    let raw = (value || '').trim();
    if (/[\u0000-\u001f]/.test(raw)) {
      // 历史配置中可能出现 JSON 转义损坏（如 .\banner → 退格符），回退到内置默认
      raw = './banner-difcult.png';
    }
    let src = raw;
    try {
      // 本地图片路径 → file:// URL（网络地址原样使用）
      if (src && !/^https?:\/\//i.test(src) && !src.startsWith('file://')) {
        const path = require('path');
        const fs = require('fs');
        const { pathToFileURL } = require('url');
        let resolved = src;
        if (!path.isAbsolute(src)) {
          // 相对路径（如 ./banner-difcult.png）：优先程序基础目录，其次打包 asar 内
          const base = await this.getAppBasePath();
          const candidates = [
            path.join(base, src),
            path.join(base, 'resources', 'app.asar', src)
          ];
          const found = candidates.find(c => fs.existsSync(c));
          if (found) resolved = found;
        }
        src = pathToFileURL(path.resolve(resolved)).href;
      }
    } catch (e) {
      console.error('applyHomeBanner error:', e);
    }
    img.src = src || 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=beautiful%20landscape%20sunset%20mountains%20forest%20purple%20sky%20artistic%20wallpaper&image_size=landscape_16_9';
  }

  async getAppBasePath() {
    try {
      if (this.ipcRenderer) {
        const r = await this.ipcRenderer.invoke('config-get-path');
        if (r && r.success && r.path) return require('path').dirname(r.path);
      }
    } catch (e) {
    }
    return process.cwd();
  }

  // 删除确认：confirmDelete 关闭时直接执行
  confirmAction(message, callback) {
    if (this.settings?.confirmDelete === false) {
      callback();
      return;
    }
    this.showDialog('确认', message, 'confirm', callback);
  }

  // 防抖持久化“上次打开的目录”
  schedulePersistSettings() {
    // 设置尚未从磁盘加载完成时跳过，避免覆盖用户已保存的配置
    if (!this._settingsLoaded) return;
    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      if (this.ipcRenderer && this.settings) {
        this.ipcRenderer.invoke('config-write-settings', { ...this.settings }).catch(() => {});
      }
    }, 500);
  }

  saveSettings() {
    const settings = {
      startPage: this.settingStartPage?.value || 'home',
      defaultView: this.settingDefaultView?.value || 'list',
      language: this.settingLanguage?.value || 'zh-CN',
      confirmDelete: this.settingConfirmDelete?.checked ?? true,
      showHidden: this.settingShowHidden?.checked ?? false,
      doubleClick: this.settingDoubleClick?.checked ?? true,
      homeBanner: this.settingHomeBanner?.value || '',
      lastDirectory: this.settings?.lastDirectory || '',
      autoIndex: this.settingAutoIndex?.checked ?? true,
      searchDepth: parseInt(this.settingSearchDepth?.value) || 5,
      saveHistory: this.settingSaveHistory?.checked ?? true,
      theme: this.settingTheme?.value || 'dark',
      accentColor: this.getActiveAccentColor()
    };

    // 同步内存中的设置，使运行时行为（删除确认/隐藏文件/单击打开/历史开关等）立即生效
    this.settings = { ...settings };
    this._settingsLoaded = true;

    try {
      if (this.ipcRenderer) {
        this.ipcRenderer.invoke('config-write-settings', settings)
          .catch(e => console.error('Failed to save settings:', e));
      }
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  }

  getActiveAccentColor() {
    const active = document.querySelector('.setting-color-swatch.active');
    return active?.dataset.color || 'blue';
  }

  applyTheme(theme) {
    let resolved = theme || 'dark';
    if (resolved === 'system') {
      const light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
      resolved = light ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', resolved);
  }

  // 按当前设置（搜索深度等）重建文件索引
  rebuildSearchIndex() {
    if (!this.ipcRenderer) return;
    this.ipcRenderer.invoke('launchpad-rebuild-index').catch(() => {});
  }

  // ========== 修改卷标（主菜单“驱动器”右侧铅笔按钮） ==========
  initVolumeLabels() {
    this.volumeLabelOverlay = document.getElementById('volume-label-overlay');
    this.volumeLabelList = document.getElementById('volume-label-list');
    this.volumeLabelClose = document.getElementById('volume-label-close');
    this.volumeLabelCancel = document.getElementById('volume-label-cancel');
    this.volumeLabelSave = document.getElementById('volume-label-save');
    this.drivesLabelBtn = document.getElementById('drives-label-btn');
    this._volumeLabelsOriginal = [];
    // 卷标预处理缓存：盘符 -> 卷标，供主页卡片/侧栏统一使用
    this._driveLabels = {};

    this.drivesLabelBtn?.addEventListener('click', () => this.openVolumeLabelModal());
    this.volumeLabelClose?.addEventListener('click', () => this.closeVolumeLabelModal());
    this.volumeLabelCancel?.addEventListener('click', () => this.closeVolumeLabelModal());
    this.volumeLabelSave?.addEventListener('click', () => this.saveVolumeLabels());
    this.volumeLabelOverlay?.addEventListener('click', (e) => {
      if (e.target === this.volumeLabelOverlay) this.closeVolumeLabelModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.volumeLabelOverlay && !this.volumeLabelOverlay.classList.contains('is-hidden')) {
        this.closeVolumeLabelModal();
      }
    });

    // 预处理：启动即拉取卷标并缓存，完成后刷新显示
    this.refreshDriveLabels();
  }

  // 拉取所有已挂载磁盘的卷标并缓存；完成后刷新主页驱动器卡片与侧栏盘符
  async refreshDriveLabels() {
    if (!this.ipcRenderer) return;
    try {
      const result = await this.ipcRenderer.invoke('get-volume-labels');
      if (result.success) {
        this._driveLabels = {};
        (result.volumes || []).forEach(v => {
          this._driveLabels[v.drive] = v.label;
        });
      }
      this.applyDriveLabelsToSidebar();
      const grid = document.getElementById('drives-grid');
      if (grid) {
        this.renderDrives();
      }
    } catch (err) {
      console.error('refreshDriveLabels error:', err);
    }
  }

  // 侧栏盘符按钮的标题（tooltip）显示真实卷标，如 "Windows (C:)"
  applyDriveLabelsToSidebar() {
    document.querySelectorAll('.nav-sidebar-drive[data-path]').forEach(btn => {
      const m = (btn.dataset.path || '').match(/^([A-Za-z]):\\?$/);
      if (!m) return;
      const letter = m[1].toUpperCase();
      const label = (this._driveLabels || {})[letter];
      btn.title = label ? `${label} (${letter}:)` : `本地磁盘 (${letter}:)`;
    });
  }

  async openVolumeLabelModal() {
    if (!this.volumeLabelOverlay || !this.ipcRenderer) return;
    this.volumeLabelOverlay.classList.remove('is-hidden');
    this.volumeLabelList.innerHTML = '<div class="volume-label-empty">加载中...</div>';
    try {
      const result = await this.ipcRenderer.invoke('get-volume-labels');
      if (!result.success) throw new Error(result.error || '获取卷标失败');
      this._volumeLabelsOriginal = result.volumes || [];
      this.renderVolumeLabelRows(this._volumeLabelsOriginal);
    } catch (err) {
      console.error('openVolumeLabelModal error:', err);
      this.volumeLabelList.innerHTML = '<div class="volume-label-empty">加载失败: ' + this.escapeHtml(err.message) + '</div>';
    }
  }

  renderVolumeLabelRows(volumes) {
    if (!this.volumeLabelList) return;
    if (!volumes || volumes.length === 0) {
      this.volumeLabelList.innerHTML = '<div class="volume-label-empty">未发现已挂载的磁盘</div>';
      return;
    }
    this.volumeLabelList.innerHTML = volumes.map(v => `
      <div class="volume-label-row" data-drive="${v.drive}">
        <span class="volume-label-row__drive">${v.drive}:</span>
        <input type="text" class="volume-label-row__input" value="${this.escapeAttr(v.label)}" maxlength="32" placeholder="无卷标">
      </div>
    `).join('');
  }

  closeVolumeLabelModal() {
    this.volumeLabelOverlay?.classList.add('is-hidden');
  }

  async saveVolumeLabels() {
    if (!this.ipcRenderer || !this.volumeLabelList) return;
    const rows = this.volumeLabelList.querySelectorAll('.volume-label-row');
    const changes = [];
    rows.forEach(row => {
      const drive = row.dataset.drive;
      const input = row.querySelector('.volume-label-row__input');
      const original = (this._volumeLabelsOriginal || []).find(v => v.drive === drive);
      const newLabel = input ? input.value.trim() : '';
      if (!original || original.label !== newLabel) {
        changes.push({ drive, label: newLabel });
      }
    });

    if (changes.length === 0) {
      this.closeVolumeLabelModal();
      return;
    }

    const errors = [];
    for (const c of changes) {
      try {
        const r = await this.ipcRenderer.invoke('set-volume-label', c);
        if (!r.success) errors.push(`${c.drive}: ${r.error}`);
      } catch (e) {
        errors.push(`${c.drive}: ${e.message}`);
      }
    }

    if (errors.length > 0) {
      this.showDialog('错误', '部分卷标修改失败：\n' + errors.join('\n'), 'error');
      return;
    }

    this.closeVolumeLabelModal();
    // 刷新卷标缓存 + 主页卡片 + 侧栏
    await this.refreshDriveLabels();
  }
  
  async updateConfigPathInfo() {
    try {
      if (this.ipcRenderer) {
        const result = await this.ipcRenderer.invoke('config-get-path');
        if (result.success && this.settingConfigPath) {
          this.settingsState.configPath = result.path;
          // 显示简化路径
          const displayPath = result.path.length > 60
            ? '...' + result.path.slice(-55)
            : result.path;
          this.settingConfigPath.textContent = displayPath;
          this.settingConfigPath.title = result.path;
        }
      }
    } catch (e) {
      console.error('Failed to get config path:', e);
    }
  }

  resetToDefaults() {
    const defaults = {
      startPage: 'home',
      defaultView: 'list',
      language: 'zh-CN',
      confirmDelete: true,
      showHidden: false,
      doubleClick: true,
      homeBanner: './banner-difcult.png',
      autoIndex: true,
      searchDepth: 5,
      saveHistory: true,
      theme: 'dark',
      accentColor: 'blue'
    };

    this.applySettings(defaults);
    this.saveSettings();

  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.fileManager = new FileManager();
});

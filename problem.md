# AmengExplorer 问题清单（便携性 & 代码审查）

> 生成日期：2026-08-05
> 范围：打包配置、路径解析、配置存储、外部依赖、跨机器可移植性

## 已修复

- [x] **回收站路径写死 `AmengBro`**：`virtual-fs.js` 的 `getTrashPath()` 原来固定 `os.homedir()\AmengBro\Trash`，已改为按 `root/etc/users.toml` 的 `[global] current_user` 动态解析，且统一到虚拟根（root → `<root>\root\Trash`，其他用户 → `<root>\home\<用户>\Trash`）。
- [x] **`parseTOML` 覆盖 `[global] current_user`**：`user-config.js` 解析到 `[user.X]` 段时会把当前用户覆盖成该段名，导致实际生效用户恒为最后一个用户（AmengBro）。已拆分 `sectionUser` / `currentUser`，现在正确读取 `current_user = "root"`。
- [x] **root 用户主目录不符合 Linux 约定**：`getHomePath()` 曾返回 `/home/root`，已新增 `getHomeBasePath()` 特判：root → `/root`，其他用户 → `/home/<用户>`。
- [x] **用户目录 Windows 映射未统一到虚拟根**：首页/桌面/文档/下载/图片/视频/音乐/回收站曾映射到真实主目录 `os.homedir()`，与 amsys 列表不一致；已统一为 `<root>\root` / `<root>\home\<用户>`，侧边栏导航同步修改（顺带修复“桌面”按钮误加载 `/` 的问题）。
- [x] **Electron 配置写入 amsys 的 config.ini**：`config.ini` 属于 amsys（C++ 后端），不应存放应用配置；已移除 `[launchpad]` 段（`everything_path` / `everything_enabled`），应用配置只放在自己的 `config/settings.json`。
- [x] **Everything 路径设置不生效**：设置面板写入 `settings.json`，而主进程只读 `config.ini`，两套数据互不相通；主进程 `getEverythingConfig()` 已改为从 `config/settings.json` 读取。

## 待修复

- [x] **P0 打包后 amsys.exe 无法启动**：`forge.config.js` 的顶层 `asarUnpack` 在 electron-packager v18 中已不再支持（被静默忽略），amsys.exe / getfl.exe / config.ini 全部被压进 `app.asar`，打包版 spawn `resources\app.asar\amsys.exe` 实测返回 ENOENT。
  - 修复：改为 `asar: { unpack: '**/{amsys.exe,getfl.exe,config.ini,root/**}' }`；打包后 `resources/app.asar.unpacked` 包含 amsys.exe / config.ini / root 数据，实测 pipe 调用 `resolve /`、`list_dir`、`to_windows` 全部成功。
- [x] **P0 `config.ini` 的 root 是开发机绝对路径**：已改为相对路径 `root = ./root`，并在 `amsys-client.js` spawn 时固定 `cwd` 为 amsys.exe 所在目录（amsys 的相对 root 是相对进程工作目录解析的），`virtual-fs` 再把 amsys 返回的路径归一化为绝对路径。
- [x] **P1 应用不再读写 config.ini**：`config.ini` 属于 amsys，Electron 应用已彻底移除对其的读写（虚拟根由 amsys `resolve /` 获取，用户配置从虚拟根 `etc/users.toml` 读取）。
- [x] **P1 `root/` 虚拟根数据随包分发**：`root/**` 加入 asar 解包，打包后 `app.asar.unpacked/root` 包含 `etc/users.toml`、`etc/fstab` 等文件；空目录骨架由应用启动时自动重建，不再落到用户主目录。
- [x] **P1 amsys.exe 位置不可动态配置**：已支持多级动态解析（`amsys-get-path-async`）：`config/settings.json` 的 `amsysPath` > 内嵌 amsys 的 `config.ini` 中 `amsys=` 外部路径（绝对路径，或 `/bin/com.amsys.app` 类 Unix 路径由内嵌 amsys `resolve` 翻译）> 内嵌 amsys（打包 `app.asar.unpacked` / 开发项目根）。
- [x] **检查更新实现**：主进程 `check-updates` IPC 调用 GitHub Releases API（`/repos/AmengBro/AmengExplorer/releases/latest`）获取 `tag_name`，与 `app.getVersion()` 做 semver 比较；渲染进程内联显示“已是最新版本”/“检查到新版本”+“前往下载”（`shell.openExternal` 跳 release 页），无弹窗、无数据库。
- [x] **图标映射重构**：`config/icons.json` 重构为 `_types` 扩展名表（扩展名 → Fluent 图标名，可直接匹配 `@fluentui/svg-icons`），`getFileIcon` 由 60 行 if 链改为查表；符号链接目录用 `folder_link` 图标并移除右下角三角标，归档文件（zip/rar/7z/tar/gz 等）用 `folder_zip`；按指定映射替换 pdf/ppt/xls/doc/css/js/dll/sys/cer/ini/msc/toml 等图标。
- [x] **符号链接目录大小查询**：列表/分栏/网格视图的符号链接目录不再显示“→ 链接”，与普通目录一样显示“查看”按钮并支持大小计算（Windows 下 junction/符号链接对 fs 遍历透明）。
- [x] **磁盘卷标显示与修改**：卷标启动时预处理并缓存（`_driveLabels`，主进程 `get-volume-labels` IPC），主页驱动器卡片与左侧栏盘符按钮（原“本地磁盘 (C:)”写死）统一显示真实卷标（如 `Windows (C:)`）；主菜单“驱动器”标题右侧新增铅笔按钮（`pencil`→Fluent `edit` 图标），点击打开遮罩窗列出已挂载磁盘，可逐个修改卷标并保存后刷新缓存（主进程 `set-volume-label` IPC，pwsh `Get-Volume`/`Set-Volume` + `-EncodedCommand`，卷标做了引号/控制符清洗与 32 字符限制）。
- [x] **右键菜单对齐修复**：`.context-menu-item span:first-of-type` 会把 `flex:1` 误加到图标占位 `.icon-wrapper` 上导致菜单项文字错位；已改为 `> span:not(.icon-wrapper):not(.context-menu-shortcut)`，并移除 Shell 菜单动态项的空图标占位，主菜单与子菜单文字对齐；子菜单加 `max-height` + 滚动防溢出。
- [x] **Shell 右键菜单可靠性修复**：脚本改为支持驱动器根目录（`Namespace` 回退 + `folder.Self`）；过滤 shell 扩展（分享菜单等）写入 stdout 的日志行；无 pwsh 时显示友好提示；失败提供“重试”按钮；temp 脚本 `finally` 兜底删除；超时 10s→15s。
- [x] **主题色扩展与自定义取色**：预置色 10 种（新增 teal/pink/yellow/cyan/slate），`applyAccentColor` 支持 hex→HSL 自定义颜色（`<input type="color">`），自定义色持久化为 hex，预设/自定义状态由 `_accentMode` 区分。
- [x] **根目录挂载盘去重**：fstab 允许把磁盘根挂载到虚拟根（如 `C:\ = /`）；`loadDrivesAsync` 对每个 `/media/<盘符>` 用 `vfs.toWindows` 取真实路径与 `vfs.root_` 归一比较（忽略大小写与结尾分隔符），相等则跳过该挂载点；侧栏盘符按钮同步隐藏。
- [x] **配置文件完全外部化**：`forge.config.js` 的 ignore 排除 `config/`（不再进 asar），新增 `afterComplete` 钩子把项目 `config/`（icons/settings/launchpad-history.json）直接复制到 exe 旁；`config.ini` 仍与 amsys.exe 同级解包到 `app.asar.unpacked`。实测：exe 旁 `config/` 三件齐全、asar 内无 `config/*.json`、`config.ini` 在解包目录。
- [x] **Shell 右键菜单恒显示“没有其他选项”修复**：定位为 `populateShellMenu` 的 `escapedPath = winPath.replace(/'/g,"''").replace(/\\/g,"\\\\")` 把路径反斜杠翻倍，PowerShell 单引号字符串中 `C:\\Windows` 即两个反斜杠，`$shell.Namespace` 返回 null → 0 动词。A/B 实测确认（翻倍→folderNull=True；单斜杠→21 verbs）。已改为只转义单引号，普通文件/虚拟根文件/目录均正常返回 verbs。
- [x] **二级菜单防溢出**：原仅有 `max-height`，子菜单从父项顶部向下展开时仍会冲出下边缘；新增 `positionContextSubmenu()`——按 `视口高度 - 父项顶部 - 8px` 动态限高（超高 `overflow-y` 滚轮滚动）、水平翻转、内容加载完成/重试后重新定位，菜单永不超出屏幕下边缘。
- [x] **P2 用户配置不再做应用侧路径解析**：`user-config.js` 已删除 `resolveAppRoot()\root` 默认值，虚拟根完全以 amsys `resolve /` 的结果为准（`UserConfig` 构造函数必须显式传入 amsys 解析出的根路径）。
- [x] **P2 Everything 依赖已彻底移除**：`launchpad-check-everything` / `launchpad-open-everything` / `resolveEverythingExecutables` / `parseEverythingCSV`、设置项 `everythingPath` / `everythingEnabled` 及设置面板 UI 全部删除，搜索仅依赖本地文件索引 + PATH 扫描。
- [x] **P2 跨卷移动失败已修复**：删除到回收站 / 恢复 / 剪切粘贴统一走 `movePathWithFallback()`，`renameSync` 抛 EXDEV 时自动 `cpSync` + 删除兜底。
- [x] **P2 wmic 依赖已移除**：`getSystemDrives()` / `getDriveUsage()` 改用程序目录内置便携版 pwsh7（`Get-CimInstance Win32_LogicalDisk`，`-EncodedCommand` 免引号问题）；解析优先级：程序目录 `pwsh7/pwsh.exe` > `pwsh/pwsh.exe` > 根目录 `pwsh.exe` > PATH `pwsh`，均不可用或无 WMI 时降级为盘符扫描，兼容 Windows PE。
- [x] **P3 图标库全量进包**：评估后决定不修——Electron 运行时本身体积就很大，`@fluentui/svg-icons` 的 2.1 万 SVG 可接受。
- [x] **P3 ignore 规则留下空壳目录**：评估后决定不修——空目录不影响功能与包体积。
- [x] **P3 启动台历史含相对路径命令**：`launchpad-run` 的 command 分支新增 `resolveCommandPath()`：首 token 为 `amsys.exe` 时改写为实际路径（settings.json `amsysPath` / 解包目录），其余 `./`、`..\` 相对路径按程序基础目录（exe 所在目录/项目根）解析，`>./amsys.exe --user AmengBro` 这类历史命令打包后也可执行。
- [x] **P3 `forge.config.js` 的 `cacheRoot` 为开发机绝对路径**：评估后决定不修——仅打包期 Electron 下载缓存，不影响运行时。
- [x] **P0 打包后所有图标显示 undefined**：打包版 exe 旁没有 `config/`，而主进程配置读写统一走 exe 旁（`getConfigPath`），`config-sync-read-icons` 返回空对象导致图标映射为空。已新增 `ensureDefaultConfigFiles()`：首次运行时把 `app.asar` 内的 `config/icons.json`、`settings.json`、`launchpad-history.json` 复制到 exe 旁 `config/`（便携版可写），并在 `createWindow` 前执行；已用 Electron headless 实测 asar 内读取与复制链路。
- [x] **设置功能落实（修正版）**：启动页（home/桌面/文档/上次目录）、删除确认开关、隐藏文件过滤、单击打开、保存历史开关、自动索引、搜索深度（传入索引 worker）全部接入运行时。
- [x] **深浅色主题实现**：新增 `:root[data-theme="light"]` 变量覆盖（背景/前景/边框/次要色等），`applyTheme` 支持 dark/light/system。
- [x] **强调色修正**：`applyAccentColor` 设置 `--primary`（连同 `--accent`），作用于“查看”按钮、设置菜单等原本固定为蓝色的元素，而不是只改文本/背景色调。
- [x] **主页横幅可配置**：新增 `homeBanner` 设置（默认 Trae 生成的网络图片 URL，即主页顶栏正下方/快速访问上方的 banner），外观页可修改 URL 实时生效。

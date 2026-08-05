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
- [x] **P1 应用不再读写 config.ini**：`config.ini` 属于 amsys，Electron 应用已彻底移除对其的读写（虚拟根由 amsys `resolve /` 获取，用户配置从虚拟根 `etc/users.toml` 读取），主进程 Everything 配置从 `config/settings.json` 读取。
- [x] **P1 `root/` 虚拟根数据随包分发**：`root/**` 加入 asar 解包，打包后 `app.asar.unpacked/root` 包含 `etc/users.toml`、`etc/fstab` 等文件；空目录骨架由应用启动时自动重建，不再落到用户主目录。
- [x] **P1 amsys.exe 位置不可动态配置**：已新增配置项 `config/settings.json` 的 `amsysPath`（可指向 amsys.exe 或所在目录）；主进程通过 `amsys-get-path` IPC 解析，优先级：显式配置 > 打包 `app.asar.unpacked` > 开发项目根。
- [x] **P2 用户配置不再做应用侧路径解析**：`user-config.js` 已删除 `resolveAppRoot()\root` 默认值，虚拟根完全以 amsys `resolve /` 的结果为准（`UserConfig` 构造函数必须显式传入 amsys 解析出的根路径）。
- [ ] **P2 Everything 搜索为弃用方案**：本地文件索引 + PATH 快速扫描已是搜索主路径，Everything 相关代码（`launchpad-check-everything`、`launchpad-open-everything`、`resolveEverythingExecutables`、设置项 `everythingPath` / `everythingEnabled` 及 UI）建议整体移除。
- [ ] **P2 跨卷移动失败**：删除/恢复使用 `fs.renameSync`，跨盘符（如 C:\ ↔ I:\）会抛 EXDEV 导致“移动到回收站失败”。
  - 修复：EXDEV 时改用 copy + delete 兜底。
- [ ] **P2 wmic 依赖**：`app.js` 的 `getSystemDrives()` / `getDriveUsage()` 使用 `wmic`，Win11 24H2 起已移除（有盘符扫描兜底，但盘名降级为“X盘”）。
  - 修复：改用 PowerShell `Get-CimInstance Win32_LogicalDisk`。
- [ ] **P3 图标库全量进包**：`icons.js` 按名读取 `@fluentui/svg-icons`，全量约 2.1 万文件进 asar（24MB 的绝大部分）。
  - 修复：按 `config/icons.json` 实际用到的图标裁剪子集。
- [ ] **P3 ignore 规则留下空壳目录**：`forge.config.js` 的 ignore 正则以 `[\\/]` 结尾，匹配不到目录本身，`.trae` / `docs` / `example` / `root` 以空壳目录留在 asar。
  - 修复：目录级规则改为 `(?:[/\\]|$)` 结尾，整目录排除。
- [ ] **P3 启动台历史含相对路径命令**：`config/launchpad-history.json` 中的 `>./amsys.exe --user AmengBro` 依赖 cwd=项目根，打包后 cwd 是 exe 目录且 amsys 不在那里，无法执行。
- [ ] **P3 `forge.config.js` 的 `cacheRoot` 为开发机绝对路径**：仅影响打包期 Electron 下载缓存，不影响运行时，但建议改为相对/可配置。

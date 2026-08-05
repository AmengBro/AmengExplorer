const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    // electron-packager v18 的 asar 选项使用 glob 字符串解包（顶层 asarUnpack 已不支持）
    // amsys.exe 是原生程序，必须解包到 app.asar.unpacked 才能被 spawn；
    // 虚拟根数据 root/ 也一并解包，保证打包后 amsys 能挂载虚拟文件系统
    asar: {
      unpack: '**/{amsys.exe,getfl.exe,config.ini,root/**}',
    },
    icon: 'explorer.ico',
    executableName: 'AmengExplorer',
    appCopyright: 'Copyright © 2026 A萌菌',
    ignore: [
      // 版本控制与编辑器配置
      /^[\\/]\.git[\\/]/,
      /^[\\/]\.github[\\/]/,
      /^[\\/]\.vscode[\\/]/,
      /^[\\/]\.idea[\\/]/,
      /^[\\/]\.trae[\\/]/,
      // 开发缓存与打包临时文件
      /^[\\/]\.electron_cache[\\/]/,
      /\.tar(\.gz|\.bz2|\.xz|\.zip)?$/,
      /^[\\/]node_modules\.tar$/,
      // 项目源码中非运行时目录
      /^[\\/]example[\\/]/,
      /^[\\/]docs[\\/]/,
      // 根目录下仅用于开发/说明的文件
      /^[\\/]README\.md$/,
      /^[\\/]LICENSE$/,
      /^[\\/]CONTRIBUTING\.md$/,
      /^[\\/]filesystem-architecture\.md$/,
      /^[\\/]use-pipe\.md$/,
      /^[\\/]want\.md$/,
      /^[\\/]\.gitignore$/,
      /^[\\/]\.gitattributes$/,
      /^[\\/]package-lock\.json$/,
    ],
    quiet: false,
    overwrite: true,
    download: {
      cacheRoot: 'I:/Data-数据区/应用/自制/AmengExplorer/.electron_cache',
      mirrorOptions: {
        mirror: 'https://npmmirror.com/mirrors/electron/',
      },
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

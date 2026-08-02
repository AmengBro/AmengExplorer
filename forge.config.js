const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    asarUnpack: [
      /amsys\.exe$/,
      /getfl\.exe$/,
      /config\.ini$/,
    ],
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
      /^[\\/]root[\\/]/,
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

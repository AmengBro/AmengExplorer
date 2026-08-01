const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    asarUnpack: [],
    icon: 'explorer.ico',
    executableName: 'AmengExplorer',
    appCopyright: 'Copyright © 2026 A萌菌',
    ignore: [
      /^[\\/]rootdir[\\/]/,
      /^[\\/]config[\\/]/,
      /^[\\/]\.git[\\/]/,
      /^[\\/]scripts[\\/]/,
      /^[\\/]README\.md$/,
      /^[\\/]LICENSE$/,
      /^[\\/]CONTRIBUTING\.md$/,
      /^[\\/]\.github[\\/]/,
      /^[\\/]\.vscode[\\/]/,
      /^[\\/]\.idea[\\/]/,
      /^[\\/]root[\\/]/,
      /^[\\/]example[\\/]/,
      /^[\\/]\.trae[\\/]/,
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

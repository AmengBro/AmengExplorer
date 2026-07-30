const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, '..', '..', 'node_modules', '@fluentui', 'svg-icons', 'icons');
const configPath = path.join(__dirname, '..', '..', 'config', 'icons.json');

let iconConfig = null;

function loadConfig() {
  if (iconConfig) return iconConfig;
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    iconConfig = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load icons.json config:', err.message);
    iconConfig = {};
  }
  return iconConfig;
}

function loadIcon(name, size = 24, style = 'filled') {
  if (!name) return '';
  const fileName = `${name}_${size}_${style}.svg`;
  const filePath = path.join(iconsDir, fileName);
  try {
    let svg = fs.readFileSync(filePath, 'utf8');
    svg = svg.replace(/<svg([^>]+)>/g, '<svg$1 fill="currentColor">');
    svg = svg.replace(/ fill="#([0-9a-fA-F]{3,6})"/g, '');
    return svg;
  } catch (err) {
    const regularFile = `${name}_${size}_regular.svg`;
    const regularPath = path.join(iconsDir, regularFile);
    try {
      let svg = fs.readFileSync(regularPath, 'utf8');
      svg = svg.replace(/<svg([^>]+)>/g, '<svg$1 fill="currentColor">');
      svg = svg.replace(/ fill="#([0-9a-fA-F]{3,6})"/g, '');
      return svg;
    } catch (e) {
      console.warn(`Icon not found: ${fileName}`);
      return '';
    }
  }
}

function buildIconMap(config) {
  const result = {};
  const defaults = config._defaults || { size: 24, style: 'filled' };

  for (const [key, value] of Object.entries(config)) {
    if (key.startsWith('_')) continue;
    if (key === 'contextMenu') {
      result.contextMenu = {};
      for (const [ck, cv] of Object.entries(value)) {
        result.contextMenu[ck] = loadIcon(cv, defaults.size, defaults.style);
      }
    } else {
      result[key] = loadIcon(value, defaults.size, defaults.style);
    }
  }
  return result;
}

function reloadIcons() {
  iconConfig = null;
  const config = loadConfig();
  return buildIconMap(config);
}

const fluentIcons = reloadIcons();

fluentIcons.reload = reloadIcons;

fluentIcons.getIconName = function(key) {
  const config = loadConfig();
  return config[key] || null;
};

fluentIcons.setIconName = function(key, iconName) {
  const config = loadConfig();
  config[key] = iconName;
  delete require.cache[configPath];
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  iconConfig = config;
  this[key] = loadIcon(iconName, (config._defaults || {}).size || 24, (config._defaults || {}).style || 'filled');
};

module.exports = fluentIcons;

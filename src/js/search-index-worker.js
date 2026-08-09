const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');

const IGNORED_DIRS = new Set([
  'system32', 'syswow64', 'winsxs', 'winstaller', 'assembly',
  '$recycle.bin', 'system volume information', 'config',
  'application data', 'appdata', 'local settings',
  'documents and settings', 'programdata', 'perflogs',
  'recovery', 'temp', 'tmp', 'cache',
  'node_modules', '.git', '.svn', '.hg',
  '$windows.~bt', '$windows.~ws'
]);

const SEARCH_DEPTH = 5;
const BATCH_SIZE = 2000;

if (parentPort) {
  parentPort.on('message', (msg) => {
    if (msg.type === 'build-index') {
      buildIndex(msg.drives || null, msg.depth);
    }
  });
}

function buildIndex(customDrives, depth) {
  const maxDepth = depth || SEARCH_DEPTH;
  const entries = [];
  const seenPaths = new Set();
  let scanned = 0;
  let lastReported = 0;
  const MAX_ENTRIES = 300000;

  const drives = customDrives || getDriveRoots();

  function scanDirectory(dir, depth) {
    if (depth > maxDepth) return;
    if (entries.length >= MAX_ENTRIES) return;

    let files;
    try {
      files = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }

    for (const file of files) {
      if (entries.length >= MAX_ENTRIES) break;

      const fullPath = path.join(dir, file.name);
      const pathLower = fullPath.toLowerCase();

      if (seenPaths.has(pathLower)) continue;
      seenPaths.add(pathLower);

      const nameLower = file.name.toLowerCase();

      if (file.isDirectory()) {
        if (IGNORED_DIRS.has(nameLower) || nameLower.startsWith('$')) continue;

        entries.push({
          path: fullPath,
          name: file.name,
          isDirectory: true,
          size: 0
        });

        scanDirectory(fullPath, depth + 1);
      } else if (file.isFile() || file.isSymbolicLink()) {
        try {
          const stat = fs.statSync(fullPath);
          entries.push({
            path: fullPath,
            name: file.name,
            isDirectory: false,
            size: stat.size
          });
        } catch (e) {
          entries.push({
            path: fullPath,
            name: file.name,
            isDirectory: false,
            size: 0
          });
        }
      }
    }

    scanned++;
    if (scanned - lastReported >= BATCH_SIZE) {
      lastReported = scanned;
      parentPort.postMessage({
        type: 'progress',
        scanned: scanned,
        entries: entries.length
      });
    }
  }

  for (const drive of drives) {
    try {
      scanDirectory(drive, 0);
    } catch (e) {}
  }

  parentPort.postMessage({
    type: 'complete',
    entries: entries,
    entryCount: entries.length,
    buildTime: Date.now()
  });
}

function getDriveRoots() {
  const drives = [];
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  for (const d of letters) {
    const drivePath = `${d}:\\`;
    try {
      if (fs.existsSync(drivePath)) {
        drives.push(drivePath);
      }
    } catch (e) {}
  }
  return drives;
}

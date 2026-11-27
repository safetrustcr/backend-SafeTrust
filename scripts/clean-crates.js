const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const cratesDir = path.join(repoRoot, 'crates');
const targetDir = path.join(cratesDir, 'target');

function getTargetSize() {
  const du = spawnSync('du', ['-sh', path.relative(repoRoot, targetDir)], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (!du.error && du.status === 0) {
    return du.stdout.trim();
  }

  if (du.error?.code !== 'ENOENT') {
    throw new Error(du.stderr.trim() || du.error?.message || 'du failed');
  }

  let bytes = 0;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const stats = fs.lstatSync(entryPath);
      if (stats.isDirectory()) {
        visit(entryPath);
      } else {
        bytes += stats.size;
      }
    }
  };

  visit(targetDir);
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]} (calculated)`;
}

function main() {
  if (fs.existsSync(targetDir)) {
    console.log(`Cargo build cache before cleanup (du -sh): ${getTargetSize()}`);
  } else {
    console.log('Cargo build cache not found; nothing to measure.');
  }

  const result = spawnSync('cargo', ['clean'], {
    cwd: cratesDir,
    stdio: 'inherit',
  });

  if (result.error) {
    throw new Error(`Could not run cargo clean: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

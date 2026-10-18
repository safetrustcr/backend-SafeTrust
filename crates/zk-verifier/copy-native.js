'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const crateDir = __dirname;
const dest = path.join(crateDir, 'index.node');
const libNames = [
    'libzk_verifier.so',
    'libzk_verifier.dylib',
    'zk_verifier.dll',
];
function cargoTargetDirectory() {
    try {
        const meta = JSON.parse((0, node_child_process_1.execSync)('cargo metadata --format-version 1 --no-deps', {
            cwd: crateDir,
            encoding: 'utf8',
        }));
        return typeof meta?.target_directory === 'string'
            ? meta.target_directory
            : null;
    }
    catch {
        return null;
    }
}
const releaseDirs = [
    path.join(crateDir, 'target', 'release'),
    path.join(crateDir, '..', '..', 'target', 'release'),
];
const targetDir = cargoTargetDirectory();
if (targetDir)
    releaseDirs.unshift(path.join(targetDir, 'release'));
let found = null;
for (const dir of releaseDirs) {
    for (const name of libNames) {
        const candidate = path.join(dir, name);
        if (fs.existsSync(candidate)) {
            found = candidate;
            break;
        }
    }
    if (found)
        break;
}
if (!found) {
    console.error('zk-verifier: native library not found. Run `cargo build --release` first.');
    process.exit(1);
}
fs.copyFileSync(found, dest);
console.log(`zk-verifier: wrote ${dest} from ${found}`);

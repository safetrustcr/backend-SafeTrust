'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const crateConfigs = {
    'chunk-processor': {
        libraryName: 'chunk_processor',
        destination: 'index.node',
    },
    'pg-bulk-upsert': {
        libraryName: 'pg_bulk_upsert',
        destination: 'index.node',
    },
    'stellar-utils': {
        libraryName: 'stellar_utils',
        destination: path.join('native', 'index.node'),
    },
    'webhook-verifier': {
        libraryName: 'webhook_verifier',
        destination: 'index.node',
    },
    'escrow-state-machine': {
        libraryName: 'escrow_state_machine',
        destination: 'index.node',
    },
    'soroban-reconciler': {
        libraryName: 'soroban_reconciler',
        destination: path.join('native', 'index.node'),
    },
    'x402-processor': {
        libraryName: 'x402_processor',
        destination: 'index.node',
    },
    'zk-verifier': {
        libraryName: 'zk_verifier',
        destination: 'index.node',
    },
};
const cratesDir = path.resolve(__dirname, '..');
function parseCrateArgument(args) {
    if (args.length === 1 && args[0].startsWith('--crate=')) {
        return args[0].slice('--crate='.length);
    }
    if (args.length === 2 && args[0] === '--crate') {
        return args[1];
    }
    throw new Error('Usage: node copy-native.js --crate=<crate-name>');
}
function cargoTargetDirectory(crateDir) {
    try {
        const metadata = JSON.parse((0, node_child_process_1.execFileSync)('cargo', [
            'metadata',
            '--format-version',
            '1',
            '--no-deps',
            '--manifest-path',
            path.join(cratesDir, 'Cargo.toml'),
        ], {
            cwd: crateDir,
            encoding: 'utf8',
        }));
        if (typeof metadata.target_directory === 'string') {
            return metadata.target_directory;
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`copy-native: unable to read Cargo target directory (${message}); checking conventional locations`);
    }
    return undefined;
}
function main() {
    let crateName;
    try {
        crateName = parseCrateArgument(process.argv.slice(2));
    }
    catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
    }
    const config = Object.prototype.hasOwnProperty.call(crateConfigs, crateName)
        ? crateConfigs[crateName]
        : undefined;
    if (!config) {
        console.error(`copy-native: unknown crate "${crateName}". Expected one of: ${Object.keys(crateConfigs).join(', ')}`);
        process.exitCode = 1;
        return;
    }
    const crateDir = path.join(cratesDir, crateName);
    const sourceNames = [
        `lib${config.libraryName}.so`,
        `lib${config.libraryName}.dylib`,
        `${config.libraryName}.dll`,
    ];
    const releaseDirs = new Set();
    const targetDir = cargoTargetDirectory(crateDir);
    if (targetDir)
        releaseDirs.add(path.join(targetDir, 'release'));
    const configuredTargetDir = process.env.CARGO_TARGET_DIR;
    if (configuredTargetDir) {
        releaseDirs.add(path.join(path.resolve(process.cwd(), configuredTargetDir), 'release'));
    }
    releaseDirs.add(path.join(crateDir, 'target', 'release'));
    releaseDirs.add(path.join(cratesDir, 'target', 'release'));
    releaseDirs.add(path.join(cratesDir, '..', 'target', 'release'));
    let source;
    for (const releaseDir of releaseDirs) {
        for (const sourceName of sourceNames) {
            const candidate = path.join(releaseDir, sourceName);
            if (fs.existsSync(candidate)) {
                source = candidate;
                break;
            }
        }
        if (source)
            break;
    }
    if (!source) {
        console.warn(`copy-native: warning: native library for ${crateName} was not found; skipping copy`);
        return;
    }
    const destination = path.join(crateDir, config.destination);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    console.log(`${crateName}: wrote ${destination} from ${source}`);
}
main();

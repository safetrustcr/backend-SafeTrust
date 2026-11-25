import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const docsDir = path.join(repoRoot, 'docs');
const docsReadmePath = path.join(docsDir, 'README.md');

function walkMarkdownFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function stripFencedCodeBlocks(lines) {
  const out = [];
  let inFence = false;
  let fenceChar = '';
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trimStart();
    const match = trimmed.match(/^(```+|~~~+)/);
    if (match) {
      const marker = match[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
      } else if (marker === fenceChar) {
        inFence = false;
        fenceChar = '';
      }
      out.push({ lineNumber: i + 1, text: '' });
      continue;
    }
    out.push({ lineNumber: i + 1, text: inFence ? '' : lines[i] });
  }
  return out;
}

function extractMarkdownLinks(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = stripFencedCodeBlocks(raw.split(/\r?\n/));
  const links = [];
  const linkRegex = /(?<!!)\[[^\]]*\]\(([^)]+)\)/g;

  for (const { lineNumber, text } of lines) {
    // Strip inline code spans so example markdown syntax doesn't trigger link errors.
    const withoutInlineCode = text.replace(/`[^`]*`/g, '');
    let match;
    while ((match = linkRegex.exec(withoutInlineCode)) !== null) {
      let target = match[1].trim();
      if (target.startsWith('<') && target.endsWith('>')) {
        target = target.slice(1, -1).trim();
      } else {
        // Handle optional link title: path "title"
        const spaceIdx = target.search(/\s/);
        if (spaceIdx !== -1) {
          target = target.slice(0, spaceIdx);
        }
      }
      if (!target) continue;
      if (/^(https?:|mailto:|tel:|#)/i.test(target)) continue;
      links.push({ lineNumber, target });
    }
  }
  return links;
}

function resolveLinkTarget(sourceFile, rawTarget) {
  const cleanTarget = rawTarget.split('#')[0].split('?')[0];
  if (!cleanTarget) return null;
  if (cleanTarget.startsWith('/')) {
    return path.resolve(repoRoot, cleanTarget.slice(1));
  }
  return path.resolve(path.dirname(sourceFile), cleanTarget);
}

const errors = [];
const allDocFiles = walkMarkdownFiles(docsDir);
const indexableDocs = allDocFiles.filter(
  (file) => path.resolve(file) !== path.resolve(docsReadmePath),
);

if (!fs.existsSync(docsReadmePath)) {
  errors.push('Missing docs/README.md index file.');
} else {
  const indexLinks = extractMarkdownLinks(docsReadmePath);
  const indexedPaths = new Set();
  for (const { target } of indexLinks) {
    const resolved = resolveLinkTarget(docsReadmePath, target);
    if (resolved) indexedPaths.add(resolved);
  }

  for (const docFile of indexableDocs) {
    if (!indexedPaths.has(path.resolve(docFile))) {
      const rel = path.relative(repoRoot, docFile).replaceAll('\\', '/');
      errors.push(`docs/README.md is missing an index entry for: ${rel}`);
    }
  }
}

const filesToCheckLinks = [path.join(repoRoot, 'README.md'), ...allDocFiles].filter((f) =>
  fs.existsSync(f),
);

for (const filePath of filesToCheckLinks) {
  const relFile = path.relative(repoRoot, filePath).replaceAll('\\', '/');
  for (const { lineNumber, target } of extractMarkdownLinks(filePath)) {
    const resolved = resolveLinkTarget(filePath, target);
    if (!resolved) continue;
    if (!fs.existsSync(resolved)) {
      errors.push(`${relFile}:${lineNumber}: broken relative link target "${target}"`);
    }
  }
}

if (errors.length > 0) {
  console.error('Documentation check failed:');
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(
  `Documentation check passed: ${indexableDocs.length} doc pages indexed in docs/README.md, 0 broken relative links across ${filesToCheckLinks.length} files.`,
);

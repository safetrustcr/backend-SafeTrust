import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

export function stripFencedCodeBlocks(lines) {
  const out = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLength = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!inFence) {
      const openMatch = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
      if (openMatch) {
        const marker = openMatch[1];
        const info = openMatch[2];
        // CommonMark: backtick fence info strings may not contain backtick characters.
        if (marker[0] !== '`' || !info.includes('`')) {
          inFence = true;
          fenceChar = marker[0];
          fenceLength = marker.length;
          out.push({ lineNumber: i + 1, text: '' });
          continue;
        }
      }
      out.push({ lineNumber: i + 1, text: line });
    } else {
      const closeMatch = line.match(/^\s{0,3}(`{3,}|~{3,})[ \t]*$/);
      if (
        closeMatch &&
        closeMatch[1][0] === fenceChar &&
        closeMatch[1].length >= fenceLength
      ) {
        inFence = false;
        fenceChar = '';
        fenceLength = 0;
      }
      out.push({ lineNumber: i + 1, text: '' });
    }
  }

  return out;
}

function normalizeLinkTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith('<') && target.endsWith('>')) {
    target = target.slice(1, -1).trim();
  } else {
    const spaceIdx = target.search(/\s/);
    if (spaceIdx !== -1) {
      target = target.slice(0, spaceIdx);
    }
  }
  if (!target) return null;
  if (/^(https?:|mailto:|tel:|#)/i.test(target)) return null;
  return target;
}

function normalizeRefLabel(label) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function extractMarkdownLinksFromText(raw) {
  const lines = stripFencedCodeBlocks(raw.split(/\r?\n/));
  const definitions = new Map();
  const definitionLines = new Set();
  const defRegex = /^\s{0,3}\[([^\]]+)\]:\s*(<[^>\n]+>|\S+)(?:\s+.*)?$/;

  for (const { lineNumber, text } of lines) {
    if (!text) continue;
    const match = text.match(defRegex);
    if (!match) continue;
    definitionLines.add(lineNumber);
    const key = normalizeRefLabel(match[1]);
    if (!definitions.has(key)) {
      const target = normalizeLinkTarget(match[2]);
      definitions.set(key, target);
    }
  }

  const links = [];
  const inlineRegex = /(?<!!)\[[^\]]*\]\(([^)]+)\)/g;
  const fullRefRegex = /(?<!!)\[[^\]]*\]\[([^\]]+)\]/g;
  const collapsedRefRegex = /(?<!!)\[([^\]]+)\]\[\]/g;
  const shortcutRefRegex = /(?<![!\]])\[([^\]]+)\](?![(\[:])/g;

  for (const { lineNumber, text } of lines) {
    if (!text || definitionLines.has(lineNumber)) continue;
    // Strip inline code spans so example markdown syntax doesn't trigger link errors.
    const withoutInlineCode = text.replace(/`[^`]*`/g, '');

    let match;
    while ((match = inlineRegex.exec(withoutInlineCode)) !== null) {
      const target = normalizeLinkTarget(match[1]);
      if (target) links.push({ lineNumber, target });
    }

    // Replace already-matched inline and full/collapsed reference links before shortcut matching.
    let remainder = withoutInlineCode.replace(inlineRegex, ' ');

    while ((match = fullRefRegex.exec(remainder)) !== null) {
      const key = normalizeRefLabel(match[1]);
      const target = definitions.get(key);
      if (target) links.push({ lineNumber, target });
    }
    remainder = remainder.replace(fullRefRegex, ' ');

    while ((match = collapsedRefRegex.exec(remainder)) !== null) {
      const key = normalizeRefLabel(match[1]);
      const target = definitions.get(key);
      if (target) links.push({ lineNumber, target });
    }
    remainder = remainder.replace(collapsedRefRegex, ' ');

    while ((match = shortcutRefRegex.exec(remainder)) !== null) {
      const key = normalizeRefLabel(match[1]);
      const target = definitions.get(key);
      if (target) links.push({ lineNumber, target });
    }
  }

  return links;
}

export function extractMarkdownLinks(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return extractMarkdownLinksFromText(raw);
}

function resolveLinkTarget(repoRoot, sourceFile, rawTarget) {
  const cleanTarget = rawTarget.split('#')[0].split('?')[0];
  if (!cleanTarget) return null;
  if (cleanTarget.startsWith('/')) {
    return path.resolve(repoRoot, cleanTarget.slice(1));
  }
  return path.resolve(path.dirname(sourceFile), cleanTarget);
}

export function runDocsCheck(repoRoot = process.cwd()) {
  const docsDir = path.join(repoRoot, 'docs');
  const docsReadmePath = path.join(docsDir, 'README.md');
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
      const resolved = resolveLinkTarget(repoRoot, docsReadmePath, target);
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
      const resolved = resolveLinkTarget(repoRoot, filePath, target);
      if (!resolved) continue;
      if (!fs.existsSync(resolved)) {
        errors.push(`${relFile}:${lineNumber}: broken relative link target "${target}"`);
      }
    }
  }

  return { errors, indexableCount: indexableDocs.length, checkedCount: filesToCheckLinks.length };
}

function main() {
  const { errors, indexableCount, checkedCount } = runDocsCheck();
  if (errors.length > 0) {
    console.error('Documentation check failed:');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log(
    `Documentation check passed: ${indexableCount} doc pages indexed in docs/README.md, 0 broken relative links across ${checkedCount} files.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}

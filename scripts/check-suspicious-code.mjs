import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BIDI_REGEX = /[\u202A-\u202E\u2066-\u2069]/;
const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF]/;

const JS_TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const STRICT_ZERO_WIDTH_EXTS = new Set(['.sql', '.sh', '.yaml', '.yml']);
const LONG_LINE_SKIP_EXTS = new Set(['.md', '.svg', '.graphql']);

const CODE_EXEC_PATTERNS = [
  { name: 'dynamic eval', regex: new RegExp('\\bev' + 'al\\s*\\(') },
  { name: 'dynamic Function', regex: new RegExp('\\bnew\\s+Fun' + 'ction\\s*\\(') },
  { name: 'child' + '_process', regex: new RegExp('child' + '_process') },
  {
    name: 'vm module',
    regex: new RegExp(
      '(?:require\\s*\\(\\s*[\'"](?:node:)?vm[\'"]\\s*\\)|\\bfrom\\s+[\'"](?:node:)?vm[\'"])',
    ),
  },
];

const BASE64_BLOB_REGEX = /[A-Za-z0-9+/]{198,}[A-Za-z0-9+/=]{3,}/;
const BASE64_DECODER_REGEX = new RegExp(
  '(?:\\bat' + 'ob\\b|Buffer\\.fr' + 'om\\b|\\bev' + 'al\\b|base64\\s+(?:-d|--decode)\\b)',
);

const PIPE_TO_SHELL_REGEX = /\b(?:curl|wget)\b[^\n]*\|\s*(?:ba)?sh\b/;
const DOWNLOAD_CMD_REGEX = /\b(?:curl|wget)\b/;
const CHMOD_EXEC_REGEX = /\bchmod\s+\+x\b/;
const CHECKSUM_VERIFY_REGEX = /\b(?:sha256sum|shasum|md5sum)\b|--checksum\b/;

const DANGEROUS_SQL_PATTERNS = [
  { name: 'SECURITY DEFINER', regex: /\bSECURITY\s+DEFINER\b/i },
  { name: 'GRANT', regex: /\bGRANT\b/i },
  { name: 'ALTER ROLE', regex: /\bALTER\s+ROLE\b/i },
  { name: 'CREATE ROLE', regex: /\bCREATE\s+ROLE\b/i },
  { name: 'COPY ... PROGRAM', regex: /\bCOPY\b[^\n;]*\bPROGRAM\b/i },
  { name: 'CREATE EXTENSION', regex: /\bCREATE\s+EXTENSION\b/i, allowInCreateExtensions: true },
  { name: 'DROP SCHEMA', regex: /\bDROP\s+SCHEMA\b/i },
];

function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isBinaryContent(content) {
  return content.includes('\u0000');
}

function stripJsStringLiterals(line) {
  // Replace single-quoted, double-quoted, and template literals with spaces
  // so zero-width chars inside intentional string literals are ignored while
  // identifiers and comments remain checked.
  let out = '';
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ' ';
      i += 1;
      while (i < line.length) {
        if (line[i] === '\\') {
          i += 2;
          continue;
        }
        if (line[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function stripSqlComments(line) {
  // Remove -- comments and single-line /* ... */ comments.
  return line.replace(/\/\*.*?\*\//g, ' ').replace(/--.*$/, '');
}

function isSensitiveNoticePath(normPath) {
  const base = path.posix.basename(normPath);
  if (normPath === 'webhook/package.json') return true;
  if (base === '.npmrc') return true;
  if (normPath.startsWith('bin/')) return true;
  if (/^metadata\/[^/]+\.sh$/.test(normPath)) return true;
  if (normPath === 'start.sh') return true;
  if (/^(?:webhook\/)?Dockerfile/.test(normPath)) return true;
  if (/^docker-compose.*\.ya?ml$/.test(normPath)) return true;
  if (normPath.startsWith('.github/')) return true;
  return false;
}

function isShellOrDockerfileTarget(normPath) {
  return (
    normPath.startsWith('bin/') ||
    /^metadata\/[^/]+\.sh$/.test(normPath) ||
    normPath === 'start.sh' ||
    /^(?:webhook\/)?Dockerfile/.test(normPath)
  );
}

function isCodeExecTarget(normPath) {
  const ext = path.posix.extname(normPath).toLowerCase();
  if (!JS_TS_EXTS.has(ext)) return false;
  return (
    normPath.startsWith('webhook/src/') ||
    normPath.startsWith('scripts/') ||
    normPath.startsWith('tests/karate/src/')
  );
}

function checkShellAndDockerDownloads(normPath, lines, findings, notices) {
  const isDockerfile = path.posix.basename(normPath).startsWith('Dockerfile');

  if (isDockerfile) {
    // Group logical RUN instructions so `RUN chmod +x ./start.sh` is not conflated
    // with an earlier checksum-verified download RUN block.
    const blocks = [];
    let currentBlock = null;
    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx];
      const lineNumber = idx + 1;
      if (/^\s*RUN\b/i.test(line)) {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = { startLine: lineNumber, lines: [{ lineNumber, text: line }] };
      } else if (currentBlock) {
        const prev = currentBlock.lines[currentBlock.lines.length - 1].text;
        if (/\\\s*$/.test(prev)) {
          currentBlock.lines.push({ lineNumber, text: line });
        } else {
          blocks.push(currentBlock);
          currentBlock = null;
        }
      }
    }
    if (currentBlock) blocks.push(currentBlock);

    for (const block of blocks) {
      const blockText = block.lines.map((l) => l.text).join('\n');
      const prevLine = block.startLine > 1 ? lines[block.startLine - 2] : '';
      const hasReviewed =
        /#\s*security-reviewed:\s*\S+/i.test(blockText) ||
        /#\s*security-reviewed:\s*\S+/i.test(prevLine);

      for (const entry of block.lines) {
        if (PIPE_TO_SHELL_REGEX.test(entry.text)) {
          const lineReviewed =
            /#\s*security-reviewed:\s*\S+/i.test(entry.text) ||
            (entry.lineNumber > 1 &&
              /#\s*security-reviewed:\s*\S+/i.test(lines[entry.lineNumber - 2]));
          if (lineReviewed) {
            notices.push(`${normPath}:${entry.lineNumber}: security-reviewed pipe-to-shell allowed`);
          } else {
            findings.push({
              file: normPath,
              line: entry.lineNumber,
              rule: 'pipe-to-shell',
              message: 'Pipe-to-shell download (curl/wget | sh) is not allowed',
            });
          }
        }
      }

      if (
        DOWNLOAD_CMD_REGEX.test(blockText) &&
        CHMOD_EXEC_REGEX.test(blockText) &&
        !CHECKSUM_VERIFY_REGEX.test(blockText)
      ) {
        if (hasReviewed) {
          notices.push(`${normPath}:${block.startLine}: security-reviewed download chmod +x allowed`);
        } else {
          const chmodEntry = block.lines.find((l) => CHMOD_EXEC_REGEX.test(l.text));
          findings.push({
            file: normPath,
            line: chmodEntry ? chmodEntry.lineNumber : block.startLine,
            rule: 'unchecked-download',
            message: 'Download followed by chmod +x without checksum verification',
          });
        }
      }
    }
    return;
  }

  // Shell scripts in bin/, metadata/*.sh, start.sh
  let sawDownload = false;
  let sawChecksum = false;
  let firstChmodLine = null;
  let chmodReviewed = false;

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const lineNumber = idx + 1;
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;

    if (PIPE_TO_SHELL_REGEX.test(line)) {
      if (/#\s*security-reviewed:\s*\S+/i.test(line)) {
        notices.push(`${normPath}:${lineNumber}: security-reviewed pipe-to-shell allowed`);
      } else {
        findings.push({
          file: normPath,
          line: lineNumber,
          rule: 'pipe-to-shell',
          message: 'Pipe-to-shell download (curl/wget | sh) is not allowed',
        });
      }
    }

    if (DOWNLOAD_CMD_REGEX.test(line)) sawDownload = true;
    if (CHECKSUM_VERIFY_REGEX.test(line)) sawChecksum = true;
    if (CHMOD_EXEC_REGEX.test(line) && firstChmodLine === null) {
      firstChmodLine = lineNumber;
      chmodReviewed = /#\s*security-reviewed:\s*\S+/i.test(line);
    }
  }

  if (sawDownload && firstChmodLine !== null && !sawChecksum) {
    if (chmodReviewed) {
      notices.push(`${normPath}:${firstChmodLine}: security-reviewed download chmod +x allowed`);
    } else {
      findings.push({
        file: normPath,
        line: firstChmodLine,
        rule: 'unchecked-download',
        message: 'Download followed by chmod +x without checksum verification',
      });
    }
  }
}

function checkHasuraPermissions(normPath, lines, findings, notices) {
  let currentRole = null;
  let roleIndent = -1;

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const lineNumber = idx + 1;
    if (/^\s*(?:#.*)?$/.test(line)) continue;

    const indent = line.match(/^(\s*)/)[1].length;
    const roleMatch = line.match(/^\s*(?:-\s*)?role:\s*['"]?([A-Za-z0-9_.-]+)['"]?\s*(?:#.*)?$/);
    if (roleMatch) {
      currentRole = roleMatch[1];
      roleIndent = indent;
      continue;
    }

    // Reset current role if indentation moves out of the role block.
    if (currentRole !== null && indent < roleIndent) {
      currentRole = null;
      roleIndent = -1;
    }

    if (currentRole && currentRole !== 'admin') {
      if (/^\s*(?:filter|check):\s*\{\s*\}/.test(line)) {
        if (/#\s*security-reviewed:\s*\S+/i.test(line)) {
          notices.push(
            `${normPath}:${lineNumber}: security-reviewed empty permission for role "${currentRole}" allowed`,
          );
        } else {
          findings.push({
            file: normPath,
            line: lineNumber,
            rule: 'hasura-empty-permission',
            message: `Non-admin role "${currentRole}" uses empty permission ({})`,
          });
        }
      }
    }
  }
}

export function checkFileContent(filePath, content) {
  const normPath = normalizePath(filePath);
  const findings = [];
  const notices = [];

  if (isSensitiveNoticePath(normPath)) {
    notices.push(`⚠️ Sensitive file modified (review closely): ${normPath}`);
  }

  if (isBinaryContent(content)) {
    return { findings, notices };
  }

  const lines = content.split(/\r?\n/);
  const ext = path.posix.extname(normPath).toLowerCase();
  const base = path.posix.basename(normPath);
  const skipLongLine = base === 'package-lock.json' || LONG_LINE_SKIP_EXTS.has(ext);
  const isJsTs = JS_TS_EXTS.has(ext);
  const isStrictZeroWidth = STRICT_ZERO_WIDTH_EXTS.has(ext);
  const checkCodeExec = isCodeExecTarget(normPath);

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const lineNumber = idx + 1;

    // 1. Bidi control characters
    if (BIDI_REGEX.test(line)) {
      findings.push({
        file: normPath,
        line: lineNumber,
        rule: 'bidi-control',
        message: 'Hidden Unicode bidirectional control character detected',
      });
    }

    // 2. Zero-width characters
    if (isStrictZeroWidth) {
      if (ZERO_WIDTH_REGEX.test(line)) {
        findings.push({
          file: normPath,
          line: lineNumber,
          rule: 'zero-width',
          message: 'Zero-width Unicode character detected',
        });
      }
    } else if (isJsTs) {
      const stripped = stripJsStringLiterals(line);
      if (ZERO_WIDTH_REGEX.test(stripped)) {
        findings.push({
          file: normPath,
          line: lineNumber,
          rule: 'zero-width',
          message: 'Zero-width Unicode character detected outside string literals',
        });
      }
    }

    // 3. Long source line > 500 characters
    if (!skipLongLine && line.length > 500) {
      findings.push({
        file: normPath,
        line: lineNumber,
        rule: 'long-line',
        message: `Line exceeds 500 characters (${line.length} chars)`,
      });
    }

    // 4. Dynamic code execution / process spawning in JS/TS paths
    if (checkCodeExec) {
      for (const pattern of CODE_EXEC_PATTERNS) {
        if (pattern.regex.test(line)) {
          findings.push({
            file: normPath,
            line: lineNumber,
            rule: 'dangerous-runtime-api',
            message: `Disallowed runtime API (${pattern.name}) in ${normPath}`,
          });
        }
      }
    }

    // 5. Large base64 blob (>200 chars) near decoder/eval
    if (BASE64_BLOB_REGEX.test(line)) {
      const start = Math.max(0, idx - 3);
      const end = Math.min(lines.length - 1, idx + 3);
      const windowText = lines.slice(start, end + 1).join('\n');
      if (BASE64_DECODER_REGEX.test(windowText)) {
        findings.push({
          file: normPath,
          line: lineNumber,
          rule: 'encoded-payload',
          message: 'Long base64 string (>200 chars) near decoder or execution call',
        });
      }
    }
  }

  // 6. Shell & Dockerfile download checks
  if (isShellOrDockerfileTarget(normPath)) {
    checkShellAndDockerDownloads(normPath, lines, findings, notices);
  }

  // 7. Dangerous SQL in migrations/**/*.sql
  if (normPath.startsWith('migrations/') && ext === '.sql') {
    const isCreateExtMigration = /_create_[a-z0-9_]*extensions?(\/|$)/.test(normPath);
    for (let idx = 0; idx < lines.length; idx += 1) {
      const rawLine = lines[idx];
      const lineNumber = idx + 1;
      const sqlOnly = stripSqlComments(rawLine);
      if (!sqlOnly.trim()) continue;

      const reviewMatch = rawLine.match(/--\s*security-reviewed:\s*(.+)$/i);
      for (const rule of DANGEROUS_SQL_PATTERNS) {
        if (rule.allowInCreateExtensions && isCreateExtMigration) continue;
        if (rule.regex.test(sqlOnly)) {
          if (reviewMatch) {
            notices.push(
              `${normPath}:${lineNumber}: security-reviewed SQL (${rule.name}) — ${reviewMatch[1].trim()}`,
            );
          } else {
            findings.push({
              file: normPath,
              line: lineNumber,
              rule: 'dangerous-migration-sql',
              message: `Disallowed migration SQL (${rule.name}) without "-- security-reviewed: <reason>"`,
            });
          }
        }
      }
    }
  }

  // 8. Hasura permissions in metadata/**/*.yaml
  if (normPath.startsWith('metadata/') && (ext === '.yaml' || ext === '.yml')) {
    checkHasuraPermissions(normPath, lines, findings, notices);
  }

  return { findings, notices };
}

export function checkFiles(filePaths, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const allFindings = [];
  const allNotices = [];

  for (const rawPath of filePaths) {
    const trimmed = rawPath.trim();
    if (!trimmed) continue;
    const fullPath = path.resolve(cwd, trimmed);

    let content;
    try {
      content = fs.readFileSync(fullPath, 'utf8');
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'EISDIR' || err.code === 'ENOTDIR')) {
        continue;
      }
      throw err;
    }

    const { findings, notices } = checkFileContent(trimmed, content);
    allFindings.push(...findings);
    allNotices.push(...notices);
  }

  return { findings: allFindings, notices: allNotices };
}

function runCli() {
  const args = process.argv.slice(2);
  let useStdin = false;
  let summaryFile = process.env.GITHUB_STEP_SUMMARY || '';
  const files = [];

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--stdin') {
      useStdin = true;
    } else if (args[i] === '--summary-file' && i + 1 < args.length) {
      summaryFile = args[i + 1];
      i += 1;
    } else {
      files.push(args[i]);
    }
  }

  if (useStdin) {
    const stdinText = fs.readFileSync(0, 'utf8');
    for (const line of stdinText.split(/\r?\n/)) {
      if (line.trim()) files.push(line.trim());
    }
  }

  const { findings, notices } = checkFiles(files);

  if (notices.length > 0) {
    for (const notice of notices) {
      console.log(notice);
    }
    if (summaryFile) {
      const md = [
        '### Suspicious-Code Check Notices',
        '',
        ...notices.map((n) => `- ${n}`),
        '',
      ].join('\n');
      fs.appendFileSync(summaryFile, md, 'utf8');
    }
  }

  if (findings.length > 0) {
    console.error('Suspicious-code check failed:');
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line}: [${f.rule}] ${f.message}`);
    }
    if (summaryFile) {
      const md = [
        '### Suspicious-Code Check Failures',
        '',
        ...findings.map((f) => `- \`${f.file}:${f.line}\` (**${f.rule}**): ${f.message}`),
        '',
      ].join('\n');
      fs.appendFileSync(summaryFile, md, 'utf8');
    }
    process.exit(1);
  }

  console.log(`Suspicious-code check passed across ${files.length} changed file(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli();
}

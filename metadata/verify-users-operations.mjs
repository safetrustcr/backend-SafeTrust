#!/usr/bin/env node
// Read-only check that the `users` GraphQL operations exist on a Hasura
// deployment (issue #666). Safe to point at Hasura Cloud: it only calls
// `get_inconsistent_metadata`, `export_metadata` and GraphQL introspection,
// and never writes. No defaults to localhost — the target must be explicit so
// a green local run can't be mistaken for a Cloud check. Secrets are read from
// the environment and never printed.
//
//   HASURA_ENDPOINT=https://<project>.hasura.app \
//   HASURA_ADMIN_SECRET=...  \          (metadata checks; omit to skip them)
//   GUEST_TOKEN=<jwt> HOST_TOKEN=<jwt>  (real role JWTs; omit to skip a role)
//   node metadata/verify-users-operations.mjs [--source safetrust]
//
// Exit code 0 = every check that ran passed, 1 = at least one failed,
// 2 = bad usage. Skipped checks are listed and never count as passes.

const endpoint = (process.env.HASURA_ENDPOINT || '').replace(/\/+$/, '');
const adminSecret = process.env.HASURA_ADMIN_SECRET || '';
const sourceIdx = process.argv.indexOf('--source');
const source = sourceIdx > -1 ? process.argv[sourceIdx + 1] : 'safetrust';

if (!/^https?:\/\//.test(endpoint)) {
  console.error('HASURA_ENDPOINT is required (e.g. https://<project>.hasura.app). No localhost default, on purpose.');
  process.exit(2);
}

const results = [];
const record = (status, name, detail = '') => {
  results.push({ status, name, detail });
  const tag = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' }[status];
  console.log(`${tag}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function post(path, body, headers) {
  const res = await fetch(`${endpoint}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: null };
  }
}

const rootFields = async (rootName, headers) => {
  const { json } = await post('/v1/graphql', { query: `{ __type(name: "${rootName}") { fields { name } } }` }, headers);
  return json?.data?.__type?.fields?.map((f) => f.name) ?? null;
};

async function checkMetadata() {
  if (!adminSecret) return record('skip', 'metadata checks', 'HASURA_ADMIN_SECRET not set');
  const h = { 'x-hasura-admin-secret': adminSecret };

  const inc = await post('/v1/metadata', { type: 'get_inconsistent_metadata', args: {} }, h);
  if (inc.status !== 200 || !inc.json) return record('fail', 'get_inconsistent_metadata', `HTTP ${inc.status}`);
  const bad = inc.json.inconsistent_objects ?? [];
  record(
    inc.json.is_consistent ? 'pass' : 'fail',
    'metadata is consistent',
    inc.json.is_consistent ? '' : `${bad.length} inconsistent object(s): ${bad.slice(0, 5).map((o) => o.reason).join(' | ')}`,
  );

  const exp = await post('/v1/metadata', { type: 'export_metadata', args: {} }, h);
  const src = (exp.json?.metadata ?? exp.json)?.sources?.find((s) => s.name === source);
  if (!src) return record('fail', `source "${source}" exists in metadata`);
  record('pass', `source "${source}" exists in metadata`);
  const users = (src.tables ?? []).find((t) => t.table?.name === 'users');
  if (!users) return record('fail', 'users table is tracked');
  record(users.table.schema === 'safetrust' ? 'pass' : 'fail', 'users is tracked from schema "safetrust"', `schema=${users.table.schema}`);
  const customName = users.configuration?.custom_name;
  record(
    customName === 'users' ? 'pass' : 'fail',
    'users has custom_name "users" (original GraphQL contract)',
    customName ? `custom_name=${customName}` : 'no custom_name: root fields will be safetrust_users*',
  );
  const roles = (users.select_permissions ?? []).map((p) => p.role).sort();
  record(roles.length > 0 ? 'pass' : 'fail', 'users has select permissions', `roles=${roles.join(',') || 'none'}`);
}

async function checkRole(label, token) {
  if (!token) return record('skip', `${label}: GraphQL operations`, `${label.toUpperCase()}_TOKEN not set`);
  const h = { authorization: `Bearer ${token}` };
  const q = await rootFields('query_root', h);
  if (!q) return record('fail', `${label}: introspection of query_root`, 'no data (auth failed or schema empty)');
  record(q.includes('users') ? 'pass' : 'fail', `${label}: query_root has "users"`);
  record(q.includes('safetrust_users') ? 'fail' : 'pass', `${label}: query_root has no "safetrust_users"`);
  record(q.includes('no_queries_available') ? 'fail' : 'pass', `${label}: query_root is not the empty "no_queries_available" schema`);
  const s = await rootFields('subscription_root', h);
  record(s?.includes('users') ? 'pass' : 'fail', `${label}: subscription_root has "users"`);
  const sel = await post('/v1/graphql', { query: '{ users(limit: 1) { id } }' }, h);
  record(!sel.json?.errors && sel.json?.data ? 'pass' : 'fail', `${label}: { users(limit: 1) { id } } succeeds`, sel.json?.errors?.[0]?.message ?? '');
}

await checkMetadata();
await checkRole('guest', process.env.GUEST_TOKEN);
await checkRole('host', process.env.HOST_TOKEN);

const failed = results.filter((r) => r.status === 'fail').length;
const skipped = results.filter((r) => r.status === 'skip').length;
console.log(`\n${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed > 0 ? 1 : 0);

import { readFileSync } from 'fs'
import { join } from 'path'

const dir = join(__dirname, '../../../migrations/safetrust/1793400000000_normalize_duplicated_facts')
const up = readFileSync(join(dir, 'up.sql'), 'utf8')
const down = readFileSync(join(dir, 'down.sql'), 'utf8')

describe('issue #790 normalization migration', () => {
  it('backfills user_roles before dropping users.role', () => {
    const backfill = up.indexOf('INSERT INTO safetrust.user_roles')
    const drop = up.indexOf('DROP COLUMN role')
    expect(backfill).toBeGreaterThanOrEqual(0)
    expect(drop).toBeGreaterThanOrEqual(0)
    expect(backfill).toBeLessThan(drop)
  })
  it('merges capacity into max_guests without lowering it, then drops capacity', () => {
    expect(up).toContain('GREATEST(')
    expect(up).toContain('DROP COLUMN capacity')
  })
  it('moves user_id_list into a join table and drops the array', () => {
    expect(up).toContain('CREATE TABLE safetrust.pricing_override_users')
    expect(up).toContain('DROP COLUMN user_id_list')
  })
  it('renames tenant_id to bidder_id and rewrites triggers', () => {
    expect(up).toContain('RENAME COLUMN tenant_id TO bidder_id')
    expect(up).not.toMatch(/WHERE tenant_id/)
  })
  it('has a down migration restoring every dropped column', () => {
    for (const c of ['ADD COLUMN role', 'ADD COLUMN capacity', 'ADD COLUMN user_id_list', 'RENAME COLUMN bidder_id TO tenant_id']) {
      expect(down).toContain(c)
    }
  })
})

describe('confirmation retry tenant uniqueness migration', () => {
  const retryDir = join(__dirname, '../../../migrations/safetrust/1795620000000_scope_confirmation_retry_tenant_uniqueness')
  const retryUp = readFileSync(join(retryDir, 'up.sql'), 'utf8')
  const retryDown = readFileSync(join(retryDir, 'down.sql'), 'utf8')

  it('archives and deletes duplicate retries in one statement', () => {
    expect(retryDown).toMatch(/removed_retries AS\s*\(\s*DELETE FROM/)
    expect(retryDown).toMatch(/RETURNING retries\.\*/)
  })

  it('restores archived retries without overwriting live progress', () => {
    expect(retryUp).toContain('WHERE NOT EXISTS')
    expect(retryUp).toMatch(/ON CONFLICT \(tenant_id, tx_hash, escrow_action\) DO NOTHING/)
  })
})

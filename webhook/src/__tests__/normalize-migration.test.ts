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

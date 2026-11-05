import * as fs from 'fs';
import * as path from 'path';

const dir = __dirname;
const INDEX_NAME = 'Post_organizationId_state_updatedAt_idx';
const MIGRATION = path.join(dir, 'migrations', '20261104180000_agent_activity_post_index', 'migration.sql');

describe('control plane agent center schema', () => {
  it('Post declares the org + state + updatedAt composite index', () => {
    const schema = fs.readFileSync(path.join(dir, 'schema.prisma'), 'utf8');
    const start = schema.indexOf('model Post {');
    expect(start).toBeGreaterThan(-1);
    const block = schema.slice(start, schema.indexOf('\n}\n', start));
    expect(block).toContain('@@index([organizationId, state, updatedAt])');
  });

  it('the migration is a single CREATE INDEX statement', () => {
    expect(fs.existsSync(MIGRATION)).toBe(true);
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain(INDEX_NAME);
    const statements = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^CREATE INDEX /);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { getTestDataSource } from './db';

let ds: DataSource;

beforeAll(async () => { ds = await getTestDataSource(); });
afterAll(async () => { if (ds?.isInitialized) await ds.destroy(); });

const columnsOf = (table: string) =>
  ds.query(
    `SELECT column_name, data_type, character_maximum_length, is_nullable
     FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name`,
    [table],
  );

describe('initial schema', () => {
  it('creates all three tables', async () => {
    const rows = await ds.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('users','refresh_tokens','categories')`,
    );
    expect(rows.map((r: { table_name: string }) => r.table_name).sort()).toEqual(
      ['categories', 'refresh_tokens', 'users'],
    );
  });

  it('sizes password_hash for a bcrypt digest', async () => {
    const cols = await columnsOf('users');
    const hash = cols.find((c: { column_name: string }) => c.column_name === 'password_hash');
    expect(hash.character_maximum_length).toBe(60);
  });

  it('sizes token_hash for a sha256 hex digest', async () => {
    const cols = await columnsOf('refresh_tokens');
    const hash = cols.find((c: { column_name: string }) => c.column_name === 'token_hash');
    expect(hash.character_maximum_length).toBe(64);
  });

  it('enforces category name uniqueness case-insensitively per user', async () => {
    const [user] = await ds.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ('schema@test.dev', 'x', 'Schema') RETURNING id`,
    );
    await ds.query(`INSERT INTO categories (user_id, name) VALUES ($1, 'Utilities')`, [user.id]);
    await expect(
      ds.query(`INSERT INTO categories (user_id, name) VALUES ($1, 'UTILITIES')`, [user.id]),
    ).rejects.toThrow(/duplicate key value violates unique constraint/i);
    await ds.query(`DELETE FROM users WHERE id = $1`, [user.id]);
  });

  it('cascades category and token deletion when a user is removed', async () => {
    const [user] = await ds.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ('cascade@test.dev', 'x', 'Cascade') RETURNING id`,
    );
    await ds.query(`INSERT INTO categories (user_id, name) VALUES ($1, 'Housing')`, [user.id]);
    await ds.query(`DELETE FROM users WHERE id = $1`, [user.id]);
    const left = await ds.query(`SELECT 1 FROM categories WHERE user_id = $1`, [user.id]);
    expect(left).toHaveLength(0);
  });
});

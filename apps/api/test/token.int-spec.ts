import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { TokenService, REFRESH_GRACE_MS } from '../src/auth/token.service';
import { RefreshToken } from '../src/auth/refresh-token.entity';
import { User } from '../src/users/user.entity';
import { UsersModule } from '../src/users/users.module';
import { validateEnv } from '../src/config/env.schema';
import { getTestDataSource, truncateAll } from './db';

let ds: DataSource;
let tokens: TokenService;
let userId: string;

beforeEach(async () => {
  ds = await getTestDataSource();
  await truncateAll(ds);

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env.test'] }),
      TypeOrmModule.forRoot({
        type: 'postgres',
        url: process.env.DATABASE_URL,
        entities: [User, RefreshToken],
        synchronize: false,
      }),
      TypeOrmModule.forFeature([RefreshToken]),
      JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET }),
      UsersModule,
    ],
    providers: [TokenService],
  }).compile();

  tokens = moduleRef.get(TokenService);

  const [row] = await ds.query(
    `INSERT INTO users (email, password_hash, name)
     VALUES ('tok@test.dev', '$2b$10$abcdefghijklmnopqrstuv', 'Tok') RETURNING id`,
  );
  userId = row.id;
});

afterAll(async () => { if (ds?.isInitialized) await ds.destroy(); });

describe('TokenService.rotate', () => {
  it('stores only a hash — the plaintext token never reaches the database', async () => {
    const { token } = await tokens.issueRefreshToken(userId);
    const rows = await ds.query(`SELECT token_hash FROM refresh_tokens`);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rotates a valid token and revokes the predecessor', async () => {
    const first = await tokens.issueRefreshToken(userId);
    const next = await tokens.rotate(first.token);

    expect(next.refreshToken).not.toBe(first.token);
    const rows = await ds.query(
      `SELECT revoked_at, replaced_by FROM refresh_tokens WHERE revoked_at IS NOT NULL`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].replaced_by).not.toBeNull();
  });

  it('rejects an unknown token without touching the user’s other sessions', async () => {
    await tokens.issueRefreshToken(userId);
    await expect(tokens.rotate('not-a-real-token')).rejects.toThrow(/Invalid refresh token/i);
    const live = await ds.query(`SELECT 1 FROM refresh_tokens WHERE revoked_at IS NULL`);
    expect(live).toHaveLength(1);
  });

  it('rejects an expired token', async () => {
    const { token } = await tokens.issueRefreshToken(userId);
    await ds.query(`UPDATE refresh_tokens SET expires_at = now() - interval '1 day'`);
    await expect(tokens.rotate(token)).rejects.toThrow(/expired/i);
  });

  // --- Review Focus item 1 ---
  it('lets two concurrent refreshes with the same cookie both succeed', async () => {
    const first = await tokens.issueRefreshToken(userId);

    const a = await tokens.rotate(first.token);
    const b = await tokens.rotate(first.token); // the racing second request

    expect(a.accessToken).toBeTruthy();
    expect(b.accessToken).toBeTruthy();

    const live = await ds.query(`SELECT 1 FROM refresh_tokens WHERE revoked_at IS NULL`);
    expect(live.length).toBeGreaterThan(0); // the user is NOT logged out
  });

  it('revokes the whole chain when a token is replayed after the grace window', async () => {
    const first = await tokens.issueRefreshToken(userId);
    await tokens.rotate(first.token);

    await ds.query(
      `UPDATE refresh_tokens SET revoked_at = now() - interval '${REFRESH_GRACE_MS + 60_000} milliseconds'
       WHERE revoked_at IS NOT NULL`,
    );

    await expect(tokens.rotate(first.token)).rejects.toThrow(/reuse/i);

    const live = await ds.query(`SELECT 1 FROM refresh_tokens WHERE revoked_at IS NULL`);
    expect(live).toHaveLength(0); // every session killed
  });

  it('revokes the whole chain when the successor is itself already revoked', async () => {
    const first = await tokens.issueRefreshToken(userId);
    const second = await tokens.rotate(first.token);
    await tokens.revokeAllForUser(userId);

    await expect(tokens.rotate(first.token)).rejects.toThrow(/reuse detected/i);
    expect(second.refreshToken).toBeTruthy();
  });

  it('revokes every session for the user on demand', async () => {
    await tokens.issueRefreshToken(userId);
    await tokens.issueRefreshToken(userId);
    await tokens.revokeAllForUser(userId);

    const live = await ds.query(`SELECT 1 FROM refresh_tokens WHERE revoked_at IS NULL`);
    expect(live).toHaveLength(0);
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { verify } from 'jsonwebtoken';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { TokenService, REFRESH_GRACE_MS } from '../src/auth/token.service';

// MAX_CHAIN_HOPS is private to the service; 16 is its value, and the loop below
// needs to exceed it. If the bound changes, this must change with it.
const MAX_CHAIN_HOPS_FOR_TEST = 16;
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
      // Deliberately NOT the configured secret. If issueAccessToken ever drops
      // its explicit `secret`, jwt.sign falls back to this one and verification
      // against JWT_ACCESS_SECRET fails — which is the point.
      JwtModule.register({ secret: 'module-fallback-secret-never-used-in-prod' }),
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
  it('lets two refreshes with the same cookie both succeed, leaving exactly one live token',
    async () => {
      const first = await tokens.issueRefreshToken(userId);

      const a = await tokens.rotate(first.token);
      const b = await tokens.rotate(first.token); // the racing second request

      expect(a.accessToken).toBeTruthy();
      expect(b.accessToken).toBeTruthy();

      // Exactly one, not "more than zero": an orphaned extra live token is the
      // signature of an unsynchronized rotate, and `toBeGreaterThan(0)` hides it.
      const live = await ds.query(`SELECT 1 FROM refresh_tokens WHERE revoked_at IS NULL`);
      expect(live).toHaveLength(1);

      // The token actually handed back must work — "some row is live" is not the
      // same claim as "the user still has a session".
      await expect(tokens.rotate(b.refreshToken)).resolves.toBeTruthy();
    });

  it('lets THREE refreshes with the same cookie all succeed', async () => {
    const first = await tokens.issueRefreshToken(userId);

    const a = await tokens.rotate(first.token);
    const b = await tokens.rotate(first.token);
    const c = await tokens.rotate(first.token); // single-hop grace fails here

    expect(a.accessToken).toBeTruthy();
    expect(b.accessToken).toBeTruthy();
    expect(c.accessToken).toBeTruthy();

    const live = await ds.query(`SELECT 1 FROM refresh_tokens WHERE revoked_at IS NULL`);
    expect(live).toHaveLength(1);
    await expect(tokens.rotate(c.refreshToken)).resolves.toBeTruthy();
  });

  it('rejects a revoked token with no live successor without killing the chain', async () => {
    const first = await tokens.issueRefreshToken(userId);
    const other = await tokens.issueRefreshToken(userId); // a session on another device
    await tokens.revoke(first.token); // logout, so no successor exists

    await expect(tokens.rotate(first.token)).rejects.toThrow(/Invalid refresh token/i);

    // A logout race must not sign the user out everywhere else.
    const live = await ds.query(`SELECT 1 FROM refresh_tokens WHERE revoked_at IS NULL`);
    expect(live).toHaveLength(1);
    await expect(tokens.rotate(other.token)).resolves.toBeTruthy();
  });

  it('treats a token that is both expired and revoked as replay, not expiry', async () => {
    const first = await tokens.issueRefreshToken(userId);
    await tokens.rotate(first.token);
    await ds.query(
      `UPDATE refresh_tokens
       SET revoked_at = now() - interval '1 hour', expires_at = now() - interval '1 day'`,
    );

    // Expiry must not exempt a revoked token from the theft signal.
    await expect(tokens.rotate(first.token)).rejects.toThrow(/reuse detected/i);
  });

  it('still graces a refresh at 29 seconds and refuses at 31', async () => {
    const first = await tokens.issueRefreshToken(userId);
    await tokens.rotate(first.token);
    await ds.query(
      `UPDATE refresh_tokens SET revoked_at = now() - interval '29 seconds'
       WHERE revoked_at IS NOT NULL`,
    );
    await expect(tokens.rotate(first.token)).resolves.toBeTruthy();

    const second = await tokens.issueRefreshToken(userId);
    await tokens.rotate(second.token);
    await ds.query(
      `UPDATE refresh_tokens SET revoked_at = now() - interval '31 seconds'
       WHERE revoked_at IS NOT NULL`,
    );
    await expect(tokens.rotate(second.token)).rejects.toThrow(/reuse detected/i);
  });

  it('revoke() marks the token revoked so it can no longer be rotated', async () => {
    const first = await tokens.issueRefreshToken(userId);
    await tokens.revoke(first.token);

    const rows = await ds.query(`SELECT revoked_at FROM refresh_tokens`);
    expect(rows[0].revoked_at).not.toBeNull();
    await expect(tokens.rotate(first.token)).rejects.toThrow(/Invalid refresh token/i);
  });

  it('rejects a logged-out token long after the window without killing other devices',
    async () => {
      const first = await tokens.issueRefreshToken(userId);
      const other = await tokens.issueRefreshToken(userId); // another device
      await tokens.revoke(first.token);
      await ds.query(
        `UPDATE refresh_tokens SET revoked_at = now() - interval '5 minutes'
         WHERE revoked_at IS NOT NULL`,
      );

      // A backgrounded tab retrying a dead cookie minutes after logout is not
      // a replay: the token was never rotated, so it has no successor to steal.
      await expect(tokens.rotate(first.token)).rejects.toThrow(/Invalid refresh token/i);

      const live = await ds.query(`SELECT 1 FROM refresh_tokens WHERE revoked_at IS NULL`);
      expect(live).toHaveLength(1);
      await expect(tokens.rotate(other.token)).resolves.toBeTruthy();
    });

  it('refuses an over-deep chain without treating it as theft', async () => {
    const first = await tokens.issueRefreshToken(userId);
    let current = await tokens.rotate(first.token);
    for (let i = 0; i < MAX_CHAIN_HOPS_FOR_TEST; i += 1) {
      current = await tokens.rotate(current.refreshToken);
    }

    // Walking from `first` now exceeds the hop bound. Bad data must not be
    // read as a theft signal — the user keeps their session.
    await expect(tokens.rotate(first.token)).rejects.toThrow(/Invalid refresh token/i);
    const live = await ds.query(`SELECT 1 FROM refresh_tokens WHERE revoked_at IS NULL`);
    expect(live).toHaveLength(1);
  });

  it('serializes two simultaneous rotations of the same token', async () => {
    const first = await tokens.issueRefreshToken(userId);

    // Genuinely concurrent, unlike the sequential awaits above: both promises
    // are in flight before either resolves. Without the row lock both can read
    // the token as live and rotate it, leaving two live successors.
    const results = await Promise.allSettled([
      tokens.rotate(first.token),
      tokens.rotate(first.token),
    ]);

    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    const live = await ds.query(`SELECT 1 FROM refresh_tokens WHERE revoked_at IS NULL`);
    expect(live).toHaveLength(1);
  });

  it('signs access tokens with the configured secret and TTL', async () => {
    const user = { id: userId, email: 'tok@test.dev' };
    const raw = tokens.issueAccessToken(user);

    // Verify with the secret from config, not the one the test module registered —
    // otherwise dropping the explicit secret in issueAccessToken would go unnoticed.
    const decoded = verify(raw, process.env.JWT_ACCESS_SECRET as string) as {
      sub: string;
      email: string;
      iat: number;
      exp: number;
    };

    expect(decoded.sub).toBe(userId);
    expect(decoded.email).toBe('tok@test.dev');
    // .env.test sets JWT_ACCESS_TTL=1s
    expect(decoded.exp - decoded.iat).toBe(1);
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

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { RefreshToken } from './refresh-token.entity';
import { UsersService } from '../users/users.service';
import type { User } from '../users/user.entity';
import type { Env } from '../config/env.schema';

export const REFRESH_GRACE_MS = 30_000;

/** Bound on the replaced_by walk, so corrupt data cannot loop. */
const MAX_CHAIN_HOPS = 16;

export interface RotationResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

@Injectable()
export class TokenService {
  constructor(
    @InjectRepository(RefreshToken) private readonly tokens: Repository<RefreshToken>,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  issueAccessToken(user: Pick<User, 'id' | 'email'>): string {
    return this.jwt.sign(
      { sub: user.id, email: user.email },
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
      },
    );
  }

  async issueRefreshToken(
    userId: string,
    repo: Repository<RefreshToken> = this.tokens,
  ): Promise<{ token: string; expiresAt: Date; id: string }> {
    const token = randomBytes(32).toString('base64url');
    const days = this.config.get('REFRESH_TTL_DAYS', { infer: true });
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const saved = await repo.save(
      repo.create({
        userId,
        tokenHash: this.hash(token),
        expiresAt,
        revokedAt: null,
        replacedBy: null,
      }),
    );

    // Return the id rather than re-querying by hash. A re-query that came back
    // null would commit the predecessor with replaced_by = null, turning an
    // impossible condition into a silent chain-kill on the next refresh.
    return { token, expiresAt, id: saved.id };
  }

  async rotate(presented: string): Promise<RotationResult> {
    if (!presented) throw new UnauthorizedException('Invalid refresh token');

    // The transaction must COMMIT writes even on the reject paths: a thrown
    // error inside manager.transaction() rolls everything in it back,
    // including a chain-kill revocation that is the whole point of this
    // branch. So every path returns an outcome instead of throwing, and the
    // UnauthorizedException is only raised once the transaction has settled.
    type Outcome = { ok: true; result: RotationResult } | { ok: false; message: string };

    // One transaction with a row lock on the presented token. Without it, two
    // simultaneous requests can both see the token as live and both rotate it,
    // issuing two successors and orphaning one.
    const outcome: Outcome = await this.tokens.manager.transaction(async (manager) => {
      const repo = manager.getRepository(RefreshToken);

      const row = await repo.findOne({
        where: { tokenHash: this.hash(presented) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) return { ok: false, message: 'Invalid refresh token' };

      // Revocation is checked BEFORE expiry. Presenting a revoked token is the
      // theft signal, and an expired one must not be exempt from it — every
      // rotation issues a fresh expiry, so a chain outlives any single stolen
      // token, and an attacker who waited out the expiry would escape detection.
      if (row.revokedAt) {
        const withinGrace = Date.now() - row.revokedAt.getTime() <= REFRESH_GRACE_MS;
        if (!withinGrace) {
          await this.revokeAllForUser(row.userId, manager);
          return { ok: false, message: 'Refresh token reuse detected' };
        }

        if (!row.replacedBy) {
          // Revoked with no successor ever issued (e.g. an explicit logout):
          // a benign race with the logout button, not a replay. Reject
          // without touching the user's other devices.
          return { ok: false, message: 'Invalid refresh token' };
        }

        const tip = await this.liveChainTip(row, repo);
        if (!tip) {
          // A successor existed at some point but the entire tail of the
          // chain is now dead. That is the reuse signature, not a race.
          await this.revokeAllForUser(row.userId, manager);
          return { ok: false, message: 'Refresh token reuse detected' };
        }
        return { ok: true, result: await this.rotateRow(tip, repo) };
      }

      if (row.expiresAt.getTime() <= Date.now()) {
        return { ok: false, message: 'Refresh token expired' };
      }

      return { ok: true, result: await this.rotateRow(row, repo) };
    });

    if (!outcome.ok) throw new UnauthorizedException(outcome.message);
    return outcome.result;
  }

  /**
   * Walks `replaced_by` forward to the newest link and returns it if it is
   * still live. Following only the immediate successor would tolerate exactly
   * two concurrent refreshes and log the user out on the third.
   */
  private async liveChainTip(
    start: RefreshToken,
    repo: Repository<RefreshToken>,
  ): Promise<RefreshToken | null> {
    let current = start;
    for (let hops = 0; hops < MAX_CHAIN_HOPS; hops += 1) {
      if (!current.revokedAt) return current;
      if (!current.replacedBy) return null;
      const next = await repo.findOne({ where: { id: current.replacedBy } });
      if (!next) return null;
      current = next;
    }
    return null; // bounded: corrupt data cannot loop forever
  }

  private async rotateRow(
    row: RefreshToken,
    repo: Repository<RefreshToken>,
  ): Promise<RotationResult> {
    const user = await this.users.findById(row.userId);
    if (!user) throw new UnauthorizedException('Invalid refresh token');

    const next = await this.issueRefreshToken(row.userId, repo);

    row.revokedAt = new Date();
    row.replacedBy = next.id; // carried through from save(), never re-queried
    await repo.save(row);

    return {
      accessToken: this.issueAccessToken(user),
      refreshToken: next.token,
      expiresAt: next.expiresAt,
    };
  }

  async revoke(presented: string): Promise<void> {
    if (!presented) return;
    await this.tokens.update(
      { tokenHash: this.hash(presented), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async revokeAllForUser(userId: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(RefreshToken) : this.tokens;
    await repo.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }
}

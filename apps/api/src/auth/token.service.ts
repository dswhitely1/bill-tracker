import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { RefreshToken } from './refresh-token.entity';
import { User } from '../users/user.entity';
import type { Env } from '../config/env.schema';

export const REFRESH_GRACE_MS = 30_000;

/** Bound on the replaced_by walk, so corrupt data cannot loop. */
const MAX_CHAIN_HOPS = 16;

export interface RotationResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/** Returned, never thrown, so a reject path cannot roll back its own writes. */
type RotateOutcome =
  | { ok: true; result: RotationResult }
  | { ok: false; message: string };

type ChainTip =
  | { status: 'live'; row: RefreshToken }
  | { status: 'dead' }
  | { status: 'exhausted' };

@Injectable()
export class TokenService {
  constructor(
    @InjectRepository(RefreshToken) private readonly tokens: Repository<RefreshToken>,
    private readonly jwt: JwtService,
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
    // rotate() is the cookie boundary: a non-string value reaching
    // createHash().update() throws a TypeError, surfacing as 500 instead of 401.
    if (!presented || typeof presented !== 'string') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Every branch RETURNS an outcome; none throws. A throw inside
    // manager.transaction() rolls the whole transaction back — including the
    // chain-kill revocation that the replay branch exists to perform, which
    // would answer "reuse detected" while leaving every stolen sibling live.
    // The 401 is raised only after the transaction has committed.
    const outcome: RotateOutcome = await this.tokens.manager.transaction(async (manager) => {
      const repo = manager.getRepository(RefreshToken);

      const row = await repo.findOne({
        where: { tokenHash: this.hash(presented) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) return { ok: false, message: 'Invalid refresh token' };

      // Revocation is checked BEFORE expiry. Presenting a revoked token is the
      // theft signal, and an expired one must not be exempt from it: every
      // rotation issues a fresh expiry, so a chain outlives any single stolen
      // token and an attacker who waited out the expiry would escape detection.
      if (row.revokedAt) {
        // A token that was never rotated cannot have been replayed AFTER
        // rotation — it was revoked by an explicit logout. Reject it at any
        // age without touching the user's other devices. This sits ABOVE the
        // grace test on purpose: a backgrounded tab retrying a dead cookie a
        // minute after logout must not sign the user out everywhere.
        if (!row.replacedBy) return { ok: false, message: 'Invalid refresh token' };

        const withinGrace = Date.now() - row.revokedAt.getTime() <= REFRESH_GRACE_MS;
        if (!withinGrace) {
          await this.revokeAllForUser(row.userId, manager);
          return { ok: false, message: 'Refresh token reuse detected' };
        }

        const tip = await this.liveChainTip(row, repo);
        if (tip.status === 'exhausted') {
          // Corrupt or absurdly deep chain. Refuse the request, but do not
          // read it as theft — that would log a user out over bad data.
          return { ok: false, message: 'Invalid refresh token' };
        }
        if (tip.status === 'dead') {
          await this.revokeAllForUser(row.userId, manager);
          return { ok: false, message: 'Refresh token reuse detected' };
        }
        return this.rotateRow(tip.row, repo, manager);
      }

      if (row.expiresAt.getTime() <= Date.now()) {
        return { ok: false, message: 'Refresh token expired' };
      }

      return this.rotateRow(row, repo, manager);
    });

    if (!outcome.ok) throw new UnauthorizedException(outcome.message);
    return outcome.result;
  }

  /**
   * Walks `replaced_by` forward to the newest link. Following only the
   * immediate successor would tolerate exactly two concurrent refreshes and
   * log the user out on the third.
   */
  private async liveChainTip(
    start: RefreshToken,
    repo: Repository<RefreshToken>,
  ): Promise<ChainTip> {
    let current = start;
    for (let hops = 0; hops < MAX_CHAIN_HOPS; hops += 1) {
      if (!current.revokedAt) return { status: 'live', row: current };
      if (!current.replacedBy) return { status: 'dead' };

      // Lock every link as we walk. An unlocked read here lets a request
      // holding a lock on a LATER link rotate it underneath us, orphaning a
      // live token — the same race the lock on the presented row prevents.
      // Locks are taken strictly forward along the chain, so no cycle forms.
      const next = await repo.findOne({
        where: { id: current.replacedBy },
        lock: { mode: 'pessimistic_write' },
      });
      if (!next) return { status: 'dead' };
      current = next;
    }
    return { status: 'exhausted' };
  }

  private async rotateRow(
    row: RefreshToken,
    repo: Repository<RefreshToken>,
    manager: EntityManager,
  ): Promise<RotateOutcome> {
    // Look the user up through the transaction's OWN manager. Going through
    // UsersService would draw a second connection from the pool while this
    // transaction holds one plus its row locks; at pool size (pg default 10)
    // concurrent rotations, that is a permanent self-deadlock.
    const user = await manager.getRepository(User).findOne({ where: { id: row.userId } });
    if (!user) return { ok: false, message: 'Invalid refresh token' };

    const next = await this.issueRefreshToken(row.userId, repo);

    row.revokedAt = new Date();
    row.replacedBy = next.id; // carried through from save(), never re-queried
    await repo.save(row);

    return {
      ok: true,
      result: {
        accessToken: this.issueAccessToken(user),
        refreshToken: next.token,
        expiresAt: next.expiresAt,
      },
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

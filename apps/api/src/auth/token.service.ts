import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { RefreshToken } from './refresh-token.entity';
import { UsersService } from '../users/users.service';
import type { User } from '../users/user.entity';
import type { Env } from '../config/env.schema';

export const REFRESH_GRACE_MS = 30_000;

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

  async issueRefreshToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const days = this.config.get('REFRESH_TTL_DAYS', { infer: true });
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await this.tokens.save(
      this.tokens.create({
        userId,
        tokenHash: this.hash(token),
        expiresAt,
        revokedAt: null,
        replacedBy: null,
      }),
    );

    return { token, expiresAt };
  }

  async rotate(presented: string) {
    if (!presented || typeof presented !== 'string') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const row = await this.tokens.findOne({ where: { tokenHash: this.hash(presented) } });
    if (!row) throw new UnauthorizedException('Invalid refresh token');
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (row.revokedAt) {
      const successor = row.replacedBy
        ? await this.tokens.findOne({ where: { id: row.replacedBy } })
        : null;
      const withinGrace = Date.now() - row.revokedAt.getTime() <= REFRESH_GRACE_MS;

      if (withinGrace && successor && !successor.revokedAt) {
        // A benign double refresh from one browser: both requests carried the same
        // cookie because neither response had landed yet. Rotate the successor and
        // let the newer Set-Cookie win in the shared cookie jar.
        return this.rotateRow(successor);
      }

      await this.revokeAllForUser(row.userId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    return this.rotateRow(row);
  }

  private async rotateRow(row: RefreshToken) {
    const user = await this.users.findById(row.userId);
    if (!user) throw new UnauthorizedException('Invalid refresh token');

    const next = await this.issueRefreshToken(row.userId);
    const nextRow = await this.tokens.findOne({
      where: { tokenHash: this.hash(next.token) },
    });

    row.revokedAt = new Date();
    row.replacedBy = nextRow?.id ?? null;
    await this.tokens.save(row);

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

  async revokeAllForUser(userId: string): Promise<void> {
    await this.tokens.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }
}

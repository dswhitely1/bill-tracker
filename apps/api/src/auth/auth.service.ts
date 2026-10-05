import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { UsersService } from '../users/users.service';
import { TokenService } from './token.service';
import { Category } from '../categories/category.entity';
import { DEFAULT_CATEGORIES } from '../categories/default-categories';
import type { User } from '../users/user.entity';

export interface AuthResult {
  user: User;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async register(input: { email: string; name: string; password: string }): Promise<AuthResult> {
    const user = await this.dataSource.transaction(async (manager) => {
      const created = await this.users.createUser(input, manager);
      await this.seedDefaultCategories(created.id, manager);
      return created;
    });

    return this.issueFor(user);
  }

  /** Separate method so a test can force it to fail and prove the transaction rolls back. */
  private async seedDefaultCategories(userId: string, manager: EntityManager): Promise<void> {
    await manager.save(
      Category,
      DEFAULT_CATEGORIES.map((name) => manager.create(Category, { userId, name })),
    );
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.users.findByEmail(email);

    if (!user) {
      // Burn equivalent time so a missing account is indistinguishable from a bad password.
      await this.users.verifyAgainstDummyHash(password);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!(await this.users.verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueFor(user);
  }

  private async issueFor(user: User): Promise<AuthResult> {
    const refresh = await this.tokens.issueRefreshToken(user.id);
    return {
      user,
      accessToken: this.tokens.issueAccessToken(user),
      refreshToken: refresh.token,
    };
  }
}

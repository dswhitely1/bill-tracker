import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './user.entity';
import type { Env } from '../config/env.schema';
import { assertPasswordPolicy, normalizeEmail } from './password.policy';

@Injectable()
export class UsersService {
  /**
   * Lazily derived from the configured cost and cached, rather than pinned
   * as a literal. BCRYPT_COST is operator-configurable (10-15); a literal
   * hashed at a fixed cost would make the dummy-hash comparison measurably
   * faster or slower than a real one whenever the operator's cost differs
   * from the literal's, reintroducing the timing oracle this exists to close.
   */
  private dummyHash: string | null = null;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get cost(): number {
    return this.config.get('BCRYPT_COST', { infer: true });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email: normalizeEmail(email) } });
  }

  async findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  async createUser(
    input: { email: string; name: string; password: string },
    manager?: EntityManager,
  ): Promise<User> {
    assertPasswordPolicy(input.password);

    const user = this.users.create({
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      passwordHash: await bcrypt.hash(input.password, this.cost),
    });

    return manager ? manager.save(User, user) : this.users.save(user);
  }

  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  /** Burns the same time a real comparison would, so a missing user is indistinguishable. */
  async verifyAgainstDummyHash(plain: string): Promise<void> {
    this.dummyHash ??= await bcrypt.hash('no-user-matches-this-value', this.cost);
    await bcrypt.compare(plain, this.dummyHash);
  }

  async updateProfile(
    id: string,
    patch: { name?: string; notifyEmail?: boolean; notifyInApp?: boolean },
  ): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');
    if (patch.name !== undefined) user.name = patch.name.trim();
    if (patch.notifyEmail !== undefined) user.notifyEmail = patch.notifyEmail;
    if (patch.notifyInApp !== undefined) user.notifyInApp = patch.notifyInApp;
    return this.users.save(user);
  }

  async changePassword(id: string, current: string, next: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');
    if (!(await this.verifyPassword(current, user.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    assertPasswordPolicy(next);
    user.passwordHash = await bcrypt.hash(next, this.cost);
    await this.users.save(user);
  }
}

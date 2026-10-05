import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service';

const config = { get: (k: string) => (k === 'BCRYPT_COST' ? 10 : undefined) };

function serviceWith(repo: Partial<Record<string, unknown>>) {
  return new UsersService(repo as never, config as never);
}

describe('UsersService', () => {
  let findOne: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    findOne = vi.fn<(arg: unknown) => Promise<unknown>>().mockResolvedValue(null);
  });

  it('normalizes the email before looking a user up', async () => {
    const service = serviceWith({ findOne });
    await service.findByEmail('  Don@Example.COM ');
    expect(findOne).toHaveBeenCalledWith({ where: { email: 'don@example.com' } });
  });

  it('stores a bcrypt hash, never the plaintext password', async () => {
    const save = vi.fn<(u: unknown) => Promise<unknown>>(async (u: unknown) => u);
    const create = vi.fn<(u: unknown) => unknown>((u: unknown) => u);
    const service = serviceWith({ findOne, save, create });

    const user = await service.createUser({
      email: 'A@B.co', name: 'Don', password: 'hunter22',
    });

    expect(user.passwordHash).not.toBe('hunter22');
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(user.email).toBe('a@b.co');
  });

  it('produces a hash that fits the 60-character column', async () => {
    const service = serviceWith({ findOne, save: async (u: unknown) => u, create: (u: unknown) => u });
    const user = await service.createUser({ email: 'a@b.co', name: 'D', password: 'hunter22' });
    expect(user.passwordHash).toHaveLength(60);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const service = serviceWith({ findOne, save: async (u: unknown) => u, create: (u: unknown) => u });
    const user = await service.createUser({ email: 'a@b.co', name: 'D', password: 'hunter22' });

    await expect(service.verifyPassword('hunter22', user.passwordHash)).resolves.toBe(true);
    await expect(service.verifyPassword('wrong-one', user.passwordHash)).resolves.toBe(false);
  });

  it('rejects an over-byte password before bcrypt can truncate it', async () => {
    const save = vi.fn<() => void>();
    const service = serviceWith({ findOne, save, create: (u: unknown) => u });

    await expect(
      service.createUser({ email: 'a@b.co', name: 'D', password: '\u{1F512}'.repeat(25) }),
    ).rejects.toThrow(/72 bytes/);
    expect(save).not.toHaveBeenCalled();
  });
});

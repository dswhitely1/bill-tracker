import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BillScheduler } from './bill.scheduler';
import type { BillGeneratorService } from './bill-generator.service';

const makeConfig = (env: string, tz = 'UTC') =>
  ({ get: (key: string) => (key === 'NODE_ENV' ? env : tz) }) as never;

describe('BillScheduler', () => {
  let registry: SchedulerRegistry;
  let generator: { materializeAll: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    registry = new SchedulerRegistry();
    generator = { materializeAll: vi.fn<() => Promise<number>>().mockResolvedValue(0) };
  });

  const build = (env: string) =>
    new BillScheduler(
      generator as unknown as BillGeneratorService, makeConfig(env), registry,
    );

  it('generates at startup and registers the nightly job outside tests', async () => {
    const scheduler = build('development');
    await scheduler.onApplicationBootstrap();

    expect(generator.materializeAll).toHaveBeenCalledTimes(1);
    expect(registry.getCronJobs().has('bill-horizon')).toBe(true);
    registry.getCronJob('bill-horizon').stop();
  });

  it('registers nothing and generates nothing under NODE_ENV=test', async () => {
    // A cron firing mid-suite is nondeterminism in every other test, and a
    // startup sweep would race the truncate in each beforeEach.
    const scheduler = build('test');
    await scheduler.onApplicationBootstrap();

    expect(generator.materializeAll).not.toHaveBeenCalled();
    expect(registry.getCronJobs().size).toBe(0);
  });
});

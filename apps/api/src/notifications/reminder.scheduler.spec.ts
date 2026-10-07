import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { ReminderScheduler } from './reminder.scheduler';
import type { RemindersService, RunResult } from './reminders.service';

const NOTHING: RunResult = { created: 0, usersNotified: 0, mailSent: 0, mailFailed: 0 };

function configWith(values: Partial<Env>): ConfigService<Env, true> {
  return { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
}

let registry: SchedulerRegistry;
let run: ReturnType<typeof vi.fn<() => Promise<RunResult>>>;
let reminders: RemindersService;

beforeEach(() => {
  registry = new SchedulerRegistry();
  run = vi.fn<() => Promise<RunResult>>().mockResolvedValue(NOTHING);
  reminders = { run } as unknown as RemindersService;
});

const build = (env: Partial<Env>): ReminderScheduler =>
  new ReminderScheduler(reminders, configWith(env), registry);

describe('ReminderScheduler under NODE_ENV=test', () => {
  it('neither runs nor schedules, so no spec races a background write', async () => {
    await build({ NODE_ENV: 'test', APP_TIMEZONE: 'UTC' }).onApplicationBootstrap();

    expect(run).not.toHaveBeenCalled();
    expect(registry.getCronJobs().size).toBe(0);
  });
});

describe('ReminderScheduler in a real environment', () => {
  it('runs once at bootstrap, so a server that was down at 08:00 still delivers', async () => {
    await build({ NODE_ENV: 'development', APP_TIMEZONE: 'UTC' }).onApplicationBootstrap();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('schedules the daily job in the configured zone, not the host zone', async () => {
    await build({
      NODE_ENV: 'development',
      APP_TIMEZONE: 'America/New_York',
    }).onApplicationBootstrap();

    const job = registry.getCronJob('bill-reminders');
    expect(job).toBeDefined();
    // The decorator form fixes timeZone at class-definition time, which is
    // why this is registered imperatively — the same reason BillScheduler
    // gives. Asserting the zone is what keeps that from regressing to
    // a @Cron decorator.
    expect(String(job.cronTime.timeZone)).toBe('America/New_York');
  });

  it('still schedules the job when the bootstrap run throws', async () => {
    run.mockRejectedValueOnce(new Error('database is not up yet'));

    await build({ NODE_ENV: 'development', APP_TIMEZONE: 'UTC' }).onApplicationBootstrap();

    // A boot-time hiccup must not leave the process running all day with
    // no reminder job scheduled — a silent failure rather than a loud one.
    expect(registry.getCronJobs().size).toBe(1);
  });

  it('does not reject when the bootstrap run throws', async () => {
    run.mockRejectedValueOnce(new Error('database is not up yet'));

    await expect(
      build({ NODE_ENV: 'development', APP_TIMEZONE: 'UTC' }).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });

  it('fires at 08:00, after the horizon roll rather than before it', async () => {
    await build({ NODE_ENV: 'development', APP_TIMEZONE: 'UTC' }).onApplicationBootstrap();

    // Earlier than BillScheduler's 03:00 roll would mean reminders that
    // miss an instance the roll was about to materialize.
    expect(registry.getCronJob('bill-reminders').cronTime.source).toBe('0 8 * * *');
  });
});

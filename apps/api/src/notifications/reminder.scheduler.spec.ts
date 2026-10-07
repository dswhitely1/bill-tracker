import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
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
let logError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  registry = new SchedulerRegistry();
  run = vi.fn<() => Promise<RunResult>>().mockResolvedValue(NOTHING);
  reminders = { run } as unknown as RemindersService;
  // Silenced as well as observed: the deliberate-failure tests below would
  // otherwise print real ERROR lines into an otherwise-green run.
  logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
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
    // The bootstrap run is deliberately not awaited (it must not block the
    // server from accepting traffic), so it has merely been *started* by
    // the time `onApplicationBootstrap()` resolves, not completed.
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
    // The bootstrap run is fire-and-forget, so its rejection is still
    // settling on the microtask queue when `onApplicationBootstrap()`
    // resolves. Let it drain before checking that the failure it carries
    // did not stop cron registration.
    await Promise.resolve();

    // A boot-time hiccup must not leave the process running all day with
    // no reminder job scheduled — a silent failure rather than a loud one.
    expect(registry.getCronJobs().size).toBe(1);
  });

  it('catches and logs a failed bootstrap run instead of letting it escape', async () => {
    const failure = new Error('database is not up yet');
    run.mockRejectedValueOnce(failure);
    const escaped: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      escaped.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      await build({ NODE_ENV: 'development', APP_TIMEZONE: 'UTC' }).onApplicationBootstrap();
      // Two turns: one for the rejected `run()` to settle into `runOnce`'s
      // catch, one for an uncaught rejection to reach the process listener
      // if the catch were ever removed.
      await Promise.resolve();
      await Promise.resolve();

      // Asserting on the log rather than on the hook's promise is the whole
      // point. The bootstrap call is `void`-dispatched, so the hook resolves
      // whether `runOnce` catches, rejects, or does nothing at all — a test
      // on the hook's own settlement cannot fail for this reason. The logged
      // error is the only observable proof the catch actually ran.
      expect(logError).toHaveBeenCalledWith('Bootstrap reminder run failed', failure);
      expect(escaped).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('catches and logs a failed daily run, so a cron callback cannot kill the process', async () => {
    await build({ NODE_ENV: 'development', APP_TIMEZONE: 'UTC' }).onApplicationBootstrap();
    await Promise.resolve();
    logError.mockClear();

    const failure = new Error('smtp is down');
    run.mockRejectedValueOnce(failure);
    const escaped: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      escaped.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      // Fire the registered job's own callback. Nothing else in this suite
      // invokes it, so without this the `Daily` path's error handling rests
      // on it sharing `runOnce` with the bootstrap path rather than on any
      // test. A throw out of a cron callback is an unhandled rejection that
      // can take the process down.
      registry.getCronJob('bill-reminders').fireOnTick();
      await Promise.resolve();
      await Promise.resolve();

      expect(logError).toHaveBeenCalledWith('Daily reminder run failed', failure);
      expect(escaped).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('fires at 08:00, after the horizon roll rather than before it', async () => {
    await build({ NODE_ENV: 'development', APP_TIMEZONE: 'UTC' }).onApplicationBootstrap();

    // Earlier than BillScheduler's 03:00 roll would mean reminders that
    // miss an instance the roll was about to materialize.
    expect(registry.getCronJob('bill-reminders').cronTime.source).toBe('0 8 * * *');
  });
});

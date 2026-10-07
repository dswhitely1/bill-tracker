import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { RemindersService } from './reminders.service';
import type { Env } from '../config/env.schema';

const JOB_NAME = 'bill-reminders';

/**
 * 08:00 in APP_TIMEZONE, after BillScheduler's 03:00 horizon roll, so any
 * instance materialized overnight is visible on the same day. The ordering
 * is defensive rather than load-bearing: BillsService already materializes
 * synchronously when a bill is created.
 *
 * Registered imperatively rather than with `@Cron`, because the decorator's
 * `timeZone` is fixed at class-definition time and this one comes from
 * configuration — the same reason BillScheduler gives.
 *
 * There is also one run at bootstrap, which is safe only because
 * UQ_notifications_instance_kind makes the run idempotent: a server that
 * already ran today and restarts writes nothing and mails nobody, while a
 * server that was down through 08:00 delivers that day's reminders on the
 * way up. That is the only path by which they get sent at all.
 */
@Injectable()
export class ReminderScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReminderScheduler.name);

  constructor(
    private readonly reminders: RemindersService,
    private readonly config: ConfigService<Env, true>,
    private readonly registry: SchedulerRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Under test neither the run nor the cron happens: the run would race
    // each spec's truncate, and a cron firing mid-suite would make every
    // other test intermittent.
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;

    // Before the registration and unable to prevent it. BillScheduler
    // leaves its startup sweep unwrapped, which is defensible there — an
    // unmaterialized horizon means the application is serving wrong data.
    // Here a boot-time hiccup must not leave the process up all day with
    // no reminder job scheduled, which fails silently instead of loudly.
    await this.runOnce('Bootstrap');

    const timeZone = this.config.get('APP_TIMEZONE', { infer: true });
    const job = new CronJob(
      '0 8 * * *',
      () => {
        void this.runOnce('Daily');
      },
      null,
      false,
      timeZone,
    );
    this.registry.addCronJob(JOB_NAME, job);
    job.start();
    this.logger.log(`Daily reminder run scheduled for 08:00 ${timeZone}`);
  }

  private async runOnce(label: string): Promise<void> {
    try {
      const result = await this.reminders.run();
      this.logger.log(
        `${label} reminder run created ${result.created} notification(s), ` +
          `mailed ${result.mailSent} user(s)`,
      );
    } catch (error: unknown) {
      // A throw out of a cron callback is an unhandled rejection that can
      // take the process down; the reminders can wait until tomorrow.
      this.logger.error(`${label} reminder run failed`, error as Error);
    }
  }
}

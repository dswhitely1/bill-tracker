import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { BillGeneratorService } from './bill-generator.service';
import type { Env } from '../config/env.schema';

const JOB_NAME = 'bill-horizon';

/**
 * Rolls the twelve-month horizon forward. There is deliberately no overdue
 * sweep: overdue is derived at read time (spec §2.1), so there is no stored
 * value that can go stale between runs.
 *
 * The job is registered imperatively rather than with `@Cron`, because the
 * decorator's `timeZone` is fixed at class-definition time and this one
 * comes from configuration.
 */
@Injectable()
export class BillScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(BillScheduler.name);

  constructor(
    private readonly generator: BillGeneratorService,
    private readonly config: ConfigService<Env, true>,
    private readonly registry: SchedulerRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Under test, neither the sweep nor the cron runs: the sweep would race
    // each spec's truncate, and a cron firing mid-suite would make every
    // other test intermittent.
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;

    const inserted = await this.generator.materializeAll();
    this.logger.log(`Startup horizon sweep materialized ${inserted} instance(s)`);

    const timeZone = this.config.get('APP_TIMEZONE', { infer: true });
    const job = new CronJob(
      '0 3 * * *',
      () => {
        void this.roll();
      },
      null,
      false,
      timeZone,
    );
    this.registry.addCronJob(JOB_NAME, job);
    job.start();
    this.logger.log(`Nightly horizon roll scheduled for 03:00 ${timeZone}`);
  }

  private async roll(): Promise<void> {
    try {
      const inserted = await this.generator.materializeAll();
      this.logger.log(`Nightly horizon roll materialized ${inserted} instance(s)`);
    } catch (error) {
      // A throw out of a cron callback is an unhandled rejection that can
      // take the process down; the horizon can wait until tomorrow.
      this.logger.error('Nightly horizon roll failed', error as Error);
    }
  }
}

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import type { Env } from '../config/env.schema';

/**
 * The single source of truth for how the Nest application is wired —
 * global prefix, cookie parsing, CORS, validation, and the exception
 * filter. `main.ts` and every e2e spec's `beforeAll` call this instead of
 * each keeping its own hand-rolled copy: four independent copies had
 * already drifted from production (missing `enableCors` and the explicit
 * `forbidNonWhitelisted: false`), which meant the CORS allowlist — the
 * only thing between a hostile origin and a credentialed browser request —
 * lived in a file no test executed.
 */
export function configureApp(app: INestApplication, config: ConfigService<Env, true>): void {
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}

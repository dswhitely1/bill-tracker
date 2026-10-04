import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      // ENV_FILE lets the e2e suite point the whole app at .env.test. Without it
      // every e2e test would boot against the development database.
      envFilePath: [process.env.ENV_FILE ?? '.env'],
    }),
  ],
})
export class ConfigModule {}

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../config/env.schema';
import { User } from '../users/user.entity';
import { RefreshToken } from '../auth/refresh-token.entity';
import { Category } from '../categories/category.entity';
import { Bill } from '../bills/bill.entity';
import { BillInstance } from '../bills/bill-instance.entity';
import { PaymentLog } from '../bills/payment-log.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        type: 'postgres' as const,
        url: config.get('DATABASE_URL', { infer: true }),
        ssl: config.get('DB_SSL', { infer: true }) ? { rejectUnauthorized: true } : false,
        entities: [User, RefreshToken, Category, Bill, BillInstance, PaymentLog],
        synchronize: false,
        migrationsRun: false,
        // Without this, a connection checkout the pool can't satisfy hangs
        // forever with no log and no error — the worst failure mode a
        // server has. Pool sizing (`max`) is left at its default.
        extra: { connectionTimeoutMillis: 5000 },
      }),
    }),
  ],
})
export class DatabaseModule {}

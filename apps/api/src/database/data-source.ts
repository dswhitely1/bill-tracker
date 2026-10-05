import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config as loadEnv } from 'dotenv';
import { User } from '../users/user.entity';
import { RefreshToken } from '../auth/refresh-token.entity';
import { Category } from '../categories/category.entity';
import { Bill } from '../bills/bill.entity';
import { BillInstance } from '../bills/bill-instance.entity';
import { PaymentLog } from '../bills/payment-log.entity';
import { InitialSchema1759536000000 } from './migrations/1759536000000-InitialSchema';
import { AddBillTables1759622400000 } from './migrations/1759622400000-AddBillTables';

loadEnv({ path: process.env.ENV_FILE ?? '.env', quiet: true });

// Entities and migrations are listed explicitly rather than glob-matched.
// TypeORM's glob loader (ImportUtils.importOrRequireFile) falls back to a
// raw Node `require()` of each matched .ts file when it finds no
// "type": "module" in the nearest package.json. ts-node (used by the
// `typeorm` CLI scripts below) patches that `require()` to transpile TS,
// but Vitest's runner does not, so a glob here parses fine from the CLI
// and throws "SyntaxError: Invalid or unexpected token" (decorators/type
// annotations) the moment the e2e harness calls AppDataSource.initialize().
// Explicit class references sidestep the loader entirely: whichever
// module system is executing this file (ts-node, vite-node, or a bundled
// build) has already loaded these classes through its own, TS-aware
// import machinery by the time this object literal is evaluated.
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  synchronize: false,
  logging: false,
  entities: [User, RefreshToken, Category, Bill, BillInstance, PaymentLog],
  migrations: [InitialSchema1759536000000, AddBillTables1759622400000],
  // Without this, a connection checkout the pool can't satisfy hangs
  // forever with no log and no error. Pool sizing (`max`) is left at its
  // default.
  extra: { connectionTimeoutMillis: 5000 },
});

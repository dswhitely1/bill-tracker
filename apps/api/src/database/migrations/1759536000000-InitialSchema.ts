import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1759536000000 implements MigrationInterface {
  name = 'InitialSchema1759536000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar(255) NOT NULL,
        "password_hash" varchar(60) NOT NULL,
        "name" varchar(100) NOT NULL,
        "notify_email" boolean NOT NULL DEFAULT true,
        "notify_in_app" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      )`);

    await q.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "token_hash" varchar(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz,
        "replaced_by" uuid REFERENCES "refresh_tokens"("id") ON DELETE SET NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_refresh_tokens_token_hash" UNIQUE ("token_hash")
      )`);
    await q.query(`CREATE INDEX "IDX_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")`);

    await q.query(`
      CREATE TABLE "categories" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "name" varchar(50) NOT NULL,
        "color" char(7),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX "IDX_categories_user_id" ON "categories" ("user_id")`);
    await q.query(`
      CREATE UNIQUE INDEX "UQ_categories_user_lower_name"
      ON "categories" ("user_id", lower("name"))`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "categories"`);
    await q.query(`DROP TABLE "refresh_tokens"`);
    await q.query(`DROP TABLE "users"`);
  }
}

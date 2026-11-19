import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";
import { resolveDbConfig } from "./connection-config.ts";

/**
 * drizzle-kit is for LOCAL DEVELOPMENT ONLY (`npm run db:push` against a disposable database).
 * Staging and production schemas are created and changed only by `npm run db:migrate`
 * (scripts/db-migrate.ts), which applies src/db/migrations/*.sql in order and records checksums.
 * db:push does not install the account write guard and can propose destructive changes.
 */

dotenv.config();

if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
  throw new Error("drizzle-kit is for local development. Use `npm run db:migrate` for real databases.");
}

const cfg = resolveDbConfig(process.env, "migration");
if (cfg.source === "none") {
  throw new Error("Set DATABASE_MIGRATION_URL / DATABASE_URL, or SQL_HOST, SQL_DB_NAME, SQL_ADMIN_USER and SQL_ADMIN_PASSWORD.");
}

const p = cfg.pool;
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: p.connectionString
    ? { url: p.connectionString, ssl: p.ssl as never }
    : { host: String(p.host), user: p.user, password: p.password as string | undefined, database: String(p.database), ssl: false },
  verbose: true,
});

import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

// DDL 走直连（不过 pgbouncer），使用 unpooled 连接串
if (!process.env.DATABASE_URL_UNPOOLED) {
  throw new Error("DATABASE_URL_UNPOOLED environment variable is not set");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED,
  },
});

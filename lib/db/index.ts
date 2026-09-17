import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

/** Neon serverless SQL 客户端（池化连接，走 DATABASE_URL） */
export const sql = neon(process.env.DATABASE_URL);

/** Drizzle ORM 实例，带 schema，用于类型化查询 */
export const db = drizzle(sql, { schema });

export * from "./schema";

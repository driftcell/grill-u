import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { users } from "../lib/db/schema";
import { DEMO_USER_EMAIL, DEMO_USER_ID } from "../lib/demo";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const db = drizzle(neon(process.env.DATABASE_URL));

  await db
    .insert(users)
    .values({ id: DEMO_USER_ID, email: DEMO_USER_EMAIL })
    .onConflictDoNothing({ target: users.id });

  console.log(`Demo user ready: ${DEMO_USER_ID} (${DEMO_USER_EMAIL})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

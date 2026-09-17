import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { skillEdges, skillNodes } from "../lib/db/schema";

interface SkillDagJson {
  rustEdition: string;
  nodes: {
    id: string;
    title: { zh: string; en: string };
    summary: string;
    prerequisites: string[];
    misconceptions: string[];
    status: "draft" | "compiler_verified" | "human_reviewed" | "calibrated";
  }[];
}

function loadAndValidate(path: string): SkillDagJson {
  const dag = JSON.parse(readFileSync(path, "utf8")) as SkillDagJson;
  const ids = new Set<string>();
  const errors: string[] = [];

  for (const n of dag.nodes) {
    if (ids.has(n.id)) errors.push(`duplicate id: ${n.id}`);
    ids.add(n.id);
    if (!/^[a-z]+(\.[a-z0-9_]+){1,2}$/.test(n.id)) errors.push(`bad id format: ${n.id}`);
  }
  for (const n of dag.nodes) {
    for (const p of n.prerequisites) {
      if (!ids.has(p)) errors.push(`missing prereq: ${n.id} -> ${p}`);
      if (p === n.id) errors.push(`self-loop: ${n.id}`);
    }
  }

  // 拓扑排序（Kahn）验证无环
  const indeg = new Map([...ids].map((id) => [id, 0]));
  const adj = new Map([...ids].map((id) => [id, [] as string[]]));
  for (const n of dag.nodes) {
    for (const p of n.prerequisites) {
      if (!ids.has(p)) continue;
      adj.get(p)!.push(n.id);
      indeg.set(n.id, indeg.get(n.id)! + 1);
    }
  }
  const queue = [...ids].filter((id) => indeg.get(id) === 0);
  let visited = 0;
  while (queue.length) {
    const cur = queue.shift()!;
    visited++;
    for (const next of adj.get(cur)!) {
      indeg.set(next, indeg.get(next)! - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  if (visited !== ids.size) errors.push("cycle detected in prerequisites");

  if (errors.length) {
    console.error("Invalid skill DAG, aborting seed:");
    for (const e of errors) console.error(" -", e);
    process.exit(1);
  }
  return dag;
}

async function main() {
  const dag = loadAndValidate("seeds/skill-dag.json");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const db = drizzle(neon(process.env.DATABASE_URL));

  // 1. upsert 节点（JSON 为唯一事实来源，内容变化会覆盖）
  const nodeRows = dag.nodes.map((n) => ({
    id: n.id,
    domain: n.id.split(".")[0],
    titleZh: n.title.zh,
    titleEn: n.title.en,
    summary: n.summary,
    misconceptions: n.misconceptions,
    status: n.status,
    rustEdition: dag.rustEdition,
    updatedAt: new Date(),
  }));

  await db
    .insert(skillNodes)
    .values(nodeRows)
    .onConflictDoUpdate({
      target: skillNodes.id,
      set: {
        domain: skillNodes.domain,
        titleZh: skillNodes.titleZh,
        titleEn: skillNodes.titleEn,
        summary: skillNodes.summary,
        misconceptions: skillNodes.misconceptions,
        status: skillNodes.status,
        rustEdition: skillNodes.rustEdition,
        updatedAt: new Date(),
      },
    });

  // 2. 边全量重建（完全由 JSON 派生，删除后重插保持幂等）
  const edgeRows = dag.nodes.flatMap((n) =>
    n.prerequisites.map((p) => ({ skillId: n.id, prerequisiteId: p })),
  );
  await db.delete(skillEdges);
  await db.insert(skillEdges).values(edgeRows);

  console.log(`Seeded ${nodeRows.length} skill nodes, ${edgeRows.length} skill edges.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

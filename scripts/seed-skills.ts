import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { notInArray, sql } from "drizzle-orm";
import { misconceptions, skillEdges, skillNodes } from "../lib/db/schema";

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
        domain: sql`excluded.domain`,
        titleZh: sql`excluded.title_zh`,
        titleEn: sql`excluded.title_en`,
        summary: sql`excluded.summary`,
        status: sql`excluded.status`,
        rustEdition: sql`excluded.rust_edition`,
        updatedAt: new Date(),
      },
    });

  // 2. 边全量重建（完全由 JSON 派生，删除后重插保持幂等）
  const edgeRows = dag.nodes.flatMap((n) =>
    n.prerequisites.map((p) => ({ skillId: n.id, prerequisiteId: p })),
  );
  await db.delete(skillEdges);
  await db.insert(skillEdges).values(edgeRows);

  // 3. 误区按稳定 ID upsert，并删除已不在 JSON 中的旧行
  //    （skill_evidence 会引用误区，不能整表清空；新增误区请追加到 JSON 数组末尾，避免已有证据错位）
  const mcRows = dag.nodes.flatMap((n) =>
    n.misconceptions.map((description, i) => ({
      id: `${n.id}.m${i + 1}`,
      skillId: n.id,
      description,
      updatedAt: new Date(),
    })),
  );
  await db
    .insert(misconceptions)
    .values(mcRows)
    .onConflictDoUpdate({
      target: misconceptions.id,
      set: {
        skillId: sql`excluded.skill_id`,
        description: sql`excluded.description`,
        updatedAt: new Date(),
      },
    });
  if (mcRows.length > 0) {
    await db.delete(misconceptions).where(notInArray(misconceptions.id, mcRows.map((r) => r.id)));
  } else {
    await db.delete(misconceptions);
  }

  console.log(
    `Seeded ${nodeRows.length} skill nodes, ${edgeRows.length} skill edges, ${mcRows.length} misconceptions.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

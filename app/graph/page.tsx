import Link from "next/link";
import { db } from "@/lib/db";
import { DEMO_USER_ID } from "@/lib/demo";
import { misconceptions, skillNodes } from "@/lib/db/schema";
import { projectUserGraph, type NodeState } from "@/lib/skills/projection";
import { selectTarget } from "@/lib/skills/select-target";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

const STATE_STYLE: Record<NodeState, { label: string; className: string }> = {
  unknown: { label: "未知", className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" },
  misconception_active: {
    label: "误区活跃",
    className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  },
  fragile: {
    label: "脆弱",
    className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  },
  stable: { label: "稳定", className: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" },
  transferred: {
    label: "已迁移",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  },
};

export default async function GraphPage() {
  const [projection, nodes, allMisconceptions, next] = await Promise.all([
    projectUserGraph(DEMO_USER_ID),
    db.select().from(skillNodes).orderBy(asc(skillNodes.id)),
    db.select().from(misconceptions),
    selectTarget(DEMO_USER_ID),
  ]);

  const mcById = new Map(allMisconceptions.map((m) => [m.id, m.description]));
  const domains = [...new Set(nodes.map((n) => n.domain))].sort();
  const explored = nodes.filter((n) => projection.has(n.id)).length;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">能力图谱</h1>
        <p className="text-sm text-zinc-500">
          已探索 {explored} / {nodes.length} 个微技能 · 状态由证据实时投影，无分数
        </p>
        <p className="text-sm">
          下一题推荐：<code className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{next.skillId}</code>
          （{next.type}）— {next.reason}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {(Object.entries(STATE_STYLE) as [NodeState, (typeof STATE_STYLE)[NodeState]][]).map(([key, s]) => (
          <span key={key} className={`rounded-full px-2.5 py-0.5 ${s.className}`}>
            {s.label}
          </span>
        ))}
      </div>

      {domains.map((domain) => (
        <section key={domain} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">{domain}</h2>
          <ul className="flex flex-col gap-1.5">
            {nodes
              .filter((n) => n.domain === domain)
              .map((n) => {
                const p = projection.get(n.id);
                const state: NodeState = p?.state ?? "unknown";
                const style = STATE_STYLE[state];
                const isNext = n.id === next.skillId;
                return (
                  <li
                    key={n.id}
                    className={`flex flex-col gap-1 rounded-xl border px-4 py-3 text-sm ${
                      isNext
                        ? "border-blue-400 dark:border-blue-700"
                        : "border-zinc-200 dark:border-zinc-800"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${style.className}`}>
                        {style.label}
                      </span>
                      <span className="font-medium">{n.titleZh}</span>
                      <code className="text-xs text-zinc-400">{n.id}</code>
                      {isNext && (
                        <span className="text-xs font-medium text-blue-600 dark:text-blue-400">← 下一题</span>
                      )}
                      {p && (
                        <span className="ml-auto text-xs text-zinc-400">
                          ✓{p.counts.demonstrated} ✗{p.counts.violated} ⚠{p.counts.misconceptionDetected} ·{" "}
                          {p.distinctQuestions} 题
                        </span>
                      )}
                    </div>
                    {p && p.activeMisconceptions.length > 0 && (
                      <ul className="list-inside list-disc text-xs text-red-600 dark:text-red-400">
                        {p.activeMisconceptions.map((id) => (
                          <li key={id}>{mcById.get(id) ?? id}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}

      <Link href="/practice" className="text-sm font-medium text-blue-600 hover:underline">
        去练习 →
      </Link>
    </div>
  );
}

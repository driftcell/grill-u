import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { attempts, skillEvidence } from "@/lib/db/schema";

/** 图上节点的五种状态（读时投影，不落库） */
export type NodeState = "unknown" | "misconception_active" | "fragile" | "stable" | "transferred";

export interface NodeProjection {
  state: NodeState;
  /** 仍处于活跃状态的误区 id 列表 */
  activeMisconceptions: string[];
  counts: { demonstrated: number; violated: number; misconceptionDetected: number };
  /** 最近一次证据时间（ISO 字符串，unknown 时为 null） */
  lastEvidenceAt: string | null;
  /** 证据覆盖的不同题目数（场景迁移的代理指标） */
  distinctQuestions: number;
}

export interface EvidenceEvent {
  outcome: "demonstrated" | "violated" | "misconception_detected";
  misconceptionId: string | null;
  questionId: string;
  createdAt: Date;
}

/** 稳定判定所需的末尾连续 demonstrated 次数 */
const STABLE_TRAILING = 2;

/**
 * 确定性折叠：把一个节点上的全部证据折叠成图状态。纯函数，可测试。
 * - unknown：无证据（未知 ≠ 未掌握）
 * - misconception_active：存在"最新事件是检测到误区、且之后没有 demonstrated"的误区
 * - stable：末尾连续 demonstrated ≥ STABLE_TRAILING（更早的 violated/误区视为已纠正）
 * - transferred：stable 且证据覆盖 ≥2 道不同题目
 * - fragile：其余有证据的情况
 */
export function foldNodeEvidence(events: EvidenceEvent[]): NodeProjection {
  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const counts = { demonstrated: 0, violated: 0, misconceptionDetected: 0 };
  const distinctQuestions = new Set<string>();
  /** 每个误区的最新状态：active = 检测到后未被 demonstrated 覆盖 */
  const misconceptionActive = new Map<string, boolean>();

  for (const e of sorted) {
    distinctQuestions.add(e.questionId);
    if (e.outcome === "demonstrated") {
      counts.demonstrated++;
      // 一次 demonstrated 视为对该节点上所有活跃误区的纠正
      for (const id of misconceptionActive.keys()) misconceptionActive.set(id, false);
    } else if (e.outcome === "violated") {
      counts.violated++;
    } else {
      counts.misconceptionDetected++;
      if (e.misconceptionId) misconceptionActive.set(e.misconceptionId, true);
    }
  }

  const activeMisconceptions = [...misconceptionActive.entries()]
    .filter(([, active]) => active)
    .map(([id]) => id);

  let trailingDemonstrated = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].outcome === "demonstrated") trailingDemonstrated++;
    else break;
  }

  let state: NodeState;
  if (sorted.length === 0) {
    state = "unknown";
  } else if (activeMisconceptions.length > 0) {
    state = "misconception_active";
  } else if (trailingDemonstrated >= STABLE_TRAILING) {
    state = distinctQuestions.size >= 2 ? "transferred" : "stable";
  } else {
    state = "fragile";
  }

  return {
    state,
    activeMisconceptions,
    counts,
    lastEvidenceAt: sorted.length > 0 ? sorted[sorted.length - 1].createdAt.toISOString() : null,
    distinctQuestions: distinctQuestions.size,
  };
}

/** 投影用户在整个图谱上的状态：skillNodeId → NodeProjection */
export async function projectUserGraph(userId: string): Promise<Map<string, NodeProjection>> {
  const rows = await db
    .select({
      skillNodeId: skillEvidence.skillNodeId,
      outcome: skillEvidence.outcome,
      misconceptionId: skillEvidence.misconceptionId,
      questionId: attempts.questionId,
      createdAt: skillEvidence.createdAt,
    })
    .from(skillEvidence)
    .innerJoin(attempts, eq(skillEvidence.attemptId, attempts.id))
    .where(eq(skillEvidence.userId, userId))
    .orderBy(asc(skillEvidence.createdAt));

  const byNode = new Map<string, EvidenceEvent[]>();
  for (const r of rows) {
    const list = byNode.get(r.skillNodeId) ?? [];
    list.push({
      outcome: r.outcome,
      misconceptionId: r.misconceptionId,
      questionId: r.questionId,
      createdAt: r.createdAt,
    });
    byNode.set(r.skillNodeId, list);
  }

  const result = new Map<string, NodeProjection>();
  for (const [nodeId, events] of byNode) {
    result.set(nodeId, foldNodeEvidence(events));
  }
  return result;
}

/** 投影单个节点（作答后返回最新状态用） */
export async function projectNode(userId: string, skillNodeId: string): Promise<NodeProjection> {
  const rows = await db
    .select({
      outcome: skillEvidence.outcome,
      misconceptionId: skillEvidence.misconceptionId,
      questionId: attempts.questionId,
      createdAt: skillEvidence.createdAt,
    })
    .from(skillEvidence)
    .innerJoin(attempts, eq(skillEvidence.attemptId, attempts.id))
    .where(and(eq(skillEvidence.userId, userId), eq(skillEvidence.skillNodeId, skillNodeId)))
    .orderBy(asc(skillEvidence.createdAt));

  return foldNodeEvidence(
    rows.map((r) => ({
      outcome: r.outcome,
      misconceptionId: r.misconceptionId,
      questionId: r.questionId,
      createdAt: r.createdAt,
    })),
  );
}

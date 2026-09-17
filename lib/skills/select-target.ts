import { db } from "@/lib/db";
import { skillEdges, skillNodes } from "@/lib/db/schema";
import { projectUserGraph, type NodeProjection } from "@/lib/skills/projection";
import { questionTypes, type QuestionType } from "@/lib/ai/generate-question";

/** 与 seeds/skill-dag.json 的 goldenPathDomains 对齐：金标准分支优先 */
const GOLDEN_DOMAINS = ["ownership", "borrow"];

export interface TargetSelection {
  skillId: string;
  type: QuestionType;
  /** 选题理由（展示给用户，体现可解释性） */
  reason: string;
}

/** 维度 → 最能考察该维度的题型 */
const DIMENSION_TYPE: Record<string, QuestionType> = {
  judgment: "compile_outcome",
  location: "error_location",
  fix: "minimal_fix",
  explanation: "concept_reasoning",
};

const DIMENSIONS = ["judgment", "location", "fix", "explanation"] as const;

function isValidType(t: string): t is QuestionType {
  return (questionTypes as readonly string[]).includes(t);
}

/** 按节点状态选题型的简化策略：无证据默认 judgment，误区/脆弱复查判断，稳定节点轮换维度促迁移 */
function pickType(projection: NodeProjection | undefined): QuestionType {
  if (!projection) return "compile_outcome";
  if (projection.state === "misconception_active" || projection.state === "fragile") {
    return "compile_outcome";
  }
  // 稳定节点换维度考察，促进迁移
  const rotated = DIMENSIONS[projection.distinctQuestions % DIMENSIONS.length];
  return DIMENSION_TYPE[rotated];
}

/**
 * 自适应选题：读用户图谱投影，按优先级选下一个练习目标。
 * 优先级：活跃误区 > 脆弱 > 前置已稳定的未知节点（金标准分支优先） > 稳定节点复习
 */
export async function selectTarget(userId: string): Promise<TargetSelection> {
  const [projection, nodes, edges] = await Promise.all([
    projectUserGraph(userId),
    db.select().from(skillNodes),
    db.select().from(skillEdges),
  ]);

  const prereqsOf = new Map<string, string[]>();
  for (const e of edges) {
    const list = prereqsOf.get(e.skillId) ?? [];
    list.push(e.prerequisiteId);
    prereqsOf.set(e.skillId, list);
  }

  const stateOf = (id: string): NodeProjection | undefined => projection.get(id);
  const prereqsMet = (id: string): boolean =>
    (prereqsOf.get(id) ?? []).every((p) => {
      const s = stateOf(p)?.state;
      return s === "stable" || s === "transferred";
    });

  const goldenRank = (id: string) => (GOLDEN_DOMAINS.includes(id.split(".")[0]) ? 0 : 1);
  const byGoldenThenId = (a: string, b: string) =>
    goldenRank(a) - goldenRank(b) || a.localeCompare(b);

  const withEvidence = nodes.filter((n) => stateOf(n.id) !== undefined);
  const activeMc = withEvidence
    .filter((n) => stateOf(n.id)!.state === "misconception_active")
    .map((n) => n.id)
    .sort(byGoldenThenId);
  if (activeMc.length > 0) {
    const skillId = activeMc[0];
    return { skillId, type: pickType(stateOf(skillId)), reason: "该节点存在活跃误区，优先复查" };
  }

  const fragile = withEvidence
    .filter((n) => stateOf(n.id)!.state === "fragile")
    .map((n) => n.id)
    .sort(byGoldenThenId);
  if (fragile.length > 0) {
    const skillId = fragile[0];
    return { skillId, type: pickType(stateOf(skillId)), reason: "该节点表现尚不稳定，继续巩固" };
  }

  const fresh = nodes
    .filter((n) => stateOf(n.id) === undefined && prereqsMet(n.id))
    .map((n) => n.id)
    .sort(byGoldenThenId);
  if (fresh.length > 0) {
    const skillId = fresh[0];
    return { skillId, type: pickType(undefined), reason: "前置技能已稳定，探索新技能" };
  }

  const review = nodes
    .filter((n) => {
      const s = stateOf(n.id)?.state;
      return s === "stable" || s === "transferred";
    })
    .map((n) => n.id)
    .sort(byGoldenThenId);
  if (review.length > 0) {
    const skillId = review[0];
    return { skillId, type: pickType(stateOf(skillId)), reason: "换维度/换场景复习已稳定技能" };
  }

  // 冷启动：没有任何证据时，从金标准分支的源头开始
  const roots = nodes
    .filter((n) => (prereqsOf.get(n.id) ?? []).length === 0)
    .map((n) => n.id)
    .sort(byGoldenThenId);
  const skillId = roots[0] ?? nodes[0].id;
  return { skillId, type: "compile_outcome", reason: "从基础技能开始建立能力档案" };
}

/** 手动指定模式（/practice?skill=xxx&type=yyy），type 非法时回退 compile_outcome */
export function manualTarget(skillId: string, type: string | undefined): TargetSelection {
  return {
    skillId,
    type: type && isValidType(type) ? type : "compile_outcome",
    reason: "手动指定技能与题型",
  };
}

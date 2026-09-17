import type { QuestionType } from "@/lib/ai/generate-question";
import type { AiEvaluation } from "@/lib/ai/evaluate-reasoning";
import type { questions, skillEvidence } from "@/lib/db/schema";

type EvidenceInsert = typeof skillEvidence.$inferInsert;
type Dimension = EvidenceInsert["dimension"];

/** 题型的主考察维度（客观判定落在这个维度上） */
const TYPE_DIMENSION: Record<QuestionType, Dimension> = {
  compile_outcome: "judgment",
  exact_output: "judgment",
  error_type: "judgment",
  panic_prediction: "judgment",
  error_location: "location",
  minimal_fix: "fix",
  concept_reasoning: "explanation",
};

/**
 * 确定性证据派生（AI 不直接决定证据，只提供素材）：
 * 1. 编译器客观判定 → 题型主维度的 demonstrated/violated（source=compiler）
 * 2. AI 维度评价 → 仅收录未被客观判定覆盖的维度（如 explanation），AI 不得推翻编译器结论
 * 3. AI 命中的误区 → misconception_detected（id 必须在技能的已知误区列表内，否则丢弃）
 */
export function buildEvidenceRows(input: {
  attemptId: string;
  userId: string;
  question: typeof questions.$inferSelect;
  objectiveCorrect: boolean | null;
  aiEvaluation: AiEvaluation;
  reasoning: string | null;
  knownMisconceptionIds: Set<string>;
}): EvidenceInsert[] {
  const { question, objectiveCorrect, aiEvaluation, reasoning } = input;
  const base = {
    attemptId: input.attemptId,
    userId: input.userId,
    skillNodeId: question.skillId,
  };
  const rows: EvidenceInsert[] = [];
  const mainDimension = TYPE_DIMENSION[question.type];

  // 1. 编译器客观证据
  if (objectiveCorrect !== null) {
    rows.push({
      ...base,
      dimension: mainDimension,
      outcome: objectiveCorrect ? "demonstrated" : "violated",
      source: "compiler",
      note: objectiveCorrect ? "客观作答正确（编译器判定）" : "客观作答错误（编译器判定）",
    });
  }

  // 2. AI 维度评价（不与客观证据重复；无推理文本时不评 explanation）
  for (const d of aiEvaluation.dimensions) {
    if (objectiveCorrect !== null && d.dimension === mainDimension) continue;
    if (d.dimension === "explanation" && !reasoning?.trim()) continue;
    rows.push({
      ...base,
      dimension: d.dimension,
      outcome: d.outcome,
      source: "ai",
      note: d.note,
    });
  }

  // 3. AI 命中的已知误区
  for (const m of aiEvaluation.misconceptions) {
    if (!input.knownMisconceptionIds.has(m.id)) continue;
    rows.push({
      ...base,
      dimension: mainDimension,
      outcome: "misconception_detected",
      misconceptionId: m.id,
      source: "ai",
      note: m.note,
    });
  }

  return rows;
}

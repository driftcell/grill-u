import { eq } from "drizzle-orm";
import {
  buildAttemptTurn,
  buildEvaluationTurn,
  evaluateReasoning,
  type AiEvaluation,
} from "@/lib/ai/evaluate-reasoning";
import { appendMessage, composeContext, compressIfNeeded, getOrCreateThread } from "@/lib/ai/thread";
import { buildEvidenceRows } from "@/lib/attempts/evidence";
import { gradeAttempt } from "@/lib/attempts/grade";
import { db } from "@/lib/db";
import { attempts, misconceptions, questions, skillEvidence, skillNodes } from "@/lib/db/schema";
import { projectNode, type NodeProjection } from "@/lib/skills/projection";
import type { Answer } from "@/lib/questions/answer";

export interface SubmitResult {
  attemptId: string;
  objectiveCorrect: boolean | null;
  gradeDetail: string | null;
  aiEvaluation: AiEvaluation;
  /** 标准答案与解析（提交后才返回给前端） */
  expectedAnswer: Answer;
  explanation: string | null;
  evidence: {
    dimension: string;
    outcome: string;
    misconceptionId: string | null;
    source: string;
    note: string | null;
  }[];
  /** 本次作答后该技能节点的最新图状态 */
  nodeState: NodeProjection;
}

/**
 * 作答闭环编排：
 * 编译器判客观结果 → AI 评推理 → 写 attempts → 确定性派生并写入 skill_evidence → 返回节点最新投影
 */
export async function submitAttempt(input: {
  userId: string;
  questionId: string;
  userAnswer: Answer;
  reasoning?: string;
}): Promise<SubmitResult> {
  const reasoning = input.reasoning?.trim() ? input.reasoning.trim() : null;

  const [question] = await db.select().from(questions).where(eq(questions.id, input.questionId)).limit(1);
  if (!question) throw new Error(`Question not found: ${input.questionId}`);

  const [skill] = await db.select().from(skillNodes).where(eq(skillNodes.id, question.skillId)).limit(1);
  if (!skill) throw new Error(`Skill not found: ${question.skillId}`);

  const knownMisconceptions = await db
    .select()
    .from(misconceptions)
    .where(eq(misconceptions.skillId, question.skillId));

  // 1. 编译器客观判定
  const grade = await gradeAttempt(question, input.userAnswer);

  // 2. AI 评价推理（带导师线程的持久上下文；超阈值先压缩再调用）
  const threadRow = await getOrCreateThread(input.userId);
  const thread = await compressIfNeeded(threadRow.id);
  const history = await composeContext(thread);

  const turnInput = {
    question,
    userAnswer: input.userAnswer,
    objectiveCorrect: grade.correct,
    reasoning,
    skill,
    misconceptions: knownMisconceptions,
  };
  const aiEvaluation = await evaluateReasoning({ ...turnInput, history });

  // 3. 写 attempts
  const [attempt] = await db
    .insert(attempts)
    .values({
      userId: input.userId,
      questionId: question.id,
      userAnswer: input.userAnswer,
      reasoning,
      objectiveCorrect: grade.correct,
      aiEvaluation,
    })
    .returning({ id: attempts.id });

  // 4. 对话 turn 入线程（作答事件 + 导师评价，保持教学连续性）
  await appendMessage(thread.id, {
    role: "user",
    kind: "attempt",
    content: buildAttemptTurn(turnInput),
    refAttemptId: attempt.id,
  });
  await appendMessage(thread.id, {
    role: "assistant",
    kind: "evaluation",
    content: buildEvaluationTurn(aiEvaluation),
    refAttemptId: attempt.id,
  });

  // 5. 确定性派生证据并写入
  const evidenceRows = buildEvidenceRows({
    attemptId: attempt.id,
    userId: input.userId,
    question,
    objectiveCorrect: grade.correct,
    aiEvaluation,
    reasoning,
    knownMisconceptionIds: new Set(knownMisconceptions.map((m) => m.id)),
  });
  if (evidenceRows.length > 0) {
    await db.insert(skillEvidence).values(evidenceRows);
  }

  // 6. 节点最新投影
  const nodeState = await projectNode(input.userId, question.skillId);

  return {
    attemptId: attempt.id,
    objectiveCorrect: grade.correct,
    gradeDetail: grade.detail ?? null,
    aiEvaluation,
    expectedAnswer: question.answer as Answer,
    explanation: question.explanation,
    evidence: evidenceRows.map((r) => ({
      dimension: r.dimension,
      outcome: r.outcome,
      misconceptionId: r.misconceptionId ?? null,
      source: r.source,
      note: r.note ?? null,
    })),
    nodeState,
  };
}

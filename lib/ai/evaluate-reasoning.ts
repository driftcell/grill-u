import { z } from "zod";
import { type QuestionType } from "@/lib/ai/generate-question";
import { generateJson } from "@/lib/ai/structured";
import type { ContextMessage } from "@/lib/ai/thread";
import type { misconceptions, questions, skillNodes } from "@/lib/db/schema";
import type { Answer } from "@/lib/questions/answer";

/** AI 推理评价的结构化输出（写入 attempts.ai_evaluation） */
export const aiEvaluationSchema = z.object({
  dimensions: z
    .array(
      z.object({
        dimension: z.enum(["judgment", "location", "explanation", "fix", "transfer"]),
        outcome: z.enum(["demonstrated", "violated"]),
        note: z.string().describe("中文，一句话说明依据"),
      }),
    )
    .describe("对用户推理过程的分维度评价；只评价与本次作答真正相关的维度"),
  misconceptions: z
    .array(
      z.object({
        id: z.string().describe("命中的误区 id，必须来自给定的误区列表"),
        note: z.string().describe("中文，指出用户推理中体现该误区的具体说法"),
      }),
    )
    .describe("用户作答中暴露出的已知误区；没有则为空数组"),
  summary: z.string().describe("中文，2-4 句讲解：用户哪里对、哪里错、背后的规则是什么"),
});

export type AiEvaluation = z.infer<typeof aiEvaluationSchema>;

const TYPE_DIMENSION_GUIDE: Record<QuestionType, string> = {
  compile_outcome: "judgment（结论判断）已由编译器判定，你只需评价 explanation（推理质量）",
  exact_output: "judgment（结论判断）已由编译器判定，你只需评价 explanation（推理质量）",
  error_type: "judgment（结论判断）已由编译器判定，你只需评价 explanation（推理质量）",
  panic_prediction: "judgment（结论判断）已由编译器判定，你只需评价 explanation（推理质量）",
  error_location: "location（错误定位）已由编译器判定，你只需评价 explanation（推理质量）",
  minimal_fix: "fix（最小修复）已由编译器判定，你只需评价 explanation（推理质量）",
  concept_reasoning: "本题没有客观判定，explanation（概念解释）是主要评价维度，请重点评价",
};

/** 系统提示保持字节稳定（DeepSeek 前缀缓存），与题型相关的内容放用户 turn。
 *  按 DeepSeek JSON Output 官方要求：含 "json" 字样 + 输出样例，缓解空 content 问题 */
const SYSTEM = `你是 Rust 教学平台的导师，正在与一名学习者进行【持续性】的教学对话。你会看到这名学习者历史上的作答事件和你以往的评价。

客观结果已经由 Rust 编译器判定，你的任务不是重复判定对错，而是：
1. 评价学习者的【推理过程】是否体现了对底层规则的真实理解（猜对不等于理解）
2. 从当次事件给定的已知误区列表中识别学习者暴露了哪些误区（只能引用列表中的 id，没有命中就返回空数组）
3. 给出简短讲解；若学习者反复暴露同一误区，换解释角度并明确指出这是反复出现的问题

评价标准：
- 推理正确且触及底层规则 → explanation: demonstrated
- 结论对但推理缺失/含错误规则直觉 → explanation: violated
- 只输出与当次作答真正相关的维度，不要凑数

【输出要求】只输出一个 JSON 对象，不要输出任何其他文字、解释或 markdown 围栏。JSON 格式样例：
{"dimensions":[{"dimension":"explanation","outcome":"violated","note":"学习者用浅拷贝直觉判断赋值"}],"misconceptions":[{"id":"ownership.move.on_assignment.m1","note":"认为赋值后原绑定仍可用"}],"summary":"结论正确，但推理……"}`;

export interface AttemptTurnInput {
  question: typeof questions.$inferSelect;
  userAnswer: Answer;
  objectiveCorrect: boolean | null;
  reasoning: string | null;
  skill: typeof skillNodes.$inferSelect;
  misconceptions: (typeof misconceptions.$inferSelect)[];
}

/** 作答事件的用户 turn 文本（同一份内容既发给模型也存入线程） */
export function buildAttemptTurn(input: AttemptTurnInput): string {
  const { question, userAnswer, objectiveCorrect, reasoning, skill } = input;

  const objectiveText =
    objectiveCorrect === null
      ? "本题无客观判定（概念解释题）"
      : `学习者客观作答${objectiveCorrect ? "【正确】" : "【错误】"}（编译器判定，不可推翻）`;

  const misconceptionList =
    input.misconceptions.length > 0
      ? input.misconceptions.map((m) => `- ${m.id}：${m.description}`).join("\n")
      : "（该技能暂无已知误区）";

  const reasoningText = reasoning?.trim()
    ? reasoning
    : "（学习者未填写推理，explanation 维度请注明无法评价）";

  return `【作答事件】技能 ${skill.id}（${skill.titleZh}）· 题型 ${question.type}

题目：
${question.prompt}

\`\`\`rust
${question.code}
\`\`\`

标准答案：${JSON.stringify(question.answer)}
参考解析：${question.explanation ?? "（无）"}

${objectiveText}
学习者的客观作答：${JSON.stringify(userAnswer)}
学习者的推理：
${reasoningText}

本次可引用的已知误区列表：
${misconceptionList}

维度指引：${TYPE_DIMENSION_GUIDE[question.type]}`;
}

/** 评价结果的 assistant turn 可读文本（存入线程，供后续对话保持连续性） */
export function buildEvaluationTurn(ev: AiEvaluation): string {
  const parts = [ev.summary];
  if (ev.dimensions.length > 0) {
    parts.push(
      ev.dimensions.map((d) => `- ${d.dimension}: ${d.outcome}（${d.note}）`).join("\n"),
    );
  }
  if (ev.misconceptions.length > 0) {
    parts.push(
      "暴露误区：\n" + ev.misconceptions.map((m) => `- ${m.id}：${m.note}`).join("\n"),
    );
  }
  return parts.join("\n");
}

/**
 * AI 的职责边界：只评价推理过程、识别误区，输出结构化证据素材。
 * 客观结论永远以编译器判定为准，后端用确定性规则把本输出折叠成 skill_evidence。
 *
 * 不用 generateObject：DeepSeek 的 JSON 行为是概率性失败，
 * 统一走 generateJson 的"多轮重试 + 每轮变化请求形态"。
 */
export async function evaluateReasoning(input: AttemptTurnInput & {
  history: ContextMessage[];
}): Promise<AiEvaluation> {
  const messages: ContextMessage[] = [
    ...input.history,
    { role: "user" as const, content: buildAttemptTurn(input) },
  ];
  return generateJson({ system: SYSTEM, messages, schema: aiEvaluationSchema });
}

import { deepseek } from "@ai-sdk/deepseek";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { attempts, questions, misconceptions, skillNodes } from "@/lib/db/schema";
import { answerSchema, type Answer } from "@/lib/questions/answer";
import { stripCodeFences } from "@/lib/questions/prompt";
import { runOnPlaygroundCached, interpret } from "@/lib/playground";
import { and, desc, eq } from "drizzle-orm";

/** DeepSeek 当前可用模型：deepseek-flash / deepseek-v4-pro（deepseek-chat 已是指向 flash 的遗留别名） */
export const MODEL_ID = "deepseek-flash";

export const questionTypes = [
  "compile_outcome",
  "exact_output",
  "error_type",
  "error_location",
  "panic_prediction",
  "minimal_fix",
  "concept_reasoning",
] as const;

export type QuestionType = (typeof questionTypes)[number];

export type GenerateMode =
  | { kind: "fresh" }
  | {
      kind: "variant";
      /** 原题 ID，变种题挂在同一技能节点下 */
      basedOnQuestionId: string;
      /** 用户暴露的误区（AI 评判输出），变种题要针对它 */
      misconception?: string;
    };

export interface GenerateResult {
  questionId: string;
  steps: number;
}

const TYPE_GUIDE: Record<QuestionType, string> = {
  compile_outcome: "用户判断代码能否通过编译，answer.compiles 是标准答案。题干只问能否编译，不要暗示答案",
  exact_output: "用户写出程序的精确 stdout，answer.stdout 是标准答案（程序必须能编译运行）",
  error_type:
    "用户需要先自己判断代码能否编译；若编译失败，回答错误的类型/错误码。answer.errorCode 填 rustc 错误码如 E0502。【重要】题干绝不能提前透露代码有错误，应写成中性的问法，例如「请判断这段代码能否通过编译；如果不能，错误的类型是什么？」",
  error_location:
    "用户需要先自己判断代码能否编译；若编译失败，指出触发错误的行。answer.line 是该行号。【重要】题干绝不能提前透露代码有错误，应写成中性的问法，例如「请判断这段代码能否通过编译；如果不能，请指出触发错误的行号」——暴露误区的机会留给用户",
  panic_prediction:
    "用户判断程序运行时是否会 panic，answer.panics 是标准答案。题干用中性问法（如「这段程序运行时会发生什么？」），不要暗示答案",
  minimal_fix:
    "用户需要先自己判断代码能否编译；若不能，给出最小修复。answer.fixedCode 是能通过编译运行的修复后完整代码。【重要】题干绝不能提前透露代码有错误，应写成「请判断这段代码能否通过编译；如果不能，请给出最小修复」",
  concept_reasoning: "用户解释概念与推理过程，answer.keyPoints 是评分关键点",
};

async function verifyAnswer(
  type: QuestionType,
  code: string,
  answer: Answer,
): Promise<{ ok: true; runnerResultId: string | null } | { ok: false; reason: string }> {
  if (type === "compile_outcome") {
    if (answer.compiles === undefined) return { ok: false, reason: "answer.compiles 缺失" };
    const { result, runnerResultId } = await runOnPlaygroundCached(code);
    const { compiled } = interpret(result);
    if (compiled !== answer.compiles) {
      return {
        ok: false,
        reason: `你声称 compiles=${answer.compiles}，但 Playground 实际编译${compiled ? "成功" : "失败"}。编译器输出：${result.stderr.slice(0, 1500)}`,
      };
    }
    return { ok: true, runnerResultId };
  }

  if (type === "exact_output") {
    if (answer.stdout === undefined) return { ok: false, reason: "answer.stdout 缺失" };
    const { result, runnerResultId } = await runOnPlaygroundCached(code);
    const outcome = interpret(result);
    if (!outcome.ran) {
      return { ok: false, reason: `exact_output 题的程序必须能编译并运行成功，但实际失败了：${result.stderr.slice(0, 1500)}` };
    }
    if (result.stdout.trim() !== answer.stdout.trim()) {
      return {
        ok: false,
        reason: `你声称 stdout 是 ${JSON.stringify(answer.stdout)}，但实际是 ${JSON.stringify(result.stdout)}`,
      };
    }
    return { ok: true, runnerResultId };
  }

  if (type === "error_type") {
    if (!answer.errorCode) return { ok: false, reason: "answer.errorCode 缺失" };
    const { result, runnerResultId } = await runOnPlaygroundCached(code);
    const { compiled } = interpret(result);
    if (compiled) {
      return { ok: false, reason: "error_type 题的代码必须编译失败，但实际编译成功了" };
    }
    if (!result.stderr.includes(`error[${answer.errorCode}]`)) {
      return {
        ok: false,
        reason: `你声称错误码是 ${answer.errorCode}，但编译器输出中没有 error[${answer.errorCode}]。实际输出：${result.stderr.slice(0, 1500)}`,
      };
    }
    return { ok: true, runnerResultId };
  }

  if (type === "error_location") {
    if (answer.line === undefined) return { ok: false, reason: "answer.line 缺失" };
    const { result, runnerResultId } = await runOnPlaygroundCached(code);
    const { compiled } = interpret(result);
    if (compiled) {
      return { ok: false, reason: "error_location 题的代码必须编译失败，但实际编译成功了" };
    }
    const m = result.stderr.match(/-->\s+src\/main\.rs:(\d+):(\d+)/);
    if (!m) {
      return { ok: false, reason: `无法从编译器输出解析错误位置。实际输出：${result.stderr.slice(0, 1500)}` };
    }
    const actualLine = Number(m[1]);
    if (actualLine !== answer.line) {
      return { ok: false, reason: `你声称错误在第 ${answer.line} 行，但编译器报在第 ${actualLine} 行` };
    }
    return { ok: true, runnerResultId };
  }

  if (type === "panic_prediction") {
    if (answer.panics === undefined) return { ok: false, reason: "answer.panics 缺失" };
    const { result, runnerResultId } = await runOnPlaygroundCached(code);
    const outcome = interpret(result);
    if (!outcome.compiled) {
      return { ok: false, reason: `panic_prediction 题的代码必须能编译通过，但实际编译失败：${result.stderr.slice(0, 1500)}` };
    }
    if (outcome.panicked !== answer.panics) {
      return {
        ok: false,
        reason: `你声称 panics=${answer.panics}，但实际${outcome.panicked ? "发生" : "未发生"} panic。stderr：${result.stderr.slice(0, 1500)}`,
      };
    }
    return { ok: true, runnerResultId };
  }

  if (type === "minimal_fix") {
    if (!answer.fixedCode) return { ok: false, reason: "answer.fixedCode 缺失" };
    const [orig, fixed] = await Promise.all([
      runOnPlaygroundCached(code),
      runOnPlaygroundCached(answer.fixedCode),
    ]);
    if (interpret(orig.result).compiled) {
      return { ok: false, reason: "minimal_fix 题的原代码必须有编译错误，但实际编译成功了" };
    }
    if (!interpret(fixed.result).compiled) {
      return { ok: false, reason: `你给的修复代码仍编译失败：${fixed.result.stderr.slice(0, 1500)}` };
    }
    return { ok: true, runnerResultId: fixed.runnerResultId };
  }

  // concept_reasoning：无客观编译结果可校验，直接通过
  return { ok: true, runnerResultId: null };
}

function buildPrompts(
  skill: typeof skillNodes.$inferSelect,
  misconceptionDescriptions: string[],
  type: QuestionType,
  mode: GenerateMode,
  basedOn?: typeof questions.$inferSelect,
  recentCodes?: string[],
) {
  const system = `你是 Rust 教学平台的出题引擎。你为目标微技能设计一道练习题，用工具调用完成"草稿 → 编译器验证 → 正式出题"的流程。

硬性要求：
- 代码必须是单文件、可直接在 Rust Playground 运行的 main.rs，edition 2021，只用标准库，控制在 30 行以内
- 代码必须聚焦考察目标技能，不要混入无关难点
- 流程：先起草代码，然后必须调用 verifyOnPlayground 确认编译器行为符合预期，如有出入就修正代码重新验证，最后才能调用 finalizeQuestion
- finalizeQuestion 时服务端会再次用 Playground 交叉验证你的 answer，不一致会被拒绝，所以不要猜编译结果，一切以 verifyOnPlayground 的真实返回为准
- prompt 用中文，简洁清晰，只问题型对应的一个问题，不要混入其他问法，不要出现 answer.xxx 等内部字段名
- prompt 中【不要包含代码】：代码由平台单独渲染，prompt 只写问题文字，不要夹带 Markdown 代码围栏
- prompt 绝不预设结论：除非题型本身要求，不得告诉用户代码是否有错、是否会 panic，判断的机会留给用户
- explanation 用中文解释这道题考察的规则和常见误区`;

  const skillInfo = `目标技能：${skill.id}（${skill.titleZh} / ${skill.titleEn}）
技能说明：${skill.summary}
典型误区：${misconceptionDescriptions.length > 0 ? misconceptionDescriptions.join("；") : "（暂无）"}
题型：${type} —— ${TYPE_GUIDE[type]}`;

  const user =
    mode.kind === "variant" && basedOn
      ? `${skillInfo}

这是一道已使用过的原题：
\`\`\`rust
${basedOn.code}
\`\`\`
题干：${basedOn.prompt}
${mode.misconception ? `学习者在这道题上暴露的误区：${mode.misconception}` : ""}

请生成一道变种题：考察同一技能的同一规则，但代码场景要明显不同${mode.misconception ? "，并且专门针对上述误区设计迷惑点" : ""}。`
      : `${skillInfo}
${recentCodes && recentCodes.length > 0 ? `
该学习者近期在这个技能上已经做过以下题目（代码场景），请换一个【明显不同】的场景，避免雷同：
${recentCodes.map((c, i) => `--- 近期题 ${i + 1} ---\n${c}`).join("\n")}
` : ""}
请为该技能生成一道题。`;

  return { system, user };
}

/**
 * AI 出题管线：草稿 → Playground 验证 → 服务端交叉验证 → 入库（compiler_verified）。
 * 模型不许凭空决定编译结果，一切客观结论以 Playground 真实返回为准。
 */
export async function generateQuestionForSkill(
  skillId: string,
  type: QuestionType,
  mode: GenerateMode = { kind: "fresh" },
  opts: { userId?: string } = {},
): Promise<GenerateResult> {
  const [skill] = await db.select().from(skillNodes).where(eq(skillNodes.id, skillId)).limit(1);
  if (!skill) throw new Error(`Unknown skill: ${skillId}`);

  const skillMisconceptions = await db
    .select({ description: misconceptions.description })
    .from(misconceptions)
    .where(eq(misconceptions.skillId, skillId));

  let basedOn: typeof questions.$inferSelect | undefined;
  if (mode.kind === "variant") {
    const [row] = await db.select().from(questions).where(eq(questions.id, mode.basedOnQuestionId)).limit(1);
    if (!row) throw new Error(`Variant base question not found: ${mode.basedOnQuestionId}`);
    basedOn = row;
  }

  // 防雷同：该用户近期在本技能上作答过的题目代码
  let recentCodes: string[] = [];
  if (mode.kind === "fresh" && opts.userId) {
    const recent = await db
      .select({ code: questions.code })
      .from(attempts)
      .innerJoin(questions, eq(attempts.questionId, questions.id))
      .where(and(eq(attempts.userId, opts.userId), eq(questions.skillId, skillId)))
      .orderBy(desc(attempts.createdAt))
      .limit(20);
    recentCodes = [...new Set(recent.map((r) => r.code))].slice(0, 3);
  }

  const { system, user } = buildPrompts(
    skill,
    skillMisconceptions.map((m) => m.description),
    type,
    mode,
    basedOn,
    recentCodes,
  );

  let savedQuestionId: string | null = null;

  const result = await generateText({
    model: deepseek(MODEL_ID),
    system,
    prompt: user,
    stopWhen: stepCountIs(12),
    tools: {
      verifyOnPlayground: tool({
        description:
          "把 Rust 代码提交到 Rust Playground 真实编译并运行，返回编译器结果。出题前必须用它验证代码行为，禁止凭空猜测编译结果或运行输出。编译失败时 success=false 且 stderr 含 error[Exxxx]；编译成功时 stderr 含 Finished；运行时 panic 时 stderr 含 panicked。",
        inputSchema: z.object({
          code: z.string().describe("完整的 main.rs 源代码"),
        }),
        execute: async ({ code }) => {
          const { result, fromCache } = await runOnPlaygroundCached(code);
          return {
            success: result.success,
            stdout: result.stdout.slice(0, 4000),
            stderr: result.stderr.slice(0, 4000),
            exitDetail: result.exitDetail,
            fromCache,
          };
        },
      }),
      finalizeQuestion: tool({
        description:
          "完成出题并入库。调用前必须已经用 verifyOnPlayground 验证过代码。服务端会用 Playground 对 answer 做交叉验证，不一致会返回错误原因，需要修正后重新调用。",
        inputSchema: z.object({
          code: z.string().describe("题目代码（完整 main.rs）"),
          prompt: z.string().describe("题干（中文）"),
          answer: answerSchema,
          explanation: z.string().describe("解析（中文）：考察点、规则解释、常见误区"),
        }),
        execute: async ({ code, prompt, answer, explanation }) => {
          const check = await verifyAnswer(type, code, answer);
          if (!check.ok) {
            return { ok: false as const, reason: check.reason };
          }
          const [row] = await db
            .insert(questions)
            .values({
              skillId,
              type,
              code,
              prompt: stripCodeFences(prompt),
              answer,
              explanation,
              source: "ai_generated",
              model: MODEL_ID,
              status: "compiler_verified",
              runnerResultId: check.runnerResultId,
              variantOfId: mode.kind === "variant" ? mode.basedOnQuestionId : null,
            })
            .returning({ id: questions.id });
          savedQuestionId = row.id;
          return { ok: true as const, questionId: row.id };
        },
      }),
    },
  });

  if (!savedQuestionId) {
    throw new Error(
      `AI 未能完成出题（${result.steps.length} 步后停止）。最后的输出：${result.text.slice(0, 500)}`,
    );
  }
  return { questionId: savedQuestionId, steps: result.steps.length };
}

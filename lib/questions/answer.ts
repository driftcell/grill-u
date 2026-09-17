import { z } from "zod";

/**
 * 题目预期答案 / 用户作答共用的结构，按题型取用对应字段。
 * - AI 出题时 finalizeQuestion 提交它作为标准答案（questions.answer）
 * - 用户作答时提交它作为 userAnswer（attempts.user_answer）
 */
export const answerSchema = z.object({
  compiles: z.boolean().optional().describe("compile_outcome：代码能否通过编译"),
  stdout: z.string().optional().describe("exact_output：程序 stdout 的精确内容"),
  line: z.number().int().positive().optional().describe("error_location：触发编译错误的行号（从 1 开始）"),
  errorCode: z.string().optional().describe("error_type：rustc 错误码，如 E0382"),
  panics: z.boolean().optional().describe("panic_prediction：程序运行时是否会 panic"),
  fixedCode: z.string().optional().describe("minimal_fix：修复后的完整代码"),
  keyPoints: z.array(z.string()).optional().describe("concept_reasoning：评分关键点"),
});

export type Answer = z.infer<typeof answerSchema>;

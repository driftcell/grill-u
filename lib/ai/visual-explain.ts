import { eq } from "drizzle-orm";
import { z } from "zod";
import { generateJson } from "@/lib/ai/structured";
import { db } from "@/lib/db";
import { questions, skillNodes } from "@/lib/db/schema";

/**
 * 可视化讲解：AI 把题目代码的执行/检查过程抽成结构化"帧"，
 * 前端用内置组件做确定性步进渲染（AI 出数据，代码做呈现）。
 */

export const visualBindingSchema = z.object({
  name: z.string().describe("绑定名"),
  status: z
    .enum(["alive", "moved", "dropped", "borrowed"])
    .describe("本帧状态：alive 存活 / moved 所有权已移走 / dropped 已释放 / borrowed 正被借用"),
  value: z.string().optional().describe("值的简写，如 String(\"ping\")"),
  detail: z.string().optional().describe("中文补充指向关系，如「所有权 → x」「不可变借用 s」"),
});

export const visualFrameSchema = z.object({
  line: z.number().int().positive().describe("本帧焦点代码行（从 1 开始）"),
  bindings: z.array(visualBindingSchema).describe("本帧可见的绑定及其状态"),
  events: z.array(z.string()).describe("本步发生的事件，中文短句，1-3 条"),
  note: z.string().optional().describe("本帧讲解，中文一两句"),
});

export const visualExplainSchema = z.object({
  title: z.string().describe("图解标题，点出核心规则"),
  frames: z.array(visualFrameSchema).min(2).max(10),
});

export type VisualExplain = z.infer<typeof visualExplainSchema>;

const SYSTEM = `你是 Rust 规则可视化讲解器。给定一道 Rust 题目（代码、标准答案、解析，以及学习者的作答情况），把代码执行/检查过程拆成 4-8 帧，让学习者逐步"看见"规则如何生效。

要求：
- 帧按代码行推进，覆盖：绑定创建 → 关键规则事件（移动/借用/drop/编译错误点）→ 结局
- 每帧列出当时所有可见绑定的状态；状态变化是动画的核心，务必准确
- 规则生效的那一行（移动发生行 / 借用冲突行 / 编译器报错行）必须有独立帧，events 要点明规则
- 若学习者答错，在出错行附近的 note 里对照"学习者直觉 vs 实际规则"
- line 必须在代码实际行数范围内
- value 用简写；detail 表达指向关系（所有权去了哪、借用了谁）

【输出要求】只输出一个 JSON 对象，不要输出任何其他文字或 markdown 围栏。JSON 格式样例：
{"title":"赋值即移动：原绑定立即失效","frames":[{"line":2,"bindings":[{"name":"s","status":"alive","value":"String(\\"hi\\")"}],"events":["s 拥有堆上的 String"],"note":"绑定创建"},{"line":3,"bindings":[{"name":"s","status":"moved","detail":"所有权 → x"},{"name":"x","status":"alive","value":"String(\\"hi\\")"}],"events":["赋值即移动：所有权移交给 x","s 从此失效"],"note":"规则生效点"}]}`;

export async function generateVisualExplain(input: {
  questionId: string;
  /** 学习者作答与评价摘要（可选，用于针对性讲解） */
  userContext?: string;
}): Promise<VisualExplain> {
  const [question] = await db
    .select()
    .from(questions)
    .where(eq(questions.id, input.questionId))
    .limit(1);
  if (!question) throw new Error(`Question not found: ${input.questionId}`);
  const [skill] = await db
    .select()
    .from(skillNodes)
    .where(eq(skillNodes.id, question.skillId))
    .limit(1);

  const codeLines = question.code.split("\n").length;
  const userTurn = [
    `【技能】${skill.titleZh}（${skill.id}）`,
    `【题型】${question.type}`,
    `【代码】共 ${codeLines} 行\n${question.code}`,
    `【题干】${question.prompt}`,
    `【标准答案】${JSON.stringify(question.answer)}`,
    question.explanation ? `【解析】${question.explanation}` : null,
    input.userContext ? `【学习者情况】${input.userContext}` : null,
    "请生成 4-8 帧的可视化讲解。",
  ]
    .filter(Boolean)
    .join("\n\n");

  return generateJson({
    system: SYSTEM,
    messages: [{ role: "user", content: userTurn }],
    schema: visualExplainSchema,
    maxOutputTokens: 4096,
  });
}

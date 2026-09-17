import {
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const skillStatus = pgEnum("skill_status", [
  "draft",
  "compiler_verified",
  "human_reviewed",
  "calibrated",
]);

export const skillNodes = pgTable("skill_nodes", {
  /** 点分自然主键，如 "borrow.nll.last_use"，与 seeds/skill-dag.json 一致 */
  id: text("id").primaryKey(),
  /** 冗余的域前缀，如 "borrow"，方便按域过滤 */
  domain: text("domain").notNull(),
  titleZh: text("title_zh").notNull(),
  titleEn: text("title_en").notNull(),
  summary: text("summary").notNull(),
  misconceptions: text("misconceptions").array().notNull().default([]),
  status: skillStatus("status").notNull().default("draft"),
  rustEdition: text("rust_edition").notNull().default("2021"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const skillEdges = pgTable(
  "skill_edges",
  {
    /** 语义：skill_id 依赖 prerequisite_id（先修关系） */
    skillId: text("skill_id")
      .notNull()
      .references(() => skillNodes.id, { onDelete: "cascade" }),
    prerequisiteId: text("prerequisite_id")
      .notNull()
      .references(() => skillNodes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.skillId, t.prerequisiteId] })],
);

export const questionType = pgEnum("question_type", [
  "compile_outcome", // 能否通过编译
  "exact_output", // 精确运行输出
  "error_type", // 编译错误类型
  "error_location", // 错误位置
  "panic_prediction", // 运行时 panic 判断
  "minimal_fix", // 最小修复
  "concept_reasoning", // 概念解释与推理
]);

export const questionStatus = pgEnum("question_status", [
  "draft",
  "compiler_verified",
  "human_reviewed",
  "calibrated",
  "retired",
]);

export const questionSource = pgEnum("question_source", ["ai_generated", "human_authored"]);

/** 编译/运行结果缓存，按 action+code+edition+channel 的哈希共享 */
export const runnerResults = pgTable("runner_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** sha256(action + "\0" + code + "\0" + edition + "\0" + channel)，同一代码只跑一次 */
  codeHash: text("code_hash").notNull().unique(),
  /** execute（编译并运行）| compile（仅编译） */
  action: text("action").notNull(),
  code: text("code").notNull(),
  edition: text("edition").notNull(),
  channel: text("channel").notNull(),
  success: boolean("success").notNull(),
  stdout: text("stdout").notNull(),
  stderr: text("stderr").notNull(),
  exitDetail: text("exit_detail"),
  ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
});

export const questions = pgTable("questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 考察的技能节点；变种题与原题挂在同一节点 */
  skillId: text("skill_id")
    .notNull()
    .references(() => skillNodes.id),
  type: questionType("type").notNull(),
  code: text("code").notNull(),
  prompt: text("prompt").notNull(),
  /** 期望答案，按题型不同：{compiles} | {stdout} | {line} | {errorCode} | {panics} | {fixedCode} | {keyPoints[]} */
  answer: jsonb("answer").notNull(),
  explanation: text("explanation"),
  source: questionSource("source").notNull(),
  /** 生成模型名，人工题为 null */
  model: text("model"),
  status: questionStatus("status").notNull().default("draft"),
  rustEdition: text("rust_edition").notNull().default("2021"),
  channel: text("channel").notNull().default("stable"),
  /** 验证本题的编译/运行缓存 */
  runnerResultId: uuid("runner_result_id").references(() => runnerResults.id),
  /** 变种题指向它的原题 */
  variantOfId: uuid("variant_of_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

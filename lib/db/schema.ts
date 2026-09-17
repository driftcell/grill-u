import {
  boolean,
  index,
  integer,
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
  status: skillStatus("status").notNull().default("draft"),
  rustEdition: text("rust_edition").notNull().default("2021"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * 典型误区是一等图节点：用户证据直接挂到误区上，
 * "掌握"在图上表现为具体误区被暴露、被纠正且未复发。
 */
export const misconceptions = pgTable("misconceptions", {
  /** 稳定文本主键：${skillId}.m${序号}，序号对应 seed JSON 数组下标（约定只追加，不重排） */
  id: text("id").primaryKey(),
  skillId: text("skill_id")
    .notNull()
    .references(() => skillNodes.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
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

/** demo 阶段不做登录，先种一个固定 ID 的 demo 用户（见 lib/demo.ts） */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 一次作答：客观答案 + 用户推理 + 编译器判定 + AI 结构化评价 */
export const attempts = pgTable("attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  questionId: uuid("question_id")
    .notNull()
    .references(() => questions.id),
  /** 用户提交的客观答案，结构按题型与 questions.answer 对齐 */
  userAnswer: jsonb("user_answer").notNull(),
  /** 用户填写的推理过程（concept_reasoning 题的主要作答内容） */
  reasoning: text("reasoning"),
  /** 客观判定结果；concept_reasoning 无客观答案时为 null */
  objectiveCorrect: boolean("objective_correct"),
  /** AI 对推理的结构化评价（评价完成前为 null） */
  aiEvaluation: jsonb("ai_evaluation"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const evidenceDimension = pgEnum("evidence_dimension", [
  "judgment", // 结论判断
  "location", // 错误定位
  "explanation", // 原因解释
  "fix", // 最小修复
  "transfer", // 跨场景迁移
]);

export const evidenceOutcome = pgEnum("evidence_outcome", [
  "demonstrated", // 表现出正确理解
  "violated", // 违反规则但未命中已知误区
  "misconception_detected", // 命中已知误区
]);

export const evidenceSource = pgEnum("evidence_source", [
  "compiler", // 编译器客观判定
  "ai", // AI 推理评价
]);

/**
 * 结构化能力证据（append-only，长期核心资产）。
 * 用户能力 = 这些证据在知识图谱上的确定性投影，不存储任何分数。
 */
export const skillEvidence = pgTable(
  "skill_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    /** 冗余 user_id：按用户投影图谱时无需 join attempts */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    skillNodeId: text("skill_node_id")
      .notNull()
      .references(() => skillNodes.id),
    dimension: evidenceDimension("dimension").notNull(),
    outcome: evidenceOutcome("outcome").notNull(),
    /** outcome = misconception_detected 时指向命中的误区节点 */
    misconceptionId: text("misconception_id").references(() => misconceptions.id),
    source: evidenceSource("source").notNull(),
    /** 可解释文本：判定说明或 AI 评价摘要 */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("skill_evidence_user_node_idx").on(t.userId, t.skillNodeId)],
);

/**
 * 每个用户的导师对话线程：持久上下文，按稳定性排序注入模型。
 * 结构化长期记忆在 skill_evidence / attempts 里（永不压缩），
 * 这里只承载对话流体（作答事件、评价、讲解、后续追问）。
 */
export const aiThreads = pgTable("ai_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  /** 线程种类，目前只有 tutor */
  kind: text("kind").notNull().default("tutor"),
  /** 早期历程的压缩摘要（覆盖 summarized=true 的消息），钉在上下文开头 */
  summary: text("summary"),
  /** 摘要 + 未压缩消息的估计 token 数（增量维护，触发压缩的判据） */
  approxTokens: integer("approx_tokens").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => aiThreads.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // "user" | "assistant"
    /** attempt=作答事件 evaluation=评价讲解 chat=自由对话 */
    kind: text("kind").notNull(),
    content: text("content").notNull(),
    /** 关联的作答（chat 消息为 null） */
    refAttemptId: uuid("ref_attempt_id").references(() => attempts.id),
    approxTokens: integer("approx_tokens").notNull(),
    /** 压缩后旧消息归档保留但不进上下文 */
    summarized: boolean("summarized").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_messages_thread_idx").on(t.threadId, t.summarized, t.createdAt)],
);

import { deepseek } from "@ai-sdk/deepseek";
import { generateText } from "ai";
import { and, asc, eq, sql } from "drizzle-orm";
import { MODEL_ID } from "@/lib/ai/generate-question";
import { db } from "@/lib/db";
import { aiMessages, aiThreads } from "@/lib/db/schema";

/**
 * 上下文预算：100k tokens 之前不压缩（DeepSeek 上下文窗口 128k）。
 * 触发压缩时保留末尾 RECENT_KEEP_TOKENS 的近期对话，其余压成摘要。
 */
export const MAX_CONTEXT_TOKENS = 100_000;
const RECENT_KEEP_TOKENS = 16_000;

/**
 * 粗略 token 估计：DeepSeek 中文约 1 token/字，英文约 0.3 token/字符，
 * 混合内容按 0.8/字符保守高估，宁可早压不可溢出。
 * 后续可用 API 返回的 usage 校准。
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length * 0.8);
}

export type Thread = typeof aiThreads.$inferSelect;

export interface ContextMessage {
  role: "user" | "assistant";
  content: string;
}

/** 取用户的导师线程，没有则创建 */
export async function getOrCreateThread(userId: string, kind = "tutor"): Promise<Thread> {
  const [existing] = await db
    .select()
    .from(aiThreads)
    .where(and(eq(aiThreads.userId, userId), eq(aiThreads.kind, kind)))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(aiThreads)
    .values({ userId, kind })
    .returning();
  return created;
}

/** 追加一条消息，并增量维护线程的 approxTokens */
export async function appendMessage(
  threadId: string,
  input: {
    role: "user" | "assistant";
    kind: "attempt" | "evaluation" | "chat";
    content: string;
    refAttemptId?: string;
  },
): Promise<void> {
  const approxTokens = estimateTokens(input.content);
  await db.insert(aiMessages).values({
    threadId,
    role: input.role,
    kind: input.kind,
    content: input.content,
    refAttemptId: input.refAttemptId ?? null,
    approxTokens,
  });
  await db
    .update(aiThreads)
    .set({ approxTokens: sql`${aiThreads.approxTokens} + ${approxTokens}`, updatedAt: new Date() })
    .where(eq(aiThreads.id, threadId));
}

/**
 * 组合注入模型的对话上下文（按稳定性排序，利于 DeepSeek 前缀缓存）：
 * [学习历程摘要(若存在)] → 未压缩的历史消息（时间升序）
 */
export async function composeContext(thread: Thread): Promise<ContextMessage[]> {
  const rows = await db
    .select({ role: aiMessages.role, content: aiMessages.content })
    .from(aiMessages)
    .where(and(eq(aiMessages.threadId, thread.id), eq(aiMessages.summarized, false)))
    .orderBy(asc(aiMessages.createdAt));

  const messages: ContextMessage[] = [];
  if (thread.summary) {
    messages.push({
      role: "user",
      content: `【系统注入：该学习者较早的学习历程摘要】\n${thread.summary}`,
    });
  }
  for (const r of rows) {
    messages.push({ role: r.role as "user" | "assistant", content: r.content });
  }
  return messages;
}

/**
 * 超阈值压缩：把最旧的未压缩消息（保留末尾 recentKeepTokens）让模型压成摘要，
 * 钉到线程 summary 上，旧消息标记 summarized 归档（不删除，DB 是长期资产）。
 * 内部重新读取线程行（调用方对象可能因追加消息而过期），返回最新线程行。
 * @param maxTokens 可注入阈值，测试用小值触发
 * @param recentKeepTokens 压缩时保留的近期窗口，测试用小值
 */
export async function compressIfNeeded(
  threadId: string,
  maxTokens = MAX_CONTEXT_TOKENS,
  recentKeepTokens = RECENT_KEEP_TOKENS,
): Promise<Thread> {
  const [thread] = await db.select().from(aiThreads).where(eq(aiThreads.id, threadId)).limit(1);
  if (!thread) throw new Error(`Thread not found: ${threadId}`);
  if (thread.approxTokens < maxTokens) {
    return thread;
  }

  const rows = await db
    .select()
    .from(aiMessages)
    .where(and(eq(aiMessages.threadId, thread.id), eq(aiMessages.summarized, false)))
    .orderBy(asc(aiMessages.createdAt));

  // 从末尾往前保留近期对话
  let recentTokens = 0;
  let cutoff = rows.length;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (recentTokens + rows[i].approxTokens > recentKeepTokens) break;
    recentTokens += rows[i].approxTokens;
    cutoff = i;
  }
  const toSummarize = rows.slice(0, cutoff);
  if (toSummarize.length === 0) {
    // 全部消息都在保留窗口内，无法压缩
    return thread;
  }

  const history = toSummarize
    .map((m) => `${m.role === "user" ? "【学习者】" : "【导师】"}${m.content}`)
    .join("\n\n");

  const { text: newSummary } = await generateText({
    model: deepseek(MODEL_ID),
    system: `你是学习档案压缩器。把 Rust 学习对话历程压缩成摘要，供后续教学保持连续性。必须保留：
- 暴露过的误区（引用误区 id）及其纠正情况
- 反复出现的规则盲区
- 学习者容易接受的解释方式
丢弃：具体题目代码、一次性客套、已被纠正且再未复发的细节。中文，500 字以内。`,
    prompt: `${thread.summary ? `已有摘要（需合并）：\n${thread.summary}\n\n` : ""}待压缩的对话历程：\n${history}`,
  });

  const summaryTokens = estimateTokens(newSummary);
  await db
    .update(aiMessages)
    .set({ summarized: true })
    .where(
      and(
        eq(aiMessages.threadId, thread.id),
        eq(aiMessages.summarized, false),
        sql`${aiMessages.createdAt} <= ${toSummarize[toSummarize.length - 1].createdAt}`,
      ),
    );

  const approxTokens = summaryTokens + recentTokens;
  const [updated] = await db
    .update(aiThreads)
    .set({ summary: newSummary, approxTokens, updatedAt: new Date() })
    .where(eq(aiThreads.id, thread.id))
    .returning();

  return updated;
}

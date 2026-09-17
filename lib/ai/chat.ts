import { deepseek } from "@ai-sdk/deepseek";
import { generateText } from "ai";
import { MODEL_ID } from "@/lib/ai/generate-question";
import {
  appendMessage,
  compressIfNeeded,
  composeContext,
  getOrCreateThread,
} from "@/lib/ai/thread";

/**
 * 判题后的自由追问：与推理评价共用同一条持久线程，
 * 导师因此能看到完整的作答事件、历史评价与过往追问。
 * 输出为 Markdown 散文（非结构化 JSON）。
 */
const CHAT_SYSTEM = `你是 Rust 教学平台的导师，正在与一名学习者进行【持续性】的教学对话。你能看到这名学习者历史上的作答事件、你以往的评价、以及之前的追问。

学习者正在就刚才的题目追问。要求：
- 紧扣上下文中的具体题目与编译器判定，用中文回答，简洁清晰
- 可以使用 Markdown：行内代码、代码块、列表
- 引导式回答优于直接给结论；指出学习者推理中的具体错位，而不是泛泛讲解
- 如果问题与 Rust 学习无关，礼貌地拉回主题`;

export async function replyToLearner(userId: string, message: string): Promise<string> {
  const thread = await getOrCreateThread(userId);
  await appendMessage(thread.id, { role: "user", kind: "chat", content: message });

  const fresh = await compressIfNeeded(thread.id);
  const history = await composeContext(fresh);

  const { text } = await generateText({
    model: deepseek(MODEL_ID),
    system: CHAT_SYSTEM,
    messages: history,
    maxOutputTokens: 2048,
  });

  const reply = text.trim();
  await appendMessage(thread.id, { role: "assistant", kind: "chat", content: reply });
  return reply;
}

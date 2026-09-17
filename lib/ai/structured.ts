import { createDeepSeek, deepseek } from "@ai-sdk/deepseek";
import { generateText } from "ai";
import type { z } from "zod";
import { MODEL_ID } from "@/lib/ai/generate-question";
import { repairJsonText } from "@/lib/ai/json-repair";
import type { ContextMessage } from "@/lib/ai/thread";

/**
 * DeepSeek 的 JSON 输出有两种随机失败（官方已知问题）：
 * json_object 模式有概率返回空 content；普通模式有概率输出散文。
 * SDK 自带的 json 兼容模式还会额外注入一条 system 消息。
 * 这里直接在请求体上打 response_format 补丁（单条 system 不受影响），
 * 配合"两种模式交替 + 纠正提示"的多轮重试消解随机性。
 */
const jsonPatchFetch: typeof fetch = async (url, init) => {
  if (init?.body && typeof init.body === "string" && String(url).includes("chat/completions")) {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    body.response_format = { type: "json_object" };
    init = { ...init, body: JSON.stringify(body) };
  }
  return fetch(url, init);
};

const jsonForcedProvider = createDeepSeek({ fetch: jsonPatchFetch });

const RETRY_NUDGE =
  "你上一次没有按要求输出。请只输出一个 JSON 对象，不要输出任何其他文字或 markdown 围栏。";

/**
 * 结构化输出统一入口：generateText + 本地解析校验 + 3 轮交替重试。
 * 调用方只需提供 system（含 JSON 样例）、消息与 zod schema。
 */
export async function generateJson<S extends z.ZodType>(input: {
  system: string;
  messages: ContextMessage[];
  schema: S;
  maxOutputTokens?: number;
}): Promise<z.infer<S>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const forceJson = attempt % 2 === 0;
    const messages =
      attempt === 0
        ? input.messages
        : [...input.messages, { role: "user" as const, content: RETRY_NUDGE }];
    try {
      const { text } = await generateText({
        model: forceJson ? jsonForcedProvider(MODEL_ID) : deepseek(MODEL_ID),
        system: input.system,
        messages,
        maxOutputTokens: input.maxOutputTokens ?? 2048,
      });

      const repaired = await repairJsonText({ text });
      if (!repaired) {
        throw new Error(`响应中未找到 JSON（前 100 字符：${text.slice(0, 100)}）`);
      }
      const parsed = input.schema.safeParse(JSON.parse(repaired));
      if (!parsed.success) {
        throw new Error(`JSON 不符合 schema：${parsed.error.issues[0]?.message}`);
      }
      return parsed.data as z.infer<S>;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

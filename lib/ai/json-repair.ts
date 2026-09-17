/**
 * DeepSeek 不支持原生 JSON Schema 输出，AI SDK 会把 schema 注入 system message
 * 让模型返回 JSON 文本。模型偶尔会在 JSON 外面包 markdown 围栏或加前后缀，
 * 导致 generateObject 解析失败。这个修复函数提取出 JSON 本体。
 */
export async function repairJsonText({ text }: { text: string }): Promise<string | null> {
  let t = text.trim();

  // 剥掉 markdown 围栏（```json ... ```）
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();

  // 提取第一个 { 到最后一个 } 之间的内容
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return t.slice(start, end + 1);
}

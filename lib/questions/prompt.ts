/** 去掉模型在题干里夹带的代码围栏（代码由平台单独渲染，prompt 只保留问题文字） */
export function stripCodeFences(prompt: string): string {
  return prompt
    .replace(/```[a-zA-Z]*\n[\s\S]*?```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

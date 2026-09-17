"use server";

import { replyToLearner } from "@/lib/ai/chat";
import { generateVisualExplain, type VisualExplain } from "@/lib/ai/visual-explain";
import { submitAttempt, type SubmitResult } from "@/lib/attempts/submit";
import { DEMO_USER_ID } from "@/lib/demo";
import { answerSchema } from "@/lib/questions/answer";

export async function submitAttemptAction(input: {
  questionId: string;
  userAnswer: unknown;
  reasoning?: string;
}): Promise<SubmitResult> {
  const userAnswer = answerSchema.parse(input.userAnswer);
  return await submitAttempt({
    userId: DEMO_USER_ID,
    questionId: input.questionId,
    userAnswer,
    reasoning: input.reasoning,
  });
}

export async function askTutorAction(message: string): Promise<string> {
  const trimmed = message.trim();
  if (!trimmed) throw new Error("消息不能为空");
  if (trimmed.length > 4000) throw new Error("消息过长");
  return await replyToLearner(DEMO_USER_ID, trimmed);
}

export async function visualExplainAction(
  questionId: string,
  userContext?: string,
): Promise<VisualExplain> {
  return await generateVisualExplain({ questionId, userContext });
}

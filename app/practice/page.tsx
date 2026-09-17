import { generateQuestionForSkill, type QuestionType } from "@/lib/ai/generate-question";
import { db } from "@/lib/db";
import { DEMO_USER_ID } from "@/lib/demo";
import { questions, skillNodes } from "@/lib/db/schema";
import { manualTarget, selectTarget } from "@/lib/skills/select-target";
import { stripCodeFences } from "@/lib/questions/prompt";
import { eq } from "drizzle-orm";
import { PracticeForm } from "./practice-form";

export const dynamic = "force-dynamic";

export default async function PracticePage({
  searchParams,
}: {
  searchParams: Promise<{ skill?: string; type?: string }>;
}) {
  const { skill: skillParam, type: typeParam } = await searchParams;

  const target = skillParam
    ? manualTarget(skillParam, typeParam)
    : await selectTarget(DEMO_USER_ID);

  let question: typeof questions.$inferSelect;
  let skill: typeof skillNodes.$inferSelect;
  try {
    const { questionId } = await generateQuestionForSkill(target.skillId, target.type, { kind: "fresh" }, { userId: DEMO_USER_ID });
    const [q] = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
    const [s] = await db.select().from(skillNodes).where(eq(skillNodes.id, target.skillId)).limit(1);
    question = q;
    skill = s;
  } catch (err) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-16">
        <h1 className="text-xl font-semibold">出题失败</h1>
        <p className="text-sm text-zinc-500">
          目标技能 <code>{target.skillId}</code>（{target.type}）
        </p>
        <pre className="overflow-auto rounded-lg bg-zinc-100 p-4 text-xs dark:bg-zinc-900">
          {err instanceof Error ? err.message : String(err)}
        </pre>
        <a href="/practice" className="text-sm font-medium text-blue-600 hover:underline">
          重试 →
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span className="rounded-full bg-zinc-100 px-3 py-1 dark:bg-zinc-800">
          {skill.titleZh} · {skill.id}
        </span>
        <span className="rounded-full bg-zinc-100 px-3 py-1 dark:bg-zinc-800">{question.type}</span>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          {target.reason}
        </span>
      </div>
      <PracticeForm
        key={question.id}
        question={{
          id: question.id,
          type: question.type as QuestionType,
          code: question.code,
          prompt: stripCodeFences(question.prompt),
        }}
      />
    </div>
  );
}

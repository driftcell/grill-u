import "./env";

import { generateQuestionForSkill, questionTypes, type GenerateMode } from "@/lib/ai/generate-question";
import { db } from "@/lib/db";
import { questions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const VALID_TYPES = questionTypes;

function usage(): never {
  console.error(`Usage:
  pnpm generate:question <skillId> [type]
  pnpm generate:question <skillId> <type> --variant <questionId> [--misconception "误区描述"]

type: ${VALID_TYPES.join(" | ")}（默认 compile_outcome）`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const skillId = args[0];
  if (!skillId) usage();

  let type: (typeof VALID_TYPES)[number] = "compile_outcome";
  const rest = args.slice(1);
  if (rest[0] && !rest[0].startsWith("--")) {
    if (!VALID_TYPES.includes(rest[0] as (typeof VALID_TYPES)[number])) usage();
    type = rest.shift() as (typeof VALID_TYPES)[number];
  }

  let mode: GenerateMode = { kind: "fresh" };
  const variantIdx = rest.indexOf("--variant");
  if (variantIdx !== -1) {
    const basedOnQuestionId = rest[variantIdx + 1];
    if (!basedOnQuestionId) usage();
    const mcIdx = rest.indexOf("--misconception");
    mode = {
      kind: "variant",
      basedOnQuestionId,
      misconception: mcIdx !== -1 ? rest[mcIdx + 1] : undefined,
    };
  }

  console.log(`Generating ${type} question for skill "${skillId}" (mode: ${mode.kind})...`);
  const { questionId, steps } = await generateQuestionForSkill(skillId, type, mode);

  const [q] = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
  console.log(`\n✓ Question saved in ${steps} steps, status=${q.status}\n`);
  console.log(`id:     ${q.id}`);
  console.log(`skill:  ${q.skillId}`);
  console.log(`type:   ${q.type}`);
  console.log(`prompt: ${q.prompt}`);
  console.log(`answer: ${JSON.stringify(q.answer)}`);
  console.log(`code:\n${q.code}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

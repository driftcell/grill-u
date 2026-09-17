import type { questions } from "@/lib/db/schema";
import { answerSchema, type Answer } from "@/lib/questions/answer";
import { interpret, runOnPlaygroundCached } from "@/lib/playground";

export interface GradeResult {
  /** null 表示该题型无客观判定（concept_reasoning） */
  correct: boolean | null;
  /** 判定说明（如 minimal_fix 失败时的编译器报错） */
  detail?: string;
}

type Question = typeof questions.$inferSelect;

/** 宽容地规范化用户输入的错误码："e0382" / "E-0382" / "error[E0382]" → "E0382" */
function normalizeErrorCode(code: string): string {
  const m = code.trim().toUpperCase().match(/(\d{4})/);
  return m ? `E${m[1]}` : code.trim().toUpperCase();
}

/**
 * 客观判定：完全确定性。
 * 除 minimal_fix 需要把用户的修复代码真送编译器外，
 * 其余题型只与 compiler_verified 的标准答案比对，不再访问编译器。
 */
export async function gradeAttempt(question: Question, userAnswer: Answer): Promise<GradeResult> {
  const expected = answerSchema.parse(question.answer);

  switch (question.type) {
    case "compile_outcome":
      return { correct: userAnswer.compiles === expected.compiles };

    case "exact_output":
      return { correct: (userAnswer.stdout ?? "").trim() === (expected.stdout ?? "").trim() };

    case "error_type": {
      if (!userAnswer.errorCode || !expected.errorCode) return { correct: false };
      return {
        correct: normalizeErrorCode(userAnswer.errorCode) === normalizeErrorCode(expected.errorCode),
      };
    }

    case "error_location":
      return { correct: userAnswer.line === expected.line };

    case "panic_prediction":
      return { correct: userAnswer.panics === expected.panics };

    case "minimal_fix": {
      if (!userAnswer.fixedCode?.trim()) return { correct: false };
      const { result } = await runOnPlaygroundCached(userAnswer.fixedCode);
      if (interpret(result).compiled) return { correct: true };
      return { correct: false, detail: result.stderr.slice(0, 1500) };
    }

    case "concept_reasoning":
      return { correct: null };
  }
}

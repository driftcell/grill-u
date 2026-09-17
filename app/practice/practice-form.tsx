"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { FrameStepper } from "@/components/frame-stepper";
import { Markdown } from "@/components/markdown";
import type { QuestionType } from "@/lib/ai/generate-question";
import type { VisualExplain } from "@/lib/ai/visual-explain";
import type { SubmitResult } from "@/lib/attempts/submit";
import type { Answer } from "@/lib/questions/answer";
import { askTutorAction, submitAttemptAction, visualExplainAction } from "./actions";

interface PracticeQuestion {
  id: string;
  type: QuestionType;
  code: string;
  prompt: string;
}

const NODE_STATE_LABEL: Record<string, string> = {
  unknown: "未知",
  misconception_active: "误区活跃",
  fragile: "脆弱",
  stable: "稳定",
  transferred: "已迁移",
};

const OUTCOME_LABEL: Record<string, string> = {
  demonstrated: "✓ 展现理解",
  violated: "✗ 违反规则",
  misconception_detected: "⚠ 命中误区",
};

const DIMENSION_LABEL: Record<string, string> = {
  judgment: "结论判断",
  location: "错误定位",
  explanation: "原因解释",
  fix: "最小修复",
  transfer: "跨场景迁移",
};

function CodeBlock({
  code,
  highlightLine,
  selectedLine,
  onLineSelect,
}: {
  code: string;
  /** 判题后标红的标准错误行 */
  highlightLine?: number;
  /** error_location 作答中：点击选中的行 */
  selectedLine?: number | null;
  onLineSelect?: (line: number) => void;
}) {
  const selectable = !!onLineSelect;
  return (
    <pre className="overflow-x-auto rounded-xl bg-zinc-950 p-4 text-sm leading-6 text-zinc-100">
      {code.split("\n").map((line, i) => {
        const n = i + 1;
        const cls =
          highlightLine === n
            ? "-mx-4 bg-red-950/60 px-4"
            : selectedLine === n
              ? "-mx-4 border-l-4 border-blue-400 bg-blue-500/30 pl-3 pr-4"
              : selectable
                ? "-mx-4 cursor-pointer px-4 hover:bg-zinc-700/50"
                : undefined;
        return (
          <div
            key={i}
            className={cls}
            onClick={selectable ? () => onLineSelect(n) : undefined}
          >
            <span
              className={`mr-4 inline-block w-6 select-none text-right ${
                selectedLine === n ? "font-bold text-blue-300" : "text-zinc-500"
              }`}
            >
              {n}
            </span>
            <code>{line}</code>
          </div>
        );
      })}
    </pre>
  );
}

function AnswerFields({
  type,
  boolAnswer,
  setBoolAnswer,
  textAnswer,
  setTextAnswer,
  lineAnswer,
}: {
  type: QuestionType;
  boolAnswer: boolean | null;
  setBoolAnswer: (v: boolean) => void;
  textAnswer: string;
  setTextAnswer: (v: string) => void;
  lineAnswer: number | null;
}) {
  if (type === "compile_outcome" || type === "panic_prediction") {
    const [yes, no] =
      type === "compile_outcome" ? ["能通过编译", "不能通过编译"] : ["会 panic", "不会 panic"];
    return (
      <div className="flex gap-3">
        {[
          { v: true, label: yes },
          { v: false, label: no },
        ].map((opt) => (
          <button
            key={opt.label}
            type="button"
            onClick={() => setBoolAnswer(opt.v)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
              boolAnswer === opt.v
                ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  if (type === "minimal_fix") {
    return (
      <textarea
        value={textAnswer}
        onChange={(e) => setTextAnswer(e.target.value)}
        rows={10}
        spellCheck={false}
        placeholder="粘贴修复后的完整 main.rs"
        className="w-full rounded-xl border border-zinc-300 bg-transparent p-3 font-mono text-sm dark:border-zinc-700"
      />
    );
  }

  if (type === "concept_reasoning") return null;

  if (type === "error_location") {
    return lineAnswer === null ? (
      <p className="text-sm text-zinc-500">点击上面代码中触发编译错误的行</p>
    ) : (
      <p className="text-sm">
        已选 <span className="font-bold text-blue-600 dark:text-blue-400">第 {lineAnswer} 行</span>
        <span className="text-zinc-500">（点击其他行可改选）</span>
      </p>
    );
  }

  if (type === "exact_output") {
    return (
      <textarea
        value={textAnswer}
        onChange={(e) => setTextAnswer(e.target.value)}
        rows={4}
        spellCheck={false}
        placeholder="程序的精确 stdout（逐字符，含换行）"
        className="w-full max-w-xl rounded-xl border border-zinc-300 bg-transparent p-3 font-mono text-sm dark:border-zinc-700"
      />
    );
  }

  return (
    <input
      value={textAnswer}
      onChange={(e) => setTextAnswer(e.target.value)}
      placeholder="rustc 错误码，如 E0382"
      className="w-full max-w-md rounded-xl border border-zinc-300 bg-transparent px-3 py-2 font-mono text-sm dark:border-zinc-700"
    />
  );
}

export function PracticeForm({ question }: { question: PracticeQuestion }) {
  const [boolAnswer, setBoolAnswer] = useState<boolean | null>(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [lineAnswer, setLineAnswer] = useState<number | null>(null);
  const [reasoning, setReasoning] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [chatLog, setChatLog] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatPending, startChatTransition] = useTransition();
  const [visual, setVisual] = useState<VisualExplain | null>(null);
  const [visualErr, setVisualErr] = useState<string | null>(null);
  const [visualPending, startVisualTransition] = useTransition();

  const needsBool = question.type === "compile_outcome" || question.type === "panic_prediction";
  const needsText = ["exact_output", "error_type", "minimal_fix"].includes(question.type);
  const needsLine = question.type === "error_location";
  const canSubmit =
    !pending &&
    (!needsBool || boolAnswer !== null) &&
    (!needsText || textAnswer.trim().length > 0) &&
    (!needsLine || lineAnswer !== null) &&
    (question.type !== "concept_reasoning" || reasoning.trim().length > 0);

  function buildUserAnswer(): Answer {
    switch (question.type) {
      case "compile_outcome":
        return { compiles: boolAnswer! };
      case "panic_prediction":
        return { panics: boolAnswer! };
      case "exact_output":
        return { stdout: textAnswer };
      case "error_type":
        return { errorCode: textAnswer };
      case "error_location":
        return { line: lineAnswer! };
      case "minimal_fix":
        return { fixedCode: textAnswer };
      case "concept_reasoning":
        return {};
    }
  }

  function onSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await submitAttemptAction({
          questionId: question.id,
          userAnswer: buildUserAnswer(),
          reasoning: reasoning.trim() || undefined,
        });
        setResult(r);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function onSendChat() {
    const msg = chatInput.trim();
    if (!msg || chatPending) return;
    setChatInput("");
    setChatLog((l) => [...l, { role: "user", content: msg }]);
    startChatTransition(async () => {
      try {
        const reply = await askTutorAction(msg);
        setChatLog((l) => [...l, { role: "assistant", content: reply }]);
      } catch (e) {
        setChatLog((l) => [
          ...l,
          { role: "assistant", content: `出错了：${e instanceof Error ? e.message : String(e)}` },
        ]);
      }
    });
  }

  function onVisualExplain() {
    if (!result) return;
    setVisualErr(null);
    startVisualTransition(async () => {
      try {
        const userContext = `学习者客观作答${result.objectiveCorrect === null ? "（无判定）" : result.objectiveCorrect ? "正确" : "错误"}。AI 评价：${result.aiEvaluation.summary}`;
        setVisual(await visualExplainAction(question.id, userContext));
      } catch (e) {
        setVisualErr(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const highlightLine = result?.expectedAnswer.line;

  return (
    <div className="flex flex-col gap-6">
      <p className="whitespace-pre-wrap text-base leading-7">{question.prompt}</p>

      <CodeBlock
        code={question.code}
        highlightLine={result ? highlightLine : undefined}
        selectedLine={!result && needsLine ? lineAnswer : undefined}
        onLineSelect={!result && needsLine ? setLineAnswer : undefined}
      />

      {!result && (
        <>
          <AnswerFields
            type={question.type}
            boolAnswer={boolAnswer}
            setBoolAnswer={setBoolAnswer}
            textAnswer={textAnswer}
            setTextAnswer={setTextAnswer}
            lineAnswer={lineAnswer}
          />

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              你的推理（AI 会评价推理质量，猜对不算理解）
              {question.type === "concept_reasoning" && <span className="text-red-500"> *</span>}
            </label>
            <textarea
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value)}
              rows={4}
              placeholder="写下你的判断依据：哪条规则起作用？借用活到哪一行？……"
              className="w-full rounded-xl border border-zinc-300 bg-transparent p-3 text-sm dark:border-zinc-700"
            />
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className="rounded-full bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending ? "编译器判定 + AI 评价中…" : "提交"}
            </button>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </>
      )}

      {result && (
        <div className="flex flex-col gap-5 rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-sm font-semibold ${
                result.objectiveCorrect === null
                  ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                  : result.objectiveCorrect
                    ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                    : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
              }`}
            >
              {result.objectiveCorrect === null
                ? "概念解释题（无客观判定）"
                : result.objectiveCorrect
                  ? "客观作答正确"
                  : "客观作答错误"}
            </span>
            <span className="text-sm text-zinc-500">
              节点状态：{NODE_STATE_LABEL[result.nodeState.state] ?? result.nodeState.state}
            </span>
          </div>

          {result.gradeDetail && (
            <pre className="max-h-40 overflow-auto rounded-lg bg-zinc-100 p-3 text-xs dark:bg-zinc-900">
              {result.gradeDetail}
            </pre>
          )}

          {result.explanation && (
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium">解析</span>
              <div className="text-zinc-600 dark:text-zinc-400">
                <Markdown>{result.explanation}</Markdown>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 text-sm">
            <span className="font-medium">AI 推理评价</span>
            <div className="text-zinc-700 dark:text-zinc-300">
              <Markdown>{result.aiEvaluation.summary}</Markdown>
            </div>
            {result.aiEvaluation.misconceptions.length > 0 && (
              <div className="rounded-lg bg-red-50 p-3 text-red-800 dark:bg-red-950/40 dark:text-red-200">
                <div className="mb-1 font-medium">暴露的误区</div>
                <ul className="list-inside list-disc">
                  {result.aiEvaluation.misconceptions.map((m) => (
                    <li key={m.id}>
                      <code className="text-xs">{m.id}</code> — {m.note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-3">
              <span className="font-medium">逐步图解</span>
              {!visual && (
                <button
                  type="button"
                  onClick={onVisualExplain}
                  disabled={visualPending}
                  className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  {visualPending ? "生成中…" : "生成可视化讲解"}
                </button>
              )}
            </div>
            {visualErr && (
              <p className="text-xs text-red-600">
                生成失败：{visualErr}（可点击按钮重试）
              </p>
            )}
            {visual && (
              <FrameStepper code={question.code} title={visual.title} frames={visual.frames} />
            )}
          </div>

          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">写入图谱的证据（{result.evidence.length} 条）</span>
            <ul className="flex flex-col gap-1">
              {result.evidence.map((e, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span>{OUTCOME_LABEL[e.outcome] ?? e.outcome}</span>
                  <span className="text-zinc-500">
                    {DIMENSION_LABEL[e.dimension] ?? e.dimension} · {e.source === "compiler" ? "编译器" : "AI"}
                    {e.misconceptionId ? ` · ${e.misconceptionId}` : ""}
                  </span>
                  {e.note && <span className="text-zinc-400">{e.note}</span>}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <span className="text-sm font-medium">继续追问导师</span>
            {chatLog.length > 0 && (
              <div className="flex flex-col gap-3">
                {chatLog.map((m, i) =>
                  m.role === "user" ? (
                    <div
                      key={i}
                      className="self-end rounded-2xl rounded-br-sm bg-zinc-900 px-4 py-2 text-sm text-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      {m.content}
                    </div>
                  ) : (
                    <div
                      key={i}
                      className="self-start rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-2 text-sm dark:bg-zinc-800"
                    >
                      <Markdown>{m.content}</Markdown>
                    </div>
                  ),
                )}
                {chatPending && (
                  <div className="self-start text-sm text-zinc-400">导师思考中…</div>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) onSendChat();
                }}
                placeholder="对这道题还有疑问？直接问导师…"
                className="flex-1 rounded-full border border-zinc-300 bg-transparent px-4 py-2 text-sm dark:border-zinc-700"
              />
              <button
                type="button"
                onClick={onSendChat}
                disabled={chatPending || chatInput.trim().length === 0}
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                发送
              </button>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Link
              href="/practice"
              className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-80"
            >
              下一题（按图谱自适应选题）
            </Link>
            <Link
              href="/graph"
              className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              查看能力图谱
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

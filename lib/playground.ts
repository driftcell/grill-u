import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { runnerResults } from "@/lib/db/schema";

export type PlaygroundAction = "execute" | "compile";

export interface PlaygroundResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitDetail: string | null;
}

/**
 * 对 /execute 原始结果的语义解读。
 * 依据实测的 Playground 行为：
 * - 编译失败：stderr 只有 cargo 编译输出和 error[Exxxx]，没有 "Finished" 行
 * - 编译成功但运行时 panic：stderr 有 "Finished"/"Running" 行 + "panicked"
 * - 编译并运行成功：success=true
 */
export interface RunOutcome {
  /** 编译是否通过 */
  compiled: boolean;
  /** 是否成功运行到结束（exit 0） */
  ran: boolean;
  /** 运行时是否发生 panic */
  panicked: boolean;
  result: PlaygroundResult;
}

export function interpret(result: PlaygroundResult): RunOutcome {
  return {
    compiled: result.stderr.includes("Finished"),
    ran: result.success,
    panicked: result.stderr.includes("panicked"),
    result,
  };
}

export interface PlaygroundOptions {
  action?: PlaygroundAction;
  edition?: string;
  channel?: string;
}

const PLAYGROUND_BASE = "https://play.rust-lang.org";

/** 直接调用 Rust Playground 在线服务（无缓存） */
export async function runOnPlayground(
  code: string,
  opts: PlaygroundOptions = {},
): Promise<PlaygroundResult> {
  const action = opts.action ?? "execute";
  const res = await fetch(`${PLAYGROUND_BASE}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: opts.channel ?? "stable",
      mode: "debug",
      edition: opts.edition ?? "2021",
      crateType: "bin",
      tests: false,
      code,
    }),
  });
  if (!res.ok) {
    throw new Error(`Playground /${action} request failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    success?: boolean;
    stdout?: string;
    stderr?: string;
    exitDetail?: string;
  };
  return {
    success: data.success === true,
    stdout: data.stdout ?? "",
    stderr: data.stderr ?? "",
    exitDetail: data.exitDetail ?? null,
  };
}

function hashOf(code: string, action: PlaygroundAction, edition: string, channel: string) {
  return createHash("sha256").update([action, code, edition, channel].join("\0")).digest("hex");
}

export interface CachedRun {
  result: PlaygroundResult;
  runnerResultId: string;
  fromCache: boolean;
}

/**
 * 带 runner_results 缓存的 Playground 调用：
 * 同一份 (action, code, edition, channel) 只真正执行一次。
 */
export async function runOnPlaygroundCached(
  code: string,
  opts: PlaygroundOptions = {},
): Promise<CachedRun> {
  const action = opts.action ?? "execute";
  const edition = opts.edition ?? "2021";
  const channel = opts.channel ?? "stable";
  const codeHash = hashOf(code, action, edition, channel);

  const [cached] = await db
    .select()
    .from(runnerResults)
    .where(eq(runnerResults.codeHash, codeHash))
    .limit(1);
  if (cached) {
    return {
      result: {
        success: cached.success,
        stdout: cached.stdout,
        stderr: cached.stderr,
        exitDetail: cached.exitDetail,
      },
      runnerResultId: cached.id,
      fromCache: true,
    };
  }

  const result = await runOnPlayground(code, { action, edition, channel });
  const [inserted] = await db
    .insert(runnerResults)
    .values({
      codeHash,
      action,
      code,
      edition,
      channel,
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      exitDetail: result.exitDetail,
    })
    .onConflictDoNothing({ target: runnerResults.codeHash })
    .returning({ id: runnerResults.id });

  // 并发下可能插入冲突，此时回查已有行
  const runnerResultId =
    inserted?.id ??
    (
      await db
        .select({ id: runnerResults.id })
        .from(runnerResults)
        .where(eq(runnerResults.codeHash, codeHash))
        .limit(1)
    )[0].id;

  return { result, runnerResultId, fromCache: false };
}

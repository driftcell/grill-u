import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-10 px-6 py-24">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Grill-U Rust</h1>
        <p className="max-w-xl text-zinc-600 dark:text-zinc-400">
          编译器客观验证 + AI 教学反馈 + 技能图谱驱动的 Rust 自适应练习。
          你的能力直接反映在知识图谱上，而不是一个分数。
        </p>
      </div>
      <div className="flex gap-4">
        <Link
          href="/practice"
          className="rounded-full bg-foreground px-6 py-3 font-medium text-background transition-opacity hover:opacity-80"
        >
          开始练习
        </Link>
        <Link
          href="/graph"
          className="rounded-full border border-zinc-300 px-6 py-3 font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          能力图谱
        </Link>
      </div>
    </div>
  );
}

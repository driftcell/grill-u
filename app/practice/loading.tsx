export default function PracticeLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div className="flex items-center gap-3 text-sm text-zinc-500">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
        AI 正在根据你的能力图谱出题，并提交 Rust Playground 验证…（通常需要 30-60 秒）
      </div>
      <div className="h-40 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-24 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}

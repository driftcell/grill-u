export default function GraphLoading() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-10">
      <div className="flex items-center gap-3 text-sm text-zinc-500">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
        正在从证据投影能力图谱…
      </div>
      <div className="h-16 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-48 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-48 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}

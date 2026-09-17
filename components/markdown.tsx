import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * 轻量 Markdown 渲染（解析、AI 评价、导师回复）。
 * 无 typography 插件，逐元素映射 Tailwind 类，保持与页面风格一致。
 */
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 underline dark:text-blue-400">
            {children}
          </a>
        ),
        code: ({ className, children }) =>
          className ? (
            <code className="font-mono text-[0.85em]">{children}</code>
          ) : (
            <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800">
              {children}
            </code>
          ),
        pre: ({ children }) => (
          <pre className="my-2 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs leading-5 text-zinc-100">
            {children}
          </pre>
        ),
        ul: ({ children }) => <ul className="my-1.5 list-inside list-disc space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="my-1.5 list-inside list-decimal space-y-0.5">{children}</ol>,
        blockquote: ({ children }) => (
          <blockquote className="my-1.5 border-l-2 border-zinc-300 pl-3 text-zinc-500 dark:border-zinc-700">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table className="w-full border-collapse text-[0.9em]">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-zinc-300 bg-zinc-100 px-2 py-1 text-left font-medium dark:border-zinc-700 dark:bg-zinc-800">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-zinc-300 px-2 py-1 align-top dark:border-zinc-700">{children}</td>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

"use client";

import { useEffect, useState } from "react";

/**
 * 逐步图解渲染器：吃 AI 抽取的结构化帧，确定性地渲染
 * "代码行高亮 + 绑定状态卡片 + 事件旁白"的步进动画。
 */

export interface StepBinding {
  name: string;
  status: "alive" | "moved" | "dropped" | "borrowed";
  value?: string;
  detail?: string;
}

export interface StepFrame {
  line: number;
  bindings: StepBinding[];
  events: string[];
  note?: string;
}

const STATUS_STYLE: Record<StepBinding["status"], { card: string; label: string; labelCls: string }> = {
  alive: {
    card: "border-green-500/50 bg-green-50 dark:bg-green-950/30",
    label: "存活",
    labelCls: "text-green-600 dark:text-green-400",
  },
  moved: {
    card: "border-zinc-300 bg-zinc-50 opacity-60 dark:border-zinc-700 dark:bg-zinc-900",
    label: "已移动",
    labelCls: "text-zinc-400",
  },
  dropped: {
    card: "border-dashed border-zinc-300 opacity-45 dark:border-zinc-700",
    label: "已释放",
    labelCls: "text-zinc-400",
  },
  borrowed: {
    card: "border-amber-500/50 bg-amber-50 dark:bg-amber-950/30",
    label: "被借用",
    labelCls: "text-amber-600 dark:text-amber-400",
  },
};

export function FrameStepper({
  code,
  title,
  frames,
}: {
  code: string;
  title: string;
  frames: StepFrame[];
}) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frame = frames[Math.min(idx, frames.length - 1)];
  const codeLines = code.split("\n");

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      if (idx >= frames.length - 1) {
        setPlaying(false);
      } else {
        setIdx(idx + 1);
      }
    }, 1800);
    return () => clearTimeout(t);
  }, [playing, idx, frames.length]);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-zinc-400">
          第 {idx + 1} / {frames.length} 帧
        </span>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row">
        {/* 代码：焦点行高亮 */}
        <pre className="flex-1 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs leading-5 text-zinc-100">
          {codeLines.map((line, i) => {
            const n = i + 1;
            const active = n === frame.line;
            return (
              <div
                key={i}
                className={
                  active
                    ? "-mx-3 border-l-2 border-amber-400 bg-amber-400/15 pl-[10px] pr-3 transition-colors duration-300"
                    : "-mx-3 border-l-2 border-transparent px-3"
                }
              >
                <span
                  className={`mr-3 inline-block w-5 select-none text-right ${
                    active ? "font-bold text-amber-300" : "text-zinc-600"
                  }`}
                >
                  {n}
                </span>
                <code>{line}</code>
              </div>
            );
          })}
        </pre>

        {/* 绑定状态卡片：按名字 reconcile，状态变化有过渡动画 */}
        <div className="flex w-full flex-col gap-2 lg:w-52">
          {frame.bindings.map((b) => {
            const s = STATUS_STYLE[b.status] ?? STATUS_STYLE.alive;
            return (
              <div
                key={b.name}
                className={`rounded-lg border px-3 py-2 transition-all duration-500 ${s.card}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <code className="text-sm font-semibold">{b.name}</code>
                  <span className={`text-[10px] ${s.labelCls}`}>{s.label}</span>
                </div>
                {b.value && (
                  <div className="mt-0.5 font-mono text-[11px] text-zinc-500">{b.value}</div>
                )}
                {b.detail && <div className="mt-0.5 text-[11px]">{b.detail}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* 事件旁白 */}
      <ul className="flex flex-col gap-1 text-sm">
        {frame.events.map((e, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-amber-500">▸</span>
            <span>{e}</span>
          </li>
        ))}
      </ul>
      {frame.note && <p className="text-xs text-zinc-500">{frame.note}</p>}

      {/* 控制条 */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setIdx((i) => Math.max(0, i - 1));
          }}
          disabled={idx === 0}
          className="rounded-full border border-zinc-300 px-3 py-1 text-xs disabled:opacity-30 dark:border-zinc-700"
        >
          ← 上一步
        </button>
        <div className="flex flex-1 items-center justify-center gap-1.5">
          {frames.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setPlaying(false);
                setIdx(i);
              }}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === idx ? "w-5 bg-amber-500" : "w-1.5 bg-zinc-300 dark:bg-zinc-700"
              }`}
              aria-label={`第 ${i + 1} 帧`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            if (playing) {
              setPlaying(false);
            } else {
              if (idx >= frames.length - 1) setIdx(0);
              setPlaying(true);
            }
          }}
          className="rounded-full border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-700"
        >
          {playing ? "暂停" : "播放"}
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setIdx((i) => Math.min(frames.length - 1, i + 1));
          }}
          disabled={idx >= frames.length - 1}
          className="rounded-full border border-zinc-300 px-3 py-1 text-xs disabled:opacity-30 dark:border-zinc-700"
        >
          下一步 →
        </button>
      </div>
    </div>
  );
}

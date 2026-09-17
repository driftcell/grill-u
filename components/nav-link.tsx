"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import type { ReactNode } from "react";

function PendingSpinner() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
    />
  );
}

/**
 * 带内联加载反馈的 Link（Next 16 useLinkStatus）。
 * 注意 prefetch={false}：/practice 页面会真实调用 AI 出题，
 * 预取会白白触发生成；也让 pending 状态不被预取跳过。
 */
export function NavLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} prefetch={false} className={className}>
      <span className="inline-flex items-center gap-2">
        <PendingSpinner />
        {children}
      </span>
    </Link>
  );
}

import type { ReactNode } from "react";
import Link from "next/link";

/**
 * `/guides/*` — how-to guides for staff, readable SIGNED OUT.
 *
 * Public on purpose: the first guide covers setting up an account and signing
 * in, so a person who does not have a login yet has to be able to read it — a
 * redirect to /login would be the one page it could not help with. Shared as a
 * link in Slack, and printed.
 *
 * `/legal`'s shape exactly: outside the (app) group, exempted in `proxy.ts`,
 * static text that reaches NOTHING — no session, no query, no RPC. Keep it that
 * way; a guide that needed data would need a different kind of page.
 */
export default function GuidesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white print:bg-white">
      <header className="bg-ink px-6 py-4 text-white print:hidden">
        <Link
          href="/guides"
          className="text-[13px] font-semibold uppercase tracking-[0.12em] text-white hover:underline"
        >
          Donut Friend · Guides
        </Link>
      </header>
      <main className="px-4 pb-16 pt-8 sm:px-6">{children}</main>
    </div>
  );
}

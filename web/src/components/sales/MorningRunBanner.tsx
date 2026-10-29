"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SMALL_BUTTON_CLASS } from "@/components/ui/buttons";
import { runProblems, type SalesRun } from "@/lib/salesRun";

/**
 * THE MORNING RUN, AT THE TOP OF THE SALES SCREEN (Mark, 2026-10-29: "a banner
 * on the daily sales page when there is an issue and how to fix it").
 *
 * Quiet when the run is clean — one line saying when it ran — and a ruled box
 * when it is not: each problem in the run's own words, the fix beneath it, and
 * a link to where the fix is made. The same list the morning email leads with,
 * read from the same row (migration 212), so the two can't disagree. A later
 * clean run clears it; Run Now is that later run on demand.
 *
 * Only the latest REAL run counts: a dry run posts nothing, so it can't clear
 * a problem or raise one.
 */
export function MorningRunBanner({
  run,
  overdue,
  canRun,
  timeZone,
  now,
}: {
  run: SalesRun | null;
  overdue: boolean;
  canRun: boolean;
  timeZone: string;
  /** The server's clock at render, so the stuck test is the same on both sides. */
  now: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runNow() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: fnError } = await supabase.functions.invoke("sales-nightly", { body: {} });
    if (fnError) {
      let message = fnError.message;
      try {
        const parsed = await (fnError as { context?: Response }).context?.json();
        if (parsed?.error) message = parsed.error;
      } catch {
        /* keep the SDK's message */
      }
      setError(message);
    }
    setBusy(false);
    router.refresh();
  }

  const problems = run ? runProblems(run, now) : [];
  const when = run
    ? new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(run.finished_at ?? run.started_at))
    : null;

  const button = canRun ? (
    <button type="button" className={SMALL_BUTTON_CLASS} onClick={runNow} disabled={busy}>
      {busy ? "Running…" : "Run Now"}
    </button>
  ) : null;

  const needsYou = overdue || problems.length > 0;

  if (!needsYou) {
    if (!run) return null;
    const running = run.status === "running";
    return (
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span>
          Morning run · {when} ·{" "}
          {running ? "running now" : run.emailed_to ? "all posted, summary emailed" : "all posted"}
        </span>
        {running ? null : button}
        {error ? <span className="text-accent">{error}</span> : null}
      </p>
    );
  }

  return (
    <section className="max-w-3xl space-y-3 border-2 border-ink p-4" aria-label="Morning sales run">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">
          <span className="bg-mark-fill px-1">
            {overdue && problems.length === 0
              ? "This morning's sales run hasn't happened"
              : `The morning sales run needs you — ${problems.length} ${problems.length === 1 ? "issue" : "issues"}`}
          </span>
          {when && !(overdue && problems.length === 0) ? (
            <span className="ml-2 font-normal text-muted">{when}</span>
          ) : null}
        </h2>
        {button}
      </div>

      {overdue && problems.length === 0 ? (
        <p className="text-sm">
          It runs at 7 AM. Press Run Now to sync and post the last seven days; if it fails, it says
          why here.
        </p>
      ) : (
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {problems.map((p, i) => (
            <li key={i}>
              {p.shop || p.date ? (
                <span className="font-semibold">{[p.shop, p.date].filter(Boolean).join(" · ")} — </span>
              ) : null}
              {p.message}
              <br />
              <span className="text-muted">{p.fix}</span>
              {p.href ? (
                <>
                  {" "}
                  <Link href={p.href} className="text-muted underline hover:text-ink">
                    {p.hrefLabel ?? "Open"}
                  </Link>
                </>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {error ? <p className="text-sm text-accent">{error}</p> : null}
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";

import { SectionHeading } from "@/components/ui/SectionHeading";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";

export type EventLogRow = {
  id: string;
  /** Already formatted by the caller — a date, or a date and time. */
  when: string;
  author: string | null;
  message: string;
  /** A third meta item after the author, e.g. "FileMaker". */
  tag?: string | null;
  /**
   * Written BY THE APP because something changed, rather than typed by a
   * person. Rendered in the muted ink, so the notes people wrote stand out of
   * the run of "Priority changed…" lines around them.
   */
  quiet?: boolean;
};

/**
 * A record's history: newest first, and a way to add an entry to it.
 *
 * The presentational half of the special order's log, shared since the task
 * record grew one (2026-11-23). Each caller owns its own INSERT — the tables
 * differ, and so do their rules (an order's note can be corrected in the
 * database, a task's cannot) — and hands it in as `onAdd`, which resolves to
 * an error message or null.
 *
 * There is never a delete or edit control here: both logs are records of what
 * happened, and neither table has a delete policy.
 */
export function EventLog({
  title = "History",
  rows,
  total,
  canWrite,
  onAdd,
  addLabel = "Add entry",
  inputLabel = "What happened",
  empty,
}: {
  title?: string;
  rows: EventLogRow[];
  /** How many exist, when `rows` is capped. */
  total: number;
  canWrite: boolean;
  onAdd: (text: string) => Promise<string | null>;
  addLabel?: string;
  inputLabel?: string;
  empty: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");

  function add() {
    const text = message.trim();
    if (!text) return;
    setError(null);
    start(async () => {
      const failed = await onAdd(text);
      if (failed) {
        setError(failed);
        return;
      }
      setMessage("");
      setAdding(false);
    });
  }

  return (
    <section className="space-y-3">
      <SectionHeading count={total}>{title}</SectionHeading>

      {canWrite ? (
        adding ? (
          <div className="flex flex-wrap items-end gap-3">
            <TextInput
              value={message}
              onValueChange={setMessage}
              aria-label={inputLabel}
              className="w-full max-w-[42rem]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button type="button" className={BUTTON_CLASS} onClick={add} disabled={pending || !message.trim()}>
              {pending ? "Adding…" : addLabel}
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setMessage(""); }}
              className="text-[13px] text-muted underline underline-offset-2 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className={BUTTON_CLASS} onClick={() => setAdding(true)}>
            {addLabel}
          </button>
        )
      ) : null}

      {error ? <p className="text-[13px] text-accent">{error}</p> : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="max-w-[70ch] space-y-2 text-[14px]">
          {rows.map((e) => (
            <li key={e.id} className="border-b border-hairline pb-2 last:border-0">
              <span className={`block whitespace-pre-wrap ${e.quiet ? "text-muted" : ""}`}>
                {e.message}
              </span>
              <span className="block text-[12px] text-subtle">
                {e.when}
                {e.author ? ` · ${e.author}` : ""}
                {e.tag ? ` · ${e.tag}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Names the cap only when there IS one — "showing 200 of 200" is a
          sentence nobody needs, and one that appears on every record teaches
          you to stop reading it. */}
      {total > rows.length ? (
        <p className="text-[12px] text-muted">
          Showing the most recent {rows.length} of {total}.
        </p>
      ) : null}
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";

export type OrderEventRow = {
  id: string;
  happened_at: string;
  author: string | null;
  message: string;
  source: "filemaker" | "app" | "manual";
};

/**
 * The log — decision 16, and the thing FileMaker got right.
 *
 * FMP kept it as ONE TEXT BLOB per order, `\v`-separated, reverse-chronological
 * and unqueryable. 106,373 entries came across as rows, written by sixty-odd
 * named people over twelve years. `author` is TEXT rather than a user FK
 * because those usernames — `tracit`, `levik`, `df01` — are not app accounts
 * and 56,162 of the entries belong to one person who no longer works here.
 *
 * NEWEST FIRST, which is how FileMaker stored it and how it is read.
 *
 * There is no delete: an entry removed is a thing that happened with no trace,
 * and migration 051 declines to write a delete policy at all. A wrong entry is
 * corrected in place.
 */
export function OrderLog({
  orderId,
  orgId,
  rows,
  total,
  canWrite,
  authorName,
}: {
  orderId: string;
  orgId: string;
  rows: OrderEventRow[];
  total: number;
  canWrite: boolean;
  /** Who is writing — the app user's display name, not a FileMaker username. */
  authorName: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");

  function add() {
    const text = message.trim();
    if (!text) return;
    setError(null);
    start(async () => {
      const { data, error: e } = await supabase
        .from("special_order_events")
        .insert({
          org_id: orgId,
          order_id: orderId,
          message: text,
          author: authorName,
          // `manual` rather than `app`: this one was typed by a person, where
          // `app` means the app wrote it because something happened. Telling
          // them apart is what lets a future screen show only the acts.
          source: "manual",
        })
        .select("id");
      if (e) {
        setError(e.message);
        return;
      }
      if (!data?.length) {
        setError("Nothing was written — the database refused it and said nothing.");
        return;
      }
      setMessage("");
      setAdding(false);
      router.refresh();
    });
  }

  return (
    <section className="space-y-3">
      <SectionHeading count={total}>History</SectionHeading>

      {canWrite ? (
        adding ? (
          <div className="flex flex-wrap items-end gap-3">
            <TextInput
              value={message}
              onValueChange={setMessage}
              placeholder="Called to confirm the pickup time"
              aria-label="What happened"
              className="w-full max-w-[42rem]"
              autoFocus
            />
            <button type="button" className={BUTTON_CLASS} onClick={add} disabled={pending || !message.trim()}>
              {pending ? "Adding…" : "Add entry"}
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
            Add entry
          </button>
        )
      ) : null}

      {error ? <p className="text-[13px] text-accent">{error}</p> : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing has been recorded on this order.</p>
      ) : (
        <ul className="max-w-[70ch] space-y-2 text-[14px]">
          {rows.map((e) => (
            <li key={e.id} className="border-b border-hairline pb-2 last:border-0">
              <span className="block whitespace-pre-wrap">{e.message}</span>
              <span className="block text-[12px] text-subtle">
                {e.happened_at.slice(0, 10)}
                {e.author ? ` · ${e.author}` : ""}
                {e.source === "filemaker" ? " · FileMaker" : ""}
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

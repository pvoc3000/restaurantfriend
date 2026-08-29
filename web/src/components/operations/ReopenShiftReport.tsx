"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/lib/confirm";
import { DANGER_BUTTON_CLASS } from "@/components/ui/buttons";

/**
 * Take a sent report back.
 *
 * Mark asked for this within an hour of the first real send, which is a fair
 * measure of how badly it was missing: 070 made a sent report a document and
 * left no way back, so the first time anybody wanted one it had to be done by
 * hand against the database.
 *
 * DANGEROUS-LOOKING ON PURPOSE, even though it is recoverable — a reader cannot
 * tell "opens a confirm" from "destroys" by looking, which is why every
 * destructive command in this app is red before it is pressed. What it actually
 * does is undo the flush: the ratings it wrote onto people's records and the
 * counts it poured onto the schedule.
 *
 * The confirm names the blast radius in ROWS rather than in prose, because the
 * number is the thing somebody needs in order to decide — and it names the one
 * consequence that is NOT undoable: sending again emails the team again.
 */
export function ReopenShiftReport({
  reportId,
  ratingCount,
  countCount,
  emailed,
}: {
  reportId: string;
  ratingCount: number;
  countCount: number;
  emailed: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [failed, setFailed] = useState<string | null>(null);
  const [kept, setKept] = useState<string[] | null>(null);
  const [, startTransition] = useTransition();

  async function reopen() {
    const parts: string[] = [];
    if (ratingCount > 0) {
      parts.push(
        `${ratingCount} staff ${ratingCount === 1 ? "rating comes" : "ratings come"} off ${
          ratingCount === 1 ? "that person's" : "those people's"
        } record`
      );
    }
    if (countCount > 0) {
      parts.push(
        `${countCount} ${countCount === 1 ? "count comes" : "counts come"} off the schedule`
      );
    }

    // TITLE AND BODY EXPLICITLY, not through `splitConfirmMessage` — that helper
    // splits on a BLANK LINE, so a one-paragraph message becomes all title and
    // the panel renders a wall of uppercase over an empty body. It is for
    // callers that already hold a two-paragraph string; this one composes.
    const ok = await confirmDialog({
      title: "Reopen this report?",
      body: [
        parts.length > 0
          ? `${parts.join(", and ")}.`
          : "Nothing was written to anybody's record, so there is nothing to take back.",
        "Everything you typed stays on the report itself, ready to walk again.",
        emailed
          ? "The team has already been emailed, and sending again will email them again."
          : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      confirmLabel: "Reopen",
      tone: "danger",
    });
    if (!ok) return;

    startTransition(async () => {
      const { data, error } = await supabase.rpc("reopen_shift_report", {
        p_report_id: reportId,
      });
      if (error) {
        setFailed(
          /reopen_shift_report/.test(error.message)
            ? "reopen_shift_report does not exist — migration 072 has not been applied yet."
            : error.message
        );
        return;
      }
      setFailed(null);
      // Anything it REFUSED to undo — a line somebody has recounted since, a
      // premium inside a closed pay period. Shown rather than swallowed: the
      // report is a draft either way, and this is the part the person cannot
      // see for themselves.
      const receipt = data as { kept?: { reason?: string; item?: string; employee?: string }[] };
      const notes = (receipt?.kept ?? []).map(
        (k) => `${k.item ?? k.employee ?? "One row"}: ${k.reason ?? "left alone"}`
      );
      setKept(notes.length > 0 ? notes : null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <button type="button" className={DANGER_BUTTON_CLASS} onClick={() => void reopen()}>
        Reopen
      </button>
      {failed ? <p className="text-sm text-accent">{failed}</p> : null}
      {kept ? (
        <ul className="space-y-1 text-sm">
          {kept.map((k) => (
            <li key={k}>
              <span className="bg-mark-fill px-1">{k}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

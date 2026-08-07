"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { RowMenu } from "@/components/ui/RowMenu";
import { TabPicker } from "@/components/ui/TabPicker";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_DANGER_CLASS } from "@/components/ui/Dialog";
import {
  AD_HOC_EVENT_KINDS,
  EVENT_KIND_LABEL,
  EVENT_KIND_OPTIONS,
  SHIFT_SLOT_LABEL,
  isDisciplinary,
  type EventKind,
  type ShiftSlot,
} from "@/lib/employeeEvents";

export type EmployeeEventRow = {
  id: string;
  occurred_on: string;
  kind: EventKind;
  score: number | null;
  shift: ShiftSlot | null;
  position: string | null;
  headline: string | null;
  detail: string | null;
  outcome: string | null;
  /** Resolved on the server: the linked employee's name, or FMP's own string. */
  author: string | null;
  locationCode: string | null;
};

type Tier = "narrative" | "shifts" | "all";

/**
 * Everything that has happened with this person (migration 035).
 *
 * IT OPENS ON "NOTES & WARNINGS", and that default is the whole reason this
 * block is readable. A long-serving person carries ~1,000 shift ratings and a
 * dozen warnings; one flat list buries the thing you came for — the write-up you
 * are looking up before a review — under the thing that happens every day. The
 * tiers are the same shape as the order guide's: a filter, not a mode.
 *
 * Kind renders as PLAIN TEXT and never a coloured chip. Colour means record
 * STATE in this design system, and a written warning is a record TYPE. The
 * temptation to tint the disciplinary ones red is strong and is refused; what
 * they get instead is weight.
 */
export function EmployeeEvents({
  rows,
  shiftTotal,
  editable,
}: {
  /** Every narrative event, plus the most recent page of shift ratings. */
  rows: EmployeeEventRow[];
  /** How many shift ratings exist, which may exceed how many are here. */
  shiftTotal: number;
  editable: boolean;
}) {
  const [tier, setTier] = useState<Tier>("narrative");

  const counts = useMemo(() => {
    const shifts = rows.filter((r) => r.kind === "shift").length;
    return { narrative: rows.length - shifts, shifts, all: rows.length };
  }, [rows]);

  // Only the shift ratings are capped, so only their tiers can be short. Saying
  // "showing 500 of 1,590" while Notes & warnings is complete would be a false
  // warning on the tier that matters most.
  const capped = shiftTotal > counts.shifts && tier !== "narrative";

  const shown = useMemo(() => {
    if (tier === "all") return rows;
    if (tier === "shifts") return rows.filter((r) => r.kind === "shift");
    return rows.filter((r) => r.kind !== "shift");
  }, [rows, tier]);

  const columns: DataColumn<EmployeeEventRow>[] = [
    {
      key: "date",
      label: "Date",
      width: 120,
      sortValue: (r) => r.occurred_on,
      render: (r) =>
        editable ? (
          <InlineValue table="employee_events" id={r.id} column="occurred_on" kind="date" value={r.occurred_on} nullable={false} />
        ) : (
          <span className={READ_ONLY_VALUE}>{r.occurred_on}</span>
        ),
    },
    {
      key: "kind",
      label: "Kind",
      width: 150,
      sortValue: (r) => EVENT_KIND_LABEL[r.kind] ?? r.kind,
      render: (r) => {
        // A `shift` or `document_note` row shows its label and offers no picker.
        // PickList has no `allowNew` here, so choosing away from a value outside
        // AD_HOC_EVENT_KINDS could never choose back — the asymmetry that hid
        // PACKAGE_DESC_OPTIONS' missing GAL and QT for four days. Better to say
        // "not editable" than to offer a one-way door.
        const changeable = editable && (AD_HOC_EVENT_KINDS as string[]).includes(r.kind);
        const label = EVENT_KIND_LABEL[r.kind] ?? r.kind;
        if (!changeable) {
          return (
            <span className={`${READ_ONLY_VALUE} ${isDisciplinary(r.kind) ? "font-semibold" : ""}`}>{label}</span>
          );
        }
        return (
          <InlineValue
            table="employee_events"
            id={r.id}
            column="kind"
            kind="pick"
            value={r.kind}
            nullable={false}
            options={EVENT_KIND_OPTIONS.filter((o) => (AD_HOC_EVENT_KINDS as string[]).includes(o.value))}
          />
        );
      },
    },
    {
      key: "where",
      label: "Where",
      width: 80,
      hideWhenCompact: true,
      sortValue: (r) => r.locationCode ?? "",
      render: (r) => <span className={READ_ONLY_VALUE}>{r.locationCode ?? "—"}</span>,
    },
    {
      key: "shift",
      label: "Shift",
      width: 100,
      hideWhenCompact: true,
      sortValue: (r) => (r.shift ? SHIFT_SLOT_LABEL[r.shift] : ""),
      render: (r) => (
        <span className={READ_ONLY_VALUE}>
          {r.shift ? SHIFT_SLOT_LABEL[r.shift] : "—"}
          {r.position ? <span className="ml-2 text-[12px] text-muted">{r.position}</span> : null}
        </span>
      ),
    },
    {
      key: "score",
      label: "Score",
      width: 70,
      align: "right",
      sortValue: (r) => r.score ?? -1,
      render: (r) => <span className={READ_ONLY_VALUE}>{r.score === null ? "—" : r.score.toFixed(2)}</span>,
    },
    {
      key: "note",
      label: "Note",
      width: 460,
      pinned: true,
      sortValue: (r) => r.headline ?? "",
      render: (r) =>
        editable ? (
          <InlineValue table="employee_events" id={r.id} column="headline" value={r.headline} />
        ) : (
          <span className={READ_ONLY_VALUE}>{r.headline ?? "—"}</span>
        ),
    },
    {
      key: "author",
      label: "By",
      width: 140,
      hideWhenCompact: true,
      sortValue: (r) => r.author ?? "",
      render: (r) => <span className={READ_ONLY_VALUE}>{r.author ?? "—"}</span>,
    },
    ...(editable
      ? [
          {
            key: "menu",
            label: "",
            width: 60,
            render: (r: EmployeeEventRow) => <RemoveEvent row={r} />,
          } as DataColumn<EmployeeEventRow>,
        ]
      : []),
  ];

  return (
    <DataTable
      rows={shown}
      columns={columns}
      rowKey={(r) => r.id}
      storageKey="rf.employeeEvents.v1"
      defaultSort={{ key: "date", dir: "desc" }}
      columnChooser
      compactBelow={1100}
      scroll
      group={{ sortKey: "date", label: (r) => r.occurred_on.slice(0, 4) }}
      expand={{
        canExpand: (r) => Boolean(r.detail || r.outcome),
        render: (r) => (
          <div className="space-y-2 px-4 py-3 text-sm">
            {r.detail ? <p className="max-w-[90ch] whitespace-pre-line">{r.detail}</p> : null}
            {r.outcome ? (
              <p className="text-muted">
                <span className="text-[11px] uppercase tracking-[0.12em] text-subtle">Action taken</span>{" "}
                {editable ? (
                  <InlineValue table="employee_events" id={r.id} column="outcome" value={r.outcome} />
                ) : (
                  r.outcome
                )}
              </p>
            ) : null}
          </div>
        ),
      }}
      leading={
        <div className="space-y-1.5">
          <TabPicker
            ariaLabel="Which events to show"
            value={tier}
            onChange={setTier}
            options={[
              { key: "narrative", label: "Notes & warnings", count: counts.narrative },
              { key: "shifts", label: "Shifts", count: shiftTotal },
              { key: "all", label: "All", count: counts.narrative + shiftTotal },
            ]}
          />
          {capped ? (
            <p className="text-[12px] text-muted">
              Showing the most recent {counts.shifts.toLocaleString()} of{" "}
              {shiftTotal.toLocaleString()} shift ratings. Every note and warning is here.
            </p>
          ) : null}
        </div>
      }
      empty={
        <p className="text-sm text-muted">
          {tier === "narrative"
            ? "No notes or warnings recorded."
            : tier === "shifts"
              ? "No shift ratings recorded."
              : "No events recorded."}
        </p>
      }
    />
  );
}

function RemoveEvent({ row }: { row: EmployeeEventRow }) {
  const router = useRouter();
  const supabase = createClient();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  function remove() {
    setFailed(null);
    startTransition(async () => {
      // .select() its own result — the `order_guide_entries` lesson. With no
      // matching policy Postgres deletes zero rows and PostgREST returns NO
      // error, so a bare delete reports a cheerful success.
      const { data, error } = await supabase
        .from("employee_events")
        .delete()
        .eq("id", row.id)
        .select("id");
      if (error || (data ?? []).length === 0) {
        setFailed(error?.message ?? "Nothing was removed.");
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  const label = EVENT_KIND_LABEL[row.kind] ?? row.kind;

  return (
    <>
      <RowMenu
        label={`Actions for the ${label.toLowerCase()} on ${row.occurred_on}`}
        items={[{ label: "Remove…", onSelect: () => setConfirming(true) }]}
      />
      {confirming && (
        <Dialog
          title="Remove this event"
          onClose={() => !pending && setConfirming(false)}
          busy={pending}
          footer={
            <>
              <button type="button" onClick={() => setConfirming(false)} disabled={pending} className={DIALOG_CANCEL_CLASS}>
                Cancel
              </button>
              <button type="button" onClick={remove} disabled={pending} className={DIALOG_DANGER_CLASS}>
                {pending ? "Removing…" : "Remove"}
              </button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <p>
              The {label.toLowerCase()} recorded on {row.occurred_on}
              {row.headline ? ` — “${row.headline}”` : ""} will be deleted.
            </p>
            <p className="text-muted">
              This is for a misfile — a note typed onto the wrong person. It is not how you record that
              something was resolved; the record of what happened should outlive the handling of it.
            </p>
            {failed && <p className="text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}

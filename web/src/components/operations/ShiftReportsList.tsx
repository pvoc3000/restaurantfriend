"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { RowMenu } from "@/components/ui/RowMenu";
import { NewShiftReport } from "./NewShiftReport";
import {
  SHIFT_SLOT_LABEL,
  attentionReason,
  missingNights,
  type ShiftSlot,
} from "@/lib/shiftReports";
import { daysBefore } from "@/lib/today";
import type { PickOption } from "@/components/ui/PickList";

export type ShiftReportRow = {
  id: string;
  reportDate: string;
  shift: ShiftSlot;
  status: "draft" | "sent";
  narrative: string | null;
  supervisorName: string | null;
  mine: boolean;
  sentAt: string | null;
  emailedAt: string | null;
  updatedAt: string;
};

type Tier = "attention" | "draft" | "sent" | "all";

/** How far back the missing-night sweep looks. Shorter than the page's own
 *  window, because a gap three weeks old is history rather than a task. */
const GAP_DAYS = 7;

function isoWeekday(date: string): number {
  // Parsed as UTC deliberately: `new Date("2026-08-28")` is UTC midnight, and
  // asking for the LOCAL weekday of that instant moves the answer for everyone
  // west of Greenwich. getUTCDay() is Sunday-0, ISO is Monday-1.
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function ShiftReportsList({
  rows,
  today,
  orgId,
  locationId,
  locationCode,
  openDays,
  takers,
}: {
  rows: ShiftReportRow[];
  today: string;
  orgId: string;
  locationId: string;
  locationCode: string;
  openDays: number[];
  takers: PickOption[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [tier, setTier] = useState<Tier>("attention");
  const [search, setSearch] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /**
   * The nights that produced no report at all.
   *
   * Ends YESTERDAY: today's closing report is not late at 4pm. Only closing
   * shifts are expected — an opening report is a nice-to-have and flagging its
   * absence every morning would be noise on the tier that has to stay quiet to
   * be worth reading.
   */
  const gaps = useMemo(() => {
    if (openDays.length === 0) return [];
    const days: { date: string; isoWeekday: number }[] = [];
    for (let i = 1; i <= GAP_DAYS; i += 1) {
      const date = daysBefore(today, i);
      days.push({ date, isoWeekday: isoWeekday(date) });
    }
    return missingNights({
      reportDates: rows.filter((r) => r.shift === "closing").map((r) => r.reportDate),
      openDays,
      days,
    });
  }, [rows, openDays, today]);

  const withReason = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        reason: attentionReason({
          status: r.status,
          reportDate: r.reportDate,
          emailedAt: r.emailedAt,
          updatedAt: r.updatedAt,
          today,
        }),
      })),
    [rows, today]
  );

  const attentionCount = withReason.filter((r) => r.reason !== null).length + gaps.length;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return withReason
      .filter((r) => {
        if (tier === "attention") return r.reason !== null;
        if (tier === "draft") return r.status === "draft";
        if (tier === "sent") return r.status === "sent";
        return true;
      })
      .filter((r) => {
        if (term === "") return true;
        // The narrative is searchable, which is what makes the archive worth
        // keeping — "when did the walk-in fail?" is a question about prose.
        return (
          (r.narrative ?? "").toLowerCase().includes(term) ||
          (r.supervisorName ?? "").toLowerCase().includes(term) ||
          r.reportDate.includes(term) ||
          SHIFT_SLOT_LABEL[r.shift].toLowerCase().includes(term)
        );
      });
  }, [withReason, tier, search]);

  async function remove(row: ShiftReportRow) {
    const ok = await confirmDialog({
      ...splitConfirmMessage(
        `Delete the ${SHIFT_SLOT_LABEL[row.shift].toLowerCase()} report for ${row.reportDate}? ` +
          (row.status === "sent"
            ? "It has already been sent, so the ratings and counts it wrote stay where they are — only the report goes."
            : "Nothing has been written to the schedule or to anybody's record yet, so this discards the whole draft.")
      ),
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      // `.select()` on a delete: with no matching policy Postgres removes zero
      // rows and PostgREST returns NO error, so a bare delete reports a
      // cheerful success and the row is still there after the refresh.
      const { data, error } = await supabase
        .from("shift_reports")
        .delete()
        .eq("id", row.id)
        .select("id");
      if (error) {
        setFailed(error.message);
        return;
      }
      if (!data || data.length === 0) {
        setFailed(
          "That report could not be deleted — a sent report is a document, and only a manager may remove one."
        );
        return;
      }
      setFailed(null);
      router.refresh();
    });
  }

  const columns: DataColumn<(typeof withReason)[number]>[] = [
    {
      key: "date",
      label: "Date",
      width: 150,
      pinned: true,
      sortValue: (r) => r.reportDate,
      render: (r) => (
        <Link
          href={r.status === "draft" ? `/shift-reports/${r.id}/run` : `/shift-reports/${r.id}`}
          className="underline"
        >
          {r.reportDate}
        </Link>
      ),
    },
    {
      key: "shift",
      label: "Shift",
      width: 120,
      sortValue: (r) => SHIFT_SLOT_LABEL[r.shift],
      render: (r) => SHIFT_SLOT_LABEL[r.shift],
    },
    {
      key: "supervisor",
      label: "Supervisor",
      width: 200,
      sortValue: (r) => r.supervisorName ?? "",
      render: (r) => r.supervisorName ?? <span className="text-faint">—</span>,
    },
    {
      key: "status",
      label: "Status",
      width: 190,
      sortValue: (r) => r.reason ?? r.status,
      render: (r) =>
        r.reason ? (
          // Yellow as a FILL, never as ink — `text-mark` on white is 1.43:1.
          <span className="bg-mark-fill px-1">{r.reason}</span>
        ) : r.status === "sent" ? (
          "Sent"
        ) : (
          "Draft"
        ),
    },
    {
      key: "narrative",
      label: "Report",
      width: 420,
      wrap: true,
      sortValue: (r) => r.narrative ?? "",
      render: (r) =>
        r.narrative ? (
          <span className="line-clamp-2">{r.narrative}</span>
        ) : (
          <span className="text-faint">Nothing written yet</span>
        ),
    },
    {
      key: "menu",
      label: "",
      width: 60,
      render: (r) => (
        <RowMenu
          label={`Commands for the ${r.reportDate} report`}
          items={[
            r.status === "draft"
              ? {
                  label: "Resume…",
                  onSelect: () => router.push(`/shift-reports/${r.id}/run`),
                }
              : { label: "Open", onSelect: () => router.push(`/shift-reports/${r.id}`) },
            { label: "Delete…", danger: true, onSelect: () => void remove(r) },
          ]}
        />
      ),
    },
  ];

  // The nights this shop was open and nobody reported. Held as a value rather
  // than written inline because it renders in TWO places and never both — see
  // where it is used.
  const gapsNote =
    gaps.length > 0 ? (
      <p className="text-sm">
        <span className="bg-mark-fill px-1">
          {gaps.length === 1 ? "One night" : `${gaps.length} nights`} at {locationCode} closed
          with no report
        </span>{" "}
        <span className="text-muted">— {gaps.join(", ")}</span>
      </p>
    ) : null;

  return (
    <div className="space-y-4">
      {/* Beside the title, like `/checklists` and `/equipment`: in a
          `justify-end` row above the filters a create command reads as one
          more filter. `items-start`, so it lines up with the TOP of the
          heading and stays put if the title ever wraps. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Shift Reports
        </h1>
        <NewShiftReport
          orgId={orgId}
          locationId={locationId}
          locationCode={locationCode}
          today={today}
          takers={takers}
          existing={rows.map((r) => ({ date: r.reportDate, shift: r.shift }))}
        />
      </div>

      {failed ? <p className="text-sm text-accent">{failed}</p> : null}

      {/* ONE STATEMENT, IN WHICHEVER PLACE CAN BE SEEN. The missing nights are
          counted on the tab and have no row to show, so with no flagged report
          under it the table's own empty slot is where they belong — a band
          saying "5 nights" over a table saying "nothing needs attention" is the
          screen contradicting itself, and a band plus a sentence pointing AT
          the band is the same fact twice, an inch apart. Above the table only
          when there are rows, because then the empty slot does not exist. */}
      {tier === "attention" && visible.length > 0 ? gapsNote : null}

      <DataTable
        rows={visible}
        columns={columns}
        rowKey={(r) => r.id}
        storageKey="rf.shiftReports.v1"
        defaultSort={{ key: "date", dir: "desc" }}
        compactBelow={1280}
        columnChooser
        empty={
          tier === "attention" ? (
            (gapsNote ?? <p className="text-sm text-muted">Nothing needs attention.</p>)
          ) : (
            <p className="text-sm text-muted">No shift reports here yet.</p>
          )
        }
        leading={
          <div className="flex flex-wrap items-end gap-3">
            <TabPicker
              ariaLabel="Which shift reports"
              value={tier}
              onChange={setTier}
              options={[
                { key: "attention", label: "Needs attention", count: attentionCount },
                { key: "draft", label: "Drafts" },
                { key: "sent", label: "Sent" },
                { key: "all", label: "All" },
              ]}
            />
            <TextInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search the reports…"
              clearLabel="Clear the search"
              className="w-72"
            />
          </div>
        }
      />
    </div>
  );
}

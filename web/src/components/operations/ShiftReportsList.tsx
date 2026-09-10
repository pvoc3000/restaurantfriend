"use client";

import { useMemo, useState, useTransition } from "react";
import { PageHeading } from "@/components/ui/PageHeading";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { PickList } from "@/components/ui/PickList";
import { ControlField } from "@/components/ui/ControlField";
import { TextInput } from "@/components/ui/TextInput";
import { SearchGlyph } from "@/components/ui/SearchGlyph";
import { RowMenu } from "@/components/ui/RowMenu";
import { NewShiftReport } from "./NewShiftReport";
import {
  SHIFT_SLOT_LABEL,
  attentionReason,
  missingNights,
  type ShiftSlot,
} from "@/lib/shiftReports";
import { daysBefore } from "@/lib/today";

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

/**
 * NO "NEEDS ATTENTION" TIER SINCE 2026-09-09 (Mark: "let's get rid of the
 * 'needs attention' tab on the shift report list page. Make 'drafts' the
 * default tab").
 *
 * It was the list's opening view and it was a tier over a QUEUE that is
 * normally empty — which is the wrong shape for the screen you land on. Drafts
 * is what somebody comes here to finish.
 *
 * NEITHER HALF OF WHAT IT COUNTED IS LOST, which is why this is a tab going
 * rather than a feature: the per-row reason still paints the Status cell yellow
 * ("Sent, but not emailed", "Still a draft"), and the missing-night sweep is
 * still a sentence over the table — now on every tier rather than only on the
 * one you had to choose. What goes is a fourth way to filter, and a landing
 * view whose usual answer was "nothing".
 */
type Tier = "draft" | "sent" | "all";

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
  myEmployeeId,
}: {
  rows: ShiftReportRow[];
  today: string;
  orgId: string;
  locationId: string;
  locationCode: string;
  openDays: number[];
  /** The signed-in member's own employee id — migration 080. */
  myEmployeeId: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [tier, setTier] = useState<Tier>("draft");
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

  const draftCount = rows.filter((r) => r.status === "draft").length;
  const sentCount = rows.filter((r) => r.status === "sent").length;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return withReason
      .filter((r) => {
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

  // The nights this shop was open and nobody reported. It has no ROW of its
  // own — there is no report to show — so it is a sentence over the table.
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
      <PageHeading
        title="Shift Reports"
        code={locationCode}
        visible={visible.length}
        total={rows.length}
        noun="shift reports"
        action={
          <NewShiftReport
            orgId={orgId}
            locationId={locationId}
            locationCode={locationCode}
            today={today}
            myEmployeeId={myEmployeeId}
            existing={rows.map((r) => ({
              date: r.reportDate,
              shift: r.shift,
              status: r.status,
            }))}
          />
        }
      />

      {failed ? <p className="text-sm text-accent">{failed}</p> : null}

      <DataTable
        rows={visible}
        columns={columns}
        rowKey={(r) => r.id}
        storageKey="rf.shiftReports.v1"
        defaultSort={{ key: "date", dir: "desc" }}
        compactBelow={1280}
        columnChooser
        empty={
          <p className="text-sm text-muted">
            {tier === "draft"
              ? "No drafts — everything here has been sent."
              : tier === "sent"
                ? "Nothing has been sent yet."
                : "No shift reports here yet."}
          </p>
        }
        leading={
          <div className="space-y-3">
          {/* SEARCH FIRST, then the tiers — the order every other list uses
              (Mark, 2026-09-03). The command is in the title row (2026-09-10). */}
          <div className="flex flex-wrap items-end gap-3">
            <TextInput
              value={search}
              onValueChange={setSearch}
              aria-label="Search the reports"
              clearLabel="Clear the search"
              search
              icon={<SearchGlyph />}
            />
            {/* A captioned PICKLIST rather than tabs (Mark, 2026-09-10), the
                purchasing lists' conversion: counts ride as hints, `fit`
                sizes the trigger to its widest option. */}
            <ControlField label="Show">
              <PickList
                ariaLabel="Which shift reports"
                variant="field"
                value={tier}
                onPick={(next) => setTier(next as typeof tier)}
                options={[
                  { value: "draft", label: "Drafts", hint: String(draftCount) },
                  { value: "sent", label: "Sent", hint: String(sentCount) },
                  { value: "all", label: "All", hint: String(rows.length) },
                ]}
                fit
              />
            </ControlField>
          </div>
          {/* UNDER THE TABS, NOT OVER THEM (Mark, 2026-09-03), and ON EVERY
              TIER since the Needs-attention tab went (2026-09-09).

              It was shown on that one tier because it was half of that tab's
              count, and it explained the half you could not see. With the tab
              gone there is no count to explain — but the FACT is unchanged and
              belongs to the shop's last seven days rather than to any tier, so
              hiding it behind a filter would be the only way left to lose it.
              It has no ROW of its own (there is no report to show), so no
              filter can reach it and none should try. */}
          {gapsNote}
          </div>
        }
      />
    </div>
  );
}

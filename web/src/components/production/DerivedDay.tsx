"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import { DateField } from "@/components/ui/DateField";
import { PickList } from "@/components/ui/PickList";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { packetDate } from "@/lib/productionSchedule";

export type DayRow = {
  itemId: string;
  itemName: string;
  itemType: string | null;
  subtype: string | null;
  finish: string | null;
  size: string | null;
  kitchenCode: string;
  trayNumber: string | null;
  plannedPar: number | null;
  overridePar: number | null;
  par: number;
  parSource: string;
  overrideNote: string | null;
  planCount: number;
  kitchenAssumed: boolean;
  kitchenSplit: boolean;
  isSuppressed: boolean;
  hiddenReason: string | null;
};

export type OverrideItem = { id: string; name: string; detail: string };

type Tier = "making" | "changed" | "not-made" | "all";

/**
 * What generation would write, and where a par override gets typed.
 *
 * A DataTable rather than a matrix: unlike the plan editor's tray × weekday
 * grid, this is one row per item with real columns to sort and group by. The
 * matrix's argument — the columns are DAYS and every cell is a SET — doesn't
 * apply to a single day.
 *
 * ONE NUMBER PER ITEM PER SHOP PER DAY. An override carries no kitchen when the
 * item is already planned, because the plan is what says who makes it; on an
 * item split across two kitchens the override claims the one making the most
 * and the other goes to zero, which the row states rather than hides.
 */
export function DerivedDay({
  orgId,
  locationId,
  locationCode,
  locations,
  date,
  today,
  rows,
  addable,
  committed,
  editable,
}: {
  orgId: string;
  locationId: string;
  locationCode: string;
  locations: { id: string; code: string; name: string }[];
  date: string;
  today: string;
  rows: DayRow[];
  addable: OverrideItem[];
  committed: { id: string; kitchenCode: string }[];
  editable: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [tier, setTier] = useState<Tier>("making");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const counts = useMemo(
    () => ({
      making: rows.filter((r) => r.par > 0).length,
      changed: rows.filter((r) => r.parSource === "override").length,
      notMade: rows.filter((r) => r.par === 0).length,
      all: rows.length,
    }),
    [rows]
  );

  const shown = useMemo(
    () =>
      rows.filter((r) => {
        if (tier === "making") return r.par > 0;
        if (tier === "changed") return r.parSource === "override";
        if (tier === "not-made") return r.par === 0;
        return true;
      }),
    [rows, tier]
  );

  const total = rows.reduce((n, r) => n + r.par, 0);

  function move(next: { date?: string; location?: string }) {
    const q = new URLSearchParams();
    q.set("date", next.date ?? date);
    q.set("location", next.location ?? locationId);
    router.push(`/production-day?${q.toString()}`);
  }

  /** Write, change or clear one item's override for this shop-day. */
  async function setOverride(row: DayRow, par: number | null, note?: string | null) {
    setBusy(row.itemId);
    setError(null);

    if (par === null) {
      const { data, error: err } = await supabase
        .from("production_par_overrides")
        .delete()
        .eq("location_id", locationId)
        .eq("override_date", date)
        .eq("item_id", row.itemId)
        .select("id");
      setBusy(null);
      if (err) return setError(err.message);
      // A delete matching no policy removes zero rows and returns NO error.
      if ((data ?? []).length === 0) {
        return setError("Nothing was cleared — you may not have permission.");
      }
      router.refresh();
      return;
    }

    const { data, error: err } = await supabase
      .from("production_par_overrides")
      .upsert(
        {
          // Explicitly, always — no table defaults org_id, and a WITH CHECK is
          // evaluated before the NOT NULL, so omitting it reports as an RLS
          // violation and sends you looking at roles.
          org_id: orgId,
          location_id: locationId,
          override_date: date,
          item_id: row.itemId,
          par,
          ...(note === undefined ? {} : { note }),
          // Only meaningful for an ADDITION — an item no plan carries, which
          // therefore has no kitchen to inherit. Left null so the derived day
          // falls back to the selling shop and says it assumed.
        },
        { onConflict: "location_id,override_date,item_id" }
      )
      .select("id");

    setBusy(null);
    if (err) return setError(err.message);
    if ((data ?? []).length === 0) {
      return setError("Nothing was saved — you may not have permission.");
    }
    router.refresh();
  }

  const columns: DataColumn<DayRow>[] = [
    {
      key: "item",
      label: "Item",
      width: 250,
      pinned: true,
      wrap: true,
      sortValue: (r) => r.itemName,
      render: (r) => (
        <span className="block">
          <span className={r.par > 0 ? "font-medium" : "text-muted"}>{r.itemName}</span>
          <span className="block text-[12px] text-muted">
            {[r.subtype, r.finish, r.size].filter(Boolean).join(" · ") || "—"}
          </span>
        </span>
      ),
    },
    {
      key: "kitchen",
      label: "Made at",
      width: 110,
      sortValue: (r) => r.kitchenCode,
      render: (r) => (
        <span className={r.kitchenCode === locationCode ? "text-muted" : "font-medium"}>
          {r.kitchenCode}
          {r.kitchenAssumed ? (
            <span className="block text-[11px] text-mark" title="No kitchen on the plan">
              assumed
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "planned",
      label: "Plans say",
      width: 110,
      align: "right",
      sortValue: (r) => r.plannedPar ?? -1,
      render: (r) =>
        r.plannedPar === null ? (
          <span className="text-faint" title="No plan carries this item that day">
            —
          </span>
        ) : (
          <span className="tabular-nums text-muted">
            {r.plannedPar}
            {r.planCount > 1 ? (
              <span
                className="block text-[11px] text-mark"
                title="Carried by more than one active plan; the pars are summed"
              >
                {r.planCount} plans
              </span>
            ) : null}
          </span>
        ),
    },
    {
      key: "par",
      label: "Making",
      width: 90,
      align: "right",
      sortValue: (r) => r.par,
      render: (r) => (
        <span
          className={
            r.par === 0
              ? "tabular-nums text-faint"
              : r.parSource === "override"
                ? "tabular-nums font-medium text-mark"
                : "tabular-nums font-medium"
          }
        >
          {r.par}
        </span>
      ),
    },
    ...(editable
      ? [
          {
            key: "override",
            label: "Override",
            width: 240,
            render: (r: DayRow) => (
              <OverrideCell
                row={r}
                busy={busy === r.itemId}
                onSet={(par) => setOverride(r, par)}
              />
            ),
          } as DataColumn<DayRow>,
        ]
      : []),
    {
      key: "why",
      label: "Why",
      width: 220,
      wrap: true,
      sortValue: (r) => r.hiddenReason ?? r.parSource,
      // Every sentence this column can say is one FMP could not: it named
      // nothing when a par was missing, so a nearly-empty schedule read as the
      // generator being broken.
      render: (r) => {
        if (r.isSuppressed) {
          return (
            <span className="text-mark">
              {r.kitchenSplit
                ? "Override went to the other kitchen"
                : // Since 043 a suppression has two authors, and they get two
                  // sentences. A zero on the PLAN comes through as "making none
                  // today"; an override-zero has its reason nulled by the fold,
                  // so it falls through to the wording it always had — plus the
                  // note, which only an override can carry.
                  r.hiddenReason ??
                  `Suppressed for today${r.overrideNote ? ` — ${r.overrideNote}` : ""}`}
            </span>
          );
        }
        if (r.parSource === "override") {
          return (
            <span className="text-mark">
              {r.plannedPar === null ? "Added for today" : "Override"}
              {r.overrideNote ? ` — ${r.overrideNote}` : ""}
            </span>
          );
        }
        if (r.hiddenReason) return <span className="text-muted">{r.hiddenReason}</span>;
        return <span className="text-faint">—</span>;
      },
    },
    {
      key: "tray",
      label: "Tray",
      width: 80,
      sortValue: (r) => r.trayNumber ?? "",
      hideWhenCompact: true,
      render: (r) => <span className="text-muted">{r.trayNumber ?? "—"}</span>,
    },
  ];

  const group: DataGroup<DayRow> = {
    label: (r) => `${r.kitchenCode === locationCode ? "Made here" : `Made at ${r.kitchenCode}`}`,
    summary: (run) => ({
      par: <span className="tabular-nums">{run.reduce((n, r) => n + r.par, 0)}</span>,
    }),
  };

  const sorted = useMemo(
    () =>
      [...shown].sort(
        (a, b) =>
          a.kitchenCode.localeCompare(b.kitchenCode) ||
          (a.itemType ?? "").localeCompare(b.itemType ?? "") ||
          a.itemName.localeCompare(b.itemName, undefined, { numeric: true })
      ),
    [shown]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          The day
        </h1>
        <Link
          href="/schedules"
          className="inline-flex h-9 items-center border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink no-underline transition-colors hover:bg-ink hover:text-white"
        >
          Schedules
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <div className="space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Shop
          </span>
          <PickList
            variant="field"
            value={locationId}
            onPick={(id) => move({ location: id })}
            options={locations.map((l) => ({ value: l.id, label: l.code, hint: l.name }))}
            ariaLabel="Which shop"
          />
        </div>
        <label className="space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Date
          </span>
          <DateField
            value={date}
            onChange={(next) => next && move({ date: next })}
            required
            ariaLabel="Which day"
          />
        </label>
        <p className="pb-2 text-sm text-muted">
          {packetDate(date)}
          {date === today ? " · today" : ""} — {total.toLocaleString()} to make across{" "}
          {counts.making} {counts.making === 1 ? "item" : "items"}
        </p>
      </div>

      {committed.length > 0 ? (
        // Not a warning: a generated day is the normal state after closing. But
        // it changes what an override MEANS — the document already exists, so a
        // new override only reaches it by regenerating.
        <p className="border border-hairline px-4 py-3 text-sm text-muted">
          This day is already generated for{" "}
          {committed.map((c, i) => (
            <span key={c.id}>
              {i > 0 ? ", " : ""}
              <Link href={`/schedules/${c.id}`} className="underline underline-offset-[3px]">
                {c.kitchenCode}
              </Link>
            </span>
          ))}
          . An override written now reaches that schedule only when you
          regenerate it — or you can change the par on the schedule itself.
        </p>
      ) : null}

      {error ? <p className="text-sm text-accent">{error}</p> : null}

      <DataTable
        rows={sorted}
        columns={columns}
        rowKey={(r) => r.itemId}
        storageKey="production-day"
        compactBelow={1200}
        columnChooser
        group={group}
        empty={
          <p className="text-sm text-muted">
            No active plan covers {locationCode} on {packetDate(date)}, so nothing
            would be generated. Add a par override below to make something anyway.
          </p>
        }
        leading={
          <div className="flex flex-wrap items-end gap-4">
            <TabPicker
              ariaLabel="Which items"
              value={tier}
              onChange={setTier}
              options={[
                { key: "making" as Tier, label: "Making", count: counts.making },
                { key: "changed" as Tier, label: "Overridden", count: counts.changed },
                { key: "not-made" as Tier, label: "Not made", count: counts.notMade },
                { key: "all" as Tier, label: "All", count: counts.all },
              ]}
            />
            {editable ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] hover:bg-ink hover:text-white"
              >
                Add an item…
              </button>
            ) : null}
          </div>
        }
      />

      {adding ? (
        <AddOverride
          items={addable}
          date={date}
          locationCode={locationCode}
          onClose={() => setAdding(false)}
          onAdd={async (itemId, par, note) => {
            await setOverride(
              { itemId } as DayRow,
              par,
              note.trim() ? note.trim() : null
            );
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The override editor for one row.
 *
 * NOTHING PREFILLS. The receiving screen's rule, and for the same reason: a box
 * that fills itself with the planned par would make merely LOOKING at a day
 * indistinguishable from having decided something about it, and `par_source` is
 * the column that has to be able to tell those apart.
 */
function OverrideCell({
  row,
  busy,
  onSet,
}: {
  row: DayRow;
  busy: boolean;
  onSet: (par: number | null) => void;
}) {
  const [draft, setDraft] = useState("");

  if (row.parSource === "override") {
    return (
      <span className="flex items-center gap-2">
        <span className="tabular-nums font-medium">{row.overridePar}</span>
        <button
          type="button"
          onClick={() => onSet(null)}
          disabled={busy}
          className="text-[12px] text-muted underline underline-offset-[3px] hover:text-ink disabled:opacity-35"
        >
          {busy ? "…" : "clear"}
        </button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        step={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="—"
        aria-label={`Override the par for ${row.itemName}`}
        className="h-8 w-16 border border-ink px-2 text-right tabular-nums"
      />
      <button
        type="button"
        onClick={() => {
          const n = Number(draft);
          if (!Number.isFinite(n) || n < 0) return;
          onSet(n);
          setDraft("");
        }}
        disabled={busy || draft.trim() === ""}
        className="h-8 border border-ink bg-white px-2 text-[11px] font-semibold uppercase tracking-[0.06em] hover:bg-ink hover:text-white disabled:opacity-35"
      >
        Set
      </button>
      {/* Zero is an instruction, not an empty box: to a kitchen "don't make it"
          and "make zero of it" are the same sentence. */}
      {row.par > 0 ? (
        <button
          type="button"
          onClick={() => onSet(0)}
          disabled={busy}
          className="text-[12px] text-muted underline underline-offset-[3px] hover:text-ink disabled:opacity-35"
        >
          skip
        </button>
      ) : null}
    </span>
  );
}

function AddOverride({
  items,
  date,
  locationCode,
  onClose,
  onAdd,
}: {
  items: OverrideItem[];
  date: string;
  locationCode: string;
  onClose: () => void;
  onAdd: (itemId: string, par: number, note: string) => Promise<void>;
}) {
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [par, setPar] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    const base = q
      ? items.filter((i) => `${i.name} ${i.detail}`.toLowerCase().includes(q))
      : items;
    return base.slice(0, 60);
  }, [items, term]);

  return (
    <Dialog
      title={`Make something extra on ${packetDate(date)}`}
      onClose={onClose}
      width="max-w-2xl"
      height="h-[80vh]"
      busy={saving}
      toolbar={
        <TextInput
          value={term}
          onValueChange={setTerm}
          placeholder="Search the menu…"
          aria-label="Search items"
          className="w-full"
        />
      }
      footer={
        <>
          <button type="button" onClick={onClose} className={DIALOG_CANCEL_CLASS}>
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !picked || par.trim() === ""}
            onClick={async () => {
              if (!picked) return;
              const n = Number(par);
              if (!Number.isFinite(n) || n < 0) return;
              setSaving(true);
              await onAdd(picked, n, note);
              setSaving(false);
              onClose();
            }}
            className={DIALOG_COMMIT_CLASS}
          >
            {saving ? "Saving…" : "Add to the day"}
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">
        A par override for an item no plan carries at {locationCode} that day. It
        will be made in this shop&rsquo;s own kitchen unless a plan says
        otherwise, and generation picks it up whenever it runs.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <label className="space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            How many
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={par}
            onChange={(e) => setPar(e.target.value)}
            aria-label="How many to make"
            className="h-9 w-24 border border-ink px-2 text-right tabular-nums"
          />
        </label>
        <label className="min-w-[16rem] flex-1 space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Why
          </span>
          <TextInput
            value={note}
            onValueChange={setNote}
            placeholder="July 4, walk-in order…"
            aria-label="Why this override"
            className="w-full"
          />
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted">
          {term ? "Nothing on the menu matches that." : "Every active item is already on this day."}
        </p>
      ) : (
        <ul className="divide-y divide-hairline border border-ink">
          {shown.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => setPicked(i.id)}
                className={`flex w-full items-baseline gap-3 px-4 py-2.5 text-left text-sm ${
                  picked === i.id ? "bg-ink text-white" : "hover:bg-neutral-50"
                }`}
              >
                <span className="font-medium">{i.name}</span>
                <span className={picked === i.id ? "text-white/70" : "text-muted"}>
                  {i.detail}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

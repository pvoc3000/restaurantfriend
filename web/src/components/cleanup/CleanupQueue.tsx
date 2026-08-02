"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { STICKY_HEAD_ROW, useOverflowOnlyWhenNeeded } from "@/lib/tableHead";
import { createClient } from "@/lib/supabase/client";
import { PROBLEM_ORDER, PROBLEM_LABEL, type ProblemKind } from "@/lib/cleanup";
import {
  STALE_ORDER,
  STALE_LABEL,
  type StaleBucket,
} from "@/lib/lastOrdered";
import type { QueueItem } from "@/app/(app)/cleanup/page";
import { Checkbox } from "@/components/ui/Checkbox";
import { TabPicker } from "@/components/ui/TabPicker";
import { FixDrawer } from "./FixDrawer";

type ProblemTab = ProblemKind | "all";
type StaleTab = StaleBucket | "any";

export function CleanupQueue({
  items,
  orgId,
  allLocations,
  activeLocationCode,
}: {
  items: QueueItem[];
  orgId: string;
  allLocations: boolean;
  activeLocationCode: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();

  // Lets the sticky column labels work — see lib/tableHead.
  const paneRef = useRef<HTMLDivElement>(null);
  useOverflowOnlyWhenNeeded(paneRef);

  const [problemTab, setProblemTab] = useState<ProblemTab>("all");
  const [staleTab, setStaleTab] = useState<StaleTab>("any");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState<{ id: string; name: string }[] | null>(
    null
  );

  const problemCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const item of items)
      for (const p of item.problems) c[p] = (c[p] ?? 0) + 1;
    return c;
  }, [items]);

  const staleCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const item of items) c[item.stale] = (c[item.stale] ?? 0) + 1;
    return c;
  }, [items]);

  const visible = useMemo(
    () =>
      items.filter(
        (i) =>
          (problemTab === "all" || i.problems.includes(problemTab)) &&
          (staleTab === "any" || i.stale === staleTab)
      ),
    [items, problemTab, staleTab]
  );

  const selected = selectedId
    ? items.find((i) => i.id === selectedId) ?? null
    : null;
  const selectedResolved = selectedId !== null && selected === null;

  function setScope(all: boolean) {
    router.push(`${pathname}?scope=${all ? "all" : "location"}`);
  }

  const problemTabs: ProblemTab[] = [
    "all",
    ...PROBLEM_ORDER.filter((p) => (problemCounts[p] ?? 0) > 0),
  ];

  // --- bulk select ---
  const visibleIds = visible.map((i) => i.id);
  const allVisibleChecked =
    visibleIds.length > 0 && visibleIds.every((id) => checked.has(id));

  function toggleAllVisible() {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allVisibleChecked) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleOne(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deactivateSelected() {
    const ids = [...checked];
    if (ids.length === 0) return;
    setBulkBusy(true);
    setBulkError(null);

    // Rows being deactivated, with their item id + name (for the follow-up).
    const rows = items.filter((i) => checked.has(i.id));

    const { error } = await supabase
      .from("inventory_item_locations")
      .update({ is_active: false })
      .in("id", ids);
    if (error) {
      setBulkError(error.message);
      setBulkBusy(false);
      return;
    }

    // Which of these items are now inactive at EVERY location? Offer to
    // deactivate the item entirely (brief §B3 follow-up).
    const invIds = [...new Set(rows.map((r) => r.inventory_item_id))];
    const { data: stillActive, error: qErr } = await supabase
      .from("inventory_item_locations")
      .select("inventory_item_id")
      .in("inventory_item_id", invIds)
      .eq("is_active", true);
    if (qErr) {
      // Deactivation already succeeded; just skip the follow-up.
      setBulkError(null);
    }
    const stillActiveSet = new Set(
      (stillActive ?? []).map((r) => r.inventory_item_id)
    );
    const nameByInv = new Map(rows.map((r) => [r.inventory_item_id, r.inventory_items.name]));
    const fullyInactive = invIds
      .filter((id) => !stillActiveSet.has(id))
      .map((id) => ({ id, name: nameByInv.get(id) ?? "item" }));

    setChecked(new Set());
    setBulkBusy(false);
    setFollowUp(fullyInactive.length > 0 ? fullyInactive : null);
    router.refresh();
  }

  async function deactivateItemsEverywhere() {
    if (!followUp) return;
    setBulkBusy(true);
    setBulkError(null);
    const { error } = await supabase
      .from("inventory_items")
      .update({ is_active: false })
      .in(
        "id",
        followUp.map((f) => f.id)
      );
    setBulkBusy(false);
    if (error) {
      setBulkError(error.message);
      return;
    }
    setFollowUp(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">Catalog cleanup</h1>
        <span className="text-sm text-subtle">
          {items.length} {items.length === 1 ? "row needs" : "rows need"} attention
        </span>
        <TabPicker
          ariaLabel="Scope"
          className="ml-auto"
          value={allLocations ? "all" : "location"}
          onChange={(scope) => setScope(scope === "all")}
          options={[
            { key: "location", label: activeLocationCode ?? "This location" },
            { key: "all", label: "All locations" },
          ]}
        />
      </div>

      <p className="text-sm text-subtle">
        Suggested flow: triage stale rows first — select what you no longer order
        and deactivate it — then fix what remains.
      </p>

      {/* Problem filter */}
      <TabPicker
        ariaLabel="Problem"
        value={problemTab}
        onChange={setProblemTab}
        options={problemTabs.map((t) => ({
          key: t,
          label: t === "all" ? "All" : PROBLEM_LABEL[t],
          count: t === "all" ? items.length : problemCounts[t] ?? 0,
        }))}
      />

      {/* Last-ordered (staleness) filter */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs uppercase tracking-[0.12em] text-faint">
          Last ordered
        </span>
        <TabPicker
          ariaLabel="Last ordered"
          value={staleTab}
          onChange={setStaleTab}
          options={(["any", ...STALE_ORDER] as StaleTab[]).map((t) => ({
            key: t,
            label: t === "any" ? "Any age" : STALE_LABEL[t],
            count: t === "any" ? items.length : staleCounts[t] ?? 0,
          }))}
        />
      </div>

      {/* Bulk action bar */}
      {checked.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 border border-ink px-4 py-3 text-sm">
          <span>{checked.size} selected</span>
          <button
            disabled={bulkBusy}
            onClick={deactivateSelected}
            className="h-9 border border-accent bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-35"
          >
            Deactivate selected here
          </button>
          <button
            onClick={() => setChecked(new Set())}
            className="text-muted hover:underline"
          >
            Clear
          </button>
          {bulkError && <span className="text-accent">{bulkError}</span>}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="border border-ink bg-[var(--rf-green-50)] px-3 py-2 text-sm text-ink">
          Nothing here — this queue is clear.
        </p>
      ) : (
        <div ref={paneRef} className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              {/* Labels stay put down the burn-down — see lib/tableHead. */}
              <tr className={`text-left text-muted ${STICKY_HEAD_ROW}`}>
                <th className="w-8 px-2 py-1">
                  <Checkbox
                    checked={allVisibleChecked}
                    onChange={toggleAllVisible}
                    label="select all"
                    size={18}
                  />
                </th>
                <th className="px-2 py-1 font-medium">Item</th>
                <th className="px-2 py-1 font-medium">Loc</th>
                <th className="px-2 py-1 font-medium">Category</th>
                <th className="px-2 py-1 font-medium">Favorites</th>
                <th className="px-2 py-1 font-medium">Last ordered</th>
                <th className="px-2 py-1 font-medium">Problem</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`cursor-pointer border-b border-hairline hover:bg-neutral-50 ${
                    selectedId === item.id ? "bg-neutral-100" : ""
                  }`}
                >
                  <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={checked.has(item.id)}
                      onChange={() => toggleOne(item.id)}
                      label={`select ${item.inventory_items.name}`}
                      size={18}
                    />
                  </td>
                  <td className="px-2 py-1">{item.inventory_items.name}</td>
                  <td className="px-2 py-1 text-muted">{item.location_code}</td>
                  <td className="px-2 py-1 text-muted">
                    {item.inventory_items.category ?? "—"}
                  </td>
                  {/* The sources the guide would actually emit for this row —
                      what the checks now measure. */}
                  <td className="px-2 py-1 text-muted">
                    {item.favorites.length === 0 ? (
                      <span className="text-faint">none</span>
                    ) : (
                      [...new Set(item.favorites.map((f) => f.vendor_name ?? "—"))].join(", ")
                    )}
                  </td>
                  <td className="px-2 py-1 tabular-nums">
                    {item.last_order_date ? (
                      <span className="text-muted">{item.last_order_date}</span>
                    ) : (
                      <span className="text-accent">never</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <span className="flex flex-wrap gap-1">
                      {item.problems.map((p) => (
                        <span
                          key={p}
                          className="border border-ink bg-mark-fill px-1.5 py-0.5 text-xs text-ink"
                        >
                          {PROBLEM_LABEL[p]}
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(selected || selectedResolved) && (
        <FixDrawer
          item={selected}
          orgId={orgId}
          resolved={selectedResolved}
          onClose={() => setSelectedId(null)}
          onChanged={() => router.refresh()}
        />
      )}

      {/* Deactivate-everywhere follow-up (brief §B3) */}
      {followUp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-md space-y-3 border-2 border-ink bg-white p-4">
            <h2 className="text-lg font-semibold">Deactivate items entirely?</h2>
            <p className="text-sm text-muted">
              {followUp.length}{" "}
              {followUp.length === 1 ? "item is" : "items are"} now inactive at
              every location. Deactivate the item{followUp.length === 1 ? "" : "s"}{" "}
              in the catalog too?
            </p>
            <ul className="max-h-40 overflow-y-auto text-sm text-body">
              {followUp.map((f) => (
                <li key={f.id}>• {f.name}</li>
              ))}
            </ul>
            {bulkError && <p className="text-sm text-accent">{bulkError}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setFollowUp(null)}
                className="h-9 border border-ink px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white"
              >
                Leave active
              </button>
              <button
                disabled={bulkBusy}
                onClick={deactivateItemsEverywhere}
                className="h-9 border border-accent bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-35"
              >
                Deactivate {followUp.length === 1 ? "item" : "all"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

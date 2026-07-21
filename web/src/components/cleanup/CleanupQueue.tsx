"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PROBLEM_ORDER, PROBLEM_LABEL, type ProblemKind } from "@/lib/cleanup";
import {
  STALE_ORDER,
  STALE_LABEL,
  type StaleBucket,
} from "@/lib/lastOrdered";
import type { QueueItem } from "@/app/(app)/cleanup/page";
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
      .from("item_locations")
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
      .from("item_locations")
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
        <h1 className="text-xl font-semibold">Catalog cleanup</h1>
        <span className="text-sm text-neutral-500">
          {items.length} {items.length === 1 ? "row needs" : "rows need"} attention
        </span>
        <div className="ml-auto flex items-center gap-1 text-sm">
          <button
            onClick={() => setScope(false)}
            className={`rounded px-2 py-1 ${
              allLocations
                ? "text-neutral-600 hover:bg-neutral-100"
                : "bg-neutral-900 text-white"
            }`}
          >
            {activeLocationCode ?? "This location"}
          </button>
          <button
            onClick={() => setScope(true)}
            className={`rounded px-2 py-1 ${
              allLocations
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            All locations
          </button>
        </div>
      </div>

      <p className="text-sm text-neutral-500">
        Suggested flow: triage stale rows first — select what you no longer order
        and deactivate it — then fix what remains.
      </p>

      {/* Problem filter */}
      <div className="flex flex-wrap gap-2">
        {problemTabs.map((t) => {
          const count = t === "all" ? items.length : problemCounts[t] ?? 0;
          const label = t === "all" ? "All" : PROBLEM_LABEL[t];
          const on = problemTab === t;
          return (
            <button
              key={t}
              onClick={() => setProblemTab(t)}
              className={`rounded-full border px-3 py-1 text-sm ${
                on
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-300 text-neutral-700 hover:bg-neutral-100"
              }`}
            >
              {label}
              <span className={`ml-1.5 ${on ? "text-neutral-300" : "text-neutral-400"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Last-ordered (staleness) filter */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-neutral-400">
          Last ordered
        </span>
        {(["any", ...STALE_ORDER] as StaleTab[]).map((t) => {
          const count = t === "any" ? items.length : staleCounts[t] ?? 0;
          const label = t === "any" ? "Any age" : STALE_LABEL[t];
          const on = staleTab === t;
          return (
            <button
              key={t}
              onClick={() => setStaleTab(t)}
              className={`rounded-full border px-3 py-1 text-sm ${
                on
                  ? "border-amber-700 bg-amber-700 text-white"
                  : "border-neutral-300 text-neutral-700 hover:bg-neutral-100"
              }`}
            >
              {label}
              <span className={`ml-1.5 ${on ? "text-amber-200" : "text-neutral-400"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Bulk action bar */}
      {checked.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm">
          <span>{checked.size} selected</span>
          <button
            disabled={bulkBusy}
            onClick={deactivateSelected}
            className="rounded bg-red-700 px-3 py-1 text-white hover:bg-red-800 disabled:opacity-50"
          >
            Deactivate selected here
          </button>
          <button
            onClick={() => setChecked(new Set())}
            className="text-neutral-600 hover:underline"
          >
            Clear
          </button>
          {bulkError && <span className="text-red-700">{bulkError}</span>}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Nothing here — this queue is clear.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-neutral-600">
                <th className="w-8 px-2 py-1">
                  <input
                    type="checkbox"
                    checked={allVisibleChecked}
                    onChange={toggleAllVisible}
                    aria-label="select all"
                  />
                </th>
                <th className="px-2 py-1 font-medium">Item</th>
                <th className="px-2 py-1 font-medium">Loc</th>
                <th className="px-2 py-1 font-medium">Category</th>
                <th className="px-2 py-1 font-medium">Default vendor</th>
                <th className="px-2 py-1 font-medium">Last ordered</th>
                <th className="px-2 py-1 font-medium">Problem</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`cursor-pointer border-b border-neutral-100 hover:bg-neutral-50 ${
                    selectedId === item.id ? "bg-blue-50" : ""
                  }`}
                >
                  <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checked.has(item.id)}
                      onChange={() => toggleOne(item.id)}
                      aria-label={`select ${item.inventory_items.name}`}
                    />
                  </td>
                  <td className="px-2 py-1">{item.inventory_items.name}</td>
                  <td className="px-2 py-1 text-neutral-600">{item.location_code}</td>
                  <td className="px-2 py-1 text-neutral-600">
                    {item.inventory_items.category ?? "—"}
                  </td>
                  <td className="px-2 py-1 text-neutral-600">
                    {item.vendor_items?.vendors?.name ?? (
                      <span className="text-neutral-400">none</span>
                    )}
                  </td>
                  <td className="px-2 py-1 tabular-nums">
                    {item.last_order_date ? (
                      <span className="text-neutral-600">{item.last_order_date}</span>
                    ) : (
                      <span className="text-amber-700">never</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <span className="flex flex-wrap gap-1">
                      {item.problems.map((p) => (
                        <span
                          key={p}
                          className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md space-y-3 rounded border border-neutral-300 bg-white p-4 shadow-xl">
            <h2 className="text-lg font-semibold">Deactivate items entirely?</h2>
            <p className="text-sm text-neutral-600">
              {followUp.length}{" "}
              {followUp.length === 1 ? "item is" : "items are"} now inactive at
              every location. Deactivate the item{followUp.length === 1 ? "" : "s"}{" "}
              in the catalog too?
            </p>
            <ul className="max-h-40 overflow-y-auto text-sm text-neutral-700">
              {followUp.map((f) => (
                <li key={f.id}>• {f.name}</li>
              ))}
            </ul>
            {bulkError && <p className="text-sm text-red-700">{bulkError}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setFollowUp(null)}
                className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
              >
                Leave active
              </button>
              <button
                disabled={bulkBusy}
                onClick={deactivateItemsEverywhere}
                className="rounded bg-red-700 px-3 py-1 text-sm text-white hover:bg-red-800 disabled:opacity-50"
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

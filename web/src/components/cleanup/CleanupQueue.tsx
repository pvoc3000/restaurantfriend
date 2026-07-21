"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  PROBLEM_ORDER,
  PROBLEM_LABEL,
  type ProblemKind,
} from "@/lib/cleanup";
import type { QueueItem } from "@/app/(app)/cleanup/page";
import { FixDrawer } from "./FixDrawer";

type Tab = ProblemKind | "all";

export function CleanupQueue({
  items,
  allLocations,
  activeLocationCode,
}: {
  items: QueueItem[];
  allLocations: boolean;
  activeLocationCode: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<Tab>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const item of items)
      for (const p of item.problems) c[p] = (c[p] ?? 0) + 1;
    return c;
  }, [items]);

  const visible = useMemo(
    () =>
      tab === "all"
        ? items
        : items.filter((i) => i.problems.includes(tab)),
    [items, tab]
  );

  const selected = selectedId
    ? items.find((i) => i.id === selectedId) ?? null
    : null;
  // The row was in the drawer but is now gone from the queue → it was fixed.
  const selectedResolved = selectedId !== null && selected === null;

  function setScope(all: boolean) {
    router.push(`${pathname}?scope=${all ? "all" : "location"}`);
  }

  const activeTabs: Tab[] = [
    "all",
    ...PROBLEM_ORDER.filter((p) => (counts[p] ?? 0) > 0),
  ];

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

      <div className="flex flex-wrap gap-2">
        {activeTabs.map((t) => {
          const count = t === "all" ? items.length : counts[t] ?? 0;
          const label = t === "all" ? "All" : PROBLEM_LABEL[t];
          const on = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
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

      {visible.length === 0 ? (
        <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Nothing here — this queue is clear.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-neutral-600">
                <th className="px-2 py-1 font-medium">Item</th>
                <th className="px-2 py-1 font-medium">Loc</th>
                <th className="px-2 py-1 font-medium">Category</th>
                <th className="px-2 py-1 font-medium">Default vendor</th>
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
          resolved={selectedResolved}
          onClose={() => setSelectedId(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

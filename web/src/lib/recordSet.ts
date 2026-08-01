"use client";

// FileMaker's book control: first / previous / next / last, on a detail screen
// (Mark, 2026-07-31 — "especially helpful in detail views to go to the next
// record in the list rather than back to the list and then to the next one").
//
// The hard part isn't the buttons, it's WHICH records they walk. FMP's book
// walks the found set — what your search and sort left on screen — and anything
// else would be a lie: sitting on the fifth of eight Chefs' Warehouse orders,
// "next" must mean the sixth of those eight, not the next row of a table you
// aren't looking at.
//
// So the LIST publishes what it is showing, in the order it is showing it, with
// the very hrefs its own rows link to. That means every filter, every sort, the
// search box and the grouping are all accounted for without this module knowing
// that any of them exist — and a list whose filtering is client-side (Inventory
// filters 790 rows in the browser) is handled by exactly the same three lines
// as one that filters in Postgres.
//
// IN MEMORY, deliberately, and for the same reason as `scrollMemory`: the (app)
// layout survives soft navigation, so list → detail → next → next is all one
// page load. A hard load has no found set — nobody has run a search yet — and
// the nav simply doesn't appear, which is honest. Storing it would mean pasting
// a URL on Monday and being told you're "record 4 of 61" of Friday's search.

import { useEffect, useSyncExternalStore } from "react";

/** One record in the set: what it is, and where its detail screen lives —
 *  built by the list, so it carries that list's own breadcrumb stamp. */
export type RecordRef = { id: string; href: string };

export type RecordPosition = {
  /** 1-based, for "4 of 61". */
  index: number;
  total: number;
  first: string | null;
  previous: string | null;
  next: string | null;
  last: string | null;
};

const sets = new Map<string, RecordRef[]>();
const listeners = new Set<() => void>();

function announce() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * Record what a list is showing. Keyed by the list's own pathname, which is
 * what a detail screen can work out from the breadcrumb that led it there.
 */
export function publishRecordSet(key: string, records: RecordRef[]) {
  sets.set(key, records);
  announce();
}

/** Publish from a list, and keep it current as filters narrow it. */
export function usePublishRecordSet(key: string, records: RecordRef[]) {
  // The signature, not the array: `records` is rebuilt on every render, and an
  // effect keyed on its identity would publish (and notify) each time.
  const signature = records.map((r) => r.id).join(",");
  useEffect(() => {
    publishRecordSet(key, records);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, signature]);
}

/**
 * Where `id` sits in the set published under `key` — or null when there is no
 * set (a pasted URL, a reload), when this record isn't in it (you arrived from
 * somewhere else entirely), or when it's the only one.
 */
export function useRecordPosition(key: string | null, id: string): RecordPosition | null {
  const records = useSyncExternalStore(
    subscribe,
    () => (key ? sets.get(key) ?? null : null),
    () => null // The server has never seen a found set.
  );
  if (!records) return null;
  return recordPosition(records, id);
}

/** The pure half, so it can be reasoned about without React. */
export function recordPosition(records: RecordRef[], id: string): RecordPosition | null {
  const at = records.findIndex((r) => r.id === id);
  if (at < 0 || records.length < 2) return null;
  return {
    index: at + 1,
    total: records.length,
    first: at > 0 ? records[0].href : null,
    previous: at > 0 ? records[at - 1].href : null,
    next: at < records.length - 1 ? records[at + 1].href : null,
    last: at < records.length - 1 ? records[records.length - 1].href : null,
  };
}


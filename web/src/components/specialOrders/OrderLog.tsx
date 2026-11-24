"use client";

import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { EventLog } from "@/components/ui/EventLog";

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
 *
 * The list and the add control are `ui/EventLog`, shared with the task record;
 * this keeps only the insert, which is the order's own.
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

  async function add(text: string): Promise<string | null> {
    const { data, error } = await supabase
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
    if (error) return error.message;
    if (!data?.length) return "Nothing was written — the database refused it and said nothing.";
    router.refresh();
    return null;
  }

  return (
    <EventLog
      rows={rows.map((e) => ({
        id: e.id,
        when: e.happened_at.slice(0, 10),
        author: e.author,
        message: e.message,
        tag: e.source === "filemaker" ? "FileMaker" : null,
      }))}
      total={total}
      canWrite={canWrite}
      onAdd={add}
      empty="Nothing has been recorded on this order."
    />
  );
}

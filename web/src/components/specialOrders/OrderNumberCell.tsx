"use client";

import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { createClient } from "@/lib/supabase/client";

/**
 * The order's NUMBER, editable (Mark, 2026-09-16).
 *
 * A client component for `onWrite`, which a server component cannot pass.
 * `number` is TEXT (051 — "2899-01", "5689a" are real) and unique per org, so
 * the write trims, refuses an empty value, and turns the unique violation
 * (23505) into a sentence rather than the raw Postgres text in the cell. It
 * `.select()`s its own result, so a write RLS silently refuses says so.
 */
export function OrderNumberCell({
  id,
  value,
  canWrite,
}: {
  id: string;
  value: string;
  canWrite: boolean;
}) {
  if (!canWrite) return <span className={READ_ONLY_VALUE}>{value}</span>;
  return (
    <InlineValue
      boxed={BOXED_FIELDS}
      table="special_orders"
      id={id}
      column="number"
      value={value}
      nullable={false}
      ariaLabel="Order number"
      onWrite={async (next) => {
        const number = String(next ?? "").trim();
        if (number === "") return { error: "An order needs a number." };
        if (number === value) return { error: null };
        const supabase = createClient();
        const { data, error } = await supabase
          .from("special_orders")
          .update({ number })
          .eq("id", id)
          .select("id");
        if (error) {
          return {
            error:
              error.code === "23505"
                ? `Order ${number} already exists — choose another number.`
                : error.message,
          };
        }
        if (!data?.length) return { error: "That wasn't saved — the database refused it silently." };
        return { error: null };
      }}
    />
  );
}

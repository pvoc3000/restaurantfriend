"use client";

import { createClient } from "@/lib/supabase/client";
import { InlineValue } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";

/**
 * The element's own name, edited where you read it — the plan title's shape
 * (`PlanDetail`), one record over.
 *
 * A CLIENT COMPONENT for a boundary reason, not a styling one: this cell needs
 * `onWrite`, which is a function, and a function cannot be handed across a
 * server component's boundary at all. `ElementDetail` is a server component, so
 * the closure has to live on this side of the line — `BatchVersionCell`'s
 * split, and for the same rule.
 *
 * WHY IT WRITES ITSELF RATHER THAN LETTING `InlineValue` DO IT. 036 puts
 * `unique (org_id, name)` on this table — the name is the identity the BOM
 * groups by, and the transform had to merge three duplicate pairs to satisfy
 * it. So renaming onto an element that already exists is a real, reachable
 * outcome, and a plain update hands back
 *
 *   duplicate key value violates unique constraint
 *   "production_elements_org_id_name_key"
 *
 * which the cell would print verbatim. That is migration 024's lesson: raw
 * Postgres text in a cell, on a field somebody is editing by hand. The sentence
 * already exists in `NewElement`, which meets the same constraint from the
 * other end; this is the same words for the same collision.
 *
 * Renaming is safe for everything downstream because nothing in the app joins
 * elements by NAME at runtime — the costing graph is keyed by id, and a recipe
 * line's `label` is its own column (which is what `metadataLine` matches, so
 * the Expected Yield and Prep time rows are untouched). A renamed element does
 * NOT rename its recipe: `production_recipes.name` is a separate column and the
 * FK between them is by id.
 */
export function ElementNameCell({ id, name }: { id: string; name: string }) {
  const supabase = createClient();

  return (
    <InlineValue
      boxed={BOXED_FIELDS}
      table="production_elements"
      id={id}
      column="name"
      // NOT NULL, so clearing it asks for a value instead of bouncing a
      // null-violation back at you.
      nullable={false}
      value={name}
      ariaLabel="Element name"
      // The browser reset sets `button { text-transform: none }`, so the h1's
      // own `uppercase` does not reach the button inside it.
      className="uppercase"
      onWrite={async (next) => {
        const { data, error } = await supabase
          .from("production_elements")
          .update({ name: String(next) })
          .eq("id", id)
          // An update matching no policy changes nothing and returns NO error,
          // so a bare call reports a cheerful success, `router.refresh()` hands
          // back the old name, and the rename reads as the field being broken
          // rather than as being refused.
          .select("id");

        if (error) {
          return {
            error: /duplicate key|unique/.test(error.message)
              ? `There is already an element called “${String(next)}”.`
              : error.message,
          };
        }
        if (!data?.length) {
          return { error: "Not saved — the database refused it and said nothing." };
        }
        return { error: null };
      }}
    />
  );
}

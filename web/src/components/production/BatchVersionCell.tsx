"use client";

import { InlineValue } from "@/components/catalog/InlineValue";
import type { PickOption } from "@/components/ui/PickList";

/**
 * Which recipe version a batch was run from, with the LABEL snapshotted beside
 * the link.
 *
 * A client component for a boundary reason, not a styling one: the version and
 * its label must be written in ONE statement, which is what `alsoUpdate` is
 * for — and `alsoUpdate` is a FUNCTION, so it cannot be handed across a server
 * component's boundary at all. The record is a server component, so the closure
 * has to live on this side of the line.
 *
 * The snapshot itself is 038's rule one table over: 036 makes `version_label`
 * editable text, so renaming a version must not rewrite what last month's batch
 * says it followed.
 */
export function BatchVersionCell({
  batchId,
  value,
  options,
  boxed = false,
}: {
  batchId: string;
  value: string | null;
  options: PickOption[];
  /** Forwarded, so a record's field block can box this cell like its
   *  neighbours while a list keeps it bare. */
  boxed?: boolean;
}) {
  return (
    <InlineValue
      boxed={boxed}
      table="production_batches"
      id={batchId}
      column="recipe_version_id"
      kind="pick"
      options={options}
      value={value}
      ariaLabel="Which recipe version"
      alsoUpdate={(next) => ({
        recipe_version_label:
          options.find((v) => v.value === next)?.label ?? null,
      })}
    />
  );
}

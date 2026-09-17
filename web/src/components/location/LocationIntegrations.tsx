"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeQbo } from "@/lib/qboClient";
import { InlineValue } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";

/**
 * The shop's two QuickBooks facts and its Square id, on the Operations tab.
 *
 * CLASS AND LOCATION LIVE HERE, NOT IN THE SALES MAPPING GRID (migration 104):
 * they are facts about the SHOP, stamped on every line of its daily sales
 * entry, and the grid is one for the whole org. 083 put the same pair on the
 * vendor's per-shop row for bills; this is the shop itself.
 *
 * The Square location id had no editor anywhere until now — `docs/square-
 * setup.md` said to set it "on the shop's record", and it was set by SQL.
 *
 * The two pickers read `classes` and `departments` ONE AFTER ANOTHER
 * (2026-09-12's token-refresh race), and only when QuickBooks is connected.
 */
export function LocationIntegrations({
  locationId,
  squareLocationId,
  qboClassRef,
  qboLocationRef,
  qboConnected,
  editable,
  schemaError,
}: {
  locationId: string;
  squareLocationId: string | null;
  qboClassRef: string | null;
  qboLocationRef: string | null;
  qboConnected: boolean;
  editable: boolean;
  /** The columns are missing — migration 104 is not applied. */
  schemaError: string | null;
}) {
  const supabase = createClient();
  const [qbo, setQbo] = useState<{
    classes: { id: string; name: string }[];
    departments: { id: string; name: string }[];
    departmentsEnabled: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!qboConnected || schemaError) return;
    let cancelled = false;
    void (async () => {
      const c = await invokeQbo(supabase, { mode: "classes" });
      const d = await invokeQbo(supabase, { mode: "departments" });
      if (cancelled) return;
      const failure = c.message ?? d.message;
      if (failure) setError(failure);
      setQbo({
        classes: (c.data?.classes ?? []) as { id: string; name: string }[],
        departments: (d.data?.departments ?? []) as { id: string; name: string }[],
        departmentsEnabled: d.data?.enabled === true,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [qboConnected, schemaError, supabase]);

  if (schemaError) {
    return (
      <p className="max-w-[72ch] text-sm text-accent">
        The QuickBooks class and location columns are missing — migration 104 has not been applied
        yet. ({schemaError})
      </p>
    );
  }

  function placeholder(list: { id: string }[] | undefined, empty: string, resting: string): string {
    if (!qboConnected) return "QuickBooks is not connected";
    if (!qbo) return "Reading QuickBooks…";
    return list && list.length > 0 ? resting : empty;
  }

  return (
    <div className="space-y-2">
      <dl className="grid max-w-md grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-2 text-sm">
        <dt className="text-subtle">Square location</dt>
        <dd>
          <InlineValue
            boxed={BOXED_FIELDS}
            readOnly={!editable}
            table="locations"
            id={locationId}
            column="square_location_id"
            value={squareLocationId}
            kind="text"
            placeholder="Not on Square"
            ariaLabel="Square location id"
          />
        </dd>

        <dt className="text-subtle">QuickBooks class</dt>
        <dd>
          <InlineValue
            boxed={BOXED_FIELDS}
            readOnly={!editable || !qboConnected}
            table="locations"
            id={locationId}
            column="qbo_class_ref"
            value={qboClassRef}
            kind="pick"
            clearable
            placeholder={placeholder(qbo?.classes, "Class tracking is off in QuickBooks", "None")}
            ariaLabel="QuickBooks class for this shop's daily sales"
            options={(qbo?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))}
            alsoUpdate={(next) => ({
              qbo_class_name: qbo?.classes.find((c) => c.id === next)?.name ?? null,
            })}
          />
        </dd>

        <dt className="text-subtle">QuickBooks location</dt>
        <dd>
          <InlineValue
            boxed={BOXED_FIELDS}
            readOnly={!editable || !qboConnected}
            table="locations"
            id={locationId}
            column="qbo_location_ref"
            value={qboLocationRef}
            kind="pick"
            clearable
            placeholder={
              qbo && !qbo.departmentsEnabled
                ? "Track locations is off in QuickBooks"
                : placeholder(qbo?.departments, "No locations in QuickBooks", "None")
            }
            ariaLabel="QuickBooks location for this shop's daily sales"
            options={(qbo?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))}
            alsoUpdate={(next) => ({
              qbo_location_name: qbo?.departments.find((d) => d.id === next)?.name ?? null,
            })}
          />
        </dd>
      </dl>
      {error ? <p className="max-w-[72ch] text-xs text-accent">{error}</p> : null}
    </div>
  );
}

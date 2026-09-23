"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { InlineValue } from "@/components/catalog/InlineValue";
import { variationOptions, type SquareVariation } from "@/lib/squareCatalog";

type Catalog = { environment: string; variations: SquareVariation[] } | { error: string };

/**
 * ONE REQUEST FOR THE WHOLE SCREEN. Four fields want the same catalog, and
 * four identical calls to Square on every settings visit would be the kind of
 * cost nobody notices until it is slow. Module-level, so it lasts as long as
 * the page does and a reload asks again.
 */
let catalogPromise: Promise<Catalog> | null = null;

function loadCatalog(): Promise<Catalog> {
  catalogPromise ??= (async () => {
    const { data, error } = await createClient().functions.invoke("square-catalog", { body: {} });
    if (error) {
      let message = error.message;
      try {
        const parsed = await (error as { context?: Response }).context?.json();
        if (parsed?.error) message = parsed.error;
      } catch {
        // keep the generic message
      }
      catalogPromise = null; // let the next visit try again
      return { error: message };
    }
    return data as Catalog;
  })();
  return catalogPromise;
}

/**
 * A SQUARE ITEM VARIATION, CHOSEN FROM SQUARE'S OWN CATALOG (Mark,
 * 2026-09-23) rather than pasted from a curl. The options come from
 * `square-catalog`, which lists the catalog of the environment the pay link
 * charges into — so a field for THAT environment is a picker, and a field for
 * the other one stays typed, because its items are in a catalog this token
 * cannot see.
 *
 * A client component for the reason `PercentSetting` is one: the options are
 * fetched in the browser, and the settings screen around it is a server
 * component. While the catalog loads, or if Square cannot be reached, the
 * field is the typed box it always was, and says why.
 */
export function SquareItemSetting({
  orgId,
  path,
  value,
  settings,
  environment,
  label,
}: {
  orgId: string;
  path: string[];
  value: string | null;
  settings: Record<string, unknown>;
  /** Which environment's catalog this field names an item in. */
  environment: "production" | "sandbox";
  label: string;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);

  useEffect(() => {
    let live = true;
    void loadCatalog().then((c) => {
      if (live) setCatalog(c);
    });
    return () => {
      live = false;
    };
  }, []);

  const common = {
    table: "orgs",
    id: orgId,
    column: path[path.length - 1],
    value,
    jsonColumn: "settings",
    jsonPath: path,
    jsonDocument: settings,
    ariaLabel: label,
  };

  const usable = catalog && !("error" in catalog) && catalog.environment === environment;
  if (!usable) {
    return (
      <span className="inline-flex w-full flex-col">
        <InlineValue {...common} />
        {catalog && "error" in catalog ? (
          <span className="text-xs text-subtle">Couldn’t list Square’s items: {catalog.error}</span>
        ) : catalog ? (
          <span className="text-xs text-subtle">
            Square is set to {catalog.environment === "sandbox" ? "Sandbox" : "Production"} — this one is typed.
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <InlineValue
      {...common}
      kind="pick"
      clearable
      placeholder="Choose an item"
      options={variationOptions(catalog.variations, value)}
    />
  );
}

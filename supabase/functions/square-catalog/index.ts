// square-catalog — the Square items a pay-link payment can be sold as, for
// Settings' pickers (Mark, 2026-09-23: "is there a way to grab the item names
// and tokens from square and use a picklist in settings to set it instead?").
//
// Until now the "Special Order" variation id came from a hand-run curl in
// docs/square-payments-setup.md, because Square's dashboard never shows it.
// This lists every ITEM with its VARIATIONS and its category, READ-ONLY.
//
// SIGNED IN, owner or admin — the same people who can edit Settings → General.
// It uses the pay link's own token pair (SQUARE_PAY_ACCESS_TOKEN,
// SQUARE_PAY_ENV), so it lists the catalog of whichever environment the pay
// link charges into, and says which; the picker offers it only for that
// environment's fields.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Pinned with square-pay, square-refund and sync-square-sales. */
const SQUARE_VERSION = "2026-07-15";

const SQUARE_BASE: Record<string, string> = {
  production: "https://connect.squareup.com",
  sandbox: "https://connect.squareupsandbox.com",
};

const MANAGERS = ["owner", "admin"];

type CatalogObject = {
  id: string;
  type: string;
  is_deleted?: boolean;
  category_data?: { name?: string };
  item_data?: {
    name?: string;
    is_archived?: boolean;
    category_id?: string;
    categories?: { id: string }[];
    reporting_category?: { id: string };
    variations?: { id: string; is_deleted?: boolean; item_variation_data?: { name?: string } }[];
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return json(401, { error: "not signed in" });

    const { data: member } = await supabase
      .from("org_members")
      .select("role")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!member || !MANAGERS.includes(member.role)) {
      return json(403, { error: "Only a manager or the owner can read the Square catalog." });
    }

    const squareToken = Deno.env
      .get("SQUARE_PAY_ACCESS_TOKEN")
      // deno-lint-ignore no-control-regex
      ?.replace(/[\u0000-\u001F\u007F]/g, "")
      .trim()
      .replace(/^["']|["']$/g, "");
    const env = (Deno.env.get("SQUARE_PAY_ENV") ?? "production").trim();
    if (!squareToken || !SQUARE_BASE[env]) {
      return json(500, { error: "SQUARE_PAY_ACCESS_TOKEN / SQUARE_PAY_ENV are not set." });
    }

    // Every page: a catalog is a few hundred objects, and a picker missing the
    // one you want because it was on page two is the failure nobody reports.
    const objects: CatalogObject[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const url = new URL(`${SQUARE_BASE[env]}/v2/catalog/list`);
      url.searchParams.set("types", "ITEM,CATEGORY");
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${squareToken}`, "Square-Version": SQUARE_VERSION },
      });
      const body = (await res.json().catch(() => ({}))) as {
        objects?: CatalogObject[];
        cursor?: string;
        errors?: { detail?: string }[];
      };
      if (!res.ok) {
        return json(400, {
          error: `Square refused the catalog request: ${body.errors?.[0]?.detail ?? res.status}`,
        });
      }
      objects.push(...(body.objects ?? []));
      cursor = body.cursor;
      if (!cursor) break;
    }

    const categoryName = new Map(
      objects
        .filter((o) => o.type === "CATEGORY" && !o.is_deleted)
        .map((o) => [o.id, o.category_data?.name ?? ""])
    );

    const variations = objects
      .filter((o) => o.type === "ITEM" && !o.is_deleted && !o.item_data?.is_archived)
      .flatMap((o) => {
        const item = o.item_data ?? {};
        const categoryId =
          item.reporting_category?.id ?? item.categories?.[0]?.id ?? item.category_id ?? null;
        const live = (item.variations ?? []).filter((v) => !v.is_deleted);
        return live.map((v) => ({
          id: v.id,
          item: item.name ?? "",
          variation: v.item_variation_data?.name ?? "",
          variations: live.length,
          category: categoryId ? categoryName.get(categoryId) ?? null : null,
        }));
      })
      .sort((a, b) => a.item.localeCompare(b.item) || a.variation.localeCompare(b.variation));

    return json(200, { environment: env, variations });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});

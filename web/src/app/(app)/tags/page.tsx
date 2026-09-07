import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEditPage } from "@/lib/pageAccess";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import { resolveItemPrice } from "@/lib/productionPrice";
import {
  isoWeekday,
  itemLabel,
  onPlanItemIds,
  planDateParam,
  TAG_BUCKET,
  TAG_SELECT,
  TAG_URL_TTL_SECONDS,
  type DisplayTag,
  type TagSize,
} from "@/lib/displayTags";
import { TagsList, type TagRow } from "@/components/tags/TagsList";
import { NewTag, type TagItemOption } from "@/components/tags/NewTag";

/**
 * Tags — the case signs (095). Org-wide rows; what FOLLOWS the working shop is
 * the price on each one and whether its donut is on that shop's plan.
 */
export default async function TagsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const { date } = await searchParams;
  const session = await getAppSession();
  const supabase = await createClient();
  const active = session.activeLocation;
  if (!active) {
    return <p className="text-sm text-muted">No location is set up for this org yet.</p>;
  }
  const orgId = session.membership.org_id;
  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());
  // The day the picker is set to (default today): which plans are in force,
  // and which weekday's trays, both follow it.
  const day = planDateParam(date, today);

  // Every table here is far under PostgREST's 1,000-row cap (86 tags, ~250
  // images, 307 items, 40 grid cells), so nothing paginates.
  const [
    { data: tags, error },
    { data: images },
    { data: items },
    { data: grid },
    { data: gridOverrides },
    { data: itemOverrides },
    { data: planRows },
  ] = await Promise.all([
    supabase.from("display_tags").select(TAG_SELECT).eq("org_id", orgId).order("title"),
    supabase.from("display_tag_images").select("tag_id, size, storage_path").eq("org_id", orgId),
    supabase
      .from("production_items")
      .select("id, name, size, item_type, subtype, price_class, price_tier, is_active")
      .eq("org_id", orgId)
      .order("name"),
    supabase.from("production_price_grid").select("id, price_class, price_tier, price, class_sort, tier_sort"),
    supabase.from("production_price_grid_locations").select("grid_id, location_id, price"),
    supabase.from("production_item_locations").select("item_id, location_id, price_override"),
    // The plans in force at this shop on that day — dates compare as STRINGS.
    supabase
      .from("v_production_plan_days")
      .select("item_id, weekday, planned_par")
      .eq("location_id", active.id)
      .eq("plan_active", true)
      .lte("starts_on", day)
      .or(`ends_on.is.null,ends_on.gte.${day}`),
  ]);

  if (error) {
    return (
      <p className="max-w-[72ch] text-sm text-accent">
        Could not load the tags: {error.message}
        {/relation .* does not exist|display_tag/.test(error.message) &&
          " — migration 095 has not been applied yet."}
      </p>
    );
  }

  const itemById = new Map((items ?? []).map((i) => [i.id as string, i]));
  const overridesByItem = new Map<string, { item_id: string; location_id: string; price_override: number | null }[]>();
  for (const o of (itemOverrides ?? []) as { item_id: string; location_id: string; price_override: number | null }[]) {
    const list = overridesByItem.get(o.item_id) ?? [];
    list.push(o);
    overridesByItem.set(o.item_id, list);
  }
  const onPlan = onPlanItemIds(
    (planRows ?? []) as { item_id: string; weekday: number; planned_par: number | null }[],
    isoWeekday(day)
  );

  // ONE signing batch for every background on the list, keyed by path (a
  // per-item failure would otherwise shift the zip).
  const paths = (images ?? []).map((i) => i.storage_path as string);
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage.from(TAG_BUCKET).createSignedUrls(paths, TAG_URL_TTL_SECONDS);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }
  const imagesByTag = new Map<string, TagRow["images"]>();
  for (const img of images ?? []) {
    const slots = imagesByTag.get(img.tag_id as string) ?? {};
    slots[img.size as TagSize] = {
      path: img.storage_path as string,
      url: signed.get(img.storage_path as string) ?? null,
    };
    imagesByTag.set(img.tag_id as string, slots);
  }

  const rows: TagRow[] = ((tags ?? []) as unknown as DisplayTag[]).map((t) => {
    const item = t.production_item_id ? itemById.get(t.production_item_id) : undefined;
    const resolved = item
      ? resolveItemPrice(
          item as { price_class: string | null; price_tier: string | null },
          active.id,
          (grid ?? []) as never,
          (gridOverrides ?? []) as never,
          overridesByItem.get(item.id as string) ?? []
        )
      : null;
    return {
      id: t.id,
      title: t.title,
      item_id: t.production_item_id,
      item_name: item ? (item.name as string) : null,
      item_label: item ? itemLabel(item as Parameters<typeof itemLabel>[0]) : null,
      price: resolved?.price ?? null,
      images: imagesByTag.get(t.id) ?? {},
      on_plan: !!t.production_item_id && onPlan.has(t.production_item_id),
      is_active: t.is_active,
    };
  });

  const editable = canEditPage(session.membership.role, "/tags");
  const itemOptions: TagItemOption[] = (items ?? [])
    .filter((i) => i.is_active)
    .map((i) => ({ value: i.id as string, label: itemLabel(i as Parameters<typeof itemLabel>[0]) }));

  return (
    <TagsList
      key={`${active.id}:${day}`}
      rows={rows}
      locationCode={active.code}
      today={today}
      day={day}
      orgId={orgId}
      editable={editable}
      action={editable && <NewTag orgId={orgId} items={itemOptions} />}
    />
  );
}

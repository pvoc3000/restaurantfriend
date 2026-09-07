import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEditPage } from "@/lib/pageAccess";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import type { RawSearchParams } from "@/lib/itemFilters";
import { resolveItemPrice } from "@/lib/productionPrice";
import {
  TAG_BUCKET,
  TAG_SELECT,
  TAG_SIZES,
  TAG_URL_TTL_SECONDS,
  formatTagPrice,
  itemLabel,
  type DisplayTag,
  type TagSize,
} from "@/lib/displayTags";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { InlineValue } from "@/components/catalog/InlineValue";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { TagImageSlot, type SlotImage } from "@/components/tags/TagImageSlot";
import { TagActions } from "@/components/tags/TagActions";

const CRUMB = { href: "/tags", label: "Tags" };

/** CSS pixels per point. At 1 the 2x10 is 720px wide, which a 1280 window's
 *  content column holds; all three sizes share it so they read to scale. */
const PREVIEW_SCALE = 1;

/**
 * One tag: its fields on top, then the three sizes previewed WITH the price
 * this shop would print (Mark, 2026-09-06: "the detail page should feature
 * previews of all three sizes").
 */
export default async function TagPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  const session = await getAppSession();
  const supabase = await createClient();
  const orgId = session.membership.org_id;
  const active = session.activeLocation;
  const editable = canEditPage(session.membership.role, "/tags");

  const [{ data: tag, error }, { data: images }, { data: items }, { data: grid }, { data: gridOverrides }] =
    await Promise.all([
      supabase.from("display_tags").select(TAG_SELECT).eq("id", id).maybeSingle(),
      supabase
        .from("display_tag_images")
        .select("id, size, storage_path, file_name")
        .eq("tag_id", id),
      supabase
        .from("production_items")
        .select("id, name, size, item_type, subtype, price_class, price_tier, is_active")
        .eq("org_id", orgId)
        .order("name"),
      supabase.from("production_price_grid").select("id, price_class, price_tier, price, class_sort, tier_sort"),
      supabase.from("production_price_grid_locations").select("grid_id, location_id, price"),
    ]);
  if (error) return <p className="text-sm text-accent">Could not load this tag: {error.message}</p>;
  if (!tag) notFound();
  const row = tag as unknown as DisplayTag;

  const item = row.production_item_id ? (items ?? []).find((i) => i.id === row.production_item_id) : undefined;
  let price: number | null = null;
  if (item && active) {
    const { data: overrides } = await supabase
      .from("production_item_locations")
      .select("item_id, location_id, price_override")
      .eq("item_id", item.id);
    price = resolveItemPrice(
      item as { price_class: string | null; price_tier: string | null },
      active.id,
      (grid ?? []) as never,
      (gridOverrides ?? []) as never,
      (overrides ?? []) as { item_id: string; location_id: string; price_override: number | null }[]
    ).price;
  }
  const priceText = formatTagPrice(price);

  const paths = (images ?? []).map((i) => i.storage_path as string);
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage.from(TAG_BUCKET).createSignedUrls(paths, TAG_URL_TTL_SECONDS);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }
  const slots: Partial<Record<TagSize, SlotImage>> = {};
  for (const img of images ?? []) {
    slots[img.size as TagSize] = {
      id: img.id as string,
      storage_path: img.storage_path as string,
      url: signed.get(img.storage_path as string) ?? null,
      file_name: (img.file_name as string | null) ?? null,
    };
  }

  const trail = parseTrail(rawParams, CRUMB);
  const itemOptions = (items ?? [])
    .filter((i) => i.is_active || i.id === row.production_item_id)
    .map((i) => ({
      value: i.id as string,
      label: itemLabel(i as Parameters<typeof itemLabel>[0]),
      inactive: !i.is_active,
    }));
  const label = "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted";
  const subtitle = [
    active?.code,
    !row.production_item_id ? "no item linked" : priceText ?? `no price at ${active?.code ?? "this shop"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-12">
      <Breadcrumbs
        trail={trail}
        current={row.title}
        trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
      />

      <div className="flex flex-wrap items-start gap-4">
        <div className="space-y-1">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            {/* The title keeps the underline — the one exception to the boxes. */}
            <InlineValue
              readOnly={!editable}
              table="display_tags"
              id={id}
              column="title"
              value={row.title}
              nullable={false}
              ariaLabel="Title"
              className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]"
            />
          </h1>
          <p className="text-[12px] uppercase tracking-[0.12em] text-subtle">{subtitle}</p>
        </div>
        {editable && (
          <div className="ml-auto">
            <TagActions tagId={id} title={row.title} imagePaths={paths} />
          </div>
        )}
      </div>

      <section className="space-y-4">
        <SectionHeading>Details</SectionHeading>
        <dl className="grid max-w-[min(42rem,max(24rem,50%))] grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-2 text-sm">
          <dt className={label}>Item</dt>
          <dd>
            <InlineValue
              readOnly={!editable}
              table="display_tags"
              id={id}
              column="production_item_id"
              value={row.production_item_id ?? ""}
              kind="pick"
              options={itemOptions}
              clearable
              placeholder="No item"
              boxed={BOXED_FIELDS}
              ariaLabel="Production item"
            />
          </dd>
          <dt className={label}>Active</dt>
          <dd>
            <ActiveToggle table="display_tags" id={id} active={row.is_active} readOnly={!editable} />
          </dd>
          <dt className={`${label} self-start pt-2`}>Description</dt>
          <dd>
            <InlineValue
              readOnly={!editable}
              table="display_tags"
              id={id}
              column="description"
              value={row.description}
              multiline
              rows={4}
              boxed={BOXED_FIELDS}
              ariaLabel="Description"
            />
          </dd>
        </dl>
      </section>

      <div className="space-y-10">
        {TAG_SIZES.map((size) => (
          <TagImageSlot
            key={size}
            orgId={orgId}
            tagId={id}
            size={size}
            image={slots[size] ?? null}
            price={priceText}
            scale={PREVIEW_SCALE}
            editable={editable}
          />
        ))}
      </div>
    </div>
  );
}

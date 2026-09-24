-- ============================================================================
-- 132 — THE INQUIRY FORM'S MENU (special orders 4b, catalog side)
-- ============================================================================
-- Mark, 2026-09-24: the public /inquiry form should let a customer BUILD the
-- order — regular donuts, minis, giant donuts and letters — with prices shown,
-- rather than only describe it. Submitting still makes a LEAD; the quote stays
-- the offer. This migration is everything the page READS. 133 is the write.
--
-- 1. `production_items.public_description` — what a customer is told a flavour
--    is. Separate from `notes`, which is the kitchen's and says things like
--    "use the old tip". Stored HERE and not read from Square (Mark): minis,
--    giants and letters are not in Square at all.
--
-- 2. `show_on_inquiry_form` FLIPS TO HIDE-BY-EXCEPTION. 051 made it opt-in
--    ("Mark ticks the menu once"); Mark, today: "we can allow them to 'ask' us
--    to make any regular donut that is currently active", and the same for
--    minis, giants and letters. So the default becomes TRUE and every row is
--    switched on EXCEPT the ones measured as not-a-menu-item on 2026-09-24:
--    the `Custom …` placeholders (Custom Mini, Custom Giant, Custom Letter,
--    Custom Bar / Bismark / Bullseye / Promise Ring) and `Misc` (an ice cream
--    container). The name still reads correctly either way, so it is kept.
--    The menu ALSO requires a price, so an unpriced item is off the page until
--    somebody prices it — a public page naming a donut with no number beside
--    it is the question this whole feature exists to answer.
--
-- 3. `production_item_price(item, location)` — `lib/productionPrice.ts`'s
--    `resolveItemPrice`, in SQL, because an anon caller cannot read the three
--    price tables and 133's gate must RE-PRICE what the customer sends rather
--    than trust it. Same cascade, same order, same trimmed case-insensitive
--    (class, tier) match, and the same refusal to invent a cell for an item
--    missing either half. Keep the two in step BY HAND; the harness compares
--    them over every live item.
--
-- 4. `inquiry_menu(org, location)` — the page's one read, `anon`, named for its
--    one caller (044's rule). Returns only what a customer may see: id, name,
--    category, price, description. Never cost, never `price_class` /
--    `price_tier`, never the taxonomy beyond the four categories.
--    Plus `rules`: the minimums, the rush terms, the tax rate of the shop the
--    prices came from, and whether a delivery estimate is on offer.
--
-- 5. Settings, only written if absent (051's idiom):
--    `special_orders.inquiry_minimums` — Mark, 2026-09-24: 24 regular donuts;
--    24 minis in total with 6 per flavour; 10 letters; 1 giant. EACH CATEGORY
--    THAT IS ORDERED MEETS ITS OWN (his answer to "is 12 regulars + 1 giant
--    fine?" — no).
--    `special_orders.delivery` — base fee + per mile from ONE origin shop, up to
--    a maximum distance. Seeded EMPTY: an estimate is only offered once
--    somebody fills in the numbers in Settings.
--
-- Depends on 037, 051, 057. RERUNNABLE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The customer-facing description
-- ----------------------------------------------------------------------------
alter table production_items
  add column if not exists public_description text;

comment on column production_items.public_description is
  'What the public inquiry form tells a customer this flavour is. Not the '
  'kitchen''s notes. The menu falls back to a same-named item''s description, '
  'so a flavour is described once across its sizes.';


-- ----------------------------------------------------------------------------
-- 2. Hide by exception
-- ----------------------------------------------------------------------------
alter table production_items
  alter column show_on_inquiry_form set default true;

-- Only rows still at 051's untouched FALSE are considered, and only once: the
-- marker below stops a re-run from switching back on something Mark has since
-- switched off.
update production_items
   set show_on_inquiry_form = not (name ilike 'Custom %' or coalesce(item_type, '') = 'Misc')
 where not show_on_inquiry_form
   and not exists (
     select 1 from orgs o
      where o.id = production_items.org_id
        and coalesce(o.settings -> 'special_orders', '{}'::jsonb) ? 'inquiry_minimums'
   );

drop index if exists production_items_inquiry_idx;
create index if not exists production_items_inquiry_idx
  on production_items (org_id) where show_on_inquiry_form and is_active;


-- ----------------------------------------------------------------------------
-- 5. Settings (before the functions, and before the marker above is set)
-- ----------------------------------------------------------------------------
update orgs
   set settings = jsonb_set(
         settings,
         '{special_orders}',
         coalesce(settings -> 'special_orders', '{}'::jsonb) || jsonb_build_object(
           'inquiry_minimums', jsonb_build_object(
             'regular', 24,
             'mini', 24,
             'mini_per_flavor', 6,
             'letter', 10,
             'giant', 1
           ),
           'delivery', jsonb_build_object(
             'origin_location_id', null,
             'base_fee', null,
             'per_mile', null,
             'max_miles', null
           )
         )
       )
 where not (coalesce(settings -> 'special_orders', '{}'::jsonb) ? 'inquiry_minimums');


-- ----------------------------------------------------------------------------
-- 3. What an item sells for at a shop
-- ----------------------------------------------------------------------------
create or replace function public.production_item_price(p_item uuid, p_location uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_item  production_items%rowtype;
  v_cell  production_price_grid%rowtype;
  v_price numeric;
begin
  select * into v_item from production_items where id = p_item;
  if not found then
    return null;
  end if;

  -- 1. The item's own price at this shop.
  if p_location is not null then
    select pil.price_override into v_price
      from production_item_locations pil
     where pil.item_id = p_item and pil.location_id = p_location;
    if v_price is not null then
      return v_price;
    end if;
  end if;

  -- No cell without BOTH halves (`findCell`).
  if nullif(btrim(coalesce(v_item.price_class, '')), '') is null
     or nullif(btrim(coalesce(v_item.price_tier, '')), '') is null then
    return null;
  end if;

  select g.* into v_cell
    from production_price_grid g
   where g.org_id = v_item.org_id
     and lower(btrim(g.price_class)) = lower(btrim(v_item.price_class))
     and lower(btrim(g.price_tier))  = lower(btrim(v_item.price_tier))
   limit 1;
  if not found then
    return null;
  end if;

  -- 2. This shop's version of the cell.
  if p_location is not null then
    select gl.price into v_price
      from production_price_grid_locations gl
     where gl.grid_id = v_cell.id and gl.location_id = p_location;
    if v_price is not null then
      return v_price;
    end if;
  end if;

  -- 3. The org grid.
  return v_cell.price;
end;
$$;

revoke all on function public.production_item_price(uuid, uuid) from public, anon, authenticated;
grant execute on function public.production_item_price(uuid, uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- Which shop a public price is read at
-- ----------------------------------------------------------------------------
-- The pickup shop when one was chosen and is real; otherwise the delivery
-- origin; otherwise the org's first active physical shop by code. Shared by
-- the menu and by 133's gate, so the price a customer SEES and the price the
-- lead is WRITTEN with are read at the same shop.
create or replace function public.inquiry_price_location(p_org_id uuid, p_location_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid;
  v_origin text;
begin
  if p_location_id is not null then
    select l.id into v from locations l
     where l.id = p_location_id and l.org_id = p_org_id
       and l.is_active and l.kind = 'physical';
    if v is not null then
      return v;
    end if;
  end if;

  select o.settings -> 'special_orders' -> 'delivery' ->> 'origin_location_id'
    into v_origin from orgs o where o.id = p_org_id;
  if nullif(v_origin, '') is not null then
    begin
      select l.id into v from locations l
       where l.id = v_origin::uuid and l.org_id = p_org_id
         and l.is_active and l.kind = 'physical';
    exception when others then
      v := null;
    end;
    if v is not null then
      return v;
    end if;
  end if;

  select l.id into v from locations l
   where l.org_id = p_org_id and l.is_active and l.kind = 'physical'
   order by l.code
   limit 1;
  return v;
end;
$$;

revoke all on function public.inquiry_price_location(uuid, uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- Which of the four a menu item is — null means "not on the form"
-- ----------------------------------------------------------------------------
create or replace function public.inquiry_category(p_subtype text, p_size text)
returns text
language sql
immutable
as $$
  select case
    when lower(btrim(coalesce(p_subtype, ''))) = 'letter' then 'letter'
    when lower(btrim(coalesce(p_size, ''))) = 'regular' then 'regular'
    when lower(btrim(coalesce(p_size, ''))) = 'mini'    then 'mini'
    when lower(btrim(coalesce(p_size, ''))) = 'giant'   then 'giant'
    else null
  end;
$$;

revoke all on function public.inquiry_category(text, text) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 4. The menu
-- ----------------------------------------------------------------------------
-- NEVER RAISES; an unknown org gets an empty menu, as `inquiry_shops` does.
create or replace function public.inquiry_menu(p_org_id uuid, p_location_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
  v_so       jsonb;
  v_loc      uuid;
  v_tax      numeric;
  v_items    jsonb;
  v_delivery jsonb;
begin
  if p_org_id is null then
    return jsonb_build_object('items', '[]'::jsonb, 'rules', '{}'::jsonb);
  end if;
  select o.settings into v_settings from orgs o where o.id = p_org_id;
  if not found then
    return jsonb_build_object('items', '[]'::jsonb, 'rules', '{}'::jsonb);
  end if;
  v_so := coalesce(v_settings -> 'special_orders', '{}'::jsonb);
  v_delivery := coalesce(v_so -> 'delivery', '{}'::jsonb);

  v_loc := inquiry_price_location(p_org_id, p_location_id);
  select l.tax_rate into v_tax from locations l where l.id = v_loc;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'name', m.name,
           'category', m.category,
           'price', m.price,
           'description', m.description
         ) order by m.category, lower(m.name)), '[]'::jsonb)
    into v_items
    from (
      select pi.id, pi.name,
             inquiry_category(pi.subtype, pi.size) as category,
             production_item_price(pi.id, v_loc) as price,
             coalesce(
               nullif(btrim(coalesce(pi.public_description, '')), ''),
               (select nullif(btrim(s.public_description), '')
                  from production_items s
                 where s.org_id = pi.org_id
                   and lower(btrim(s.name)) = lower(btrim(pi.name))
                   and nullif(btrim(coalesce(s.public_description, '')), '') is not null
                 order by (lower(coalesce(s.size, '')) = 'regular') desc, s.created_at
                 limit 1)
             ) as description
        from production_items pi
       where pi.org_id = p_org_id
         and pi.is_active
         and pi.show_on_inquiry_form
         and inquiry_category(pi.subtype, pi.size) is not null
         -- A shop that has said "not here" for this item (043's only per-shop no).
         and not exists (
           select 1 from production_item_locations pil
            where pil.item_id = pi.id and pil.location_id = v_loc and not pil.is_active
         )
    ) m
   where m.price is not null;

  return jsonb_build_object(
    'items', v_items,
    'rules', jsonb_build_object(
      'minimums', coalesce(v_so -> 'inquiry_minimums', '{}'::jsonb),
      'rush', jsonb_build_object(
        'cutoff_business_days', coalesce((v_so ->> 'rush_cutoff_business_days')::numeric, 2),
        'minimum', coalesce((v_so ->> 'rush_minimum')::numeric, 25),
        'rate', coalesce((v_so ->> 'rush_rate')::numeric, 0.30)
      ),
      'tax_rate', v_tax,
      -- Whether to offer the estimate at all — the NUMBERS stay server-side and
      -- only a computed fee ever leaves (`inquiry-delivery-quote`).
      'delivery_estimate',
        nullif(v_delivery ->> 'origin_location_id', '') is not null
        and nullif(v_delivery ->> 'per_mile', '') is not null,
      'timezone', coalesce(v_settings ->> 'timezone', 'UTC')
    )
  );
end;
$$;

revoke all on function public.inquiry_menu(uuid, uuid) from public, anon, authenticated;
grant execute on function public.inquiry_menu(uuid, uuid) to anon, authenticated;


notify pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   select count(*) from production_items where is_active and show_on_inquiry_form;
--     -> about 235 (246 active less the Custom placeholders and Misc)
--   select jsonb_array_length(public.inquiry_menu('<org>', null) -> 'items');
--     -> the priced subset of those
--   select public.inquiry_menu(null);  -> {"items": [], "rules": {}}

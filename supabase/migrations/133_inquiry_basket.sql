-- ============================================================================
-- 133 — THE INQUIRY CARRIES A BASKET (special orders 4b, the gate)
-- ============================================================================
-- 132 gave the public form a menu; this is the write. `create_inquiry` gains
-- ONE argument, `p_items`, and the lead it creates now carries the customer's
-- picks as real `special_order_items` — so whoever answers it edits a draft
-- instead of retyping prose. It is still a LEAD (Mark, 2026-09-24: "it's a
-- lead, not an order"); the quote remains the offer.
--
-- ----------------------------------------------------------------------------
-- WHAT CHANGED, and nothing else did
-- ----------------------------------------------------------------------------
-- 058's function is reproduced WHOLE (055's rule: a migration that restates a
-- function must restate all of it) and every changed line is marked `<<< 133`:
--
--   · the argument `p_items jsonb default '{}'`, LAST, so a caller that sends
--     only 058's fourteen named arguments — the v1 form, git tag `inquiry-v1` —
--     resolves to this function and gets 058's lead exactly. That is what makes
--     going back to v1 a code revert and not a database change (Mark: "save
--     /inquiry as it exists now in case we need to go back to it later").
--   · the basket is validated and RE-PRICED before anything is written, so a
--     refused basket leaves no customer and no lead behind. The page's prices
--     are never trusted: each line is priced with `production_item_price` at
--     `inquiry_price_location` — the same shop `inquiry_menu` priced it at.
--   · the minimums from `special_orders.inquiry_minimums`: EACH CATEGORY THAT
--     IS ORDERED MEETS ITS OWN (Mark: 24 regulars; 24 minis and 6 per flavour;
--     10 letters; 1 giant).
--   · letters are ONE LINE PER CHARACTER in the message's order, cut
--     `Letter - "A"` with the note `"A"` — `AddOrderLine`'s shape exactly. When
--     the customer named flavours but left it to us ("make it work") the line
--     is UNLINKED and priced at the average of those flavours; the app already
--     flags an unlinked line as unschedulable, which is the prompt to choose.
--   · a delivery lead with a basket takes its tax rate from the pricing shop.
--   · the raw basket joins `source_payload.inquiry`, and one log entry says
--     the lines came from the customer.
--
-- IT STILL NEVER RAISES. New states: `items_invalid`, `item_unavailable`,
-- `letter_invalid` (+ `character`), `minimum_not_met` (+ `category`,
-- `minimum`). None of them depends on who the customer is, so decision 18's
-- privacy rule — the same answer whether or not the email was known — holds.
--
-- THE SIGNATURE CHANGES, so 058's is DROPPED first: `create or replace` with a
-- new argument list makes an OVERLOAD and leaves the old one live beside it
-- (033's `freeze_pay_period` lesson), and PostgREST would then refuse a
-- 14-argument call as ambiguous. The grants are restated for the new one.
--
-- Depends on 057, 058, 132. RERUNNABLE.
-- ============================================================================

drop function if exists public.create_inquiry(uuid, text, text, text, text, text, text, uuid, text, text, text, text, text, jsonb);

create or replace function public.create_inquiry(
  p_org_id      uuid,
  p_name        text,
  p_email       text default null,
  p_phone       text default null,
  p_occasion    text default null,
  p_fulfillment text default 'pickup',
  p_address     text default null,
  p_location_id uuid default null,
  p_event_date  text default null,
  p_event_time  text default null,
  p_interest    text default null,
  p_description text default null,
  p_allergies   text default null,
  p_meta        jsonb default '{}'::jsonb,
  p_items       jsonb default '{}'::jsonb   -- <<< 133
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings    jsonb;
  v_tz          text;
  v_today       date;
  v_name        text := nullif(btrim(coalesce(p_name, '')), '');
  v_email       text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_phone       text := nullif(btrim(coalesce(p_phone, '')), '');
  v_digits      text;
  v_fulfillment text := lower(coalesce(nullif(btrim(coalesce(p_fulfillment, '')), ''), 'pickup'));
  v_address     text := nullif(btrim(coalesce(p_address, '')), '');
  v_date        date;
  v_time        time;
  v_cap_email   integer;
  v_cap_all     integer;
  v_seen        integer;
  v_location    uuid;
  v_tax         numeric(6,5);
  v_customer    uuid;
  v_first       text;
  v_last        text;
  v_number      text;
  v_order       uuid;
  v_notes       text;
  -- <<< 133: the customer's basket
  v_mins        jsonb;
  v_price_loc   uuid;
  v_lines       jsonb := '[]'::jsonb;
  v_r           jsonb;
  v_c           jsonb;
  v_id          uuid;
  v_ids         uuid[];
  v_assign      uuid[];
  v_chars       text[];
  v_char        text;
  v_pi          production_items%rowtype;
  v_cat         text;
  v_price       numeric;
  v_avg         numeric;
  v_qty         integer;
  v_sets        integer;
  v_line_note   text;
  v_flavor_names text;
  v_n_regular   integer := 0;
  v_n_mini      integer := 0;
  v_n_giant     integer := 0;
  v_n_letter    integer := 0;
  v_mini_by     jsonb := '{}'::jsonb;
  v_min         integer;
  v_i           integer;
  v_sort        integer := 0;
begin
  -- --- the org, and everything configured on it -----------------------------
  if p_org_id is null then
    return jsonb_build_object('ok', false, 'state', 'unknown_org');
  end if;

  select o.settings into v_settings from orgs o where o.id = p_org_id;
  if not found then
    return jsonb_build_object('ok', false, 'state', 'unknown_org');
  end if;

  -- A public page has no session, so `lib/today` is unreachable and the org's
  -- own zone is the only honest source for "today". 007's lesson: from 5pm in
  -- Los Angeles a UTC host is already tomorrow.
  v_tz := coalesce(v_settings ->> 'timezone', 'UTC');
  v_today := (now() at time zone v_tz)::date;

  -- --- THE HONEYPOT ---------------------------------------------------------
  -- Decided HERE rather than in the edge function so the gate holds the whole
  -- rule, and answered with the ORDINARY state so a bot cannot tell that its
  -- submission went nowhere.
  if nullif(btrim(coalesce(p_meta ->> 'honeypot', '')), '') is not null then
    return jsonb_build_object('ok', true, 'state', 'received');
  end if;

  -- --- validation, all of it a returned state -------------------------------
  if v_name is null then
    return jsonb_build_object('ok', false, 'state', 'name_required');
  end if;

  -- One way to reach them, or the lead is unactionable and a supervisor is
  -- left with a name and a wish.
  if v_email is null and v_phone is null then
    return jsonb_build_object('ok', false, 'state', 'contact_required');
  end if;

  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'state', 'email_invalid');
  end if;

  if v_fulfillment not in ('pickup', 'delivery') then
    return jsonb_build_object('ok', false, 'state', 'fulfillment_invalid');
  end if;

  if nullif(btrim(coalesce(p_event_date, '')), '') is not null then
    if btrim(p_event_date) !~ '^\d{4}-\d{2}-\d{2}$' then
      return jsonb_build_object('ok', false, 'state', 'date_invalid');
    end if;
    begin
      v_date := btrim(p_event_date)::date;
    exception when others then
      -- '2026-02-31' has the right shape and is not a day.
      return jsonb_build_object('ok', false, 'state', 'date_invalid');
    end;
  end if;

  if nullif(btrim(coalesce(p_event_time, '')), '') is not null then
    if btrim(p_event_time) !~ '^\d{2}:\d{2}(:\d{2})?$' then
      return jsonb_build_object('ok', false, 'state', 'time_invalid');
    end if;
    begin
      v_time := btrim(p_event_time)::time;
    exception when others then
      return jsonb_build_object('ok', false, 'state', 'time_invalid');
    end;
  end if;

  -- --- THE BASKET (133) -----------------------------------------------------
  -- <<< 133. Everything the customer picked, VALIDATED AND RE-PRICED here,
  -- before anything is written, so a refusal leaves no customer and no lead
  -- behind. The page's prices are never read: each line is priced again with
  -- `production_item_price` at the same shop `inquiry_menu` priced it at.
  --
  -- p_items = {
  --   "lines":   [{ "item_id": uuid, "qty": int, "notes": text? }],
  --   "letters": [{ "characters": ["H","I","<3"], "flavors": [uuid, …],
  --                 "assign": [uuid|null, …] | null, "sets": int }]
  -- }
  -- A 14-argument call (the v1 form, tag `inquiry-v1`) sends none of it and
  -- gets exactly 058's lead.
  --
  -- Every refusal is a returned state, like the rest of this function:
  -- `items_invalid` (malformed), `item_unavailable` (not on the menu),
  -- `letter_invalid` (a character we cannot cut), `minimum_not_met` (+ which).
  if p_items is not null and jsonb_typeof(p_items) <> 'object' then
    return jsonb_build_object('ok', false, 'state', 'items_invalid');
  end if;
  if jsonb_typeof(coalesce(p_items -> 'lines', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_items -> 'letters', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items -> 'lines', '[]'::jsonb)) > 100
     or jsonb_array_length(coalesce(p_items -> 'letters', '[]'::jsonb)) > 10 then
    return jsonb_build_object('ok', false, 'state', 'items_invalid');
  end if;

  v_mins := coalesce(v_settings -> 'special_orders' -> 'inquiry_minimums', '{}'::jsonb);
  v_price_loc := inquiry_price_location(
    p_org_id, case when v_fulfillment = 'pickup' then p_location_id else null end);

  -- Donuts, minis and giants: one line each, as picked.
  for v_r in select value from jsonb_array_elements(coalesce(p_items -> 'lines', '[]'::jsonb)) loop
    begin
      v_id := (v_r ->> 'item_id')::uuid;
    exception when others then
      return jsonb_build_object('ok', false, 'state', 'items_invalid');
    end;
    if coalesce(v_r ->> 'qty', '') !~ '^\d{1,4}$' then
      return jsonb_build_object('ok', false, 'state', 'items_invalid');
    end if;
    v_qty := (v_r ->> 'qty')::int;
    if v_qty < 1 or v_qty > 2000 then
      return jsonb_build_object('ok', false, 'state', 'items_invalid');
    end if;

    select pi.* into v_pi from production_items pi
     where pi.id = v_id and pi.org_id = p_org_id and pi.is_active and pi.show_on_inquiry_form
       and not exists (select 1 from production_item_locations pil
                        where pil.item_id = pi.id and pil.location_id = v_price_loc and not pil.is_active);
    if not found then
      return jsonb_build_object('ok', false, 'state', 'item_unavailable');
    end if;
    v_cat := inquiry_category(v_pi.subtype, v_pi.size);
    v_price := production_item_price(v_pi.id, v_price_loc);
    if v_cat is null or v_cat = 'letter' or v_price is null then
      return jsonb_build_object('ok', false, 'state', 'item_unavailable');
    end if;

    if v_cat = 'regular' then v_n_regular := v_n_regular + v_qty;
    elsif v_cat = 'giant' then v_n_giant := v_n_giant + v_qty;
    else
      v_n_mini := v_n_mini + v_qty;
      v_mini_by := v_mini_by || jsonb_build_object(
        v_pi.id::text, coalesce((v_mini_by ->> v_pi.id::text)::int, 0) + v_qty);
    end if;

    -- `AddOrderLine`'s snapshot, field for field (`addedLineName`: a Mini or
    -- Giant says so in the name; Regular is the unstated default).
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'item_id', v_pi.id,
      'name', v_pi.name || case when v_cat in ('mini', 'giant') then ' - ' || btrim(v_pi.size) else '' end,
      'item_donut', v_pi.name, 'item_type', v_pi.item_type, 'item_cut', v_pi.subtype,
      'item_finish', v_pi.finish, 'item_size', v_pi.size,
      'qty', v_qty, 'unit_price', v_price,
      'notes', left(nullif(btrim(coalesce(v_r ->> 'notes', '')), ''), 500)
    ));
  end loop;

  -- Letters: ONE LINE PER CHARACTER, in the message's order, because on a
  -- letter order the sequence IS the word and the decorator lays it out from
  -- the lines (04g, "the lines keep the order's own sequence"). The cut is
  -- `letterCut`'s canonical `Letter - "A"`, the note is `"A"` as FileMaker's
  -- always were, and qty is the number of SETS.
  for v_r in select value from jsonb_array_elements(coalesce(p_items -> 'letters', '[]'::jsonb)) loop
    if jsonb_typeof(v_r -> 'characters') is distinct from 'array'
       or jsonb_typeof(v_r -> 'flavors') is distinct from 'array'
       or jsonb_array_length(v_r -> 'characters') not between 1 and 200
       or jsonb_array_length(v_r -> 'flavors') not between 1 and 10
       or coalesce(v_r ->> 'sets', '') !~ '^\d{1,2}$' then
      return jsonb_build_object('ok', false, 'state', 'items_invalid');
    end if;
    v_sets := (v_r ->> 'sets')::int;
    if v_sets < 1 or v_sets > 50 then
      return jsonb_build_object('ok', false, 'state', 'items_invalid');
    end if;

    -- The character set is `LETTER_CHARACTERS` in lib/specialOrderLines.ts —
    -- the cuts twelve years of orders hold. Keep the two in step by hand.
    select array_agg(upper(btrim(x)) order by o) into v_chars
      from jsonb_array_elements_text(v_r -> 'characters') with ordinality as t(x, o);
    foreach v_char in array v_chars loop
      if not (v_char ~ '^[A-Z0-9]$' or v_char in ('<3', '!', '?', '&', '+', '-')) then
        return jsonb_build_object('ok', false, 'state', 'letter_invalid', 'character', v_char);
      end if;
    end loop;

    -- The flavours: each must be a LETTER item on the menu.
    begin
      select array_agg(x::uuid order by o) into v_ids
        from jsonb_array_elements_text(v_r -> 'flavors') with ordinality as t(x, o);
      if jsonb_typeof(v_r -> 'assign') = 'array' then
        if jsonb_array_length(v_r -> 'assign') <> array_length(v_chars, 1) then
          return jsonb_build_object('ok', false, 'state', 'items_invalid');
        end if;
        select array_agg(case when jsonb_typeof(x) = 'null' then null else (x #>> '{}')::uuid end order by o)
          into v_assign
          from jsonb_array_elements(v_r -> 'assign') with ordinality as t(x, o);
      else
        v_assign := null;
      end if;
    exception when others then
      return jsonb_build_object('ok', false, 'state', 'items_invalid');
    end;

    v_avg := 0;
    v_flavor_names := null;
    foreach v_id in array v_ids loop
      select pi.* into v_pi from production_items pi
       where pi.id = v_id and pi.org_id = p_org_id and pi.is_active and pi.show_on_inquiry_form
         and not exists (select 1 from production_item_locations pil
                          where pil.item_id = pi.id and pil.location_id = v_price_loc and not pil.is_active);
      if not found or inquiry_category(v_pi.subtype, v_pi.size) is distinct from 'letter' then
        return jsonb_build_object('ok', false, 'state', 'item_unavailable');
      end if;
      v_price := production_item_price(v_pi.id, v_price_loc);
      if v_price is null then
        return jsonb_build_object('ok', false, 'state', 'item_unavailable');
      end if;
      v_avg := v_avg + v_price;
      v_flavor_names := concat_ws(', ', v_flavor_names, v_pi.name);
    end loop;
    v_avg := round(v_avg / array_length(v_ids, 1), 2);

    -- ONE flavour and no assignment is not ambiguous: every letter is that one.
    if v_assign is null and array_length(v_ids, 1) = 1 then
      v_assign := array_fill(v_ids[1], array[array_length(v_chars, 1)]);
    end if;

    for v_i in 1 .. array_length(v_chars, 1) loop
      v_char := v_chars[v_i];
      v_id := case when v_assign is null then null else v_assign[v_i] end;
      if v_id is not null then
        if not (v_id = any (v_ids)) then
          return jsonb_build_object('ok', false, 'state', 'items_invalid');
        end if;
        select pi.* into v_pi from production_items pi where pi.id = v_id;
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'item_id', v_pi.id,
          'name', v_pi.name || ' - Letter ' || v_char,
          'item_donut', v_pi.name, 'item_type', v_pi.item_type,
          'item_cut', 'Letter - "' || v_char || '"',
          'item_finish', v_pi.finish, 'item_size', v_pi.size,
          'qty', v_sets, 'unit_price', production_item_price(v_pi.id, v_price_loc),
          'notes', '"' || v_char || '"'
        ));
      else
        -- "MAKE IT WORK": the customer gave flavours and left the spelling of
        -- them to us. The line is UNLINKED on purpose — the app already says a
        -- line with no production item cannot be scheduled, which is exactly
        -- the prompt somebody needs to pick the flavour. Priced at the average
        -- of the flavours they chose, which is what "estimate" means here.
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'item_id', null,
          'name', 'Letter ' || v_char || ' (flavor to be chosen)',
          'item_donut', null, 'item_type', null,
          'item_cut', 'Letter - "' || v_char || '"',
          'item_finish', null, 'item_size', 'Regular',
          'qty', v_sets, 'unit_price', v_avg,
          'notes', '"' || v_char || '" — flavors: ' || v_flavor_names
        ));
      end if;
    end loop;

    v_n_letter := v_n_letter + array_length(v_chars, 1) * v_sets;
  end loop;

  -- THE MINIMUMS (Mark, 2026-09-24): EACH CATEGORY THAT IS ORDERED MEETS ITS
  -- OWN. A category left empty is not short — a giant-only order is fine.
  v_min := coalesce((v_mins ->> 'regular')::int, 0);
  if v_n_regular > 0 and v_n_regular < v_min then
    return jsonb_build_object('ok', false, 'state', 'minimum_not_met', 'category', 'regular', 'minimum', v_min);
  end if;
  v_min := coalesce((v_mins ->> 'mini')::int, 0);
  if v_n_mini > 0 and v_n_mini < v_min then
    return jsonb_build_object('ok', false, 'state', 'minimum_not_met', 'category', 'mini', 'minimum', v_min);
  end if;
  v_min := coalesce((v_mins ->> 'mini_per_flavor')::int, 0);
  if exists (select 1 from jsonb_each_text(v_mini_by) e where e.value::int < v_min) then
    return jsonb_build_object('ok', false, 'state', 'minimum_not_met', 'category', 'mini_per_flavor', 'minimum', v_min);
  end if;
  v_min := coalesce((v_mins ->> 'letter')::int, 0);
  if v_n_letter > 0 and v_n_letter < v_min then
    return jsonb_build_object('ok', false, 'state', 'minimum_not_met', 'category', 'letter', 'minimum', v_min);
  end if;
  v_min := coalesce((v_mins ->> 'giant')::int, 0);
  if v_n_giant > 0 and v_n_giant < v_min then
    return jsonb_build_object('ok', false, 'state', 'minimum_not_met', 'category', 'giant', 'minimum', v_min);
  end if;

  -- --- THE CAPS -------------------------------------------------------------
  -- Both answer with `received`, which is the same thing a successful
  -- submission is told. That covers a double-tapped button and a nuisance
  -- identically, and tells a prober nothing about either.
  v_cap_email := coalesce((v_settings -> 'special_orders' ->> 'inquiry_max_per_email_per_hour')::int, 3);
  v_cap_all   := coalesce((v_settings -> 'special_orders' ->> 'inquiry_max_per_hour')::int, 30);

  select count(*) into v_seen
    from special_orders so
   where so.org_id = p_org_id
     and so.source = 'inquiry'
     and so.created_at > now() - interval '1 hour';
  if v_seen >= v_cap_all then
    return jsonb_build_object('ok', true, 'state', 'received');
  end if;

  if v_email is not null then
    select count(*) into v_seen
      from special_orders so
     where so.org_id = p_org_id
       and so.source = 'inquiry'
       and so.created_at > now() - interval '1 hour'
       and lower(so.contact_email) = v_email;
    if v_seen >= v_cap_email then
      return jsonb_build_object('ok', true, 'state', 'received');
    end if;
  end if;

  -- --- the pickup shop ------------------------------------------------------
  -- A shop that is not this org's, not active or not physical is DROPPED rather
  -- than refused: a stale form left open in a tab must not cost somebody their
  -- inquiry, and a null pickup shop is an ordinary state (187 of 8,330 real
  -- orders name one at all).
  if p_location_id is not null then
    select l.id, l.tax_rate into v_location, v_tax
      from locations l
     where l.id = p_location_id
       and l.org_id = p_org_id
       and l.is_active
       and l.kind = 'physical';
  end if;

  -- <<< 133: a basket was priced at `v_price_loc`; a DELIVERY lead has no
  -- pickup shop and so no tax rate, which would make the lead's total quietly
  -- tax-free. Take the rate from the shop its prices came from. Only when there
  -- IS a basket, so a v1-shaped call still writes exactly 058's lead.
  if v_tax is null and jsonb_array_length(v_lines) > 0 then
    select l.tax_rate into v_tax from locations l where l.id = v_price_loc;
  end if;

  -- --- MATCH OR CREATE THE CUSTOMER, INTERNALLY -----------------------------
  -- Email first, then phone — 051 created the two indexes for exactly this and
  -- says so. The phone comparison strips punctuation, so it does NOT use
  -- `customers_phone_idx`; over 5,874 rows that is a few milliseconds, and
  -- matching '(323) 337-7966' against '3233377966' is worth more than the
  -- index, because the alternative is a duplicate customer every time.
  --
  -- WHATEVER HAPPENS HERE, THE ANSWER BELOW IS THE SAME.
  if v_email is not null then
    select c.id into v_customer
      from customers c
     where c.org_id = p_org_id and lower(c.email) = v_email
     order by c.created_at
     limit 1;
  end if;

  if v_customer is null and v_phone is not null then
    v_digits := nullif(regexp_replace(v_phone, '\D', '', 'g'), '');
    if length(coalesce(v_digits, '')) >= 7 then
      select c.id into v_customer
        from customers c
       where c.org_id = p_org_id
         and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_digits
       order by c.created_at
       limit 1;
    end if;
  end if;

  if v_customer is null then
    -- `lib/customerSearch`'s `splitName`: split on the LAST space, and an
    -- unsplittable name becomes the LAST name. "Brittany" is a real
    -- submission, and inventing a first name for her would be worse than
    -- leaving it null.
    if position(' ' in v_name) > 0 then
      v_first := btrim(left(v_name, length(v_name) - position(' ' in reverse(v_name))));
      v_last  := btrim(right(v_name, position(' ' in reverse(v_name)) - 1));
    else
      v_first := null;
      v_last  := v_name;
    end if;

    insert into customers (org_id, first_name, last_name, phone, email, source, source_payload)
    values (p_org_id, nullif(v_first, ''), nullif(v_last, ''), v_phone, v_email, 'inquiry',
            jsonb_build_object('inquiry', coalesce(p_meta, '{}'::jsonb)))
    returning id into v_customer;
  end if;

  -- --- the number -----------------------------------------------------------
  -- Directly, for the reason in the header. NOT `next_special_order_number`.
  v_number := nextval('special_order_number_seq')::text;

  -- --- what they told us ----------------------------------------------------
  -- The coarse "what are you interested in" leads the description rather than
  -- taking a column: it is one of a handful of category words, and a column for
  -- it would be a vocabulary to maintain for a field a supervisor reads once.
  v_notes := btrim(concat_ws(
    E'\n\n',
    nullif(btrim(coalesce(p_interest, '')), ''),
    nullif(btrim(coalesce(p_description, '')), '')
  ));

  insert into special_orders (
    org_id, number, kind, status, todo, flag_reason,
    customer_id, contact_name, contact_phone, contact_email, allergen_info,
    title, event_date, event_time,
    location_id, fulfillment, delivery_address,
    tax_rate, date_initiated,
    notes_general, source, source_payload
  )
  values (
    p_org_id, v_number, 'order', 'lead', 'Respond to Email/Call', 'New Inquiry',
    v_customer, v_name, v_phone, v_email,
    nullif(btrim(coalesce(p_allergies, '')), ''),
    -- FMP's Event_Description. The occasion IS the title on these — "Child's
    -- bday", "Anniversary" — and a lead with no title is a blank row in a list.
    coalesce(nullif(btrim(coalesce(p_occasion, '')), ''), 'Website inquiry'),
    v_date, v_time,
    v_location, v_fulfillment,
    -- THE ADDRESS IS NOT EVIDENCE OF DELIVERY. Measured over the three real
    -- Square submissions: two are PICKUPS that carry an address anyway (the
    -- form asked regardless) and one omits the field entirely. Writing it to
    -- `delivery_address` unconditionally would print a customer's home address
    -- on a kitchen document for an order they are collecting themselves. It is
    -- kept in `source_payload` either way.
    case when v_fulfillment = 'delivery' then v_address else null end,
    v_tax, v_today,
    nullif(v_notes, ''), 'inquiry',
    jsonb_build_object(
      'inquiry', jsonb_build_object(
        'name', v_name, 'email', v_email, 'phone', v_phone,
        'occasion', p_occasion, 'fulfillment', v_fulfillment, 'address', v_address,
        'location_id', p_location_id, 'event_date', p_event_date, 'event_time', p_event_time,
        'interest', p_interest, 'description', p_description, 'allergies', p_allergies,
        'items', p_items                                              -- <<< 133
      ),
      'meta', coalesce(p_meta, '{}'::jsonb)
    )
  )
  returning id into v_order;

  -- 055's insert trigger has already written "Order started as a lead", and it
  -- is AUTHORLESS here — `auth.uid()` is null for an anon caller, so
  -- `log_special_order_event` finds no `org_members` row. That is honest;
  -- nobody signed in started this. What it does not say is where it came from.
  insert into special_order_events (org_id, order_id, message, author, source)
  values (p_org_id, v_order, 'Inquiry received from the website', 'Website', 'app');

  -- <<< 133: the basket becomes the lead's lines, in the order picked. 054's
  -- line trigger logs each ("Added …", authorless, which is honest); this
  -- entry says where they came from.
  for v_r in select value from jsonb_array_elements(v_lines) loop
    v_sort := v_sort + 1;
    insert into special_order_items (
      org_id, order_id, sort, production_item_id,
      name, item_donut, item_type, item_cut, item_finish, item_size,
      notes, qty, unit_price, taxable
    ) values (
      p_org_id, v_order, v_sort, (v_r ->> 'item_id')::uuid,
      v_r ->> 'name', v_r ->> 'item_donut', v_r ->> 'item_type', v_r ->> 'item_cut',
      v_r ->> 'item_finish', v_r ->> 'item_size',
      v_r ->> 'notes', (v_r ->> 'qty')::numeric, (v_r ->> 'unit_price')::numeric, true
    );
  end loop;

  if v_sort > 0 then
    insert into special_order_events (org_id, order_id, message, author, source)
    values (p_org_id, v_order,
            'Items proposed by the customer on the website (' || v_sort
              || case when v_sort = 1 then ' line)' else ' lines)' end,
            'Website', 'app');
  end if;

  return jsonb_build_object(
    'ok', true,
    'state', 'created',
    'order_id', v_order,
    'org_id', p_org_id,
    'number', v_number,
    'contact_name', v_name,
    'contact_email', v_email,
    'lines', v_sort                                                   -- <<< 133
  );
end;
$$;


revoke all on function public.create_inquiry(uuid, text, text, text, text, text, text, uuid, text, text, text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_inquiry(uuid, text, text, text, text, text, text, uuid, text, text, text, text, text, jsonb, jsonb)
  to anon, authenticated;


notify pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   select count(*) from pg_proc where proname = 'create_inquiry';        -> 1
--   select pronargs from pg_proc where proname = 'create_inquiry';        -> 15
--   select prosecdef from pg_proc where proname = 'create_inquiry';       -> true
--
-- And, as `anon`, a basket short of a minimum is refused without writing:
--   select public.create_inquiry(p_org_id => '<org>', p_name => 'Probe',
--     p_email => 'probe@example.com',
--     p_items => '{"lines":[{"item_id":"<a regular>","qty":12}]}');
--   -> {"ok": false, "state": "minimum_not_met", "category": "regular", "minimum": 24}

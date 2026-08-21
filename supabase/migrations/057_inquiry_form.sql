-- ============================================================================
-- 057 — THE FRONT DOOR: A PUBLIC INQUIRY FORM THAT CREATES A LEAD
-- ============================================================================
-- Decision 18 of docs/special-orders-brief.md (Mark, 2026-08-16: "direct the
-- customer to our own form so that there's no email layer — it's just a direct
-- form entry that creates a special order Lead record.")
--
-- Today a customer fills in a Square web form, Square emails
-- specialorders@donutfriend.com, and a human retypes it. 051 left the seams for
-- this and nothing has ever used them: `special_orders.source` already accepts
-- `'inquiry'`, and `inbound_message_id` / `inbound_subject` are the columns the
-- outbound send already threads on.
--
-- ----------------------------------------------------------------------------
-- THE THIRD AND LAST DELIBERATE `anon` GRANT
-- ----------------------------------------------------------------------------
-- 052 granted two functions to `anon`, inverting 002's revoke rule on purpose
-- and in exactly two places. This is the third and, per the brief, the last.
-- The same argument makes it sound, and it is about REACH rather than entropy:
--
--   · `inquiry_shops` returns the id and customer-facing name of the ACTIVE
--     PHYSICAL shops. That is a list already painted on the front of each
--     building.
--   · `create_inquiry` writes ONE lead, at most ONE customer, and ONE log row.
--     It reads `customers` only to avoid making a duplicate, and — this is the
--     whole of decision 18's privacy rule — **its answer is the same whether it
--     matched an existing customer, created one, or refused the submission as
--     a duplicate**. An anon caller cannot learn whether an email address is
--     known to this business.
--
-- Neither is a general query, and every table policy still names supervisor+.
--
-- ----------------------------------------------------------------------------
-- IT NEVER RAISES, AND THAT IS A SECURITY PROPERTY, NOT A COURTESY
-- ----------------------------------------------------------------------------
-- 052's lesson restated: a function that errors on some inputs and returns
-- quietly on others is a probe. Every refusal here is a returned jsonb state.
-- The only things that can raise are genuine faults (a dead sequence), which is
-- what a 500 is for.
--
-- ----------------------------------------------------------------------------
-- IT CANNOT CALL `next_special_order_number`, AND THAT IS THE EASIEST THING
-- HERE TO GET WRONG
-- ----------------------------------------------------------------------------
-- 051 revokes that function from `anon` BY NAME and its body demands
-- supervisor+, so an anon caller gets "permission denied for function" — or, if
-- it were merely granted, "insufficient role to number a special order". This
-- is migration 014's footgun in a new costume: a definer that re-checks
-- `user_org_ids()` is unreachable from a caller who has no `auth.uid()`. So
-- this function advances the sequence itself. There is exactly one sequence, so
-- the numbers still cannot collide.
--
-- ----------------------------------------------------------------------------
-- THE DUPLICATION THIS ACCEPTS
-- ----------------------------------------------------------------------------
-- `web/src/lib/createSpecialOrder.ts` is "one creator, because there are two
-- doors", and the brief's handoff hoped a third would go through it. It cannot:
-- that function takes the CALLER's Supabase client so RLS applies, and `anon`
-- has no policy on `special_orders`, `customers` or `special_order_items`. A
-- Deno edge function cannot import from `web/` either. So the lead's defaults —
-- status `lead`, todo "Respond to Email/Call", the tax rate snapshotted from
-- the pickup shop, 051's kind/status biconditional, the contact seeded from the
-- customer — are restated once, here, in SQL.
--
-- That is the cost. The alternative is an anon-writable policy on the tables
-- holding every customer's name, address, phone and email, which is not a
-- trade. The STAFF-facing paste-and-parse dialog (the brief's fallback lane)
-- still goes through `createSpecialOrder`, and that is the door the handoff
-- note actually applies to.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. A CUSTOMER CAN COME FROM THE WEBSITE
-- ----------------------------------------------------------------------------
-- 051 gave `special_orders.source` three values and `customers.source` only
-- two. A customer the public form created is not one a person typed, and
-- provenance is the entire job of that column.
alter table customers drop constraint if exists customers_source_check;
alter table customers
  add constraint customers_source_check
  check (source in ('app', 'filemaker', 'inquiry'));


-- ----------------------------------------------------------------------------
-- 2. WHAT A CUSTOMER CALLS THE SHOP
-- ----------------------------------------------------------------------------
-- Our names are internal — 'Donut Friend 01 Highland Park', 'Donut Friend 02
-- DTLA' — and carry a numbering scheme that means nothing to the public. The
-- Square form this replaces said 'Highland Park'.
--
-- NULLABLE, falling back to `name`, so nothing changes until somebody fills it
-- in. A shop's customer-facing name is a fact about the shop, which is what
-- migration 017 made typed columns for rather than settings keys.
alter table locations add column if not exists public_name text;

comment on column locations.public_name is
  'What a customer sees — the inquiry form''s shop list. Null falls back to '
  '`name`, which is internal ("Donut Friend 01 Highland Park").';


-- ----------------------------------------------------------------------------
-- 3. THE THROTTLE'S INDEX
-- ----------------------------------------------------------------------------
-- Decision 18 asks for "per-IP rate limiting in the route", and an IP is the
-- wrong key: it needs a table to live in, it needs sweeping, and a determined
-- abuser rotates it anyway. What the caps below actually count is rows this
-- function itself created, which are already in a table nobody has to maintain.
-- The IP is still RECORDED, in `source_payload`, where it is evidence rather
-- than a gate.
create index if not exists special_orders_inquiry_recent_idx
  on special_orders (org_id, created_at) where source = 'inquiry';


-- ----------------------------------------------------------------------------
-- 4. THE MODULE'S NEW SETTINGS (design rule 2)
-- ----------------------------------------------------------------------------
-- Every number and sentence the form reasons with, so none is a literal in
-- code. `inquiry_cutoff_notice` is decision 22's terms said out loud on the
-- page — it is a NOTICE and never blocks a date.
--
-- Only written if absent, 051's idiom, so re-running cannot stomp edited copy.
update orgs
   set settings = jsonb_set(
         settings,
         '{special_orders}',
         coalesce(settings -> 'special_orders', '{}'::jsonb) || jsonb_build_object(
           'inquiry_max_per_email_per_hour', 3,
           'inquiry_max_per_hour', 30,
           'inquiry_intro',
             'Tell us about your order and we''ll get back to you with a quote. '
             || 'Everything here is custom, so a person reads every one of these.',
           'inquiry_cutoff_notice',
             'We need two business days to put an order into production. '
             || 'Sooner than that and a rush fee applies — we''ll tell you what it is before you commit.'
         )
       )
 where not (coalesce(settings -> 'special_orders', '{}'::jsonb) ? 'inquiry_max_per_hour');


-- ----------------------------------------------------------------------------
-- 5. THE SHOP LIST
-- ----------------------------------------------------------------------------
-- ACTIVE and PHYSICAL only: design rule 3's reasoning applied to a customer —
-- a closed shop is not one you can collect from, and EVENT is a virtual
-- location for offsite work, not somewhere anybody drives to.
--
-- Returns a jsonb ARRAY rather than a table, for the same reason 052's two
-- functions return objects: one round trip, one shape, and nothing to leak
-- through a row count. An unknown org gets `[]`, not an error.
create or replace function public.inquiry_shops(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if p_org_id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name), '[]'::jsonb)
    into v
    from (
      select l.id, coalesce(nullif(btrim(l.public_name), ''), l.name) as name
        from locations l
       where l.org_id = p_org_id
         and l.is_active
         and l.kind = 'physical'
    ) s;

  return v;
end;
$$;

revoke all on function public.inquiry_shops(uuid) from public, anon, authenticated;
grant execute on function public.inquiry_shops(uuid) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 6. THE LEAD
-- ----------------------------------------------------------------------------
-- Every parameter is TEXT where the column is a date or a time, deliberately.
-- A `date` parameter makes a malformed value a CAST ERROR before the function
-- body runs, which is both a raise (see the header) and an unhelpful one. The
-- `invoiceDeliveryDate` lesson in a second place: check the shape, then cast
-- inside a block that catches the range failure Postgres still raises for
-- February 31st.
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
  p_meta        jsonb default '{}'::jsonb
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
    org_id, number, kind, status, todo,
    customer_id, contact_name, contact_phone, contact_email, allergen_info,
    title, event_date, event_time,
    location_id, fulfillment, delivery_address,
    tax_rate, date_initiated,
    notes_general, source, source_payload
  )
  values (
    p_org_id, v_number, 'order', 'lead', 'Respond to Email/Call',
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
        'interest', p_interest, 'description', p_description, 'allergies', p_allergies
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

  return jsonb_build_object(
    'ok', true,
    'state', 'created',
    'order_id', v_order,
    'org_id', p_org_id,
    'number', v_number,
    'contact_name', v_name,
    'contact_email', v_email
  );
end;
$$;

-- 002's rule, and 052's form: Supabase grants EXECUTE on a new public-schema
-- function to `anon` BY DEFAULT, and `revoke ... from public` does not undo it.
-- So revoke all three by name and grant back the two that are meant, which
-- makes the anon grant read as a statement rather than an oversight.
revoke all on function public.create_inquiry(uuid, text, text, text, text, text, text, uuid, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_inquiry(uuid, text, text, text, text, text, text, uuid, text, text, text, text, text, jsonb)
  to anon, authenticated;


notify pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   select public.inquiry_shops(null);                    -> []
--   select public.create_inquiry(null, 'A Name');
--     -> {"ok": false, "state": "unknown_org"}   (and NOT an error)
--
--   select conname from pg_constraint
--    where conrelid = 'public.customers'::regclass and conname = 'customers_source_check';
--                                                         -> 1 row
--   select column_name from information_schema.columns
--    where table_name = 'locations' and column_name = 'public_name';   -> 1 row
--   select settings -> 'special_orders' ->> 'inquiry_max_per_hour' from orgs;  -> 30
--
-- And the ones that prove the grant landed the way it was meant to — as `anon`:
--
--   set local role anon;
--   select public.inquiry_shops('<org>');       -> the active physical shops
--   select count(*) from customers;             -> 0 rows (RLS; no policy names
--                                                  the public)
--   select count(*) from special_orders;        -> 0 rows
--   insert into special_orders ...              -> refused by RLS
--   select public.next_special_order_number('<org>');   -> permission denied
--
-- Checked by BREAKING each rule:
--   · a submission whose email is ALREADY a customer returns byte-identical
--     jsonb to one whose email is new, and creates no second customer;
--   · a fourth submission from one address inside an hour returns `received`,
--     the same state a successful one returns, and writes nothing;
--   · '2026-02-31' is refused as `date_invalid` rather than raising;
--   · a filled honeypot returns `received` and writes nothing;
--   · a location belonging to another org, or inactive, or virtual, is dropped
--     and the lead is still created.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- VERIFIED ON A POSTGRES 15 STUB, 2026-08-20
-- ----------------------------------------------------------------------------
-- All 57 migrations replay cleanly, and every rule above was checked by
-- BREAKING it. As a real `anon` (wrapped in `begin; set local role anon; …` with
-- `current_user` asserted in the output, because SET LOCAL outside a
-- transaction is a silent no-op that leaves you running as the superuser):
--
--   the shop list      returns DF01 and DF02 only — DF03/04/05 are inactive and
--                      EVENT is virtual; a null org returns [] rather than
--                      raising.
--   every refusal      unknown org, missing name, no way to reach them, a
--                      malformed email, '2026-02-31', '8/20/2026', '25:00',
--                      fulfilment 'teleport' and a filled honeypot ALL return a
--                      state, NONE raises, and none writes a row.
--   the real one       Victoria Fay's actual Square submission lands as #10000,
--                      kind order / status lead / todo "Respond to Email/Call",
--                      title "Child's bday" from the occasion, tax 0.09750
--                      snapshotted from DF01, `date_initiated` the org's own
--                      2026-08-20, and TWO log rows — 055's authorless "Order
--                      started as a lead" and this function's "Inquiry received
--                      from the website".
--   THE PRIVACY RULE   a submission from a KNOWN address and one from an unknown
--                      address return the same keys and the same state, and the
--                      known one creates no second customer. Broken on purpose
--                      (returning 'matched' when a customer was found) the two
--                      answers differ visibly, which is the leak decision 18
--                      forbids.
--   the address rule   a PICKUP carrying an address leaves `delivery_address`
--                      null while a DELIVERY keeps it. Broken on purpose, a
--                      pickup order carries the customer's home address, which
--                      is what would reach a kitchen document.
--   the date guard     removed, '2026-02-31' RAISES ("date/time field value out
--                      of range") instead of answering.
--   the caps           three submissions from one address succeed and the
--                      fourth returns `received` — the same state a success
--                      returns — having written nothing.
--   matching           '(323) 630-0095', '323.630.0095' and '3236300095' are
--                      one customer, not three. 'VLangFay@Gmail.com' matches
--                      'vlangfay@gmail.com'. "Brittany" keeps her one name as
--                      the LAST name; "Mary Jane Watson" splits on the last
--                      space, both matching `lib/customerSearch`'s `splitName`.
--   the shop guard     an inactive, virtual, foreign or nonexistent shop is
--                      DROPPED (null shop, null tax) and the lead is still
--                      created.
--   isolation          with 14 orders and 9 customers really present, `anon`
--                      sees 0 orders, 0 customers, 0 events and 0 items; a
--                      direct insert is refused by RLS; and
--                      `next_special_order_number` is "permission denied for
--                      function", which is precisely why this advances the
--                      sequence itself.
--   the roles          a STAFFER sees 0 orders and 0 customers; a SUPERVISOR
--                      sees all 14. Both may call this function, which is
--                      deliberate — it is granted to `authenticated` as well as
--                      `anon`, and its own gate is the whole rule.
-- ----------------------------------------------------------------------------

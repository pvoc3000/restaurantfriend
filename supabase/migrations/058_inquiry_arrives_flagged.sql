-- ============================================================================
-- 058 — A NEW INQUIRY ARRIVES FLAGGED
-- ============================================================================
-- Mark, 2026-08-21, having walked the form end to end: "we should automatically
-- 'flag' new orders 'New Inquiry' so they're easily noticed."
--
-- 057 created the lead with a to-do and nothing else, so it joined the list as
-- an ordinary row among 8,330 others. `flag_reason` is what this module already
-- has for "look at this one": it colours the row red, `needsAttention` returns
-- it ahead of every derived reason, and `orderProgress` paints the whole bar.
--
-- ----------------------------------------------------------------------------
-- IT IS ITS OWN MIGRATION RATHER THAN AN EDIT TO 057
-- ----------------------------------------------------------------------------
-- 055's rule, and the reason it is worth keeping: 057 is APPLIED. Once a
-- migration has run it is history, and a file that no longer describes what was
-- run is how the harness and production quietly stop being the same database.
-- 057's function is `create or replace`, so re-pasting an edited copy would
-- have worked; the ledger is the reason not to.
--
-- The function is therefore reproduced here IN FULL, changed in exactly two
-- places — the column list and the values list. Nothing else in 057 is touched:
-- not the grants (a `create or replace` keeps them), not the tables, not the
-- settings.
--
-- ----------------------------------------------------------------------------
-- WHY THE TO-DO STAYS "RESPOND TO EMAIL/CALL"
-- ----------------------------------------------------------------------------
-- The app's own flag path (`OrderActions.flag`) sets `flag_reason` AND `todo`
-- to "Resolve Issue" in one statement, because a flag raised by a person names
-- a problem and resolving it IS the next action. A new inquiry is not that: the
-- next action is to answer the customer, and "Resolve Issue" on a lead nobody
-- has read yet describes nothing.
--
-- So the two say different things on purpose — the FLAG is "look at this", the
-- TO-DO is "what to do about it". The manual to-do overrides the derived hint
-- on display (decision 4), so it is what the list shows.
--
-- KNOWN CONSEQUENCE, AND IT IS THE INTENDED ARC: resolving clears BOTH columns,
-- so pressing "Resolve the issue" on a new inquiry also clears
-- "Respond to Email/Call". That is not a loss — with the flag gone,
-- `suggestedTodo` takes over and returns "Send Quote" for a lead with no quote
-- out, which is the actual next step once you have read the thing. Arriving
-- flagged and leaving with a quote to send is the whole loop.
-- ============================================================================


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


-- `create or replace` preserves the grants 057 made, so `anon` and
-- `authenticated` keep EXECUTE and nothing here re-states them. The argument
-- list is UNCHANGED, which is what makes that true — changing it would create
-- an OVERLOAD and leave 057's version live beside this one, which is 033's
-- lesson about `freeze_pay_period`.


notify pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   select count(*) from pg_proc where proname = 'create_inquiry';   -> 1
--     (ONE, not two — a second row means the argument list drifted and both
--      versions are live.)
--
--   select prosecdef from pg_proc where proname = 'create_inquiry'; -> true
--
-- And the behaviour, as `anon` — a fresh submission must come back flagged:
--
--   set local role anon;
--   select public.create_inquiry('<org>', 'A Name', 'nobody@example.com');
--   select number, status, todo, flag_reason from special_orders
--    where source = 'inquiry' order by created_at desc limit 1;
--     -> lead | Respond to Email/Call | New Inquiry
--
-- Existing inquiry leads are deliberately NOT backfilled. A flag means "look at
-- this one", and retroactively raising it on orders somebody has already read
-- would say something untrue about them.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- VERIFIED ON A POSTGRES 15 STUB, 2026-08-21
-- ----------------------------------------------------------------------------
-- All 58 migrations replay cleanly. As a real `anon` (wrapped in
-- `begin; set local role anon; …` with `current_user` asserted, because SET
-- LOCAL outside a transaction is a silent no-op that leaves you as the
-- superuser):
--
--   the flag       a fresh submission lands `lead` / "Respond to Email/Call" /
--                  "New Inquiry" — the to-do and the flag saying different
--                  things, which is the point.
--   NO OVERLOAD    `select count(*) from pg_proc where proname =
--                  'create_inquiry'` is ONE, and `prosecdef` is still true.
--                  Two rows would mean the argument list drifted and 057's
--                  version was still live beside this one — 033's
--                  `freeze_pay_period` lesson, which is why the signature here
--                  is copied rather than retyped.
--   THE GRANTS     `anon` and `authenticated` still hold EXECUTE, without this
--                  migration re-stating them: `create or replace` preserves
--                  them, and the check is here because a `drop`+`create` would
--                  silently have taken them away and the failure would only
--                  show on the public form.
-- ----------------------------------------------------------------------------

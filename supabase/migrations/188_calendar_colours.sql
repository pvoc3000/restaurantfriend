-- ============================================================================
-- 188 — A COLOUR OF ITS OWN FOR AN ENTRY AND FOR A SUBSCRIBED CALENDAR
--
-- Mark, 2026-10-10: "we either need to be able to choose the colors of events
-- ourselves, or override the default colors, or both", then "organisation-wide
-- is right, go ahead and build it".
--
-- THREE PLACES A COLOUR CAN COME FROM, most particular first:
--
--   1. the entry's own, or the subscribed calendar's own — the two columns
--      added here;
--   2. the organisation's choice for the layer — `orgs.settings.calendar.
--      colors`, a jsonb map of layer → colour, which needs no migration;
--   3. the layer's default, in web/src/lib/calendarColors.ts.
--
-- A BLACKOUT IS NEVER COLOURED: it is drawn solid dark whatever its `color`
-- says, so a closed day looks the same every time. And an order, a delivery or
-- a task has no colour of its own — its layer's colour means something.
--
-- THE VALUE IS A PALETTE KEY ("teal"), not a hex code. The palette lives in
-- the web app, where each swatch is a checked pair of fill and type; the check
-- here only keeps rubbish out, and an unknown key simply draws as the default.
--
-- RERUNNABLE. Needs 181 and 186.
-- ============================================================================

alter table calendar_entries
  add column if not exists color text
    check (color is null or color ~ '^[a-z]{2,20}$');

comment on column calendar_entries.color is
  'A palette key from web/src/lib/calendarColors.ts, or null for the layer''s '
  'colour. Ignored on a blackout, which is always drawn dark.';

alter table calendar_subscriptions
  add column if not exists color text
    check (color is null or color ~ '^[a-z]{2,20}$');

comment on column calendar_subscriptions.color is
  'A palette key from web/src/lib/calendarColors.ts, or null for the '
  'subscribed-calendars layer''s colour.';

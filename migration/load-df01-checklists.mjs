/**
 * DF01's opening and closing checklists, from Mark's own PDFs (2026-08-30).
 *
 * Transcribed VERBATIM from `pdftotext -layout` rather than retyped by eye, so
 * the prompts are exactly what the paper says — including two typos ("fillout
 * out complely", "santized", "toilet bush") and the "Opening:" / "EoS:"
 * prefixes the opening list carries. Correcting somebody's own document while
 * copying it is not a thing to do quietly; they are one inline edit each.
 *
 * WHAT IT WRITES
 *   · 8 new shop sections — "Outside", and seven FOH stations (Mark's call:
 *     "we can add them, but keep them in the same sort range as the other FOH
 *     sections", so they sit at 60.1–60.7, inside FOH's existing 60–69 band and
 *     ahead of its cabinets). They add nothing to the order guide: a section
 *     with no inventory assigned renders no band there.
 *   · 2 checklist templates, 105 items.
 *
 * SECTION MAPPING (Mark's: use the area-level sections already there)
 *   OUTSIDE            → Outside            (new)
 *   LOBBY              → FOH Lobby          (new)
 *   POS/REGISTER       → FOH Register       (new)
 *   ICE CREAM STATION  → FOH Ice Cream Station (new)
 *   DIY STATION        → FOH DIY Station    (new)
 *   COFFEE STATION     → FOH Coffee Station (new)
 *   BACK COUNTER       → FOH Back Counter   (new)
 *   DISPLAY CASE       → FOH Display Case   (new)
 *   BATHROOM           → 50 Bathroom
 *   BOH                → 10 Kitchen
 *   MOP ROOM           → Kitchen Dish Pit   (Mark: "the mop station is
 *                        basically in the dish pit")
 *   BREAK ROOM         → 40 Break
 *   OFFICE             → Office
 *
 * IDEMPOTENT. Sections are matched by display_name before being created, and a
 * template is matched by (location, name) — re-running replaces its items
 * rather than doubling them. `--wipe` removes both templates entirely.
 *
 *   node --env-file=.env load-df01-checklists.mjs            # dry run
 *   node --env-file=.env load-df01-checklists.mjs --apply
 *   node --env-file=.env load-df01-checklists.mjs --apply --wipe
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

const APPLY = process.argv.includes("--apply");
const WIPE = process.argv.includes("--wipe");

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// The sections these lists walk
// ---------------------------------------------------------------------------
// `sort_order` is numeric(8,2) — the column FMP fills with 09.5 and 13.1, and
// which "10.5 Kitchen Stairs" already uses — so the seven FOH stations slot in
// at 60.1–60.7 without renumbering a single existing row.
const NEW_SECTIONS = [
  { display_name: "Outside", area: "Outside", sub_area: null, sort_order: 0 },
  { display_name: "FOH Lobby", area: "FOH", sub_area: "Lobby", sort_order: 60.1 },
  { display_name: "FOH Register", area: "FOH", sub_area: "Register", sort_order: 60.2 },
  { display_name: "FOH Ice Cream Station", area: "FOH", sub_area: "Ice Cream Station", sort_order: 60.3 },
  { display_name: "FOH DIY Station", area: "FOH", sub_area: "DIY Station", sort_order: 60.4 },
  { display_name: "FOH Coffee Station", area: "FOH", sub_area: "Coffee Station", sort_order: 60.5 },
  { display_name: "FOH Back Counter", area: "FOH", sub_area: "Back Counter", sort_order: 60.6 },
  { display_name: "FOH Display Case", area: "FOH", sub_area: "Display Case", sort_order: 60.7 },
];

/** The paper's heading → the shop section it belongs to. */
const SECTION_FOR = {
  OUTSIDE: "Outside",
  LOBBY: "FOH Lobby",
  "POS/REGISTER": "FOH Register",
  "ICE CREAM STATION": "FOH Ice Cream Station",
  "DIY STATION": "FOH DIY Station",
  "COFFEE STATION": "FOH Coffee Station",
  "BACK COUNTER": "FOH Back Counter",
  "DISPLAY CASE": "FOH Display Case",
  BATHROOM: "50 Bathroom",
  BOH: "10 Kitchen",
  "MOP ROOM": "Kitchen Dish Pit",
  "BREAK ROOM": "40 Break",
  OFFICE: "Office",
};

// ---------------------------------------------------------------------------
// The two lists. [prompt, position, guidance] — the paper's four columns less
// its checkbox, in the paper's own order.
// ---------------------------------------------------------------------------
const OPENING = {
  name: "DF01 Opening",
  shift: "opening",
  sections: [
    ["OUTSIDE", [
      ["Windows and doors cleaned"],
      ["Sidewalk swept"],
    ]],
    ["POS/REGISTER", [
      ["Opening: Check wall and tablets for any tablet orders."],
      ["Opening: Check for any phone orders."],
      ["Opening: Check for any special orders."],
      ["Opening: Update Tablets"],
      ["Opening: Change Pandora station to DF station of the day. Connect to Denon system and adjust volume to 56 if necessary."],
      ["EoS: Cash Counted"],
    ]],
    ["LOBBY", [
      ["Opening: Floor mat put down."],
      ["Opening: Drink cooler light turned on and screen opened."],
      ["Opening: Take down closed sign."],
    ]],
    ["COFFEE STATION", [
      ["Opening: Espresso machine/grinder dialed in"],
      ["Opening: Fill ice drop in. Re-stock cups, lids, straws, etc. if necessary."],
      ["Opening: Make a pot of coffee - dump used grounds and close flip-top lid when done brewing. Set timer for 3 hours."],
      ["Opening: Put out 3 rags - 1. On top of espresso machine for steam wands ONLY, 2. On top of milk fridge for cleaning coffee area, 3. Tucked under/covering espresso dump bin."],
    ]],
    ["DISPLAY CASE", [
      ["EoS: Condense donuts from BOH to display. Restock front trays."],
    ]],
    ["BOH", [
      ["Baker's table clean", "Baker"],
      ["Proof box clean", "Baker", "water emptied"],
      ["Mixers clean", "Baker"],
      ["Fryer filtered and cleaned", "Fryer", "replace filter on Tue/Fri/Sun. Clean floors and interior"],
      ["Appliances cleaned", "Fryer"],
      ["All stations cleaned", null, "including shelving above"],
      ["Glaze pans cleaned, restocked, dated", "Assistant Baker", "flip container as needed"],
      ["Premade toppings cleaned, restocked, dated", "Assistant Baker", "flip container as needed"],
      ["Ingredient bins restocked", "Assistant Baker", "flip container as needed"],
      ["Wipe down speed racks."],
      ["Handsink cleaned & restocked"],
      ["Drains clean"],
      ["Trash removed"],
      ["Dishes done and put away"],
      ["Floors swept and mopped", null, "under tables and ingredient bins"],
      // "fillout out complely" is the paper's own typo, kept verbatim.
      ["Production logs fillout out complely", "Baker"],
      ["Deliveries dated and put away (FIFO)", null, "double check walk in"],
      ["Cold brew made/diluted", null, "if needed"],
    ]],
    ["OFFICE", [
      ["EoS: Report Sent"],
    ]],
  ],
};

const CLOSING = {
  name: "DF01 Closing",
  shift: "closing",
  sections: [
    ["OUTSIDE", [
      ["DF Trash can brought in and bag replaced"],
      ["City trashcan cleared of excess trash"],
      ["Sidewalk swept and clean"],
      ["Spot clean doors and window"],
    ]],
    ["LOBBY", [
      ["Trash cans by door changed.", null, "Sunday: wipe inside of cabinet thoroughly"],
      ["Sneeze guards cleaned and sanitized", null, "Sunday: wipe down baseboards"],
      // "santized" is the paper's own typo, kept verbatim.
      ["Barrier above donut display wiped and santized"],
      ["Customer side of POS wiped down"],
      ["Beverage merchandiser restocked"],
      ["Floors swept and mopped"],
      ["Hand sanitizer wiped down & refilled"],
      ["Wall display reorganized", null, "plants and boxes"],
    ]],
    ["POS/REGISTER", [
      ["Cash counted, dropped and reloaded", "Supervisor"],
      ["Register magic erased, counters sanitized"],
    ]],
    ["ICE CREAM STATION", [
      ["Plastic utensils and cups restocked"],
      ["Scoopers and tools washed"],
      ["Signs cleaned and stowed"],
      ["Ice cream tubs covered"],
    ]],
    ["DIY STATION", [
      ["Sanitizer buckets emptied"],
      ["Refrigerated items stowed"],
      ["Glaze containers swapped out"],
      ["Spoons & utensils washed"],
      ["Toppings covered and wrapped"],
    ]],
    ["COFFEE STATION", [
      ["Area completely wiped down", "Supervisor"],
      ["All dirty towels taken out", "Supervisor"],
      ["Coffee grinder closed, emptied and brushed out", "Supervisor"],
      ["Coffee urn emptied, rinsed with Cafiza and left open to dry.", "Supervisor"],
      ["Tamper and rubber tamp mat washed and replaced", "Supervisor"],
      ["All dishes on top of espresso machine and catch tray washed and replaced", "Supervisor"],
      ["Espresso knock box washed and replaced with towel,", "Supervisor"],
      ["Espresso machine wiped down/polished and set up for next day including towels", "Supervisor"],
      ["Espresso portafilters soaked in hot water and Cafiza for at least 10 minutes.  Clean steam wands.", "Supervisor"],
      ["Espresso grinder closed, brushed, turned off", "Supervisor"],
    ]],
    ["BACK COUNTER", [
      ["All surfaces sanitized"],
      ["Floors swept, scraped, and mopped", null, "including behind lowboys"],
      ["All lowboy doors closed completely"],
      ["Floor sinks scrubbed with hot bleach water and treated with enzyme cleaner. Fill with ice"],
      ["Milks restocked to par"],
      ["All lowboys wiped down inside and out", null, "clean gaskets"],
      ["Cups and lids restocked to par"],
      ["Counters cleaned and spot magic erased"],
      ["Tablets charging"],
      ["Milkshake machine cleaned and sanitized"],
    ]],
    ["DISPLAY CASE", [
      ["Premades counted and packaged"],
      ["Boxes restocked"],
      ["Counter wiped down & sanitized"],
      ["Inside of sneeze guard clean"],
      ["Display case wiped down"],
    ]],
    ["BATHROOM", [
      ["Wipe down paper towel dispenser, sink, mirror, soap dispenser, trashcan and handicap rails."],
      // "toilet bush" is the paper's own typo, kept verbatim.
      ["Toilet cleaned inside and out, use toilet bush."],
      ["Walls underneath paper towel dispenser and soap dispenser wiped thoroughly."],
      ["Trash changed."],
      ["Paper towels and soap re-filled."],
      ["Toilet paper and paper towels above toilet re-stocked."],
      ["Floor swept, spot scraped, and mopped."],
      ["Door handle and surrounding areas wiped on both sides."],
    ]],
    ["BOH", [
      ["All trash taken out"],
      ["Floors swept and mopped"],
      ["Floor sinks scrubbed with hot bleach water and treated with enzyme cleaner"],
      ["All surfaces sanitized"],
      ["All sinks emptied, cleaned & sanitized"],
      ["Speed racks clean"],
      ["Kitchen doors cleaned both sides", null, "plus windows"],
    ]],
    ["MOP ROOM", [
      ["Mops hung correctly. Mop bucket emptied."],
      ["Chemicals restocked. Empty bottles removed."],
    ]],
    ["BREAK ROOM", [
      ["Break room cleaned and sanitized"],
      ["Check trash room for loose boxes"],
    ]],
    ["OFFICE", [
      ["Supervisor log completed", "Supervisor", "including employee comments"],
      ["Special orders printed", "Supervisor"],
      ["Trash taken out", "Supervisor"],
    ]],
  ],
};

// ---------------------------------------------------------------------------

const say = (s) => console.log(s);
const key = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");

async function main() {
  const { data: org } = await db.from("orgs").select("id").limit(1).single();
  const { data: loc } = await db
    .from("locations")
    .select("id, code, open_days")
    .eq("code", "DF01")
    .single();

  say(`${APPLY ? "APPLYING" : "DRY RUN"} — ${loc.code}, org ${org.id.slice(0, 8)}…\n`);

  if (WIPE) {
    for (const name of [OPENING.name, CLOSING.name]) {
      const { data } = await db
        .from("checklist_templates")
        .select("id")
        .eq("location_id", loc.id)
        .eq("name", name);
      for (const t of data ?? []) {
        say(`  wipe: ${name}`);
        if (APPLY) await db.from("checklist_templates").delete().eq("id", t.id);
      }
    }
    if (!APPLY) say("\n(dry run — nothing removed)");
    return;
  }

  // ── 1. Sections ──────────────────────────────────────────────────────────
  let { data: sections } = await db
    .from("shop_sections")
    .select("id, display_name")
    .eq("location_id", loc.id);
  let byName = new Map((sections ?? []).map((s) => [key(s.display_name), s]));

  say("SECTIONS");
  const toCreate = NEW_SECTIONS.filter((s) => !byName.has(key(s.display_name)));
  for (const s of NEW_SECTIONS) {
    const have = byName.has(key(s.display_name));
    say(`  ${have ? "exists " : "CREATE "} ${String(s.sort_order).padStart(5)}  ${s.display_name}`);
  }
  if (APPLY && toCreate.length > 0) {
    const { error } = await db.from("shop_sections").insert(
      toCreate.map((s) => ({ org_id: org.id, location_id: loc.id, ...s })),
    );
    if (error) throw new Error(`sections: ${error.message}`);
    ({ data: sections } = await db
      .from("shop_sections")
      .select("id, display_name")
      .eq("location_id", loc.id));
    byName = new Map((sections ?? []).map((s) => [key(s.display_name), s]));
  }

  // Every heading must resolve, or the walk would lose its shape silently.
  const missing = [...new Set(Object.values(SECTION_FOR))].filter(
    (n) => !byName.has(key(n)) && !toCreate.some((c) => key(c.display_name) === key(n)),
  );
  if (missing.length > 0) throw new Error(`no such section: ${missing.join(", ")}`);

  // ── 2. Templates ─────────────────────────────────────────────────────────
  for (const list of [OPENING, CLOSING]) {
    say(`\n${list.name.toUpperCase()}  (${list.shift})`);

    const { data: existing } = await db
      .from("checklist_templates")
      .select("id")
      .eq("location_id", loc.id)
      .eq("name", list.name)
      .maybeSingle();

    let templateId = existing?.id ?? null;
    if (APPLY) {
      if (templateId) {
        // Re-running REPLACES the items rather than doubling them. Safe because
        // a run snapshots its own copy — 076 decision 1 — so reloading the
        // master cannot touch a walk anybody has already done.
        await db.from("checklist_template_items").delete().eq("template_id", templateId);
      } else {
        const { data, error } = await db
          .from("checklist_templates")
          .insert({
            org_id: org.id,
            location_id: loc.id,
            kind: "checklist",
            name: list.name,
            // Every day the shop is open — `locations.open_days` (017) rather
            // than a hardcoded 1–7, so a shop that closes on Mondays says so.
            weekdays: loc.open_days,
            shifts: [list.shift],
          })
          .select("id")
          .single();
        if (error) throw new Error(`${list.name}: ${error.message}`);
        templateId = data.id;
      }
    }

    const rows = [];
    for (const [heading, items] of list.sections) {
      const section = byName.get(key(SECTION_FOR[heading]));
      say(`  ${heading.padEnd(18)} → ${SECTION_FOR[heading].padEnd(22)} ${items.length} item${items.length === 1 ? "" : "s"}`);
      items.forEach(([prompt, position, guidance], i) => {
        rows.push({
          org_id: org.id,
          template_id: templateId,
          shop_section_id: section?.id ?? null,
          // Ten apart, so an item can be slipped between two without a
          // renumber. Between-section order comes from the SECTION's own
          // sort_order, which is the shop's canonical walk.
          sort: (i + 1) * 10,
          prompt,
          response_type: "check",
          position: position ?? null,
          guidance: guidance ?? null,
          requires_photo: false,
          is_active: true,
          // A UNIFORM key set on every row: PostgREST unions the keys across a
          // bulk insert and sends explicit NULL for any a row omits, which
          // defeats column defaults — `requires_photo` is not null.
          unit: null,
          min_value: null,
          max_value: null,
          choices: null,
          equipment_id: null,
          weekdays: null,
        });
      });
    }

    const positions = rows.filter((r) => r.position).length;
    const guided = rows.filter((r) => r.guidance).length;
    say(`  ── ${rows.length} items · ${positions} name a position · ${guided} carry a note`);

    if (APPLY) {
      const { data, error } = await db
        .from("checklist_template_items")
        .insert(rows)
        .select("id");
      if (error) throw new Error(`${list.name} items: ${error.message}`);
      say(`  ✓ wrote ${data.length}`);
    }
  }

  if (!APPLY) say("\n(dry run — nothing written. Re-run with --apply)");
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
